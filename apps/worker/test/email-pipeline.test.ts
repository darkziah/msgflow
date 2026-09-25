import { afterEach, expect, test } from "bun:test";
import type { Message } from "@msgflow/contracts";
import {
	channels,
	emailDomains,
	inboxes,
	inboxMembers,
	mailboxes,
	workspaceMembers,
} from "@msgflow/db";
import { handleInboundEmail, replayEmailIngress } from "../src/email-ingress";
import {
	readBoundedEmail,
	readPrivateEmailAttachment,
} from "../src/email-storage";
import type { Env } from "../src/env";
import { scheduleOutbound, sendOutbound } from "../src/outbound";
import { deliverScheduledMessages } from "../src/scheduled";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf.dispose();
});
async function fixture() {
	ctx = await createTestDb();
	const objects = new Map<string, Uint8Array>();
	ctx.env.EMAIL_ARCHIVE = {
		put: async (key: string, value: string | Uint8Array) => {
			objects.set(
				key,
				typeof value === "string"
					? new TextEncoder().encode(value)
					: value.slice(),
			);
			return {};
		},
		get: async (key: string) => {
			const value = objects.get(key);
			return value
				? {
						body: new Blob([value.slice().buffer as ArrayBuffer]).stream(),
						arrayBuffer: async () => value.slice().buffer,
					}
				: null;
		},
	} as unknown as Env["EMAIL_ARCHIVE"];
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	for (const id of ["actor", "other"]) {
		await seedUser(ctx, id, `${id}@test.dev`);
		await ctx.db
			.insert(workspaceMembers)
			.values({ id, workspaceId, userId: id, role: "member", createdAt: now })
			.run();
	}
	await ctx.db
		.insert(inboxes)
		.values({ id: "inbox", workspaceId, name: "Support", createdAt: now })
		.run();
	await ctx.db
		.insert(inboxMembers)
		.values([
			{ id: "grant", inboxId: "inbox", userId: "actor" },
			{ id: "grant2", inboxId: "inbox", userId: "other" },
		])
		.run();
	await ctx.db
		.insert(emailDomains)
		.values({
			id: "domain",
			workspaceId,
			canonicalDomain: "example.com",
			inboundState: "ready",
			outboundState: "ready",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: "channel",
			workspaceId,
			type: "email",
			displayName: "Support",
			externalId: "support@example.com",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(mailboxes)
		.values({
			id: "mailbox",
			workspaceId,
			emailDomainId: "domain",
			localPart: "support",
			canonicalAddress: "support@example.com",
			type: "shared",
			inboxId: "inbox",
			isEnabled: true,
			isSendEnabled: true,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const messages = new Map<string, Message>();
	let fail = false;
	let calls = 0;
	let uncertain = false;
	const payloads: unknown[] = [];
	ctx.env.CONVERSATION_DO = {
		idFromName: (id: string) => id,
		get: () => ({
			fetch: async (input: string, init?: RequestInit) => {
				if (!init)
					return messages.has(new URL(input).searchParams.get("id") ?? "")
						? Response.json(
								messages.get(new URL(input).searchParams.get("id") ?? ""),
							)
						: new Response("missing", { status: 404 });
				if (fail) return new Response("failed", { status: 503 });
				const message = JSON.parse(init.body as string) as Message;
				messages.set(message.id, message);
				return Response.json(message);
			},
		}),
	} as unknown as Env["CONVERSATION_DO"];
	ctx.env.EMAIL = {
		send: async (payload: unknown) => {
			calls++;
			payloads.push(payload);
			if (uncertain) throw new Error("timeout");
			return { messageId: `provider-${calls}@example.com` };
		},
	} as Env["EMAIL"];
	return {
		workspaceId,
		messages,
		payloads,
		calls: () => calls,
		fail: (value: boolean) => {
			fail = value;
		},
		uncertain: () => {
			uncertain = true;
		},
	};
}
function mime(
	id = "inbound@example.net",
	extra = "",
	body = "<p>Hello &amp; welcome</p><script>bad()</script>",
) {
	return `From: Customer <customer@example.net>\r\nTo: support@example.com\r\nSubject: Pilot\r\nMessage-ID: <${id}>\r\n${extra}MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=demo\r\n\r\n--demo\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}\r\n--demo\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=test.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--demo--\r\n`;
}
async function inbound(raw = mime()) {
	await handleInboundEmail(ctx.env, {
		to: "support@example.com",
		from: "customer@example.net",
		raw: new Blob([raw]).stream(),
		setReject(reason) {
			throw new Error(reason);
		},
	});
}
async function command() {
	const row = await ctx.env.DB.prepare(
		"SELECT conversation_id FROM email_canonical_messages LIMIT 1",
	).first<{ conversation_id: string }>();
	return {
		conversationId: row!.conversation_id,
		text: "Reply",
		senderId: "actor",
		clientMessageId: "send-1",
	};
}
test("HTML and private PDF persist before fanout; failed DO replay is stable and rules commit once", async () => {
	const f = await fixture();
	const now = new Date().toISOString();
	await ctx.env.DB.batch([
		ctx.env.DB.prepare(
			"INSERT INTO canned_replies(id,workspace_id,name,body,created_at,updated_at) VALUES('reply',?,'Auto','Automatic reply',?,?)",
		).bind(f.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO rules(id,workspace_id,name,trigger_type,is_active,created_at,updated_at) VALUES('rule',?,'Auto','message_received',1,?,?)",
		).bind(f.workspaceId, now, now),
		ctx.env.DB.prepare(
			"INSERT INTO rule_actions(id,rule_id,action_type,action_value,created_at) VALUES('action','rule','send_canned_reply','reply',?)",
		).bind(now),
	]);
	f.fail(true);
	await inbound();
	const row = await ctx.env.DB.prepare(
		"SELECT id,state FROM email_ingress",
	).first<{ id: string; state: string }>();
	expect(row?.state).toBe("failed");
	expect(f.messages.size).toBe(0);
	const canonical = await ctx.env.DB.prepare(
		"SELECT message_json,routing_done FROM email_canonical_messages",
	).first<{ message_json: string; routing_done: number }>();
	const message = JSON.parse(canonical!.message_json) as Message;
	expect(message.text).toBe("Hello & welcome");
	expect(canonical?.routing_done).toBe(1);
	expect(message.attachments[0]?.type).toBe("application/pdf");
	expect(message.attachments[0]?.key).toStartWith("email/attachments/");
	expect(message.attachments[0]?.url).toStartWith("/api/email-attachments/");
	expect(
		(
			await readPrivateEmailAttachment(
				ctx.env,
				message.attachments[0]!.id,
				f.workspaceId,
				"actor",
			)
		)?.type,
	).toBe("application/pdf");
	f.fail(false);
	expect(await replayEmailIngress(ctx.env)).toEqual({
		processed: 1,
		attempted: 1,
	});
	await inbound();
	expect(f.messages.size).toBe(1);
	expect(
		(
			await ctx.env.DB.prepare(
				"SELECT count(*) n FROM email_routing_commits",
			).first<{ n: number }>()
		)?.n,
	).toBe(1);
	expect(
		(
			await ctx.env.DB.prepare(
				"SELECT count(*) n FROM scheduled_messages",
			).first<{ n: number }>()
		)?.n,
	).toBe(1);
	await inbound(
		mime("second@example.net", "In-Reply-To: <inbound@example.net>\r\n"),
	);
	expect(
		new Set([...f.messages.values()].map((m) => m.conversationId)).size,
	).toBe(1);
});
test("structured send stores real ID, binds key to actor/conversation/content, restores missing accepted projection", async () => {
	const f = await fixture();
	await inbound();
	const p = await command();
	expect((await sendOutbound(ctx.env, p)).ok).toBe(true);
	expect(f.calls()).toBe(1);
	expect(f.payloads[0]).toMatchObject({
		from: "support@example.com",
		to: "customer@example.net",
		headers: {
			"In-Reply-To": "<inbound@example.net>",
			"X-MsgFlow-Intent": "send-1",
		},
	});
	expect(f.messages.get("send-1")?.providerMessageId).toBe(
		"provider-1@example.com",
	);
	for (const changed of [
		{ senderId: "other" },
		{ text: "changed" },
		{ conversationId: "email:support@example.com:foreign" },
	])
		expect((await sendOutbound(ctx.env, { ...p, ...changed })).ok).toBe(false);
	f.messages.delete("send-1");
	expect((await sendOutbound(ctx.env, p)).ok).toBe(true);
	expect(f.messages.has("send-1")).toBe(true);
	expect(f.calls()).toBe(1);
});
test("provider uncertainty is fenced and provider-accepted DO failure only reconciles", async () => {
	const f = await fixture();
	await inbound();
	const p = await command();
	f.fail(true);
	expect((await sendOutbound(ctx.env, p)).ok).toBe(false);
	expect(f.calls()).toBe(1);
	f.fail(false);
	expect((await sendOutbound(ctx.env, p)).ok).toBe(true);
	expect(f.calls()).toBe(1);
	f.uncertain();
	const q = { ...p, clientMessageId: "uncertain" };
	expect(await sendOutbound(ctx.env, q)).toMatchObject({
		ok: false,
		retryable: false,
	});
	expect(
		await sendOutbound(ctx.env, q, { retryDefinitiveFailure: true }),
	).toMatchObject({ ok: false, retryable: false });
	expect(f.calls()).toBe(2);
});
test("scheduled command preserves subject and selected mailbox", async () => {
	const f = await fixture();
	await inbound();
	const p = {
		...(await command()),
		subject: "Scheduled subject",
		mailboxId: "mailbox",
		sendAt: new Date().toISOString(),
	};
	await scheduleOutbound(ctx.env, p);
	await deliverScheduledMessages(ctx.env, new Date().toISOString());
	expect(f.calls()).toBe(1);
	expect(f.payloads[0]).toMatchObject({ subject: "Scheduled subject" });
});
test("byte limit rejects before parsing", async () => {
	await expect(
		readBoundedEmail(new Blob([new Uint8Array(11)]).stream(), 10),
	).rejects.toThrow("limit");
});
