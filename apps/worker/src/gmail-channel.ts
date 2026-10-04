import type { GmailOAuthStartRequest } from "@msgflow/contracts";
import { channels, gmailAccounts, inboxes, teams } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { requireOwnerAccess } from "./access";
import {
	decryptChannelToken,
	encryptChannelToken,
} from "./channel-token-crypto";
import type { Env } from "./env";
import { ManageError } from "./errors";
import {
	consumeGmailOAuthState,
	exchangeGmailAuthorizationCode,
	startGmailOAuth,
} from "./gmail-oauth";

const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export async function beginGmailChannelOAuth(
	env: Env,
	workspaceId: string,
	input: GmailOAuthStartRequest,
	actorUserId: string,
	requestOrigin: string,
): Promise<{ authorizationUrl: string }> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const inbox = await db
		.select({ id: inboxes.id })
		.from(inboxes)
		.where(
			and(
				eq(inboxes.id, input.inboxId),
				eq(inboxes.workspaceId, workspaceId),
				eq(inboxes.isArchived, false),
			),
		)
		.get();
	if (!inbox) throw new ManageError("active inbox not found", 404);
	if (input.accessMode === "shared") {
		const team = await db
			.select({ id: teams.id })
			.from(teams)
			.where(
				and(eq(teams.id, input.teamId), eq(teams.workspaceId, workspaceId)),
			)
			.get();
		if (!team) throw new ManageError("team not found", 404);
	}
	// Validate configuration before accepting any request-derived origin into state.
	if (
		!env.GOOGLE_CLIENT_ID ||
		!env.GOOGLE_CLIENT_SECRET ||
		!env.GOOGLE_OAUTH_REDIRECT_URI
	) {
		throw new ManageError("Gmail OAuth is not configured", 503);
	}
	return startGmailOAuth(env, {
		workspaceId,
		actorUserId,
		inboxId: input.inboxId,
		accessMode: input.accessMode,
		teamId:
			input.accessMode === "shared" ? input.teamId : (input.teamId ?? null),
		backfillDays: input.backfillDays ?? 30,
		callbackOrigin: requestOrigin,
	});
}

export async function completeGmailChannelOAuth(
	env: Env,
	stateToken: string,
	code: string,
	actorUserId: string,
): Promise<{ callbackOrigin: string; channelId: string }> {
	const state = await consumeGmailOAuthState(env, stateToken, actorUserId);
	const tokens = await exchangeGmailAuthorizationCode(
		env,
		code,
		state.codeVerifier,
	);
	const identity = await fetchGoogleIdentity(tokens.accessToken);
	let encryptedRefreshToken: string;
	try {
		encryptedRefreshToken = await encryptChannelToken(
			tokens.refreshToken,
			env.CHANNEL_TOKEN_ENCRYPTION_KEY,
		);
	} catch {
		throw new ManageError("channel token encryption is unavailable", 503);
	}

	const db = drizzle(env.DB);
	// The global unique google_sub index expresses the provider identity boundary.
	// Preflight produces a controlled conflict; the batch catch handles races.
	const existing = await db
		.select({ id: gmailAccounts.id })
		.from(gmailAccounts)
		.where(eq(gmailAccounts.googleSub, identity.sub))
		.get();
	if (existing)
		throw new ManageError("this Google account is already connected", 409);

	const channelId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	const linkId = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)",
			).bind(
				channelId,
				state.workspaceId,
				"gmail",
				identity.email,
				identity.sub,
				now,
				now,
			),
			env.DB.prepare(
				"INSERT INTO gmail_accounts (id,workspace_id,channel_id,owner_user_id,access_mode,team_id,google_sub,email,encrypted_refresh_token,token_key_version,sync_state,backfill_days,scopes_json,archive_removes_inbox_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,'idle',?,?,0,?,?)",
			).bind(
				accountId,
				state.workspaceId,
				channelId,
				state.actorUserId,
				state.accessMode,
				state.teamId,
				identity.sub,
				identity.email,
				encryptedRefreshToken,
				state.backfillDays,
				JSON.stringify(
					tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [],
				),
				now,
				now,
			),
			env.DB.prepare(
				"INSERT INTO inbox_channels (id,inbox_id,channel_id,is_default) VALUES (?,?,?,1)",
			).bind(linkId, state.inboxId, channelId),
		]);
	} catch {
		throw new ManageError("this Google account is already connected", 409);
	}
	return { callbackOrigin: state.callbackOrigin, channelId };
}

export async function disconnectGmailChannel(
	env: Env,
	workspaceId: string,
	channelId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const account = await db
		.select({ encryptedRefreshToken: gmailAccounts.encryptedRefreshToken })
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(channels.id, channelId),
				eq(channels.workspaceId, workspaceId),
				eq(channels.type, "gmail"),
			),
		)
		.get();
	if (!account) throw new ManageError("Gmail channel not found", 404);
	try {
		const refreshToken = await decryptChannelToken(
			account.encryptedRefreshToken,
			env.CHANNEL_TOKEN_ENCRYPTION_KEY,
		);
		await fetch(GOOGLE_REVOKE_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token: refreshToken }).toString(),
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		// Revocation is best effort; local disablement must not depend on Google.
	}
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE channels SET status='disconnected', updated_at=? WHERE id=? AND workspace_id=? AND type='gmail'",
		).bind(now, channelId, workspaceId),
		env.DB.prepare(
			"UPDATE gmail_accounts SET sync_state='reconnect_required', sync_claim_token=NULL, sync_claimed_at=NULL, updated_at=? WHERE channel_id=? AND workspace_id=?",
		).bind(now, channelId, workspaceId),
	]);
}

async function fetchGoogleIdentity(
	accessToken: string,
): Promise<{ sub: string; email: string }> {
	let body: Record<string, unknown>;
	try {
		const response = await fetch(GOOGLE_USERINFO_URL, {
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error("userinfo failed");
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new ManageError("Gmail identity verification failed", 400);
	}
	const sub = body.sub;
	const email = body.email;
	if (
		typeof sub !== "string" ||
		!sub ||
		typeof email !== "string" ||
		body.email_verified !== true
	) {
		throw new ManageError("Gmail identity verification failed", 400);
	}
	const normalizedEmail = email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
		throw new ManageError("Gmail identity verification failed", 400);
	}
	return { sub, email: normalizedEmail };
}
