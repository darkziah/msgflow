import type { Env } from "./env";

export const CALL_DISPATCH_SIGNATURE_HEADER = "x-call-dispatch-signature";
export const CALL_DISPATCH_TIMESTAMP_HEADER = "x-call-dispatch-timestamp";
export const CALL_DISPATCH_NONCE_HEADER = "x-call-dispatch-nonce";

export interface CallDispatchOffer {
	queueId: string;
	ringGroupId: string;
	callId: string;
	conversationId: string;
	expiresAt: string;
	contact: {
		id: string;
		displayName: string | null;
		avatarUrl: string | null;
	};
}

/**
 * Capability headers bind a Worker-to-dispatch request to its exact raw body.
 * The caller must pass the same body string to Request; JSON reserialization
 * after signing changes the digest and is rejected by the Durable Object.
 */
export async function callDispatchInternalHeaders(
	secret: string,
	method: string,
	pathname: string,
	workspaceId: string,
	userId?: string,
	body = "",
	timestamp = Date.now().toString(),
	nonce = crypto.randomUUID(),
): Promise<Headers> {
	const canonicalMethod = method.toUpperCase();
	const bodyDigest = await sha256Hex(body);
	const data = [canonicalMethod, pathname, workspaceId, userId ?? "", timestamp, nonce, bodyDigest].join("\n");
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
	const headers = new Headers();
	headers.set(CALL_DISPATCH_TIMESTAMP_HEADER, timestamp);
	headers.set(CALL_DISPATCH_NONCE_HEADER, nonce);
	headers.set(CALL_DISPATCH_SIGNATURE_HEADER, hex(new Uint8Array(signature)));
	return headers;
}

/** Minimal protected Worker-to-dispatch offer invocation; Task 7 owns ingress. */
export async function offerCallToEligibleAgents(env: Env, workspaceId: string, offer: CallDispatchOffer): Promise<Response> {
	const body = JSON.stringify(offer);
	const headers = await callDispatchInternalHeaders(env.BETTER_AUTH_SECRET, "POST", "/offer", workspaceId, undefined, body);
	headers.set("content-type", "application/json");
	headers.set("x-authenticated-workspace-id", workspaceId);
	return env.CALL_DISPATCH_DO.get(env.CALL_DISPATCH_DO.idFromName(workspaceId)).fetch(
		new Request("https://call-dispatch/offer", { method: "POST", headers, body }),
	);
}

export async function sha256Hex(value: string): Promise<string> {
	return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
