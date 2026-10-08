import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	gmailAccounts,
	gmailSyncRequests,
	workspaceMembers,
} from "@msgflow/db";
import { encryptChannelToken } from "../src/channel-token-crypto";
import type { Env } from "../src/env";
import {
	decodeGmailPubSubNotification,
	enqueueGmailPubSubNotification,
	verifyGooglePubSubJwt,
} from "../src/gmail-pubsub";
import { gmailPubSubApi } from "../src/gmail-pubsub-route";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
const nativeFetch = globalThis.fetch;
afterEach(async () => {
	globalThis.fetch = nativeFetch;
	await ctx?.mf.dispose();
});

const pubsubEnv = (env: Env) =>
	({
		...env,
		GOOGLE_PUBSUB_AUDIENCE: "https://msgflow.test/webhooks/gmail/pubsub",
		GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL: "push@example.iam.gserviceaccount.com",
	}) as Env;

function encode(value: unknown): string {
	return btoa(JSON.stringify(value))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

async function signedJwt(overrides: Record<string, unknown> = {}) {
	const keys = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const header = encode({ alg: "RS256", kid: "test-key" });
	const payload = encode({
		iss: "https://accounts.google.com",
		aud: "https://msgflow.test/webhooks/gmail/pubsub",
		email: "push@example.iam.gserviceaccount.com",
		email_verified: true,
		exp: Math.floor(Date.now() / 1000) + 60,
		...overrides,
	});
	const signature = await crypto.subtle.sign(
		{ name: "RSASSA-PKCS1-v1_5" },
		keys.privateKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	const jwk = {
		...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
		kid: "test-key",
	};
	return {
		token: `${header}.${payload}.${btoa(
			String.fromCharCode(...new Uint8Array(signature)),
		)
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")}`,
		jwk,
	};
}

async function insertGmailAccount(
	status: "active" | "disconnected" = "active",
) {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	await seedUser(ctx, "owner", "owner@example.test");
	const now = new Date().toISOString();
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: "member",
			workspaceId,
			userId: "owner",
			role: "owner",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: "gmail",
			workspaceId,
			type: "gmail",
			displayName: "Gmail",
			externalId: "google-sub",
			status,
			createdAt: now,
			updatedAt: now,
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
			googleSub: "google-sub",
			email: "owner@example.test",
			encryptedRefreshToken: await encryptChannelToken(
				"refresh",
				"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			),
			tokenKeyVersion: 1,
			backfillDays: 30,
			scopesJson: "[]",
			archiveRemovesInboxLabel: false,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return pubsubEnv(ctx.env);
}

describe("Gmail Pub/Sub validation", () => {
	test("requires a valid Google RS256 OIDC token with exact identity claims", async () => {
		ctx = await createTestDb();
		const env = pubsubEnv(ctx.env);
		const { token, jwk } = await signedJwt();
		globalThis.fetch = (async () =>
			Response.json({ keys: [jwk] })) as typeof fetch;
		expect(await verifyGooglePubSubJwt(env, `Bearer ${token}`)).toBe(true);
		const expired = await signedJwt({ exp: Math.floor(Date.now() / 1000) - 1 });
		globalThis.fetch = (async () =>
			Response.json({ keys: [expired.jwk] })) as typeof fetch;
		expect(await verifyGooglePubSubJwt(env, `Bearer ${expired.token}`)).toBe(
			false,
		);
		expect(await verifyGooglePubSubJwt(env, "Bearer invalid")).toBe(false);
	});

	test("decodes only bounded, valid Gmail notification data", () => {
		expect(
			decodeGmailPubSubNotification({
				message: {
					messageId: "id",
					data: encode({ emailAddress: "Owner@Example.test", historyId: "42" }),
				},
				subscription: "sub",
			}),
		).toEqual({ emailAddress: "owner@example.test", historyId: "42" });
		expect(
			decodeGmailPubSubNotification({
				message: {
					messageId: "id",
					data: encode({ emailAddress: "bad", historyId: "x" }),
				},
				subscription: "sub",
			}),
		).toBeNull();
	});
	test("returns configuration, authentication, payload, and enqueue responses without exposing account identity", async () => {
		const missingCtx = await createTestDb();
		const missing = await gmailPubSubApi.fetch(
			new Request("https://msgflow.test/pubsub", {
				method: "POST",
				body: "{}",
			}),
			missingCtx.env,
		);
		expect(missing.status).toBe(503);
		await missingCtx.mf.dispose();
		const env = await insertGmailAccount();
		const unauthorized = await gmailPubSubApi.fetch(
			new Request("https://msgflow.test/pubsub", {
				method: "POST",
				body: "{}",
			}),
			env,
		);
		expect(unauthorized.status).toBe(401);
		const { token, jwk } = await signedJwt();
		globalThis.fetch = (async () =>
			Response.json({ keys: [jwk] })) as typeof fetch;
		const valid = await gmailPubSubApi.fetch(
			new Request("https://msgflow.test/pubsub", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					message: {
						messageId: "id",
						data: encode({
							emailAddress: "owner@example.test",
							historyId: "77",
						}),
					},
					subscription: "sub",
				}),
			}),
			env,
		);
		expect(valid.status).toBe(204);
		expect(await ctx.db.select().from(gmailSyncRequests).all()).toMatchObject([
			{ channelId: "gmail", requestedHistoryId: "77" },
		]);
	});
});

describe("Gmail Pub/Sub enqueue", () => {
	test("upserts recognized active work without Gmail fetches and hides disconnected accounts", async () => {
		const env = await insertGmailAccount();
		let fetches = 0;
		globalThis.fetch = (async () => {
			fetches++;
			throw new Error("webhook must not fetch Gmail");
		}) as typeof fetch;
		await enqueueGmailPubSubNotification(env, {
			emailAddress: "owner@example.test",
			historyId: "10",
		});
		await enqueueGmailPubSubNotification(env, {
			emailAddress: "owner@example.test",
			historyId: "11",
		});
		expect(fetches).toBe(0);
		expect(await ctx.db.select().from(gmailSyncRequests).all()).toMatchObject([
			{ channelId: "gmail", requestedHistoryId: "11" },
		]);
		await ctx.db.update(channels).set({ status: "disconnected" }).run();
		await enqueueGmailPubSubNotification(env, {
			emailAddress: "unknown@example.test",
			historyId: "12",
		});
		expect(await ctx.db.select().from(gmailSyncRequests).all()).toHaveLength(1);
	});
});
