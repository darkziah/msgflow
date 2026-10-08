import { afterEach, describe, expect, test } from "bun:test";
import { inboxes, workspaceMembers } from "@msgflow/db";

import type { Env } from "../src/env";
import {
	consumeGmailOAuthState,
	exchangeGmailAuthorizationCode,
	startGmailOAuth,
} from "../src/gmail-oauth";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
const nativeFetch = globalThis.fetch;
afterEach(async () => {
	globalThis.fetch = nativeFetch;
	await ctx?.mf?.dispose();
});

async function oauthEnv(): Promise<Env> {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "owner", "owner@example.test");
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
		.insert(inboxes)
		.values({ id: "inbox-1", workspaceId, name: "Inbox", createdAt: now })
		.run();
	return {
		...ctx.env,
		CHANNEL_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		GOOGLE_CLIENT_ID: "google-client-id",
		GOOGLE_CLIENT_SECRET: "google-client-secret",
		GOOGLE_OAUTH_REDIRECT_URI: "https://msgflow.test/api/gmail-oauth/callback",
	};
}

function startInput(workspaceId: string) {
	return {
		workspaceId,
		actorUserId: "owner",
		inboxId: "inbox-1",
		accessMode: "private" as const,
		teamId: null,
		backfillDays: 30,
		callbackOrigin: "https://msgflow.test",
	};
}

describe("Gmail OAuth", () => {
	test("creates an opaque encrypted PKCE authorization request and consumes it once", async () => {
		const env = await oauthEnv();
		const workspace = await ctx.env.DB.prepare(
			"SELECT id FROM workspaces LIMIT 1",
		).first<{ id: string }>();
		if (!workspace) throw new Error("workspace missing");
		const { authorizationUrl } = await startGmailOAuth(
			env,
			startInput(workspace.id),
		);
		const url = new URL(authorizationUrl);
		expect(url.origin + url.pathname).toBe(
			"https://accounts.google.com/o/oauth2/v2/auth",
		);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")).toContain(
			"https://www.googleapis.com/auth/gmail.modify",
		);
		expect(url.searchParams.get("scope")).toContain(
			"https://www.googleapis.com/auth/gmail.send",
		);
		const state = url.searchParams.get("state");
		expect(state).toStartWith("enc:v1:");
		expect(state).not.toContain(workspace.id);
		expect(url.searchParams.get("code_challenge")).toMatch(
			/^[A-Za-z0-9_-]{43}$/,
		);
		await expect(
			consumeGmailOAuthState(env, state ?? "", "other-user"),
		).rejects.toMatchObject({ status: 400 });
		const consumed = await consumeGmailOAuthState(env, state ?? "", "owner");
		expect(consumed.workspaceId).toBe(workspace.id);
		expect(consumed.codeVerifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
		await expect(
			consumeGmailOAuthState(env, state ?? "", "owner"),
		).rejects.toMatchObject({ status: 400 });
	});

	test("returns a controlled error when OAuth configuration is absent", async () => {
		const env = await oauthEnv();
		const workspace = await ctx.env.DB.prepare(
			"SELECT id FROM workspaces LIMIT 1",
		).first<{ id: string }>();
		if (!workspace) throw new Error("workspace missing");
		await expect(
			startGmailOAuth(
				{ ...env, GOOGLE_CLIENT_SECRET: undefined },
				startInput(workspace.id),
			),
		).rejects.toMatchObject({ status: 503 });
	});

	test("exchanges code with the stored verifier and rejects provider failures", async () => {
		const env = await oauthEnv();
		let request: Request | undefined;
		globalThis.fetch = async (input, init) => {
			request = new Request(input, init);
			return Response.json({
				access_token: "access-token",
				refresh_token: "refresh-token",
				expires_in: 3600,
				token_type: "Bearer",
			});
		};
		const tokens = await exchangeGmailAuthorizationCode(
			env,
			"authorization-code",
			"pkce-verifier",
		);
		expect(tokens.refreshToken).toBe("refresh-token");
		expect(request?.url).toBe("https://oauth2.googleapis.com/token");
		const body = new URLSearchParams(await request?.text());
		expect(body.get("code")).toBe("authorization-code");
		expect(body.get("code_verifier")).toBe("pkce-verifier");
		expect(body.get("client_secret")).toBe("google-client-secret");
		globalThis.fetch = async () =>
			Response.json({ error: "invalid_grant" }, { status: 400 });
		await expect(
			exchangeGmailAuthorizationCode(env, "code", "verifier"),
		).rejects.toMatchObject({ status: 400 });
	});
});
