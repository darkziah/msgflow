import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	contacts,
	conversations,
	gmailAccounts,
	gmailMessageRefs,
	inboxChannels,
	inboxes,
	workspaceMembers,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { decryptChannelToken } from "../src/channel-token-crypto";
import type { Env } from "../src/env";
import {
	beginGmailChannelOAuth,
	completeGmailChannelOAuth,
	disconnectGmailChannel,
} from "../src/gmail-channel";
import { startGmailOAuth } from "../src/gmail-oauth";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
const nativeFetch = globalThis.fetch;
afterEach(async () => {
	globalThis.fetch = nativeFetch;
	await ctx?.mf.dispose();
});

async function setup(role: "owner" | "admin" | "member" = "owner") {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "actor", "actor@example.test");
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: "membership",
			workspaceId,
			userId: "actor",
			role,
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxes)
		.values({ id: "inbox", workspaceId, name: "Inbox", createdAt: now })
		.run();
	return {
		workspaceId,
		env: {
			...ctx.env,
			CHANNEL_TOKEN_ENCRYPTION_KEY:
				"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			GOOGLE_CLIENT_ID: "client",
			GOOGLE_CLIENT_SECRET: "secret",
			GOOGLE_OAUTH_REDIRECT_URI:
				"https://msgflow.test/api/gmail-oauth/callback",
		} as Env,
	};
}

function input() {
	return { inboxId: "inbox", accessMode: "private" as const, backfillDays: 30 };
}

function oauthState(authorizationUrl: string): string {
	const state = new URL(authorizationUrl).searchParams.get("state");
	if (!state) throw new Error("OAuth state missing");
	return state;
}

function mockGoogle(identity: Record<string, unknown> = {}) {
	globalThis.fetch = async (url) => {
		if (String(url).includes("/token"))
			return Response.json({
				access_token: "access",
				refresh_token: "refresh",
				scope: "openid email",
			});
		if (String(url).includes("userinfo"))
			return Response.json({
				sub: "google-sub",
				email: "Person@Example.Test",
				email_verified: true,
				...identity,
			});
		return new Response(null, { status: 200 });
	};
}

describe("Gmail channel lifecycle", () => {
	test("requires admin-level lifecycle authority and an active inbox", async () => {
		const { env, workspaceId } = await setup("member");
		await expect(
			beginGmailChannelOAuth(
				env,
				workspaceId,
				input(),
				"actor",
				"https://msgflow.test",
			),
		).rejects.toMatchObject({ status: 403 });
		await ctx.db
			.update(workspaceMembers)
			.set({ role: "admin" })
			.where(eq(workspaceMembers.id, "membership"))
			.run();
		await ctx.db
			.update(inboxes)
			.set({ isArchived: true })
			.where(eq(inboxes.id, "inbox"))
			.run();
		await expect(
			beginGmailChannelOAuth(
				env,
				workspaceId,
				input(),
				"actor",
				"https://msgflow.test",
			),
		).rejects.toMatchObject({ status: 404 });
	});

	test("rejects an unverified owner or admin before starting Gmail OAuth", async () => {
		for (const role of ["owner", "admin"] as const) {
			const { env, workspaceId } = await setup(role);
			await ctx.env.DB.prepare(
				"UPDATE user SET email_verified=0 WHERE id='actor'",
			).run();
			await expect(
				beginGmailChannelOAuth(
					env,
					workspaceId,
					input(),
					"actor",
					"https://msgflow.test",
				),
			).rejects.toMatchObject({ status: 403 });
			const sessions = await ctx.env.DB.prepare(
				"SELECT count(*) AS count FROM gmail_oauth_sessions",
			).first<{ count: number }>();
			expect(sessions?.count).toBe(0);
			await ctx.mf.dispose();
		}
		ctx = undefined as unknown as TestCtx;
	});

	test("rejects absent OAuth configuration before recording request origin", async () => {
		const { env, workspaceId } = await setup();
		await expect(
			beginGmailChannelOAuth(
				{ ...env, GOOGLE_CLIENT_SECRET: undefined },
				workspaceId,
				input(),
				"actor",
				"https://untrusted.test",
			),
		).rejects.toMatchObject({ status: 503 });
		const row = await ctx.env.DB.prepare(
			"SELECT count(*) AS count FROM gmail_oauth_sessions",
		).first<{ count: number }>();
		expect(row?.count).toBe(0);
	});

	test("binds callback to the initiating Better Auth user", async () => {
		const { env, workspaceId } = await setup();
		const { authorizationUrl } = await beginGmailChannelOAuth(
			env,
			workspaceId,
			input(),
			"actor",
			"https://msgflow.test",
		);
		await expect(
			completeGmailChannelOAuth(
				env,
				oauthState(authorizationUrl),
				"code",
				"other-user",
			),
		).rejects.toMatchObject({ status: 400 });
	});

	test("fails safely when Google does not return an offline refresh token", async () => {
		const { env, workspaceId } = await setup();
		globalThis.fetch = async () => Response.json({ access_token: "access" });
		const { authorizationUrl } = await beginGmailChannelOAuth(
			env,
			workspaceId,
			input(),
			"actor",
			"https://msgflow.test",
		);
		await expect(
			completeGmailChannelOAuth(
				env,
				oauthState(authorizationUrl),
				"code",
				"actor",
			),
		).rejects.toMatchObject({ status: 400 });
		const rows = await ctx.env.DB.prepare(
			"SELECT count(*) AS count FROM channels WHERE type='gmail'",
		).first<{ count: number }>();
		expect(rows?.count).toBe(0);
	});

	test("rejects malformed Google identities without creating Gmail persistence or exposing secrets", async () => {
		for (const identity of [
			{ sub: undefined },
			{ sub: "" },
			{ email_verified: false },
			{ email: "not-an-email" },
		]) {
			const { env, workspaceId } = await setup();
			mockGoogle(identity);
			const { authorizationUrl } = await beginGmailChannelOAuth(
				env,
				workspaceId,
				input(),
				"actor",
				"https://msgflow.test",
			);
			const error = await completeGmailChannelOAuth(
				env,
				oauthState(authorizationUrl),
				"code",
				"actor",
			).catch((err: unknown) => err);
			expect(error).toMatchObject({ status: 400 });
			expect(String(error)).not.toContain("refresh");
			const counts = await ctx.env.DB.prepare(
				"SELECT (SELECT count(*) FROM channels WHERE type='gmail') AS channels, (SELECT count(*) FROM gmail_accounts) AS accounts",
			).first<{ channels: number; accounts: number }>();
			expect(counts).toEqual({ channels: 0, accounts: 0 });
			await ctx.mf.dispose();
		}
		ctx = undefined as unknown as TestCtx;
	});

	test("classifies only the D1 Google subject unique constraint as a collision", async () => {
		const runWithBatchError = async (message: string) => {
			const { env, workspaceId } = await setup();
			mockGoogle();
			const { authorizationUrl } = await beginGmailChannelOAuth(
				env,
				workspaceId,
				input(),
				"actor",
				"https://msgflow.test",
			);
			const failingDb = new Proxy(env.DB, {
				get(target, property) {
					if (property === "batch")
						return async () => {
							throw new Error(message);
						};
					const value = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			const error = await completeGmailChannelOAuth(
				{ ...env, DB: failingDb },
				oauthState(authorizationUrl),
				"code",
				"actor",
			).catch((err: unknown) => err);
			return { error, state: oauthState(authorizationUrl) };
		};

		const unique = await runWithBatchError(
			"D1_ERROR: UNIQUE constraint failed: gmail_accounts.google_sub",
		);
		expect(unique.error).toMatchObject({
			status: 409,
			message: "this Google account is already connected",
		});
		const foreignKey = await runWithBatchError(
			"D1_ERROR: FOREIGN KEY constraint failed",
		);
		expect(foreignKey.error).toMatchObject({ status: 500 });
		expect(String(foreignKey.error)).not.toContain("refresh");
		await expect(
			completeGmailChannelOAuth(
				ctx.env as Env,
				foreignKey.state,
				"code",
				"actor",
			),
		).rejects.toMatchObject({ status: 400 });
	});

	test("creates Gmail-only persistence and a default inbox link", async () => {
		const { env, workspaceId } = await setup();
		mockGoogle();
		const { authorizationUrl } = await beginGmailChannelOAuth(
			env,
			workspaceId,
			input(),
			"actor",
			"https://msgflow.test",
		);
		const completed = await completeGmailChannelOAuth(
			env,
			oauthState(authorizationUrl),
			"code",
			"actor",
		);
		const account = await ctx.db
			.select()
			.from(gmailAccounts)
			.where(eq(gmailAccounts.channelId, completed.channelId))
			.get();
		const channel = await ctx.db
			.select()
			.from(channels)
			.where(eq(channels.id, completed.channelId))
			.get();
		const link = await ctx.db
			.select()
			.from(inboxChannels)
			.where(
				and(
					eq(inboxChannels.channelId, completed.channelId),
					eq(inboxChannels.inboxId, "inbox"),
				),
			)
			.get();
		expect(channel).toMatchObject({
			workspaceId,
			type: "gmail",
			accessToken: null,
			refreshToken: null,
			externalId: "google-sub",
		});
		expect(account?.email).toBe("person@example.test");
		expect(account?.encryptedRefreshToken).toStartWith("enc:v1:");
		if (!account) throw new Error("Gmail account missing");
		expect(
			await decryptChannelToken(
				account.encryptedRefreshToken,
				env.CHANNEL_TOKEN_ENCRYPTION_KEY,
			),
		).toBe("refresh");
		expect(link?.isDefault).toBe(true);
	});

	test("disconnect survives revocation failure and retains Gmail history rows", async () => {
		const { env, workspaceId } = await setup();
		mockGoogle();
		const first = await startGmailOAuth(env, {
			workspaceId,
			actorUserId: "actor",
			inboxId: "inbox",
			accessMode: "private",
			teamId: null,
			backfillDays: 30,
			callbackOrigin: "https://msgflow.test",
		});
		const channelId = (
			await completeGmailChannelOAuth(
				env,
				oauthState(first.authorizationUrl),
				"code",
				"actor",
			)
		).channelId;
		const now = new Date().toISOString();
		await ctx.db
			.insert(contacts)
			.values({
				id: "contact",
				workspaceId,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(conversations)
			.values({
				id: "conversation",
				workspaceId,
				channelId,
				inboxId: "inbox",
				contactId: "contact",
				doBindingId: "conversation",
				externalThreadId: "thread",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(gmailMessageRefs)
			.values({
				channelId,
				gmailMessageId: "message",
				gmailThreadId: "thread",
				conversationId: "conversation",
				direction: "inbound",
				createdAt: now,
			})
			.run();
		globalThis.fetch = async (url) => {
			if (String(url).includes("revoke"))
				throw new Error("Google revoke failed for refresh");
			throw new Error("unexpected request");
		};
		await disconnectGmailChannel(env, workspaceId, channelId, "actor");
		const account = await ctx.db
			.select()
			.from(gmailAccounts)
			.where(eq(gmailAccounts.channelId, channelId))
			.get();
		const channel = await ctx.db
			.select()
			.from(channels)
			.where(eq(channels.id, channelId))
			.get();
		expect(account).toMatchObject({ syncState: "reconnect_required" });
		expect(channel).toMatchObject({ status: "disconnected" });
		const history = await ctx.env.DB.prepare(
			"SELECT (SELECT count(*) FROM conversations WHERE id='conversation') AS conversations, (SELECT count(*) FROM gmail_message_refs WHERE gmail_message_id='message') AS refs",
		).first<{ conversations: number; refs: number }>();
		expect(history).toEqual({ conversations: 1, refs: 1 });
	});
});
