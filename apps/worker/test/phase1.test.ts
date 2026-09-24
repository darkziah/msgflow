import { afterEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
	channels,
	contacts,
	conversations,
	inboxes,
	outboundIntents,
	scheduledMessages,
	workspaceMembers,
} from "@msgflow/db";
import {
	decryptChannelToken,
	encryptChannelToken,
} from "../src/channel-token-crypto";
import { reviveDueSnoozes } from "../src/snooze";
import { claimScheduledMessage } from "../src/scheduled-claim";
import { appendActivity } from "../src/activity";
import { listConversations } from "../src/queries";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf?.dispose();
});

const TOKEN_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

async function insertSnoozedConversation(
	snoozedUntil: string,
): Promise<{ id: string; workspaceId: string }> {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	await seedUser(ctx, "agent", "agent@test.dev");
	const now = new Date().toISOString();
	const channelId = crypto.randomUUID();
	const inboxId = crypto.randomUUID();
	const contactId = crypto.randomUUID();
	const id = crypto.randomUUID();

	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			userId: "agent",
			role: "owner",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "email",
			displayName: "Support",
			externalId: "support@test.dev",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxes)
		.values({
			id: inboxId,
			workspaceId,
			name: "Support",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(contacts)
		.values({ id: contactId, workspaceId, createdAt: now, updatedAt: now })
		.run();
	await ctx.db
		.insert(conversations)
		.values({
			id,
			workspaceId,
			channelId,
			inboxId,
			contactId,
			doBindingId: id,
			status: "open",
			snoozedUntil,
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id, workspaceId };
}

describe("scheduled snooze revival", () => {
	test("shows a future-snoozed conversation only in the Snoozed queue", async () => {
		const snoozed = await insertSnoozedConversation(
			new Date(Date.now() + 60_000).toISOString(),
		);
		const snoozedRow = await ctx.db
			.select()
			.from(conversations)
			.where(eq(conversations.id, snoozed.id))
			.get();
		if (!snoozedRow) throw new Error("seeded conversation missing");
		await ctx.db
			.insert(conversations)
			.values({
				...snoozedRow,
				id: "archived-with-stale-snooze",
				doBindingId: "archived-with-stale-snooze",
				status: "archived",
			})
			.run();

		const standard = await listConversations(
			ctx.env,
			"agent",
			{ status: "open" },
			snoozed.workspaceId,
		);
		const snoozedQueue = await listConversations(
			ctx.env,
			"agent",
			{ snoozed: true },
			snoozed.workspaceId,
		);
		const all = await listConversations(
			ctx.env,
			"agent",
			{ status: "all" },
			snoozed.workspaceId,
		);

		expect(standard.map((conversation) => conversation.id)).toEqual([]);
		expect(snoozedQueue.map((conversation) => conversation.id)).toEqual([snoozed.id]);
		expect(all.map((conversation) => conversation.id)).toEqual([
			"archived-with-stale-snooze",
		]);
	});

	test("clears only open conversations due at the cron timestamp", async () => {
		const now = "2026-09-22T00:00:00.000Z";
		const due = await insertSnoozedConversation("2026-09-21T23:59:59.000Z");
		const futureId = crypto.randomUUID();
		const dueRow = await ctx.db
			.select()
			.from(conversations)
			.where(eq(conversations.id, due.id))
			.get();
		if (!dueRow) throw new Error("seeded conversation missing");
		await ctx.db
			.insert(conversations)
			.values({
				...dueRow,
				id: futureId,
				doBindingId: futureId,
				snoozedUntil: "2026-09-22T00:00:01.000Z",
			})
			.run();

		expect(await reviveDueSnoozes(ctx.env, now)).toBe(1);

		const rows = await ctx.db
			.select({
				id: conversations.id,
				snoozedUntil: conversations.snoozedUntil,
			})
			.from(conversations)
			.where(and(eq(conversations.workspaceId, due.workspaceId)))
			.all();
		expect(rows.find((row) => row.id === due.id)?.snoozedUntil).toBeNull();
		expect(rows.find((row) => row.id === futureId)?.snoozedUntil).toBe(
			"2026-09-22T00:00:01.000Z",
		);
		expect(ctx.activityRequests).toHaveLength(1);
		expect(ctx.activityRequests[0]).toMatchObject({
			conversationId: due.id,
			action: "snooze.expired",
			actorId: null,
			details: { snoozedUntil: "2026-09-21T23:59:59.000Z" },
		});
	});
});

describe("outbound delivery persistence", () => {
	test("records an outbound intent through provider-sent and delivered states", async () => {
		ctx = await createTestDb();
		const now = "2026-09-22T00:00:00.000Z";
		await ctx.db.insert(outboundIntents).values({
			id: "intent-1", conversationId: "email:support@test.dev:thread-1", text: "hello", senderId: "agent",
			status: "pending", createdAt: now, updatedAt: now,
		}).run();
		await ctx.db.update(outboundIntents).set({ status: "provider_sent", attempts: 1, providerMessageId: "provider-1", providerSentAt: now, updatedAt: now }).where(eq(outboundIntents.id, "intent-1")).run();
		await ctx.db.update(outboundIntents).set({ status: "delivered", deliveredAt: now, updatedAt: now }).where(eq(outboundIntents.id, "intent-1")).run();
		const intent = await ctx.db.select().from(outboundIntents).where(eq(outboundIntents.id, "intent-1")).get();
		expect(intent).toMatchObject({ status: "delivered", attempts: 1, providerMessageId: "provider-1", deliveredAt: now });
	});

	test("atomically claims a due scheduled row and only reclaims an expired lease", async () => {
		ctx = await createTestDb();
		const now = "2026-09-22T00:00:00.000Z";
		await ctx.db.insert(scheduledMessages).values({ id: "scheduled-1", conversationId: "email:support@test.dev:thread-1", text: "hello", sendAt: now, createdBy: "agent" }).run();
		expect(await claimScheduledMessage(ctx.env, "scheduled-1", now, "cron-a")).toBe(true);
		expect(await claimScheduledMessage(ctx.env, "scheduled-1", now, "cron-b")).toBe(false);
		expect(await claimScheduledMessage(ctx.env, "scheduled-1", "2026-09-22T00:06:00.000Z", "cron-c")).toBe(true);
		const row = await ctx.db.select().from(scheduledMessages).where(eq(scheduledMessages.id, "scheduled-1")).get();
		expect(row).toMatchObject({ claimToken: "cron-c", claimedAt: "2026-09-22T00:06:00.000Z" });
	});
});

describe("activity append", () => {
	test("assigns audit id and timestamp in the Worker", async () => {
		ctx = await createTestDb();
		const before = Date.now();
		const activity = await appendActivity(ctx.env, {
			conversationId: "email:support@test.dev:thread-1",
			action: "tag.added",
			actorId: "agent",
			details: { tagId: "vip" },
		});

		expect(activity.id).toBeString();
		expect(new Date(activity.createdAt).getTime()).toBeGreaterThanOrEqual(
			before,
		);
		expect(ctx.activityRequests).toEqual([activity]);
	});
});

describe("channel token encryption", () => {
	test("round-trips an AES-GCM encrypted token without exposing plaintext", async () => {
		const plaintext = "EAAG-page-access-token";
		const encrypted = await encryptChannelToken(plaintext, TOKEN_KEY);
		expect(encrypted).toStartWith("enc:v1:");
		expect(encrypted).not.toContain(plaintext);
		expect(await decryptChannelToken(encrypted, TOKEN_KEY)).toBe(plaintext);
	});

	test("rejects malformed ciphertext and invalid key material", async () => {
		await expect(
			decryptChannelToken("enc:v1:not-valid", TOKEN_KEY),
		).rejects.toThrow();
		await expect(encryptChannelToken("token", "short-key")).rejects.toThrow();
	});
});
