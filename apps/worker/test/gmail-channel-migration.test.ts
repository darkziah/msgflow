import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	contacts,
	conversations,
	gmailAccountDelegates,
	gmailAccounts,
	gmailMessageRefs,
	inboxes,
} from "@msgflow/db";

import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf?.dispose());

async function insertGmailAccount(
	workspaceId: string,
	channelId: string,
	googleSub: string,
) {
	const now = new Date().toISOString();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "gmail",
			displayName: `Gmail ${channelId}`,
			externalId: `gmail:${channelId}`,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(gmailAccounts)
		.values({
			id: `account-${channelId}`,
			workspaceId,
			channelId,
			ownerUserId: "owner",
			accessMode: "shared",
			googleSub,
			email: `${channelId}@example.test`,
			encryptedRefreshToken: "encrypted",
			tokenKeyVersion: 1,
			backfillDays: 30,
			scopesJson: "[]",
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

describe("Gmail channel migration constraints", () => {
	test("enforces one Gmail account per channel and globally unique Google subject", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await insertGmailAccount(workspaceId, "channel-1", "google-sub-1");
		const now = new Date().toISOString();

		await expect(
			ctx.db.insert(gmailAccounts).values({
				id: "account-duplicate-channel",
				workspaceId,
				channelId: "channel-1",
				ownerUserId: "owner",
				accessMode: "shared",
				googleSub: "google-sub-2",
				email: "other@example.test",
				encryptedRefreshToken: "encrypted",
				tokenKeyVersion: 1,
				backfillDays: 30,
				scopesJson: "[]",
				createdAt: now,
				updatedAt: now,
			}).run(),
		).rejects.toThrow();

		await expect(insertGmailAccount(workspaceId, "channel-2", "google-sub-1")).rejects.toThrow();
	});

	test("enforces Gmail message and delegate mappings exactly once", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await seedUser(ctx, "delegate", "delegate@example.test");
		await insertGmailAccount(workspaceId, "channel-1", "google-sub-1");
		const now = new Date().toISOString();
		const accountId = "account-channel-1";

		await ctx.db
			.insert(gmailAccountDelegates)
			.values({ accountId, userId: "delegate", createdAt: now })
			.run();
		await expect(
			ctx.db.insert(gmailAccountDelegates).values({ accountId, userId: "delegate", createdAt: now }).run(),
		).rejects.toThrow();
		await ctx.db
			.insert(inboxes)
			.values({ id: "inbox-1", workspaceId, name: "Gmail", createdAt: now })
			.run();
		await ctx.db
			.insert(contacts)
			.values({ id: "contact-1", workspaceId, createdAt: now, updatedAt: now })
			.run();
		await ctx.db
			.insert(conversations)
			.values({
				id: "conversation-1",
				workspaceId,
				channelId: "channel-1",
				inboxId: "inbox-1",
				contactId: "contact-1",
				doBindingId: "conversation-1",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		const ref = {
			channelId: "channel-1",
			gmailMessageId: "message-1",
			gmailThreadId: "thread-1",
			conversationId: "conversation-1",
			direction: "inbound" as const,
			createdAt: now,
		};
		await ctx.db.insert(gmailMessageRefs).values(ref).run();
		await expect(
			ctx.db.insert(gmailMessageRefs).values({ ...ref, gmailMessageId: "message-2" }).run(),
		).rejects.toThrow();
	});
});
