import type { GmailOAuthStartRequest } from "@msgflow/contracts";
import {
	channels,
	gmailAccounts,
	gmailMessageRefs,
	inboxChannels,
	inboxes,
	teams,
} from "@msgflow/db";
import { and, eq, ne } from "drizzle-orm";
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
): Promise<{ callbackOrigin: string; channelId: string; workspaceId: string }> {
	const state = await consumeGmailOAuthState(env, stateToken, actorUserId);
	// OAuth state is one-time and bound to the initiator, but lifecycle authority
	// may have changed during the authorization window. Consume before checking so
	// a stale callback cannot be replayed if authority is restored later.
	await requireOwnerAccess(
		drizzle(env.DB),
		state.workspaceId,
		state.actorUserId,
	);
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
	const now = new Date().toISOString();
	// The global unique google_sub index expresses the provider identity boundary.
	// Preflight produces a controlled conflict; the batch catch handles races.
	const existing = await db
		.select({
			workspaceId: gmailAccounts.workspaceId,
			channelId: gmailAccounts.channelId,
			channelStatus: channels.status,
			syncState: gmailAccounts.syncState,
		})
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(eq(gmailAccounts.googleSub, identity.sub))
		.get();
	if (existing) {
		if (
			existing.workspaceId === state.workspaceId &&
			(existing.channelStatus === "disconnected" ||
				existing.syncState === "reconnect_required")
		) {
			await reactivateGmailAccount(
				env,
				state.workspaceId,
				state.actorUserId,
				existing.channelId,
				encryptedRefreshToken,
				tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [],
				now,
			);
			return {
				callbackOrigin: state.callbackOrigin,
				channelId: existing.channelId,
				workspaceId: state.workspaceId,
			};
		}
		throw new ManageError("this Google account is already connected", 409);
	}

	const channelId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	const linkId = crypto.randomUUID();
	try {
		const results = await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at)
				 SELECT ?,?,?,?,?,'active',?,?
				 WHERE EXISTS (
					SELECT 1 FROM workspace_members membership
					JOIN user actor ON actor.id=membership.user_id
					WHERE membership.workspace_id=? AND membership.user_id=?
					AND membership.role IN ('owner','admin') AND actor.email_verified=1
				 )`,
			).bind(
				channelId,
				state.workspaceId,
				"gmail",
				identity.email,
				identity.sub,
				now,
				now,
				state.workspaceId,
				state.actorUserId,
			),
			env.DB.prepare(
				`INSERT INTO gmail_accounts (id,workspace_id,channel_id,owner_user_id,access_mode,team_id,google_sub,email,encrypted_refresh_token,token_key_version,sync_state,backfill_days,scopes_json,archive_removes_inbox_label,created_at,updated_at)
				 SELECT ?,?,?,?,?,?,?,?,?,1,'idle',?,?,0,?,?
				 WHERE EXISTS (SELECT 1 FROM channels WHERE id=? AND workspace_id=? AND type='gmail')`,
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
				channelId,
				state.workspaceId,
			),
			env.DB.prepare(
				`INSERT INTO inbox_channels (id,inbox_id,channel_id,is_default)
				 SELECT ?,?,?,1
				 WHERE EXISTS (SELECT 1 FROM gmail_accounts WHERE channel_id=? AND workspace_id=?)`,
			).bind(linkId, state.inboxId, channelId, channelId, state.workspaceId),
		]);
		if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
			// This check occurs in the same D1 transaction as persistence, closing the
			// gap between callback authorization and creating provider credentials.
			await requireOwnerAccess(db, state.workspaceId, state.actorUserId);
			throw new ManageError(
				"Gmail account connection could not be completed",
				500,
			);
		}
	} catch (error) {
		if (error instanceof ManageError) throw error;
		if (isGoogleSubUniqueConstraint(error)) {
			throw new ManageError("this Google account is already connected", 409);
		}
		// State has been consumed, so failures here cannot be retried safely. Do not
		// expose D1/provider details or misrepresent a storage failure as a collision.
		throw new ManageError(
			"Gmail account connection could not be completed",
			500,
		);
	}
	return {
		callbackOrigin: state.callbackOrigin,
		channelId,
		workspaceId: state.workspaceId,
	};
}

/** Builds the same-origin Settings destination after a successful OAuth callback. */
export function gmailOAuthSuccessRedirect(
	callbackOrigin: string,
	workspaceId: string,
): string {
	const redirect = new URL("/settings", callbackOrigin);
	redirect.searchParams.set("workspace", workspaceId);
	redirect.searchParams.set("section", "channels");
	return redirect.toString();
}

async function reactivateGmailAccount(
	env: Env,
	workspaceId: string,
	actorUserId: string,
	channelId: string,
	encryptedRefreshToken: string,
	scopes: string[],
	now: string,
): Promise<void> {
	const results = await env.DB.batch([
		env.DB.prepare(
			`UPDATE channels SET status='active', updated_at=?
			 WHERE id=? AND workspace_id=? AND type='gmail' AND EXISTS (
				SELECT 1 FROM workspace_members membership
				JOIN user actor ON actor.id=membership.user_id
				WHERE membership.workspace_id=? AND membership.user_id=?
				AND membership.role IN ('owner','admin') AND actor.email_verified=1
			 )`,
		).bind(now, channelId, workspaceId, workspaceId, actorUserId),
		env.DB.prepare(
			`UPDATE gmail_accounts
			 SET encrypted_refresh_token=?, token_key_version=1, sync_state='idle',
				 sync_claim_token=NULL, sync_claimed_at=NULL, last_error=NULL,
				 scopes_json=?, updated_at=?
			 WHERE channel_id=? AND workspace_id=? AND EXISTS (
				SELECT 1 FROM workspace_members membership
				JOIN user actor ON actor.id=membership.user_id
				WHERE membership.workspace_id=? AND membership.user_id=?
				AND membership.role IN ('owner','admin') AND actor.email_verified=1
			 )`,
		).bind(
			encryptedRefreshToken,
			JSON.stringify(scopes),
			now,
			channelId,
			workspaceId,
			workspaceId,
			actorUserId,
		),
	]);
	if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
		await requireOwnerAccess(drizzle(env.DB), workspaceId, actorUserId);
		throw new ManageError(
			"Gmail account reconnection could not be completed",
			500,
		);
	}
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

/**
 * Removes Gmail provider configuration while retaining MsgFlow conversations.
 * The channel row remains a tombstone because historical conversations still
 * reference it; all Gmail credentials and provider mappings are removed.
 */
export async function deleteGmailChannel(
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
				ne(channels.status, "deleted"),
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
		// Local credential destruction must not depend on Google's revoke endpoint.
	}
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const now = new Date().toISOString();
	await db.batch([
		db
			.delete(gmailMessageRefs)
			.where(eq(gmailMessageRefs.channelId, channelId)),
		db.delete(inboxChannels).where(eq(inboxChannels.channelId, channelId)),
		db
			.delete(gmailAccounts)
			.where(
				and(
					eq(gmailAccounts.channelId, channelId),
					eq(gmailAccounts.workspaceId, workspaceId),
				),
			),
		db
			.update(channels)
			.set({ status: "deleted", updatedAt: now })
			.where(
				and(
					eq(channels.id, channelId),
					eq(channels.workspaceId, workspaceId),
					eq(channels.type, "gmail"),
				),
			),
	]);
}

function isGoogleSubUniqueConstraint(error: unknown): boolean {
	// Only the standalone D1 SQLite error is a known collision. A compound or
	// wrapped message may describe a partially failed batch and must be sanitized.
	return (
		error instanceof Error &&
		error.message ===
			"D1_ERROR: UNIQUE constraint failed: gmail_accounts.google_sub"
	);
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
