import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createAuth } from "@msgflow/auth";
import { setupInitialOwner } from "../src/setup";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf.dispose();
});

test("real DO repairs interrupted D1 projection, accepts long email, and revokes sockets", async () => {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "fixtures/conversation-worker.ts")],
		target: "browser",
		external: ["cloudflare:workers"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	const output = bundled.outputs[0];
	if (!output) throw new Error("conversation worker bundle is empty");
	ctx = await createTestDb({ script: await output.text() });
	const { workspaceId } = await seedWorkspace(ctx);
	await seedUser(ctx, "agent", "agent@test.dev");
	const now = new Date().toISOString();
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES ('m',?,'agent','member',?)",
		).bind(workspaceId, now),
		ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES ('c',?,'facebook_page','Page','page','active',?,?)",
		).bind(workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO inboxes (id,workspace_id,name,created_at) VALUES ('i',?,'Inbox',?)",
		).bind(workspaceId, now),
		ctx.env.DB.prepare(
			"INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES ('contact',?,?,?)",
		).bind(workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,created_at,updated_at) VALUES ('fb:page:person',?,'c','i','contact','fb:page:person',?,?)",
		).bind(workspaceId, now, now),
	]);
	const namespace = await ctx.mf.getDurableObjectNamespace("CONVERSATION_DO");
	const stub = namespace.get(namespace.idFromName("fb:page:person"));
	const message = {
		id: "long-email",
		conversationId: "fb:page:person",
		kind: "inbound",
		channel: "email",
		providerMessageId: "same-id",
		senderId: "contact",
		text: "a".repeat(20_000),
		payload: null,
		attachments: [],
		createdAt: now,
	};
	const append = (value: typeof message) =>
		stub.fetch("https://do/append-message", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(value),
		});
	// Fail D1 after the message is already durable in the DO.
	await ctx.env.DB.prepare(
		"CREATE TRIGGER fail_summary BEFORE INSERT ON messages_summary BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
	).run();
	await expect(append(message)).rejects.toThrow("injected failure");
	await ctx.env.DB.prepare("DROP TRIGGER fail_summary").run();
	expect((await append(message)).status).toBe(200);
	expect(
		await ctx.env.DB.prepare(
			"SELECT count(*) FROM messages_summary WHERE id='long-email'",
		).first("count(*)"),
	).toBe(1);
	expect(
		await ctx.env.DB.prepare(
			"SELECT message_count FROM conversations WHERE id='fb:page:person'",
		).first("message_count"),
	).toBe(1);
	// RFC IDs aren't trustworthy dedupe identifiers for separate email deliveries.
	expect((await append({ ...message, id: "second-email" })).status).toBe(200);
	expect(
		await ctx.env.DB.prepare(
			"SELECT message_count FROM conversations WHERE id='fb:page:person'",
		).first("message_count"),
	).toBe(2);
	// Repairing an older record must not regress the latest-seq projection.
	await append(message);
	expect(
		await ctx.env.DB.prepare(
			"SELECT message_count FROM conversations WHERE id='fb:page:person'",
		).first("message_count"),
	).toBe(2);
	const upgrade = await stub.fetch("https://do/ws", {
		headers: {
			Upgrade: "websocket",
			"x-agent-id": "agent",
			"x-conversation-id": "fb:page:person",
		},
	});
	expect(upgrade.status).toBe(101);
	const socket = upgrade.webSocket;
	if (!socket) throw new Error("upgrade did not return a WebSocket");
	socket.accept();
	await ctx.env.DB.prepare(
		"DELETE FROM workspace_members WHERE user_id='agent'",
	).run();
	const frames: string[] = [];
	socket.addEventListener("message", (event) =>
		frames.push(String(event.data)),
	);
	const closed = new Promise<number>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("revoked socket did not close")),
			3000,
		);
		socket.addEventListener("close", (event) => {
			clearTimeout(timer);
			resolve(event.code);
		});
	});
	await append({
		...message,
		id: "after-revocation",
		text: "private-after-revocation",
	});
	expect(await closed).toBe(1008);
	expect(
		frames.some((frame) => frame.includes("private-after-revocation")),
	).toBe(false);
}, 30_000);

test("real DO returns a mixed, keyset-paginated timeline and rejects invalid page parameters", async () => {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "fixtures/conversation-worker.ts")],
		target: "browser",
		external: ["cloudflare:workers"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	const output = bundled.outputs[0];
	if (!output) throw new Error("conversation worker bundle is empty");
	ctx = await createTestDb({ script: await output.text() });
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "timeline-agent", "timeline-agent@test.dev");
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES ('timeline-member',?,'timeline-agent','member',?)",
		).bind(workspaceId, now),
		ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES ('timeline-channel',?,'facebook_page','Page','page','active',?,?)",
		).bind(workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO inboxes (id,workspace_id,name,created_at) VALUES ('timeline-inbox',?,'Inbox',?)",
		).bind(workspaceId, now),
		ctx.env.DB.prepare(
			"INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES ('timeline-contact',?,?,?)",
		).bind(workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,created_at,updated_at) VALUES ('timeline-conversation',?,'timeline-channel','timeline-inbox','timeline-contact','timeline-conversation',?,?)",
		).bind(workspaceId, now, now),
	]);
	const namespace = await ctx.mf.getDurableObjectNamespace("CONVERSATION_DO");
	const stub = namespace.get(namespace.idFromName("timeline-conversation"));
	const append = (path: string, body: Record<string, unknown>) =>
		stub.fetch(`https://do${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const conversationId = "timeline-conversation";
	const tiedAt = "2026-01-02T00:00:00.000Z";
	const oldAt = "2026-01-01T00:00:00.000Z";
	expect(
		(
			await append("/append-message", {
				id: "timeline-shared",
				conversationId,
				kind: "inbound",
				channel: "facebook",
				providerMessageId: null,
				senderId: "contact",
				text: "message",
				payload: null,
				attachments: [],
				createdAt: tiedAt,
			})
		).status,
	).toBe(200);
	expect(
		(
			await append("/append-comment", {
				id: "timeline-shared",
				conversationId,
				authorId: "agent",
				text: "comment",
				mentions: [],
				createdAt: tiedAt,
			})
		).status,
	).toBe(200);
	expect(
		(
			await append("/append-activity", {
				id: "timeline-shared",
				conversationId,
				action: "conversation.updated",
				actorId: "agent",
				details: {},
				createdAt: tiedAt,
			})
		).status,
	).toBe(200);
	expect(
		(
			await append("/append-message", {
				id: "message-old",
				conversationId,
				kind: "inbound",
				channel: "facebook",
				providerMessageId: null,
				senderId: "contact",
				text: "old",
				payload: null,
				attachments: [],
				createdAt: oldAt,
			})
		).status,
	).toBe(200);

	const first = await stub.fetch("https://do/timeline?limit=2");
	expect(first.status).toBe(200);
	const firstPage = (await first.json()) as {
		items: Array<{ type: string; item: { id: string } }>;
		nextCursor: string | null;
	};
	expect(firstPage.items.map(({ item }) => item.id)).toEqual([
		"timeline-shared",
		"timeline-shared",
	]);
	expect(firstPage.items.map(({ type }) => type)).toEqual([
		"message",
		"comment",
	]);
	expect(firstPage.nextCursor).toEqual(expect.any(String));
	const nextCursor = firstPage.nextCursor;
	if (!nextCursor)
		throw new Error("first timeline page did not include a cursor");
	const second = await stub.fetch(
		`https://do/timeline?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
	);
	expect(second.status).toBe(200);
	const secondPage = (await second.json()) as {
		items: Array<{ type: string; item: { id: string } }>;
		nextCursor: string | null;
	};
	expect(secondPage.items.map(({ item }) => item.id)).toEqual([
		"timeline-shared",
		"message-old",
	]);
	expect(secondPage.items.map(({ type }) => type)).toEqual(["activity", "message"]);
	expect(secondPage.nextCursor).toBeNull();
	for (const query of [
		"limit=0",
		"limit=101",
		"limit=2.5",
		"limit=wat",
		"cursor=not-a-cursor",
	]) {
		expect((await stub.fetch(`https://do/timeline?${query}`)).status).toBe(400);
	}
}, 30_000);

test("authorized messages route forwards timeline pagination and rejects malformed values", async () => {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "../src/index.ts")],
		target: "browser",
		external: ["cloudflare:workers", "cloudflare:email"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	const output = bundled.outputs[0];
	if (!output) throw new Error("conversation worker bundle is empty");
	ctx = await createTestDb({ script: await output.text() });
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
	const now = "2026-01-01T00:00:00.000Z";
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES ('timeline-channel',?,'facebook_page','Page','page','active',?,?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES ('timeline-contact',?,?,?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,created_at,updated_at) VALUES ('timeline-route',?,'timeline-channel',?,'timeline-contact','timeline-route',?,?)",
		).bind(owner.workspaceId, owner.inboxId, now, now),
	]);
	const namespace = await ctx.mf.getDurableObjectNamespace("CONVERSATION_DO");
	const stub = namespace.get(namespace.idFromName("timeline-route"));
	await stub.fetch("https://do/append-message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: "route-message",
			conversationId: "timeline-route",
			kind: "inbound",
			channel: "facebook",
			providerMessageId: null,
			senderId: "contact",
			text: "message",
			payload: null,
			attachments: [],
			createdAt: now,
		}),
	});
	const response = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations/timeline-route/messages?workspaceId=${owner.workspaceId}&limit=1`,
		{ headers: { cookie } },
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		items: [
			{
				type: "message",
				item: expect.objectContaining({ id: "route-message" }),
			},
		],
		nextCursor: null,
	});
	const malformedLimit = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations/timeline-route/messages?workspaceId=${owner.workspaceId}&limit=wat`,
		{ headers: { cookie } },
	);
	expect(malformedLimit.status).toBe(400);
	const malformedCursor = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations/timeline-route/messages?workspaceId=${owner.workspaceId}&cursor=not-a-cursor`,
		{ headers: { cookie } },
	);
	expect(malformedCursor.status).toBe(400);
	for (const lastReadSeq of [9, 2]) {
		const markRead = await ctx.mf.dispatchFetch(
			`https://msgflow.test/api/conversations/timeline-route/read`,
			{
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ workspaceId: owner.workspaceId, lastReadSeq }),
			},
		);
		expect(markRead.status).toBe(200);
	}
	const read = await ctx.env.DB.prepare(
		"SELECT last_read_seq FROM conversation_reads WHERE conversation_id = ? AND agent_id = ?",
	)
		.bind("timeline-route", owner.userId)
		.first<{ last_read_seq: number }>();
	expect(read?.last_read_seq).toBe(9);
}, 30_000);

test("messages route maps rejected timeline DO fetches to timeline-unavailable 502", async () => {
	const bundled = await Bun.build({
		entrypoints: [
			join(import.meta.dir, "fixtures/timeline-rejecting-worker.ts"),
		],
		target: "browser",
		external: ["cloudflare:workers", "cloudflare:email"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	const output = bundled.outputs[0];
	if (!output) throw new Error("timeline rejecting worker bundle is empty");
	ctx = await createTestDb({ script: await output.text() });
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
	const now = "2026-01-01T00:00:00.000Z";
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES ('rejected-channel',?,'facebook_page','Page','page','active',?,?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES ('rejected-contact',?,?,?)",
		).bind(owner.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,created_at,updated_at) VALUES ('rejected-timeline',?,'rejected-channel',?,'rejected-contact','rejected-timeline',?,?)",
		).bind(owner.workspaceId, owner.inboxId, now, now),
	]);
	const response = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations/rejected-timeline/messages?workspaceId=${owner.workspaceId}`,
		{ headers: { cookie } },
	);
	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({
		success: false,
		error: "timeline unavailable",
	});
});
