import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";
import { setupInitialOwner } from "../src/setup";
import { createAuth } from "@msgflow/auth";
import { callDispatchInternalHeaders, offerCallToEligibleAgents } from "../src/call-dispatch-client";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

async function internalHeaders(workspaceId: string, userId?: string, method = "PATCH", pathname = "/presence", body = ""): Promise<Headers> {
	const headers = await callDispatchInternalHeaders(ctx.env.BETTER_AUTH_SECRET, method, pathname, workspaceId, userId, body);
	headers.set("content-type", "application/json");
	headers.set("x-authenticated-workspace-id", workspaceId);
	if (userId) headers.set("x-authenticated-user-id", userId);
	return headers;
}

async function offerHeaders(workspaceId: string, body: string): Promise<Headers> {
	return internalHeaders(workspaceId, undefined, "POST", "/offer", body);
}

test("call dispatch authenticates exact Worker capabilities, derives eligible recipients, and preserves socket liveness", async () => {
	const bundled = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/call-dispatch-worker.ts")], target: "browser", external: ["cloudflare:workers", "cloudflare:email"] });
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	ctx = await createTestDb({ script: await bundled.outputs[0]!.text() });
	const owner = await setupInitialOwner(ctx.env, { email: "owner@test.dev", password: "correct horse battery staple", username: "owner", workspaceName: "Owner", workspaceSlug: "owner", initialTeamName: "Team", initialInboxName: "Inbox" });
	await ctx.env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(owner.userId).run();
	const login = await createAuth(ctx.env).handler(new Request("https://msgflow.test/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "correct horse battery staple" }) }));
	const ownerCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
	if (!ownerCookie) throw new Error("owner sign-in did not issue a session cookie");
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await Promise.all([seedUser(ctx, "member", "member@test.dev"), seedUser(ctx, "nonmember", "nonmember@test.dev"), seedUser(ctx, "away", "away@test.dev")]);
	await ctx.env.DB.batch([
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("owner-wm", workspaceId, owner.userId, "owner", now),
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("member-wm", workspaceId, "member", "member", now),
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("nonmember-wm", workspaceId, "nonmember", "member", now),
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("away-wm", workspaceId, "away", "member", now),
		ctx.env.DB.prepare("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)").bind("team", workspaceId, "Support", now),
		ctx.env.DB.prepare("INSERT INTO team_members (id,team_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("member-tm", "team", "member", "member", now),
		ctx.env.DB.prepare("INSERT INTO ring_groups (id,workspace_id,team_id,name,strategy,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("group", workspaceId, "team", "Group", "simultaneous", now, now),
		ctx.env.DB.prepare("INSERT INTO ring_group_members (id,ring_group_id,user_id,sort_order,created_at) VALUES (?,?,?,?,?)").bind("group-member", "group", "member", 0, now),
		ctx.env.DB.prepare("INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind("channel", workspaceId, "facebook_page", "Page", "page", "active", now, now),
		ctx.env.DB.prepare("INSERT INTO call_queues (id,workspace_id,channel_id,team_id,name,is_enabled,no_agent_reply_text,timezone_id,weekly_operating_hours_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind("queue", workspaceId, "channel", "team", "Queue", 1, "Unavailable", "UTC", "{}", now, now),
		ctx.env.DB.prepare("INSERT INTO call_queue_stages (id,queue_id,ring_group_id,stage_order,ring_duration_seconds,created_at) VALUES (?,?,?,?,?,?)").bind("stage", "queue", "group", 0, 20, now),
	]);
	const namespace = await ctx.mf.getDurableObjectNamespace("CALL_DISPATCH_DO");
	ctx.env.CALL_DISPATCH_DO = namespace as typeof ctx.env.CALL_DISPATCH_DO;
	const stub = namespace.get(namespace.idFromName(workspaceId));
	const ws = async (userId: string) => {
		const headers = await internalHeaders(workspaceId, userId, "GET", "/ws");
		headers.set("Upgrade", "websocket");
		return stub.fetch("https://do/ws", { headers });
	};

	expect((await ctx.mf.dispatchFetch(`https://msgflow.test/ws/calling?workspaceId=${workspaceId}`, { headers: { Upgrade: "websocket" } })).status).toBe(401);
	expect((await ctx.mf.dispatchFetch("https://msgflow.test/ws/calling?workspaceId=foreign-workspace", { headers: { Upgrade: "websocket", cookie: ownerCookie } })).status).toBe(403);
	const publicConnection = await ctx.mf.dispatchFetch(`https://msgflow.test/ws/calling?workspaceId=${workspaceId}`, { headers: { Upgrade: "websocket", cookie: ownerCookie } });
	expect(publicConnection.status).toBe(101);
	publicConnection.webSocket!.accept();
	const publicPresence = await ctx.mf.dispatchFetch(`https://msgflow.test/api/workspaces/${workspaceId}/calling/presence`, {
		method: "PATCH",
		headers: { "content-type": "application/json", cookie: ownerCookie },
		body: JSON.stringify({ status: "away", ignored: true }),
	});
	expect(publicPresence.status).toBe(400);
	expect((await stub.fetch("https://do/offer", { method: "POST" })).status).toBe(403);
	const awayBody = JSON.stringify({ status: "away" });
	expect((await stub.fetch("https://do/presence", { method: "PATCH", headers: await internalHeaders(workspaceId, "away", "PATCH", "/presence", awayBody), body: awayBody })).status).toBe(409);

	const memberConnection = await ws("member");
	const nonmemberConnection = await ws("nonmember");
	expect(memberConnection.status).toBe(101);
	expect(nonmemberConnection.status).toBe(101);
	const memberSocket = memberConnection.webSocket!; memberSocket.accept();
	const nonmemberSocket = nonmemberConnection.webSocket!; nonmemberSocket.accept();
	const frames: string[] = []; const nonmemberFrames: string[] = [];
	memberSocket.addEventListener("message", (event) => frames.push(String(event.data)));
	nonmemberSocket.addEventListener("message", (event) => nonmemberFrames.push(String(event.data)));
	const extraPresence = JSON.stringify({ status: "away", ignored: true });
	expect((await stub.fetch("https://do/presence", { method: "PATCH", headers: await internalHeaders(workspaceId, "member", "PATCH", "/presence", extraPresence), body: extraPresence })).status).toBe(400);
	const offer = { queueId: "queue", ringGroupId: "group", callId: "call-1", conversationId: "conversation-1", expiresAt: new Date(Date.now() + 30_000).toISOString(), contact: { id: "contact-1", displayName: "Caller", avatarUrl: null } };
	const offerBody = JSON.stringify(offer);
	const signedOffer = await offerHeaders(workspaceId, offerBody);
	expect((await stub.fetch("https://do/offer", { method: "POST", headers: signedOffer, body: JSON.stringify({ ...offer, agentIds: ["nonmember"], sdp: "secret-sdp" }) })).status).toBe(403);
	const delivered = await offerCallToEligibleAgents(ctx.env, workspaceId, offer);
	const deliveredBody = (await delivered.json()) as { delivered: Array<{ userId: string; socketId: string }> };
	expect(deliveredBody.delivered).toHaveLength(1);
	expect(deliveredBody.delivered[0]?.userId).toBe("member");
	expect(deliveredBody.delivered[0]?.socketId).toBeString();
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "call:ring", callId: offer.callId, conversationId: offer.conversationId, queueId: offer.queueId, expiresAt: offer.expiresAt, contact: offer.contact })]);
	expect(nonmemberFrames).toEqual([]);
	const replayHeaders = await offerHeaders(workspaceId, offerBody);
	expect((await stub.fetch("https://do/offer", { method: "POST", headers: replayHeaders, body: offerBody })).status).toBe(200);
	expect((await stub.fetch("https://do/offer", { method: "POST", headers: replayHeaders, body: offerBody })).status).toBe(403);
	const expired = JSON.stringify({ ...offer, expiresAt: new Date(Date.now() - 1).toISOString() });
	expect((await stub.fetch("https://do/offer", { method: "POST", headers: await offerHeaders(workspaceId, expired), body: expired })).status).toBe(400);
	await ctx.env.DB.prepare("UPDATE call_queues SET is_enabled = 0 WHERE id = 'queue'").run();
	expect(((await (await offerCallToEligibleAgents(ctx.env, workspaceId, offer)).json()) as { delivered: unknown[] }).delivered).toHaveLength(0);
	await ctx.env.DB.prepare("UPDATE call_queues SET is_enabled = 1 WHERE id = 'queue'").run();
	await ctx.env.DB.prepare("UPDATE channels SET status = 'inactive' WHERE id = 'channel'").run();
	expect(((await (await offerCallToEligibleAgents(ctx.env, workspaceId, offer)).json()) as { delivered: unknown[] }).delivered).toHaveLength(0);

	const secondMemberConnection = await ws("member"); expect(secondMemberConnection.status).toBe(101);
	const secondMemberSocket = secondMemberConnection.webSocket!; secondMemberSocket.accept();
	memberSocket.close(); await new Promise((resolve) => setTimeout(resolve, 20));
	expect(await ctx.env.DB.prepare("SELECT status FROM agent_call_presence WHERE workspace_id=? AND user_id='member'").bind(workspaceId).first()).toEqual({ status: "available" });
	secondMemberSocket.close(); await new Promise((resolve) => setTimeout(resolve, 20));
	expect(await ctx.env.DB.prepare("SELECT status FROM agent_call_presence WHERE workspace_id=? AND user_id='member'").bind(workspaceId).first()).toEqual({ status: "offline" });
	nonmemberSocket.close();
	publicConnection.webSocket!.close();
}, 30_000);
