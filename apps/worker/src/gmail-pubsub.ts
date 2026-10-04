import { GmailPubSubEnvelopeSchema } from "@msgflow/contracts";
import { channels, gmailAccounts } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Either, Schema } from "effect";
import type { Env } from "./env";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set([
	"accounts.google.com",
	"https://accounts.google.com",
]);
const MAX_JWT_BYTES = 16_384;

export type GmailPubSubNotification = {
	emailAddress: string;
	historyId: string;
};

/** Validates a Google-signed push JWT without trusting request-controlled URLs. */
export async function verifyGooglePubSubJwt(
	env: Env,
	authorization: string | undefined,
): Promise<boolean> {
	if (!env.GOOGLE_PUBSUB_AUDIENCE || !env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL)
		throw new GmailPubSubConfigurationError();
	if (!authorization?.startsWith("Bearer ")) return false;
	const token = authorization.slice(7);
	if (token.length > MAX_JWT_BYTES) return false;
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((part) => !part)) return false;
	const [encodedHeader, encodedPayload, encodedSignature] = parts as [
		string,
		string,
		string,
	];
	const header = decodeJson(encodedHeader);
	const claims = decodeJson(encodedPayload);
	if (
		header?.alg !== "RS256" ||
		typeof header.kid !== "string" ||
		!claims ||
		!validClaims(claims, env)
	)
		return false;
	const signature = decodeBase64Url(encodedSignature);
	if (!signature) return false;
	try {
		const jwksResponse = await fetch(GOOGLE_JWKS_URL, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!jwksResponse.ok) return false;
		const jwks = (await jwksResponse.json()) as { keys?: unknown };
		const jwk = Array.isArray(jwks.keys)
			? jwks.keys.find(
					(key): key is JsonWebKey =>
						!!key &&
						typeof key === "object" &&
						(key as { kid?: unknown }).kid === header.kid &&
						(key as JsonWebKey).kty === "RSA",
				)
			: undefined;
		if (!jwk) return false;
		const key = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);
		return crypto.subtle.verify(
			{ name: "RSASSA-PKCS1-v1_5" },
			key,
			signature,
			new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
		);
	} catch {
		return false;
	}
}

export class GmailPubSubConfigurationError extends Error {}

export function decodeGmailPubSubNotification(
	raw: unknown,
): GmailPubSubNotification | null {
	const envelope = Schema.decodeUnknownEither(GmailPubSubEnvelopeSchema)(raw);
	if (Either.isLeft(envelope)) return null;
	const decoded = decodeJson(envelope.right.message.data);
	if (
		!decoded ||
		typeof decoded.emailAddress !== "string" ||
		typeof decoded.historyId !== "string"
	)
		return null;
	const emailAddress = decoded.emailAddress.trim().toLowerCase();
	if (
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) ||
		!/^\d+$/.test(decoded.historyId)
	)
		return null;
	return { emailAddress, historyId: decoded.historyId };
}

/** Coalesces a recognized active account's notification; it never calls Gmail. */
export async function enqueueGmailPubSubNotification(
	env: Env,
	notification: GmailPubSubNotification,
): Promise<void> {
	const account = await drizzle(env.DB)
		.select({ channelId: gmailAccounts.channelId })
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(gmailAccounts.email, notification.emailAddress),
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
			),
		)
		.get();
	if (!account) return;
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO gmail_sync_requests (channel_id, requested_history_id, requested_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(channel_id) DO UPDATE SET
		 requested_history_id=CASE
			WHEN length(excluded.requested_history_id) > length(gmail_sync_requests.requested_history_id)
				OR (length(excluded.requested_history_id) = length(gmail_sync_requests.requested_history_id)
					AND excluded.requested_history_id > gmail_sync_requests.requested_history_id)
			THEN excluded.requested_history_id ELSE gmail_sync_requests.requested_history_id END,
		 requested_at=excluded.requested_at`,
	)
		.bind(account.channelId, notification.historyId, now)
		.run();
}

function validClaims(claims: Record<string, unknown>, env: Env): boolean {
	const now = Math.floor(Date.now() / 1000);
	const audience = claims.aud;
	return (
		typeof claims.iss === "string" &&
		GOOGLE_ISSUERS.has(claims.iss) &&
		(typeof audience === "string"
			? audience === env.GOOGLE_PUBSUB_AUDIENCE
			: Array.isArray(audience) &&
				audience.includes(env.GOOGLE_PUBSUB_AUDIENCE)) &&
		typeof claims.email === "string" &&
		claims.email === env.GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL &&
		claims.email_verified === true &&
		typeof claims.exp === "number" &&
		Number.isFinite(claims.exp) &&
		claims.exp > now &&
		(typeof claims.nbf !== "number" || claims.nbf <= now)
	);
}

function decodeJson(value: string): Record<string, unknown> | null {
	const bytes = decodeBase64Url(value);
	if (!bytes) return null;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function decodeBase64Url(value: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
	try {
		const base64 = value
			.replaceAll("-", "+")
			.replaceAll("_", "/")
			.padEnd(Math.ceil(value.length / 4) * 4, "=");
		return Uint8Array.from(atob(base64), (character) =>
			character.charCodeAt(0),
		);
	} catch {
		return null;
	}
}
