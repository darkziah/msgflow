import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	gmailAccounts,
	gmailMessageRefs,
	inboxChannels,
	inboxes,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import { encryptChannelToken } from "../src/channel-token-crypto";
import type { Env } from "../src/env";
import {
	backfillGmailInbox,
	backfillPendingGmailInboxes,
	reconcileGmailHistory,
} from "../src/gmail-sync";
import { createTestDb, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
const nativeFetch = globalThis.fetch;
afterEach(async () => {
	globalThis.fetch = nativeFetch;
	await ctx?.mf.dispose();
});

async function setup() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await ctx.db
		.insert(inboxes)
		.values({ id: "inbox", workspaceId, name: "Inbox", createdAt: now })
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: "gmail",
			workspaceId,
			type: "gmail",
			displayName: "Gmail",
			externalId: "sub",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.env.DB.prepare(
		"INSERT INTO user (id,name,email,email_verified) VALUES ('owner','owner','owner@example.test',1)",
	).run();
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: "owner-membership",
			workspaceId,
			userId: "owner",
			role: "owner",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(gmailAccounts)
		.values({
			id: "account",
			workspaceId,
			channelId: "gmail",
			ownerUserId: "owner",
			accessMode: "private",
			teamId: null,
			googleSub: "sub",
			email: "owner@example.test",
			encryptedRefreshToken: await encryptChannelToken(
				"refresh",
				"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			),
			tokenKeyVersion: 1,
			syncState: "idle",
			backfillDays: 30,
			scopesJson: "[]",
			archiveRemovesInboxLabel: false,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxChannels)
		.values({
			id: "link",
			inboxId: "inbox",
			channelId: "gmail",
			isDefault: true,
		})
		.run();
	return {
		...ctx.env,
		CHANNEL_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		GOOGLE_CLIENT_ID: "client",
		GOOGLE_CLIENT_SECRET: "secret",
	} as Env;
}
function message(id: string, from: string, date = Date.now()) {
	return {
		id,
		threadId: "thread",
		labelIds: ["INBOX"],
		internalDate: String(date),
		payload: {
			headers: [
				{ name: "From", value: from },
				{ name: "Subject", value: "Test" },
			],
			body: { data: "SGVsbG8=" },
		},
	};
}
function mockGmail(messages: unknown[], status = 200) {
	globalThis.fetch = (async (url) => {
		const value = String(url);
		if (value.includes("/token"))
			return Response.json({ access_token: "access" });
		if (value.includes("/threads?"))
			return Response.json({ threads: [{ id: "thread" }] });
		if (value.includes("/threads/thread"))
			return Response.json({ id: "thread", messages }, { status });
		if (value.includes("/profile"))
			return Response.json({
				emailAddress: "owner@example.test",
				historyId: "history",
			});
		throw new Error(`unexpected ${value}`);
	}) as typeof fetch;
}

describe("Gmail initial inbox sync", () => {
	test("projects valid inbound Gmail once, accepts padded base64url, and only counts inserted refs", async () => {
		const env = await setup();
		mockGmail([
			message("one", "customer@example.test"),
			message("two", "customer@example.test"),
		]);
		const first = await backfillGmailInbox(env, "gmail");
		expect(first).toMatchObject({ threads: 1, messages: 2, truncated: false });
		mockGmail([
			message("one", "customer@example.test"),
			message("two", "customer@example.test"),
		]);
		const second = await backfillGmailInbox(env, "gmail");
		expect(second.messages).toBe(0);
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(2);
		expect(ctx.activityRequests).toHaveLength(2);
	});

	test("enforces the per-message cutoff, validates IDs, and keeps one contact per Gmail thread", async () => {
		const env = await setup();
		mockGmail([
			message("old", "old@example.test", Date.now() - 31 * 86_400_000),
			message("wrong-thread", "bad@example.test"),
			{ ...message("new", "first@example.test"), threadId: "thread" },
			message("other", "second@example.test"),
		]);
		const result = await backfillGmailInbox(env, "gmail");
		expect(result.messages).toBe(1);
		expect(ctx.activityRequests).toHaveLength(1);
		expect(ctx.activityRequests[0]).toMatchObject({
			senderId: expect.any(String),
			providerMessageId: "new",
		});
	});

	test("cron picks a newly connected idle account and stale 401 cannot overwrite a replaced lease", async () => {
		const env = await setup();
		mockGmail([message("one", "customer@example.test")]);
		await backfillPendingGmailInboxes(env);
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.lastSyncedAt,
		).toBeTruthy();
		await ctx.env.DB.prepare(
			"UPDATE gmail_accounts SET sync_state='idle', last_synced_at=NULL WHERE channel_id='gmail'",
		).run();
		globalThis.fetch = (async (url) => {
			if (String(url).includes("/token"))
				return Response.json({ access_token: "access" });
			if (String(url).includes("/threads?")) {
				await ctx.env.DB.prepare(
					"UPDATE gmail_accounts SET sync_state='idle', sync_claim_token='new-lease', sync_claimed_at=? WHERE channel_id='gmail'",
				)
					.bind(new Date().toISOString())
					.run();
				return new Response("unauthorized", { status: 401 });
			}
			throw new Error("unexpected request");
		}) as typeof fetch;
		await expect(backfillGmailInbox(env, "gmail")).rejects.toThrow();
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.syncState,
		).toBe("idle");
	});
	test("does not persist a Gmail ref until append succeeds and retries pending appends without rerunning rules", async () => {
		const env = await setup();
		let fail = true;
		ctx.env.CONVERSATION_DO = {
			idFromName: (id: string) => id,
			get: () => ({
				fetch: async () =>
					new Response("unavailable", { status: fail ? 503 : 200 }),
			}),
		} as Env["CONVERSATION_DO"];
		env.CONVERSATION_DO = ctx.env.CONVERSATION_DO;
		mockGmail([message("one", "customer@example.test")]);
		await expect(backfillGmailInbox(env, "gmail")).rejects.toThrow(
			"append failed",
		);
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(0);
		fail = false;
		mockGmail([message("one", "customer@example.test")]);
		await backfillGmailInbox(env, "gmail");
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(1);
	});
});

describe("Gmail History reconciliation", () => {
	async function historyEnv(historyId = "10") {
		const env = await setup();
		await ctx.env.DB.prepare(
			"UPDATE gmail_accounts SET history_id=? WHERE channel_id='gmail'",
		)
			.bind(historyId)
			.run();
		return env;
	}
	function mockHistory(
		pages: Record<string, unknown>,
		threadMessages = [message("new", "customer@example.test")],
	) {
		globalThis.fetch = (async (url) => {
			const value = String(url);
			if (value.includes("/token"))
				return Response.json({ access_token: "access" });
			if (value.includes("/history?")) {
				const token = new URL(value).searchParams.get("pageToken") ?? "first";
				const page = pages[token];
				if (page instanceof Response) return page;
				return Response.json(page);
			}
			if (value.includes("/threads/thread"))
				return Response.json({ id: "thread", messages: threadMessages });
			if (value.includes("/threads?"))
				return Response.json({ threads: [{ id: "thread" }] });
			if (value.includes("/profile"))
				return Response.json({
					emailAddress: "owner@example.test",
					historyId: "99",
				});
			throw new Error(`unexpected ${value}`);
		}) as typeof fetch;
	}
	test("commits each completed history page in order", async () => {
		const env = await historyEnv();
		mockHistory({
			first: {
				history: [
					{
						id: "11",
						messagesAdded: [{ message: { id: "new", threadId: "thread" } }],
					},
				],
				nextPageToken: "second",
			},
			second: { history: [{ id: "12", messagesAdded: [] }], historyId: "12" },
		});
		await reconcileGmailHistory(env, "gmail");
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.historyId,
		).toBe("12");
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(1);
	});
	test("deduplicates out-of-order added messages and never regresses for a stale requested ID", async () => {
		const env = await historyEnv("20");
		mockHistory({
			first: {
				history: [
					{
						id: "21",
						messagesAdded: [
							{ message: { id: "new", threadId: "thread" } },
							{ message: { id: "new", threadId: "thread" } },
						],
					},
				],
				historyId: "21",
			},
		});
		await reconcileGmailHistory(env, "gmail", "1");
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(1);
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.historyId,
		).toBe("21");
	});
	test("clears an expired history cursor and performs bounded backfill recovery", async () => {
		const env = await historyEnv();
		mockHistory({ first: new Response("expired", { status: 404 }) });
		await reconcileGmailHistory(env, "gmail");
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.historyId,
		).toBe("99");
		expect(await ctx.db.select().from(gmailMessageRefs).all()).toHaveLength(1);
	});
	test("leaves the history cursor unchanged when durable projection fails", async () => {
		const env = await historyEnv();
		ctx.env.CONVERSATION_DO = {
			idFromName: (id: string) => id,
			get: () => ({
				fetch: async () => new Response("unavailable", { status: 503 }),
			}),
		} as Env["CONVERSATION_DO"];
		env.CONVERSATION_DO = ctx.env.CONVERSATION_DO;
		mockHistory({
			first: {
				history: [
					{
						id: "11",
						messagesAdded: [{ message: { id: "new", threadId: "thread" } }],
					},
				],
				historyId: "11",
			},
		});
		await expect(reconcileGmailHistory(env, "gmail")).rejects.toThrow(
			"append failed",
		);
		expect(
			(
				await ctx.db
					.select()
					.from(gmailAccounts)
					.where(eq(gmailAccounts.channelId, "gmail"))
					.get()
			)?.historyId,
		).toBe("10");
	});
});
