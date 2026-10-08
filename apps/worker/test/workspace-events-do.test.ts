import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createAuth } from "@msgflow/auth";
import { setupInitialOwner } from "../src/setup";
import { createTestDb, type TestCtx } from "./helpers";
import { routeInbound } from "../src/ingest";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

async function ownerSession() {
	const owner = await setupInitialOwner(ctx.env, {
		email: "owner@test.dev",
		password: "correct horse battery staple",
		username: "owner",
		workspaceName: "Owner",
		workspaceSlug: "owner",
		initialTeamName: "Team",
		initialInboxName: "Inbox",
	});
	await ctx.env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
		.bind(owner.userId)
		.run();
	const login = await createAuth(ctx.env).handler(
		new Request("https://msgflow.test/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "owner@test.dev",
				password: "correct horse battery staple",
			}),
		}),
	);
	const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
	if (!cookie) throw new Error("owner sign-in did not issue a session cookie");
	return { ...owner, cookie };
}

test("workspace inbox socket authenticates access and fans out successful inbound message projections", async () => {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "../src/index.ts")],
		target: "browser",
		external: ["cloudflare:workers", "cloudflare:email"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	const output = bundled.outputs[0];
	if (!output) throw new Error("worker bundle is empty");
	ctx = await createTestDb({ script: await output.text() });
	const owner = await ownerSession();

	expect(
		(
			await ctx.mf.dispatchFetch("https://msgflow.test/ws/workspace", {
				headers: { Upgrade: "websocket", cookie: owner.cookie },
			})
		).status,
	).toBe(400);
	expect(
		(
			await ctx.mf.dispatchFetch(
				`https://msgflow.test/ws/workspace?workspaceId=${owner.workspaceId}`,
				{ headers: { Upgrade: "websocket" } },
			)
		).status,
	).toBe(401);
	const foreignWorkspaceId = "workspace-events-foreign";
	const now = new Date().toISOString();
	await ctx.env.DB.prepare(
		"INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, 'Foreign', 'workspace-events-foreign', ?, ?)",
	)
		.bind(foreignWorkspaceId, now, now)
		.run();
	expect(
		(
			await ctx.mf.dispatchFetch(
				`https://msgflow.test/ws/workspace?workspaceId=${foreignWorkspaceId}`,
				{ headers: { Upgrade: "websocket", cookie: owner.cookie } },
			)
		).status,
	).toBe(403);

	const connection = await ctx.mf.dispatchFetch(
		`https://msgflow.test/ws/workspace?workspaceId=${owner.workspaceId}`,
		{ headers: { Upgrade: "websocket", cookie: owner.cookie } },
	);
	expect(connection.status).toBe(101);
	const socket = connection.webSocket;
	if (!socket) throw new Error("workspace upgrade did not return a WebSocket");
	socket.accept();
	const frames: string[] = [];
	socket.addEventListener("message", (event) => frames.push(String(event.data)));

	const messageNow = new Date().toISOString();
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO channels (id, workspace_id, type, display_name, external_id, status, created_at, updated_at) VALUES ('workspace-events-channel', ?, 'facebook_page', 'Page', 'page', 'active', ?, ?)",
		).bind(owner.workspaceId, messageNow, messageNow),
		ctx.env.DB.prepare(
			"INSERT INTO contacts (id, workspace_id, created_at, updated_at) VALUES ('workspace-events-contact', ?, ?, ?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id, workspace_id, channel_id, inbox_id, contact_id, do_binding_id, created_at, updated_at) VALUES ('workspace-events-conversation', ?, 'workspace-events-channel', ?, 'workspace-events-contact', 'workspace-events-conversation', ?, ?)",
		).bind(owner.workspaceId, owner.inboxId, now, now),
	]);
	const conversations = await ctx.mf.getDurableObjectNamespace("CONVERSATION_DO");
	const conversation = conversations.get(
		conversations.idFromName("workspace-events-conversation"),
	);
	expect(
		(
			await conversation.fetch("https://do/append-message", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "workspace-events-message",
					conversationId: "workspace-events-conversation",
					kind: "inbound",
					channel: "facebook",
					providerMessageId: null,
					senderId: "workspace-events-contact",
					text: "updated ordering",
					payload: null,
					attachments: [],
					createdAt: now,
				}),
			})
		).status,
	).toBe(200);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "workspace:conversations-changed" })]);
	frames.length = 0;
	expect(
		(
			await conversation.fetch("https://do/append-message", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "workspace-events-message",
					conversationId: "workspace-events-conversation",
					kind: "inbound",
					channel: "facebook",
					providerMessageId: null,
					senderId: "workspace-events-contact",
					text: "updated ordering",
					payload: null,
					attachments: [],
					createdAt: now,
				}),
			})
		).status,
	).toBe(200);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([]);

	// The full inbound path writes metadata, evaluates rules, then projects the
	// message. Its single final DO projection is the one workspace notification.
	const conversationNamespace = await ctx.mf.getDurableObjectNamespace("CONVERSATION_DO");
	const workspaceNamespace = await ctx.mf.getDurableObjectNamespace("WORKSPACE_EVENTS_DO");
	ctx.env.CONVERSATION_DO = conversationNamespace as typeof ctx.env.CONVERSATION_DO;
	ctx.env.WORKSPACE_EVENTS_DO = workspaceNamespace as typeof ctx.env.WORKSPACE_EVENTS_DO;
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO channels (id, workspace_id, type, display_name, external_id, status, created_at, updated_at) VALUES ('workspace-events-route-channel', ?, 'facebook_page', 'Route Page', 'route-page', 'active', ?, ?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO inbox_channels (id, inbox_id, channel_id, is_default) VALUES ('workspace-events-route-link', ?, 'workspace-events-route-channel', 1)",
		).bind(owner.inboxId),
	]);
	frames.length = 0;
	await routeInbound(ctx.env, {
		conversationId: "fb:route-page:route-contact",
		channel: "facebook",
		providerMessageId: "workspace-events-route-message",
		senderId: "route-contact",
		text: "one authoritative signal",
		payload: {},
		attachments: [],
		createdAt: now,
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "workspace:conversations-changed" })]);
	await routeInbound(ctx.env, {
		conversationId: "fb:route-page:route-contact",
		channel: "facebook",
		providerMessageId: "workspace-events-route-message",
		senderId: "route-contact",
		text: "one authoritative signal",
		payload: {},
		attachments: [],
		createdAt: now,
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "workspace:conversations-changed" })]);

	frames.length = 0;
	const archive = await ctx.mf.dispatchFetch(
		"https://msgflow.test/api/conversations/workspace-events-conversation",
		{
			method: "PATCH",
			headers: { "content-type": "application/json", cookie: owner.cookie },
			body: JSON.stringify({ workspaceId: owner.workspaceId, status: "archived" }),
		},
	);
	expect(archive.status).toBe(200);
	expect(
		await ctx.env.DB.prepare(
			"SELECT status FROM conversations WHERE id = 'workspace-events-conversation'",
		).first<{ status: string }>(),
	).toEqual({ status: "archived" });
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "workspace:conversations-changed" })]);

	await ctx.env.DB.prepare(
		"INSERT INTO tags (id, workspace_id, name, visibility, created_at) VALUES ('workspace-events-tag', ?, 'Customer', 'shared', ?)",
	)
		.bind(owner.workspaceId, now)
		.run();
	frames.length = 0;
	const addTag = () =>
		ctx.mf.dispatchFetch(
			"https://msgflow.test/api/workspaces/" +
				`${owner.workspaceId}/conversations/workspace-events-conversation/tags`,
			{
				method: "POST",
				headers: { "content-type": "application/json", cookie: owner.cookie },
				body: JSON.stringify({ tagId: "workspace-events-tag" }),
			},
		);
	expect((await addTag()).status).toBe(200);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([JSON.stringify({ type: "workspace:conversations-changed" })]);
	frames.length = 0;
	expect((await addTag()).status).toBe(200);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(frames).toEqual([]);
	socket.close();
}, 30_000);
