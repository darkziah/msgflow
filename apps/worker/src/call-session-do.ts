import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { offerCallToEligibleAgents, callDispatchInternalHeaders, CALL_DISPATCH_NONCE_HEADER, CALL_DISPATCH_SIGNATURE_HEADER, CALL_DISPATCH_TIMESTAMP_HEADER } from "./call-dispatch-client";
import { acceptMessengerInboundCall, terminateMessengerCall } from "./facebook-calling-provider";
import { appendActivity } from "./activity";
import { notifyWorkspaceConversationChange } from "./workspace-events";

const QUEUE_BUDGET_MS = 50_000;
const META_DEADLINE_MS = 60_000;

type TerminalState = "accepted" | "rejected" | "timed_out" | "terminated" | "failed";
interface Stage { ringGroupId: string; ringDurationSeconds: number; }
interface SessionState {
	callId: string;
	workspaceId: string;
	channelId: string;
	pageId: string;
	encryptedPageAccessToken: string | null;
	conversationId: string;
	queueId: string;
	contact: { id: string; displayName: string | null; avatarUrl: string | null };
	stages: Stage[];
	stageIndex: number;
	startedAt: number;
	webhookReceivedAt: number;
	deadlineAt: number;
	metaDeadlineAt: number;
	offeredAgentIds: string[];
	winner: string | null;
	state: "ringing" | TerminalState;
}
interface StartInput extends Omit<SessionState, "stageIndex" | "startedAt" | "deadlineAt" | "metaDeadlineAt" | "offeredAgentIds" | "winner" | "state"> {}

/** One serialized queue/race state machine for a provider call. */
export class CallSessionDO extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const rawBody = await request.clone().text();
		if (!(await this.authenticatedInternalWorkspace(request, rawBody))) return new Response("forbidden", { status: 403 });
		const url = new URL(request.url);
		if (url.pathname === "/start" && request.method === "POST") return this.start(request);
		if (url.pathname === "/accept" && request.method === "POST") return this.accept(request);
		if (url.pathname === "/reject" && request.method === "POST") return this.reject(request);
		if (url.pathname === "/terminate" && request.method === "POST") return this.terminate(request);
		if (url.pathname === "/metrics" && request.method === "POST") return this.metrics(request);
		if (url.pathname === "/state" && request.method === "GET") return Response.json(await this.getState());
		return new Response("not found", { status: 404 });
	}

	async alarm(): Promise<void> {
		const state = await this.getState();
		if (!state || state.state !== "ringing") return;
		if (Date.now() >= state.deadlineAt || Date.now() >= state.metaDeadlineAt) {
			await this.finish(state, "timed_out", "queue deadline");
			return;
		}
		await this.offerStage(state, state.stageIndex + 1);
	}

	private async start(request: Request): Promise<Response> {
		const existing = await this.getState();
		if (existing) return Response.json(this.publicState(existing));
		let input: StartInput;
		try { input = await request.json() as StartInput; } catch { return new Response("invalid json", { status: 400 }); }
		if (!validStart(input)) return new Response("invalid session", { status: 400 });
		const now = Date.now();
		const webhookReceivedAt = Date.parse(input.webhookReceivedAt as unknown as string);
		if (!Number.isFinite(webhookReceivedAt) || webhookReceivedAt > now + 5_000 || now - webhookReceivedAt > META_DEADLINE_MS) return new Response("expired session", { status: 400 });
		const state: SessionState = {
			...input, stageIndex: -1, startedAt: now, webhookReceivedAt,
			deadlineAt: Math.min(now + QUEUE_BUDGET_MS, webhookReceivedAt + QUEUE_BUDGET_MS), metaDeadlineAt: webhookReceivedAt + META_DEADLINE_MS,
			offeredAgentIds: [], winner: null, state: "ringing",
		};
		await this.ctx.storage.put("state", state);
		await this.offerStage(state, 0);
		return Response.json(this.publicState((await this.getState())!));
	}

	private async accept(request: Request): Promise<Response> {
		const state = await this.getState();
		if (!state) return new Response("not found", { status: 404 });
		let body: { actorId?: unknown; offerSdp?: unknown };
		try { body = await request.json(); } catch { return new Response("invalid json", { status: 400 }); }
		if (typeof body.actorId !== "string" || typeof body.offerSdp !== "string" || !body.offerSdp) return new Response("invalid actor", { status: 400 });
		if (state.state !== "ringing") return Response.json({ won: state.winner === body.actorId, state: state.state });
		if (!state.offeredAgentIds.includes(body.actorId) || !(await this.isLiveAvailableAgent(state.workspaceId, body.actorId))) return new Response("forbidden", { status: 403 });
		let answerSdp: string;
		try { answerSdp = await acceptMessengerInboundCall({ pageId: state.pageId, encryptedPageAccessToken: state.encryptedPageAccessToken, channelTokenEncryptionKey: this.env.CHANNEL_TOKEN_ENCRYPTION_KEY, providerCallId: state.callId, offerSdp: body.offerSdp }); }
		catch { return new Response("provider unavailable", { status: 502 }); }
		state.winner = body.actorId;
		state.state = "accepted";
		state.offeredAgentIds = [];
		await this.ctx.storage.put("state", state);
		await this.ctx.storage.deleteAlarm();
		await this.env.DB.batch([
			this.env.DB.prepare("UPDATE call_events SET state='accepted', accepted_by_user_id=?, updated_at=? WHERE channel_id=? AND provider_call_id=? AND state='ringing'").bind(body.actorId, new Date().toISOString(), state.channelId, state.callId),
			this.env.DB.prepare("UPDATE conversations SET assignee_id=?, updated_at=? WHERE id=? AND workspace_id=?").bind(body.actorId, new Date().toISOString(), state.conversationId, state.workspaceId),
		]);
		await notifyWorkspaceConversationChange(this.env, state.workspaceId);
		await appendActivity(this.env, { conversationId: state.conversationId, action: "call.accepted", actorId: body.actorId, details: {} });
		return Response.json({ won: true, state: state.state, answerSdp });
	}

	private async reject(request: Request): Promise<Response> {
		const state = await this.getState();
		if (!state) return new Response("not found", { status: 404 });
		let body: { actorId?: unknown; reason?: unknown };
		try { body = await request.json(); } catch { return new Response("invalid json", { status: 400 }); }
		if (typeof body.actorId !== "string" || !state.offeredAgentIds.includes(body.actorId)) return new Response("forbidden", { status: 403 });
		if (state.state !== "ringing") return Response.json(this.publicState(state));
		state.offeredAgentIds = state.offeredAgentIds.filter((id) => id !== body.actorId);
		await this.ctx.storage.put("state", state);
		if (state.offeredAgentIds.length === 0) await this.offerStage(state, state.stageIndex + 1);
		return Response.json(this.publicState((await this.getState())!));
	}
	private async terminate(request: Request): Promise<Response> { return this.actorTerminal(request, "terminated"); }
	private async actorTerminal(request: Request, outcome: "rejected" | "terminated"): Promise<Response> {
		const state = await this.getState();
		if (!state) return new Response("not found", { status: 404 });
		let body: { actorId?: unknown; reason?: unknown };
		try { body = await request.json(); } catch { return new Response("invalid json", { status: 400 }); }
		if (typeof body.actorId !== "string") return new Response("invalid actor", { status: 400 });
		if (outcome === "rejected" && !state.offeredAgentIds.includes(body.actorId) && state.winner !== body.actorId) return new Response("forbidden", { status: 403 });
		if (outcome === "terminated" && state.winner !== body.actorId) return new Response("forbidden", { status: 403 });
		if (state.state !== "ringing" && state.state !== "accepted") return Response.json(this.publicState(state));
		if (outcome === "terminated") {
			const signalled = await terminateMessengerCall({ pageId: state.pageId, encryptedPageAccessToken: state.encryptedPageAccessToken, channelTokenEncryptionKey: this.env.CHANNEL_TOKEN_ENCRYPTION_KEY, providerCallId: state.callId });
			if (!signalled) return new Response("provider unavailable", { status: 502 });
		}
		await this.finish(state, outcome, typeof body.reason === "string" ? body.reason : outcome, body.actorId);
		return Response.json(this.publicState((await this.getState())!));
	}

	private async metrics(request: Request): Promise<Response> {
		const state = await this.getState();
		if (!state) return new Response("not found", { status: 404 });
		let body: { actorId?: unknown; durationSeconds?: unknown; packetLossPercent?: unknown; jitterMilliseconds?: unknown };
		try { body = await request.json(); } catch { return new Response("invalid json", { status: 400 }); }
		if (body.actorId !== state.winner) return new Response("forbidden", { status: 403 });
		if (!Number.isInteger(body.durationSeconds) || !Number.isFinite(body.packetLossPercent) || !Number.isFinite(body.jitterMilliseconds)) return new Response("invalid metrics", { status: 400 });
		const details = { durationSeconds: body.durationSeconds as number, packetLossPercent: body.packetLossPercent as number, jitterMilliseconds: body.jitterMilliseconds as number };
		await this.env.DB.prepare("UPDATE call_events SET quality_summary_json=?, updated_at=? WHERE channel_id=? AND provider_call_id=?").bind(JSON.stringify(details), new Date().toISOString(), state.channelId, state.callId).run();
		await appendActivity(this.env, { conversationId: state.conversationId, action: "call.quality_reported", actorId: body.actorId as string, details });
		return Response.json({ success: true });
	}

	private async offerStage(state: SessionState, index: number): Promise<void> {
		if (state.state !== "ringing") return;
		if (index >= state.stages.length || Date.now() >= state.deadlineAt) { await this.finish(state, "timed_out", "no eligible agents"); return; }
		const stage = state.stages[index]!;
		const expiresAt = Math.min(state.deadlineAt, Date.now() + stage.ringDurationSeconds * 1000);
		state.stageIndex = index; state.offeredAgentIds = [];
		await this.ctx.storage.put("state", state);
		const response = await offerCallToEligibleAgents(this.env, state.workspaceId, { queueId: state.queueId, ringGroupId: stage.ringGroupId, callId: state.callId, conversationId: state.conversationId, expiresAt: new Date(expiresAt).toISOString(), contact: state.contact });
		const result = response.ok ? await response.json() as { delivered?: Array<{ userId?: unknown; socketId?: unknown }> } : {};
		// Dispatch reports the exact live socket recipients that received this offer;
		// authorization never reconstructs recipients from a later D1 snapshot.
		state.offeredAgentIds = [...new Set((result.delivered ?? []).flatMap((recipient) => typeof recipient.userId === "string" && typeof recipient.socketId === "string" ? [recipient.userId] : []))];
		await this.ctx.storage.put("state", state);
		if (!state.offeredAgentIds.length) { await this.offerStage(state, index + 1); return; }
		await appendActivity(this.env, { conversationId: state.conversationId, action: "call.offered", actorId: null, details: { status: `stage-${index + 1}` } });
		await this.ctx.storage.setAlarm(expiresAt);
	}

	private async finish(state: SessionState, outcome: TerminalState, reason: string, actorId: string | null = null): Promise<void> {
		if (state.state !== "ringing" && !(outcome === "terminated" && state.state === "accepted")) return;
		state.state = outcome; state.offeredAgentIds = [];
		await this.ctx.storage.put("state", state); await this.ctx.storage.deleteAlarm();
		await this.env.DB.prepare("UPDATE call_events SET state=?, terminal_reason=?, updated_at=? WHERE channel_id=? AND provider_call_id=?").bind(outcome, reason, new Date().toISOString(), state.channelId, state.callId).run();
		const action = outcome === "timed_out" ? "call.timed_out" : outcome === "terminated" ? "call.terminated" : "call.rejected";
		await appendActivity(this.env, { conversationId: state.conversationId, action, actorId, details: { reason } });
	}
	private async isLiveAvailableAgent(workspaceId: string, userId: string): Promise<boolean> {
		return !!(await this.env.DB.prepare("SELECT 1 FROM agent_call_presence WHERE workspace_id=? AND user_id=? AND status='available' AND socket_connected_at IS NOT NULL AND heartbeat_expires_at > ?").bind(workspaceId, userId, new Date().toISOString()).first());
	}
	private async authenticatedInternalWorkspace(request: Request, rawBody: string): Promise<string | null> {
		const workspaceId = request.headers.get("x-authenticated-workspace-id");
		const timestamp = request.headers.get(CALL_DISPATCH_TIMESTAMP_HEADER);
		const nonce = request.headers.get(CALL_DISPATCH_NONCE_HEADER);
		const supplied = request.headers.get(CALL_DISPATCH_SIGNATURE_HEADER);
		if (!workspaceId || !timestamp || !nonce || !supplied || !/^\d+$/.test(timestamp) || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) return null;
		const age = Date.now() - Number(timestamp);
		if (!Number.isSafeInteger(Number(timestamp)) || age < -5_000 || age > 60_000) return null;
		const expected = await callDispatchInternalHeaders(this.env.BETTER_AUTH_SECRET, request.method, new URL(request.url).pathname, workspaceId, request.headers.get("x-authenticated-user-id") ?? undefined, rawBody, timestamp, nonce);
		if (!constantTimeEqual(supplied, expected.get(CALL_DISPATCH_SIGNATURE_HEADER)!)) return null;
		const key = `command-nonce:${nonce}`;
		if (await this.ctx.storage.get(key)) return null;
		await this.ctx.storage.put(key, Date.now() + 65_000);
		return workspaceId;
	}
	private async getState(): Promise<SessionState | undefined> { return this.ctx.storage.get<SessionState>("state"); }
	private publicState(state: SessionState) { return { state: state.state, winner: state.winner, stageIndex: state.stageIndex, offeredAgentIds: state.offeredAgentIds }; }
}
function constantTimeEqual(left: string, right: string): boolean { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; }

function validStart(value: StartInput): value is StartInput { return !!value && typeof value.callId === "string" && typeof value.workspaceId === "string" && typeof value.channelId === "string" && typeof value.pageId === "string" && (typeof value.encryptedPageAccessToken === "string" || value.encryptedPageAccessToken === null) && typeof value.webhookReceivedAt === "string" && typeof value.conversationId === "string" && typeof value.queueId === "string" && Array.isArray(value.stages) && value.stages.length <= 50 && value.stages.every((s) => s && typeof s.ringGroupId === "string" && Number.isInteger(s.ringDurationSeconds) && s.ringDurationSeconds > 0 && s.ringDurationSeconds <= 50) && value.stages.reduce((total, stage) => total + stage.ringDurationSeconds, 0) <= 50 && !!value.contact && typeof value.contact.id === "string"; }
