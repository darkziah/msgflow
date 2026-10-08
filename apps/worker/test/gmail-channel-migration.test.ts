import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	contacts,
	conversations,
	gmailAccountDelegates,
	gmailAccounts,
	gmailMessageRefs,
	gmailOauthSessions,
	inboxes,
	teams,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";

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
		.insert(workspaceMembers)
		.values({
			id: `owner-membership-${workspaceId}`,
			workspaceId,
			userId: "owner",
			role: "owner",
			createdAt: now,
		})
		.onConflictDoNothing()
		.run();
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
			accessMode: "private",
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
	test("enforces Gmail account and OAuth session tenant boundaries", async () => {
		ctx = await createTestDb();
		const { workspaceId: workspaceA } = await seedWorkspace(ctx);
		const now = new Date().toISOString();
		await ctx.env.DB.prepare(
			"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
		)
			.bind("workspace-b", "Workspace B", "workspace-b", now, now)
			.run();
		await seedUser(ctx, "owner", "owner@example.test");
		await seedUser(ctx, "nonmember", "nonmember@example.test");
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id: "owner-workspace-a",
				workspaceId: workspaceA,
				userId: "owner",
				role: "owner",
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(channels)
			.values({
				id: "gmail-channel-b",
				workspaceId: "workspace-b",
				type: "gmail",
				displayName: "Gmail B",
				externalId: "gmail:channel-b",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await expect(
			ctx.db
				.insert(gmailAccounts)
				.values({
					id: "cross-workspace-account",
					workspaceId: workspaceA,
					channelId: "gmail-channel-b",
					ownerUserId: "owner",
					accessMode: "shared",
					googleSub: "cross-workspace-subject",
					email: "cross-workspace@example.test",
					encryptedRefreshToken: "encrypted",
					tokenKeyVersion: 1,
					backfillDays: 30,
					scopesJson: "[]",
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();

		await ctx.db
			.insert(inboxes)
			.values([
				{
					id: "inbox-a",
					workspaceId: workspaceA,
					name: "Inbox A",
					createdAt: now,
				},
				{
					id: "inbox-b",
					workspaceId: "workspace-b",
					name: "Inbox B",
					createdAt: now,
				},
			])
			.run();
		await ctx.db
			.insert(teams)
			.values([
				{
					id: "team-a",
					workspaceId: workspaceA,
					name: "Team A",
					createdAt: now,
				},
				{
					id: "team-b",
					workspaceId: "workspace-b",
					name: "Team B",
					createdAt: now,
				},
			])
			.run();
		const session = {
			id: "session-valid",
			workspaceId: workspaceA,
			actorUserId: "owner",
			inboxId: "inbox-a",
			accessMode: "shared" as const,
			teamId: "team-a",
			backfillDays: 30,
			encryptedState: "encrypted",
			expiresAt: now,
			createdAt: now,
		};
		await ctx.db.insert(gmailOauthSessions).values(session).run();
		await expect(
			ctx.db
				.insert(gmailOauthSessions)
				.values({ ...session, id: "session-shared-no-team", teamId: null })
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailOauthSessions)
				.values({
					...session,
					id: "session-private-with-team",
					accessMode: "private",
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailOauthSessions)
				.values({ ...session, id: "session-wrong-inbox", inboxId: "inbox-b" })
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailOauthSessions)
				.values({ ...session, id: "session-wrong-team", teamId: "team-b" })
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailOauthSessions)
				.values({
					...session,
					id: "session-nonmember",
					actorUserId: "nonmember",
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(gmailOauthSessions)
				.set({ inboxId: "inbox-b" })
				.where(eq(gmailOauthSessions.id, session.id))
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(gmailOauthSessions)
				.set({ teamId: "team-b" })
				.where(eq(gmailOauthSessions.id, session.id))
				.run(),
		).rejects.toThrow();

		await insertGmailAccount(workspaceA, "gmail-channel-a", "google-subject-a");
		await expect(
			ctx.db
				.insert(gmailAccounts)
				.values({
					id: "account-nonmember-owner",
					workspaceId: workspaceA,
					channelId: "gmail-channel-a",
					ownerUserId: "nonmember",
					accessMode: "private",
					googleSub: "nonmember-owner-subject",
					email: "nonmember-owner@example.test",
					encryptedRefreshToken: "encrypted",
					tokenKeyVersion: 1,
					backfillDays: 30,
					scopesJson: "[]",
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailAccountDelegates)
				.values({
					accountId: "account-gmail-channel-a",
					userId: "nonmember",
					createdAt: now,
				})
				.run(),
		).rejects.toThrow();
		await ctx.db
			.insert(contacts)
			.values({
				id: "contact-b",
				workspaceId: "workspace-b",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(conversations)
			.values({
				id: "cross-workspace-conversation",
				workspaceId: "workspace-b",
				channelId: "gmail-channel-a",
				inboxId: "inbox-b",
				contactId: "contact-b",
				doBindingId: "cross-workspace-conversation",
				externalThreadId: "thread-a",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await expect(
			ctx.db
				.insert(gmailMessageRefs)
				.values({
					channelId: "gmail-channel-a",
					gmailMessageId: "cross-workspace-message",
					gmailThreadId: "thread-a",
					conversationId: "cross-workspace-conversation",
					direction: "inbound",
					createdAt: now,
				})
				.run(),
		).rejects.toThrow();
	});

	test("enforces one Gmail account per channel and globally unique Google subject", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await insertGmailAccount(workspaceId, "channel-1", "google-sub-1");
		const now = new Date().toISOString();

		await expect(
			ctx.db
				.insert(gmailAccounts)
				.values({
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
				})
				.run(),
		).rejects.toThrow();

		await expect(
			insertGmailAccount(workspaceId, "channel-2", "google-sub-1"),
		).rejects.toThrow();
	});

	test("0032 permits a Gmail ref for a mismatched conversation", async () => {
		ctx = await createTestDb({
			throughMigration: "0032_gmail_message_refs_thread_lookup.sql",
		});
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await insertGmailAccount(workspaceId, "channel-1", "google-sub-1");
		const now = new Date().toISOString();

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
				id: "conversation-wrong-thread",
				workspaceId,
				channelId: "channel-1",
				inboxId: "inbox-1",
				contactId: "contact-1",
				doBindingId: "conversation-wrong-thread",
				externalThreadId: "thread-2",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		await ctx.db
			.insert(gmailMessageRefs)
			.values({
				channelId: "channel-1",
				gmailMessageId: "message-wrong-thread",
				gmailThreadId: "thread-1",
				conversationId: "conversation-wrong-thread",
				direction: "inbound",
				createdAt: now,
			})
			.run();
	});

	test("enforces Gmail message, delegate, and channel/thread conversation mappings", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await seedUser(ctx, "delegate", "delegate@example.test");
		await insertGmailAccount(workspaceId, "channel-1", "google-sub-1");
		const now = new Date().toISOString();
		const accountId = "account-channel-1";
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id: "delegate-membership",
				workspaceId,
				userId: "delegate",
				role: "member",
				createdAt: now,
			})
			.run();

		await ctx.db
			.insert(gmailAccountDelegates)
			.values({ accountId, userId: "delegate", createdAt: now })
			.run();
		await expect(
			ctx.db
				.insert(gmailAccountDelegates)
				.values({ accountId, userId: "delegate", createdAt: now })
				.run(),
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
				externalThreadId: "thread-1",
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
		await ctx.db
			.insert(gmailMessageRefs)
			.values({ ...ref, gmailMessageId: "message-2" })
			.run();
		await expect(
			ctx.db.insert(gmailMessageRefs).values(ref).run(),
		).rejects.toThrow();

		await expect(
			ctx.db
				.insert(conversations)
				.values({
					id: "conversation-2",
					workspaceId,
					channelId: "channel-1",
					inboxId: "inbox-1",
					contactId: "contact-1",
					doBindingId: "conversation-2",
					externalThreadId: "thread-1",
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();

		await insertGmailAccount(workspaceId, "channel-2", "google-sub-2");
		await ctx.db
			.insert(conversations)
			.values({
				id: "conversation-other-channel",
				workspaceId,
				channelId: "channel-2",
				inboxId: "inbox-1",
				contactId: "contact-1",
				doBindingId: "conversation-other-channel",
				externalThreadId: "thread-1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(conversations)
			.values({
				id: "conversation-other-thread",
				workspaceId,
				channelId: "channel-1",
				inboxId: "inbox-1",
				contactId: "contact-1",
				doBindingId: "conversation-other-thread",
				externalThreadId: "thread-2",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(conversations)
			.values({
				id: "conversation-no-thread",
				workspaceId,
				channelId: "channel-1",
				inboxId: "inbox-1",
				contactId: "contact-1",
				doBindingId: "conversation-no-thread",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		await expect(
			ctx.db
				.insert(gmailMessageRefs)
				.values({
					...ref,
					gmailMessageId: "message-other-channel",
					conversationId: "conversation-other-channel",
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailMessageRefs)
				.values({
					...ref,
					gmailMessageId: "message-other-thread",
					conversationId: "conversation-other-thread",
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.insert(gmailMessageRefs)
				.values({
					...ref,
					gmailMessageId: "message-no-thread",
					conversationId: "conversation-no-thread",
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(gmailMessageRefs)
				.set({ conversationId: "conversation-other-thread" })
				.where(eq(gmailMessageRefs.gmailMessageId, "message-2"))
				.run(),
		).rejects.toThrow();
	});

	test("preserves Gmail-only channels and existing conversation thread refs across updates", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "owner", "owner@example.test");
		await insertGmailAccount(workspaceId, "gmail-channel", "google-sub-gmail");
		const now = new Date().toISOString();

		await ctx.db
			.insert(channels)
			.values({
				id: "email-channel",
				workspaceId,
				type: "email",
				displayName: "Email",
				externalId: "email:inbox@example.test",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(inboxes)
			.values({ id: "inbox-1", workspaceId, name: "Inbox", createdAt: now })
			.run();
		await ctx.db
			.insert(contacts)
			.values({ id: "contact-1", workspaceId, createdAt: now, updatedAt: now })
			.run();
		await ctx.db
			.insert(conversations)
			.values([
				{
					id: "gmail-conversation",
					workspaceId,
					channelId: "gmail-channel",
					inboxId: "inbox-1",
					contactId: "contact-1",
					doBindingId: "gmail-conversation",
					externalThreadId: "gmail-thread",
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "email-conversation",
					workspaceId,
					channelId: "email-channel",
					inboxId: "inbox-1",
					contactId: "contact-1",
					doBindingId: "email-conversation",
					externalThreadId: "email-thread",
					createdAt: now,
					updatedAt: now,
				},
			])
			.run();
		const gmailRef = {
			channelId: "gmail-channel",
			gmailMessageId: "gmail-message",
			gmailThreadId: "gmail-thread",
			conversationId: "gmail-conversation",
			direction: "inbound" as const,
			createdAt: now,
		};
		await ctx.db.insert(gmailMessageRefs).values(gmailRef).run();

		await expect(
			ctx.db
				.insert(gmailAccounts)
				.values({
					id: "email-account",
					workspaceId,
					channelId: "email-channel",
					ownerUserId: "owner",
					accessMode: "shared",
					googleSub: "google-sub-email",
					email: "email-account@example.test",
					encryptedRefreshToken: "encrypted",
					tokenKeyVersion: 1,
					backfillDays: 30,
					scopesJson: "[]",
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(gmailAccounts)
				.set({ channelId: "email-channel" })
				.where(eq(gmailAccounts.id, "account-gmail-channel"))
				.run(),
		).rejects.toThrow();

		await expect(
			ctx.db
				.insert(gmailMessageRefs)
				.values({
					channelId: "email-channel",
					gmailMessageId: "email-message",
					gmailThreadId: "email-thread",
					conversationId: "email-conversation",
					direction: "inbound",
					createdAt: now,
				})
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(gmailMessageRefs)
				.set({
					channelId: "email-channel",
					gmailThreadId: "email-thread",
					conversationId: "email-conversation",
				})
				.where(eq(gmailMessageRefs.gmailMessageId, "gmail-message"))
				.run(),
		).rejects.toThrow();

		await expect(
			ctx.db
				.update(conversations)
				.set({ externalThreadId: "other-thread" })
				.where(eq(conversations.id, "gmail-conversation"))
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(conversations)
				.set({ channelId: "email-channel" })
				.where(eq(conversations.id, "gmail-conversation"))
				.run(),
		).rejects.toThrow();
		await expect(
			ctx.db
				.update(channels)
				.set({ type: "email" })
				.where(eq(channels.id, "gmail-channel"))
				.run(),
		).rejects.toThrow();

		await ctx.db
			.update(conversations)
			.set({ subject: "Updated subject", status: "archived" })
			.where(eq(conversations.id, "gmail-conversation"))
			.run();
		const updatedConversation = await ctx.db
			.select()
			.from(conversations)
			.where(eq(conversations.id, "gmail-conversation"))
			.get();
		expect(updatedConversation?.subject).toBe("Updated subject");
		expect(updatedConversation?.status).toBe("archived");
	});
});
