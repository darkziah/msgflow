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
import { handleInboundEmail } from "../src/email-ingress";
import { maintainEmail } from "../src/email-maintenance";
import { readPrivateEmailAttachment } from "../src/email-storage";
import type { Env } from "../src/env";
import { sendOutbound } from "../src/outbound";
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
test("audit transitions are immutable and completed accepted rows cannot starve reconciliation", async () => {
	const f = await fixture();
	await inbound();
	const p = await command();
	for (let i = 0; i < 21; i++)
		expect(
			(await sendOutbound(ctx.env, { ...p, clientMessageId: `done-${i}` })).ok,
		).toBe(true);
	const events = await ctx.env.DB.prepare(
		"SELECT action FROM email_audit WHERE target_id='done-0' ORDER BY rowid",
	).all<{ action: string }>();
	expect(events.results.map((r) => r.action)).toEqual([
		"outbound.requested",
		"outbound.attempt",
		"outbound.accepted",
	]);
	await expect(
		ctx.env.DB.prepare("UPDATE email_audit SET action='tampered'").run(),
	).rejects.toThrow("immutable");
	await ctx.env.DB.prepare(
		"UPDATE email_canonical_messages SET projected_at=NULL WHERE id='done-20'",
	).run();
	f.messages.delete("done-20");
	expect((await maintainEmail(ctx.env)).reconciled).toBe(1);
	expect(f.messages.has("done-20")).toBe(true);
	expect(f.calls()).toBe(21);
	await ctx.env.DB.prepare(
		"UPDATE outbound_intents SET status='failed' WHERE id='done-0'",
	).run();
	await ctx.env.DB.prepare(
		"UPDATE outbound_intents SET status='uncertain' WHERE id='done-0'",
	).run();
	const outcomes = await ctx.env.DB.prepare(
		"SELECT action FROM email_audit WHERE target_id='done-0'",
	).all<{ action: string }>();
	expect(outcomes.results.map((r) => r.action)).toContain("outbound.failed");
	expect(outcomes.results.map((r) => r.action)).toContain("outbound.uncertain");
	await expect(
		ctx.env.DB.prepare("DELETE FROM email_audit").run(),
	).rejects.toThrow("immutable");
	expect(
		(await sendOutbound(ctx.env, { ...p, mailboxId: "nonexistent" })).ok,
	).toBe(false);
	expect(
		await ctx.env.DB.prepare(
			"SELECT 1 FROM email_audit WHERE action='outbound.denied' AND actor_user_id='actor'",
		).first(),
	).not.toBeNull();
	expect(
		(
			await sendOutbound(ctx.env, {
				...p,
				senderId: "outsider",
				mailboxId: "nonexistent",
			})
		).ok,
	).toBe(false);
	expect(
		await ctx.env.DB.prepare(
			"SELECT 1 FROM email_audit WHERE action='outbound.denied' AND actor_user_id='outsider'",
		).first(),
	).toBeNull();
});
test("shared bridge reader gets only exact canonical ingress attachment and audited access", async () => {
	const f = await fixture();
	await inbound();
	const p = await command();
	const now = new Date().toISOString();
	await ctx.db
		.insert(mailboxes)
		.values({
			id: "private",
			workspaceId: f.workspaceId,
			emailDomainId: "domain",
			localPart: "actor",
			canonicalAddress: "actor@example.com",
			type: "private",
			ownerUserId: "actor",
			isEnabled: true,
			isSendEnabled: true,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	expect(
		(
			await sendOutbound(ctx.env, {
				...p,
				mailboxId: "private",
				confirmPrivateIdentity: true,
			})
		).ok,
	).toBe(true);
	await handleInboundEmail(ctx.env, {
		to: "actor@example.com",
		from: "customer@example.net",
		raw: new Blob([
			mime("bridge@example.net", "In-Reply-To: <provider-1@example.com>\r\n"),
		]).stream(),
		setReject(reason) {
			throw new Error(reason);
		},
	});
	const a = await ctx.env.DB.prepare(
		"SELECT id,ingress_id,conversation_id FROM email_private_attachments WHERE mailbox_id='private'",
	).first<{ id: string; ingress_id: string; conversation_id: string }>();
	expect(a!.conversation_id).toBe(p.conversationId);
	expect(
		await readPrivateEmailAttachment(ctx.env, a!.id, f.workspaceId, "other"),
	).not.toBeNull();
	expect(
		await ctx.env.DB.prepare(
			"SELECT 1 FROM email_audit WHERE action='identity_bridge.attachment_access' AND actor_user_id='other'",
		).first(),
	).not.toBeNull();
	expect(
		await ctx.env.DB.prepare(
			"SELECT 1 FROM email_audit WHERE action='outbound.private_identity_override'",
		).first(),
	).not.toBeNull();
	await ctx.env.DB.prepare(
		"UPDATE email_private_attachments SET ingress_id=NULL WHERE id=?",
	)
		.bind(a!.id)
		.run();
	await expect(
		readPrivateEmailAttachment(ctx.env, a!.id, f.workspaceId, "other"),
	).rejects.toThrow("denied");
});
