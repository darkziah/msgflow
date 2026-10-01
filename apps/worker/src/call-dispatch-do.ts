import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import {
	CALL_DISPATCH_NONCE_HEADER,
	CALL_DISPATCH_SIGNATURE_HEADER,
	CALL_DISPATCH_TIMESTAMP_HEADER,
	callDispatchInternalHeaders,
	type CallDispatchOffer,
} from "./call-dispatch-client";

interface CallIdentity {
	workspaceId: string;
	userId: string;
}

interface CallSocketAttachment extends CallIdentity {
	socketId: string;
}

interface CallRingEvent {
	type: "call:ring";
	callId: string;
	conversationId: string;
	queueId: string;
	expiresAt: string;
	contact: {
		id: string;
		displayName: string | null;
		avatarUrl: string | null;
	};
}

interface OfferInput extends CallDispatchOffer {
	ringGroupId: string;
}

const HEARTBEAT_MS = 45_000;
const INTERNAL_MAX_AGE_MS = 60_000;
export { callDispatchInternalHeaders } from "./call-dispatch-client";

/** One hibernating WebSocket fanout per workspace for browser call notifications. */
export class CallDispatchDO extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") return this.handleUpgrade(request);
		if (url.pathname === "/presence" && request.method === "PATCH") return this.updatePresence(request);
		if (url.pathname === "/offer" && request.method === "POST") return this.offer(request);
		return new Response("not found", { status: 404 });
	}

	private async handleUpgrade(request: Request): Promise<Response> {
		const identity = await this.authenticatedIdentity(request);
		if (!identity) return new Response("forbidden", { status: 403 });
		const pair = new WebSocketPair();
		const { 0: client, 1: server } = pair;
		const attachment: CallSocketAttachment = { ...identity, socketId: crypto.randomUUID() };
		this.ctx.acceptWebSocket(server, [attachment.userId]);
		server.serializeAttachment(attachment);
		await this.writeConnectedPresence(attachment.workspaceId, attachment.userId, "available");
		return new Response(null, { status: 101, webSocket: client });
	}

	private async updatePresence(request: Request): Promise<Response> {
		const rawBody = await request.text();
		const identity = await this.authenticatedIdentity(request, rawBody);
		if (!identity) return new Response("forbidden", { status: 403 });
		if (!this.hasLiveAttachment(identity)) return new Response("socket required", { status: 409 });
		let body: unknown;
		try { body = JSON.parse(rawBody); } catch { return new Response("invalid json", { status: 400 }); }
		if (!isExactRecord(body, ["status"])) return new Response("invalid presence", { status: 400 });
		const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
		if (status !== "available" && status !== "away") return new Response("status must be available or away", { status: 400 });
		await this.refreshPresence(identity.workspaceId, identity.userId, status);
		return Response.json({ status, heartbeatExpiresAt: new Date(Date.now() + HEARTBEAT_MS).toISOString() });
	}

	private async offer(request: Request): Promise<Response> {
		const rawBody = await request.text();
		const workspaceId = await this.authenticatedInternalWorkspace(request, rawBody);
		if (!workspaceId) return new Response("forbidden", { status: 403 });
		let body: unknown;
		try { body = JSON.parse(rawBody); } catch { return new Response("invalid json", { status: 400 }); }
		if (!isOfferInput(body)) return new Response("invalid offer", { status: 400 });
		const expiresAt = Date.parse(body.expiresAt);
		if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return new Response("offer expired", { status: 400 });

		const rows = await this.env.DB.prepare(
			`SELECT DISTINCT rgm.user_id AS userId
			 FROM call_queue_stages cqs
			 JOIN call_queues cq ON cq.id = cqs.queue_id AND cq.workspace_id = ? AND cq.is_enabled = 1
			 JOIN channels ch ON ch.id = cq.channel_id AND ch.workspace_id = cq.workspace_id AND ch.type = 'facebook_page' AND ch.status = 'active'
			 JOIN ring_groups rg ON rg.id = cqs.ring_group_id AND rg.workspace_id = cq.workspace_id AND rg.team_id = cq.team_id
			 JOIN ring_group_members rgm ON rgm.ring_group_id = rg.id
			 JOIN team_members tm ON tm.team_id = cq.team_id AND tm.user_id = rgm.user_id
			 JOIN workspace_members wm ON wm.workspace_id = cq.workspace_id AND wm.user_id = rgm.user_id
			 JOIN agent_call_presence p ON p.workspace_id = cq.workspace_id AND p.user_id = rgm.user_id
			 WHERE cqs.queue_id = ? AND cqs.ring_group_id = ?
			   AND p.status = 'available' AND p.socket_connected_at IS NOT NULL AND p.heartbeat_expires_at > ?`,
		).bind(workspaceId, body.queueId, body.ringGroupId, new Date().toISOString()).all<{ userId: string }>();
		const recipients = new Set(rows.results.map((row) => row.userId));
		// Reconstruct a narrow event. Never relay request objects or signaling/session fields.
		const event: CallRingEvent = {
			type: "call:ring", callId: body.callId, conversationId: body.conversationId, queueId: body.queueId,
			expiresAt: body.expiresAt, contact: { id: body.contact.id, displayName: body.contact.displayName, avatarUrl: body.contact.avatarUrl },
		};
		const delivered: Array<{ userId: string; socketId: string }> = [];
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as CallSocketAttachment | null;
			if (attachment && recipients.has(attachment.userId) && attachment.workspaceId === workspaceId) {
				socket.send(JSON.stringify(event));
				delivered.push({ userId: attachment.userId, socketId: attachment.socketId });
			}
		}
		return Response.json({ delivered });
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		const identity = socket.deserializeAttachment() as CallSocketAttachment | null;
		if (!identity) return;
		if (!this.hasLiveAttachment(identity, socket)) await this.writeOffline(identity.workspaceId, identity.userId);
	}

	async webSocketError(socket: WebSocket): Promise<void> { await this.webSocketClose(socket); }

	private async authenticatedIdentity(request: Request, rawBody = ""): Promise<CallIdentity | null> {
		const workspaceId = await this.authenticatedInternalWorkspace(request, rawBody);
		const userId = request.headers.get("x-authenticated-user-id");
		if (!workspaceId || !userId) return null;
		const member = await this.env.DB.prepare("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?").bind(workspaceId, userId).first();
		return member ? { workspaceId, userId } : null;
	}

	private async authenticatedInternalWorkspace(request: Request, rawBody = ""): Promise<string | null> {
		const workspaceId = request.headers.get("x-authenticated-workspace-id");
		const timestamp = request.headers.get(CALL_DISPATCH_TIMESTAMP_HEADER);
		const nonce = request.headers.get(CALL_DISPATCH_NONCE_HEADER);
		const supplied = request.headers.get(CALL_DISPATCH_SIGNATURE_HEADER);
		if (!workspaceId || !timestamp || !nonce || !supplied || !/^\d+$/.test(timestamp) || !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) return null;
		const age = Date.now() - Number(timestamp);
		if (!Number.isSafeInteger(Number(timestamp)) || age < -5_000 || age > INTERNAL_MAX_AGE_MS) return null;
		const expected = await callDispatchInternalHeaders(this.env.BETTER_AUTH_SECRET, request.method, new URL(request.url).pathname, workspaceId, request.headers.get("x-authenticated-user-id") ?? undefined, rawBody, timestamp, nonce);
		if (!constantTimeEqual(supplied, expected.get(CALL_DISPATCH_SIGNATURE_HEADER)!)) return null;
		const nonceKey = `capability-nonce:${nonce}`;
		if (await this.ctx.storage.get(nonceKey)) return null;
		await this.ctx.storage.put(nonceKey, Number(timestamp) + INTERNAL_MAX_AGE_MS + 5_000);
		await this.ctx.storage.setAlarm(Number(timestamp) + INTERNAL_MAX_AGE_MS + 5_000);
		return workspaceId;
	}

	async alarm(): Promise<void> {
		const now = Date.now();
		const nonces = await this.ctx.storage.list<number>({ prefix: "capability-nonce:" });
		const expired = [...nonces].filter(([, expiresAt]) => expiresAt <= now).map(([key]) => key);
		if (expired.length) await this.ctx.storage.delete(expired);
		const remaining = [...nonces.values()].filter((expiresAt) => expiresAt > now);
		if (remaining.length) await this.ctx.storage.setAlarm(Math.min(...remaining));
	}

	private hasLiveAttachment(identity: CallIdentity, excluding?: WebSocket): boolean {
		return this.ctx.getWebSockets().some((socket) => {
			if (socket === excluding) return false;
			const attachment = socket.deserializeAttachment() as CallSocketAttachment | null;
			return attachment?.workspaceId === identity.workspaceId && attachment.userId === identity.userId;
		});
	}

	private async writeConnectedPresence(workspaceId: string, userId: string, status: "available" | "away"): Promise<void> {
		const now = new Date().toISOString();
		await this.env.DB.prepare(
			`INSERT INTO agent_call_presence (workspace_id, user_id, status, socket_connected_at, heartbeat_expires_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(workspace_id, user_id) DO UPDATE SET
			 status = excluded.status, socket_connected_at = excluded.socket_connected_at,
			 heartbeat_expires_at = excluded.heartbeat_expires_at, updated_at = excluded.updated_at`,
		).bind(workspaceId, userId, status, now, new Date(Date.now() + HEARTBEAT_MS).toISOString(), now).run();
	}

	private async refreshPresence(workspaceId: string, userId: string, status: "available" | "away"): Promise<void> {
		const now = new Date().toISOString();
		await this.env.DB.prepare(
			`UPDATE agent_call_presence SET status = ?, heartbeat_expires_at = ?, updated_at = ?
			 WHERE workspace_id = ? AND user_id = ? AND socket_connected_at IS NOT NULL`,
		).bind(status, new Date(Date.now() + HEARTBEAT_MS).toISOString(), now, workspaceId, userId).run();
	}

	private async writeOffline(workspaceId: string, userId: string): Promise<void> {
		const now = new Date().toISOString();
		await this.env.DB.prepare(
			`INSERT INTO agent_call_presence (workspace_id, user_id, status, socket_connected_at, heartbeat_expires_at, updated_at)
			 VALUES (?, ?, 'offline', NULL, NULL, ?)
			 ON CONFLICT(workspace_id, user_id) DO UPDATE SET status = 'offline', socket_connected_at = NULL, heartbeat_expires_at = NULL, updated_at = excluded.updated_at`,
		).bind(workspaceId, userId, now).run();
	}
}

function isOfferInput(value: unknown): value is OfferInput {
	if (!isExactRecord(value, ["queueId", "ringGroupId", "callId", "conversationId", "expiresAt", "contact"])) return false;
	const offer = value as Record<string, unknown>;
	return typeof offer.queueId === "string" && typeof offer.ringGroupId === "string" && typeof offer.callId === "string" &&
		typeof offer.conversationId === "string" && typeof offer.expiresAt === "string" && isExactRecord(offer.contact, ["id", "displayName", "avatarUrl"]) &&
		typeof offer.contact.id === "string" && (offer.contact.displayName === null || typeof offer.contact.displayName === "string") &&
		(offer.contact.avatarUrl === null || typeof offer.contact.avatarUrl === "string");
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function constantTimeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	return difference === 0;
}
