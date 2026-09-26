// Meta webhook signature verification (X-Hub-Signature-256 = HMAC-SHA256 of the
// raw body using the app secret). The Worker validates BEFORE parsing, per the
// ingress responsibilities in ADR 0005.

async function hmacSha256Hex(data: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(data),
	);
	return [...new Uint8Array(sig)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function verifyFacebookSignature(
	body: string,
	signature: string | null | undefined,
	appSecret: string,
): Promise<boolean> {
	if (!signature) return false;
	const expected = `sha256=${await hmacSha256Hex(body, appSecret)}`;
	if (expected.length !== signature.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Verifies a Messenger delivery against one of the configured Meta App secrets.
 * The caller must limit secrets to the Page identities named in the raw delivery;
 * this avoids treating an installation-wide legacy secret as an authorization
 * boundary once several Meta Apps are configured.
 */
export async function verifyFacebookSignatureForSecrets(
	body: string,
	signature: string | null | undefined,
	appSecrets: readonly string[],
): Promise<boolean> {
	for (const appSecret of appSecrets) {
		if (await verifyFacebookSignature(body, signature, appSecret)) return true;
	}
	return false;
}
