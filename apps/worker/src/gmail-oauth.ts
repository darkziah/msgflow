import {
	decryptChannelToken,
	encryptChannelToken,
} from "./channel-token-crypto";
import type { Env } from "./env";
import { ManageError } from "./errors";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const GOOGLE_SCOPES = [
	"openid",
	"email",
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.send",
] as const;

type GmailOAuthState = {
	sessionId: string;
	workspaceId: string;
	actorUserId: string;
	inboxId: string;
	accessMode: "private" | "shared";
	teamId: string | null;
	backfillDays: number;
	callbackOrigin: string;
	codeVerifier: string;
	expiresAt: string;
};

export type StartGmailOAuthInput = Omit<
	GmailOAuthState,
	"sessionId" | "codeVerifier" | "expiresAt"
>;

export type ConsumedGmailOAuthState = GmailOAuthState;

export type GmailOAuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiresIn: number | null;
	scope: string | null;
	tokenType: string | null;
};

/** Starts an opaque, one-time Google OAuth request. The PKCE verifier never leaves Worker storage. */
export async function startGmailOAuth(
	env: Env,
	input: StartGmailOAuthInput,
): Promise<{ authorizationUrl: string }> {
	const config = requiredOAuthConfig(env);
	const now = new Date();
	const state: GmailOAuthState = {
		...input,
		sessionId: crypto.randomUUID(),
		codeVerifier: randomBase64Url(48),
		expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
	};
	const encryptedState = await encryptChannelToken(
		JSON.stringify(state),
		env.CHANNEL_TOKEN_ENCRYPTION_KEY,
	);
	await env.DB.prepare(
		`INSERT INTO gmail_oauth_sessions
		(id, workspace_id, actor_user_id, inbox_id, access_mode, team_id, backfill_days, encrypted_state, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			state.sessionId,
			state.workspaceId,
			state.actorUserId,
			state.inboxId,
			state.accessMode,
			state.teamId,
			state.backfillDays,
			encryptedState,
			state.expiresAt,
			now.toISOString(),
		)
		.run();
	const url = new URL(AUTHORIZE_URL);
	url.search = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		access_type: "offline",
		prompt: "consent",
		scope: GOOGLE_SCOPES.join(" "),
		state: encryptedState,
		code_challenge: await sha256Base64Url(state.codeVerifier),
		code_challenge_method: "S256",
	}).toString();
	return { authorizationUrl: url.toString() };
}

/** Decrypts and atomically consumes an OAuth state for its original Agent. */
export async function consumeGmailOAuthState(
	env: Env,
	stateToken: string,
	actorUserId: string,
): Promise<ConsumedGmailOAuthState> {
	let state: GmailOAuthState;
	try {
		state = parseState(
			await decryptChannelToken(stateToken, env.CHANNEL_TOKEN_ENCRYPTION_KEY),
		);
	} catch {
		throw new ManageError("Gmail authorization has expired", 400);
	}
	if (
		state.actorUserId !== actorUserId ||
		new Date(state.expiresAt).getTime() <= Date.now()
	) {
		throw new ManageError("Gmail authorization has expired", 400);
	}
	const consumedAt = new Date().toISOString();
	const result = await env.DB.prepare(
		`UPDATE gmail_oauth_sessions
		SET consumed_at=?
		WHERE id=? AND actor_user_id=? AND encrypted_state=? AND consumed_at IS NULL AND expires_at > ?`,
	)
		.bind(consumedAt, state.sessionId, actorUserId, stateToken, consumedAt)
		.run();
	if ((result.meta.changes ?? 0) !== 1) {
		throw new ManageError("Gmail authorization has expired", 400);
	}
	return {
		sessionId: state.sessionId,
		workspaceId: state.workspaceId,
		actorUserId: state.actorUserId,
		inboxId: state.inboxId,
		accessMode: state.accessMode,
		teamId: state.teamId,
		backfillDays: state.backfillDays,
		callbackOrigin: state.callbackOrigin,
		codeVerifier: state.codeVerifier,
		expiresAt: state.expiresAt,
	};
}

/** Exchanges an authorization code without exposing provider error payloads. */
export async function exchangeGmailAuthorizationCode(
	env: Env,
	code: string,
	codeVerifier: string,
): Promise<GmailOAuthTokens> {
	const config = requiredOAuthConfig(env);
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: config.redirectUri,
		}).toString(),
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new ManageError("Gmail authorization failed", 400);
	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new ManageError("Gmail authorization failed", 400);
	}
	if (
		typeof body.access_token !== "string" ||
		typeof body.refresh_token !== "string"
	) {
		throw new ManageError("Gmail authorization requires offline access", 400);
	}
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token,
		expiresIn: typeof body.expires_in === "number" ? body.expires_in : null,
		scope: typeof body.scope === "string" ? body.scope : null,
		tokenType: typeof body.token_type === "string" ? body.token_type : null,
	};
}

function requiredOAuthConfig(env: Env): {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
} {
	if (
		!env.GOOGLE_CLIENT_ID ||
		!env.GOOGLE_CLIENT_SECRET ||
		!env.GOOGLE_OAUTH_REDIRECT_URI
	) {
		throw new ManageError("Gmail OAuth is not configured", 503);
	}
	return {
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
	};
}

function parseState(value: string): GmailOAuthState {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object") throw new Error("invalid state");
	const state = parsed as Partial<GmailOAuthState>;
	const backfillDays = state.backfillDays;
	if (
		typeof state.sessionId !== "string" ||
		typeof state.workspaceId !== "string" ||
		typeof state.actorUserId !== "string" ||
		typeof state.inboxId !== "string" ||
		(state.accessMode !== "private" && state.accessMode !== "shared") ||
		(state.teamId !== null && typeof state.teamId !== "string") ||
		typeof backfillDays !== "number" ||
		!Number.isInteger(backfillDays) ||
		backfillDays < 1 ||
		backfillDays > 90 ||
		typeof state.callbackOrigin !== "string" ||
		typeof state.codeVerifier !== "string" ||
		typeof state.expiresAt !== "string"
	) {
		throw new Error("invalid state");
	}
	return state as GmailOAuthState;
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(bytes: number): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}
