import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { emailDomains, emailIngress, inboxes, mailboxes } from "@msgflow/db";
import {
	archiveInboundEmail,
	EmailIngressRejectError,
	markEmailIngressProcessing,
	markEmailIngressProcessed,
	quarantineEmailIngress,
	MAX_INBOUND_EMAIL_BYTES,
} from "../src/email-ingress";
import { createTestDb, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf?.dispose();
});

async function readyRoute() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	const domainId = crypto.randomUUID();
	const mailboxId = crypto.randomUUID();
	const inboxId = crypto.randomUUID();
	await ctx.db
		.insert(inboxes)
		.values({ id: inboxId, workspaceId, name: "Support", createdAt: now })
		.run();
	await ctx.db
		.insert(emailDomains)
		.values({
			id: domainId,
			workspaceId,
			canonicalDomain: "example.com",
			inboundState: "ready",
			outboundState: "ready",
			dnsStatusJson: "{}",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(mailboxes)
		.values({
			id: mailboxId,
			workspaceId,
			emailDomainId: domainId,
			localPart: "support",
			canonicalAddress: "support@example.com",
			type: "shared",
			inboxId,
			isEnabled: true,
			isSendEnabled: true,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return {
		workspaceId,
		mailboxId,
		canonicalAddress: "support@example.com",
		channelId: "channel",
		inboxId,
	};
}

function rawStream(value: string | Uint8Array): ReadableStream<Uint8Array> {
	const bytes =
		typeof value === "string" ? new TextEncoder().encode(value) : value;
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

describe("durable private email ingress", () => {
	test("archives raw MIME privately before a mailbox-scoped idempotency claim", async () => {
		const route = await readyRoute();
		const raw =
			"From: sender@example.net\r\nTo: support@example.com\r\n\r\nhello";
		const stored = await archiveInboundEmail(ctx.env, route, rawStream(raw));
		if (!stored)
			throw new Error("first ingress claim unexpectedly deduplicated");
		const object = await ctx.env.EMAIL_ARCHIVE.get(stored.rawObjectKey);
		expect(await object?.text()).toBe(raw);
		expect(stored.rawObjectKey).toStartWith(`email/raw/${route.mailboxId}/`);

		const duplicate = await archiveInboundEmail(ctx.env, route, rawStream(raw));
		expect(duplicate?.id).toBe(stored.id);
		const records = await ctx.db
			.select()
			.from(emailIngress)
			.where(eq(emailIngress.mailboxId, route.mailboxId))
			.all();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			state: "stored",
			rawBytes: raw.length,
			rawSha256: stored.dedupeKey,
		});
		await markEmailIngressProcessed(ctx.env, stored.id);
		expect(
			await archiveInboundEmail(ctx.env, route, rawStream(raw)),
		).toBeNull();
	});

	test("records a replayable quarantine after durable acceptance", async () => {
		const route = await readyRoute();
		const stored = await archiveInboundEmail(
			ctx.env,
			route,
			rawStream("From: sender@example.net\r\n\r\nbody"),
		);
		if (!stored)
			throw new Error("first ingress claim unexpectedly deduplicated");
		await markEmailIngressProcessing(ctx.env, stored.id);
		await quarantineEmailIngress(
			ctx.env,
			stored.id,
			"MIME parsing or processing failed",
		);
		const record = await ctx.db
			.select()
			.from(emailIngress)
			.where(eq(emailIngress.id, stored.id))
			.get();
		expect(record).toMatchObject({
			state: "quarantined",
			error: "MIME parsing or processing failed",
		});
		expect(record?.processedAt).toBeNull();
	});

	test("rejects an oversized message before writing an archive or ingress record", async () => {
		const route = await readyRoute();
		await expect(
			archiveInboundEmail(
				ctx.env,
				route,
				rawStream(new Uint8Array(MAX_INBOUND_EMAIL_BYTES + 1)),
			),
		).rejects.toBeInstanceOf(EmailIngressRejectError);
		expect(await ctx.db.select().from(emailIngress).all()).toEqual([]);
	});
});
