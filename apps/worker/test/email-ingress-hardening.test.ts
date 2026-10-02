import { afterEach, expect, test } from "bun:test";
import {
	emailDomains,
	inboxes,
	inboxMembers,
	mailboxes,
	workspaceMembers,
} from "@msgflow/db";
import {
	handleInboundEmail,
	MAX_INBOUND_EMAIL_TEXT_BYTES,
	replayEmailIngress,
} from "../src/email-ingress";
import type { Env } from "../src/env";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf.dispose();
});
async function fixture() {
	ctx = await createTestDb();
	const objects = new Map<string, Uint8Array>();
	ctx.env.EMAIL_ARCHIVE = {
		put: async (key: string, value: Uint8Array) => {
			objects.set(key, value.slice());
			return {};
		},
		get: async (key: string) => {
			const value = objects.get(key);
			return value
				? { body: new Blob([value.slice().buffer as ArrayBuffer]).stream() }
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
		.values({ id: "grant", inboxId: "inbox", userId: "actor" })
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
	let calls = 0;
	ctx.env.CONVERSATION_DO = {
		idFromName: (id: string) => id,
		get: () => ({
			fetch: async (_input: string, init?: RequestInit) => {
				calls++;
				return Response.json(JSON.parse(init!.body as string));
			},
		}),
	} as unknown as Env["CONVERSATION_DO"];
	return { workspaceId, objects, calls: () => calls };
}
const headers =
	"From: customer@example.net\r\nTo: support@example.com\r\nSubject: Test\r\nMIME-Version: 1.0\r\n";
test("parsed text bound is 256 KiB of UTF-8, quarantined without truncation", async () => {
	const f = await fixture();
	expect(MAX_INBOUND_EMAIL_TEXT_BYTES).toBe(256 * 1024);
	const raw = `${headers}Content-Type: text/plain; charset=utf-8\r\n\r\n${"é".repeat(MAX_INBOUND_EMAIL_TEXT_BYTES / 2 + 1)}`;
	await inbound(raw);
	const first = await row();
	expect(first).toMatchObject({
		state: "quarantined",
		attempts: 1,
		error: "message text exceeds 256 KiB",
	});
	expect(new TextDecoder().decode(f.objects.get(first.raw_object_key))).toBe(
		raw,
	);
	await noTimeline();
	expect(f.calls()).toBe(0);
	expect(await replayEmailIngress(ctx.env)).toEqual({
		attempted: 0,
		processed: 0,
	});
});
async function inbound(raw: string) {
	await handleInboundEmail(ctx.env, {
		to: "support@example.com",
		from: "customer@example.net",
		raw: new Blob([raw]).stream(),
		setReject: (reason) => {
			throw new Error(reason);
		},
	});
}
async function row() {
	return (await ctx.env.DB.prepare(
		"SELECT id,state,attempts,error,raw_object_key,lease_token,lease_until FROM email_ingress",
	).first<{
		id: string;
		state: string;
		attempts: number;
		error: string;
		raw_object_key: string;
		lease_token: string | null;
		lease_until: number | null;
	}>())!;
}
async function noTimeline() {
	for (const table of [
		"email_canonical_messages",
		"conversations",
		"email_private_attachments",
	]) {
		expect(
			(
				await ctx.env.DB.prepare(`SELECT count(*) n FROM ${table}`).first<{
					n: number;
				}>()
			)?.n,
		).toBe(0);
	}
}
test("unsupported ZIP quarantines whole message and preserves raw; only explicit authorized replay retries", async () => {
	const f = await fixture();
	const raw = `${headers}Content-Type: multipart/mixed; boundary=demo\r\n\r\n--demo\r\nContent-Type: text/plain\r\n\r\nHello\r\n--demo\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=test.pdf\r\n\r\n%PDF-1.4\r\n--demo\r\nContent-Type: application/zip\r\nContent-Disposition: attachment; filename=test.zip\r\n\r\nzip\r\n--demo--\r\n`;
	await inbound(raw);
	const first = await row();
	expect(first).toMatchObject({
		state: "quarantined",
		attempts: 1,
		lease_token: null,
		lease_until: null,
	});
	expect(first.error).toContain("unsupported attachment");
	expect(new TextDecoder().decode(f.objects.get(first.raw_object_key))).toBe(
		raw,
	);
	await noTimeline();
	expect(f.calls()).toBe(0);
	expect(await replayEmailIngress(ctx.env)).toEqual({
		attempted: 0,
		processed: 0,
	});
	expect(
		await replayEmailIngress(ctx.env, undefined, undefined, first.id),
	).toEqual({ attempted: 0, processed: 0 });
	expect(await replayEmailIngress(ctx.env, f.workspaceId, "actor")).toEqual({
		attempted: 0,
		processed: 0,
	});
	expect(
		await replayEmailIngress(ctx.env, f.workspaceId, "other", first.id),
	).toEqual({ attempted: 0, processed: 0 });
	await inbound(raw);
	expect((await row()).attempts).toBe(1);
	expect(
		await replayEmailIngress(ctx.env, f.workspaceId, "actor", first.id),
	).toEqual({ attempted: 1, processed: 0 });
	expect(await row()).toMatchObject({ state: "quarantined", attempts: 2 });
	await noTimeline();
});
test("MIME parser exceptions quarantine; repaired parser input requires authorized replay and remains idempotent", async () => {
	const f = await fixture();
	const raw = `${headers}X-Oversized: ${"x".repeat(70000)}\r\n\r\nHello`;
	await inbound(raw);
	const first = await row();
	expect(first).toMatchObject({ state: "quarantined", attempts: 1 });
	expect(first.error).toContain("MIME");
	expect(new TextDecoder().decode(f.objects.get(first.raw_object_key))).toBe(
		raw,
	);
	await noTimeline();
	expect(await replayEmailIngress(ctx.env)).toEqual({
		attempted: 0,
		processed: 0,
	});
	expect(
		await replayEmailIngress(ctx.env, f.workspaceId, "actor", first.id),
	).toEqual({ attempted: 1, processed: 0 });
	expect(await row()).toMatchObject({ state: "quarantined", attempts: 2 });
	// Simulate a parser remediation with the mock archive, not a production raw rewrite.
	f.objects.set(
		first.raw_object_key,
		new TextEncoder().encode(`${headers}Content-Type: text/plain\r\n\r\nHello`),
	);
	expect(
		await replayEmailIngress(ctx.env, f.workspaceId, "actor", first.id),
	).toEqual({ attempted: 1, processed: 1 });
	expect(await row()).toMatchObject({
		state: "processed",
		attempts: 3,
		lease_token: null,
		lease_until: null,
	});
	expect(f.calls()).toBe(1);
	expect(
		await replayEmailIngress(ctx.env, f.workspaceId, "actor", first.id),
	).toEqual({ attempted: 0, processed: 0 });
	expect(f.calls()).toBe(1);
});
