import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
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
	ctx = await createTestDb({ script: await bundled.outputs[0]!.text() });
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
	const socket = upgrade.webSocket!;
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
