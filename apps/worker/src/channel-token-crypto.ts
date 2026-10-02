const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";
const AES_GCM_IV_BYTES = 12;

/**
 * Encrypt a channel credential for D1 using a 32-byte base64url key supplied
 * through the Worker secret CHANNEL_TOKEN_ENCRYPTION_KEY. The encoded value is
 * self-identifying so callers can reject plaintext rows after migration.
 */
export async function encryptChannelToken(
	plaintext: string,
	encodedKey: string,
): Promise<string> {
	if (!plaintext) throw new Error("channel token cannot be empty");
	const key = await importEncryptionKey(encodedKey, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);
	return `${ENCRYPTED_TOKEN_PREFIX}${toBase64Url(iv)}:${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Decrypt a versioned encrypted channel credential. Plaintext rows are rejected. */
export async function decryptChannelToken(
	encoded: string,
	encodedKey: string,
): Promise<string> {
	const parts = encoded.split(":");
	if (parts.length !== 4 || `${parts[0]}:${parts[1]}:` !== ENCRYPTED_TOKEN_PREFIX) {
		throw new Error("channel token is not encrypted with the supported format");
	}
	const iv = fromBase64Url(parts[2] ?? "");
	if (iv.byteLength !== AES_GCM_IV_BYTES) {
		throw new Error("channel token has an invalid AES-GCM IV");
	}
	const ciphertext = fromBase64Url(parts[3] ?? "");
	if (ciphertext.byteLength === 0) throw new Error("channel token ciphertext is empty");
	const key = await importEncryptionKey(encodedKey, ["decrypt"]);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(plaintext);
}

export function isEncryptedChannelToken(value: string): boolean {
	return value.startsWith(ENCRYPTED_TOKEN_PREFIX);
}

async function importEncryptionKey(
	encodedKey: string,
	usages: ("encrypt" | "decrypt")[],
): Promise<CryptoKey> {
	const raw = fromBase64Url(encodedKey);
	if (raw.byteLength !== 32) {
		throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY must be a 32-byte base64url key");
	}
	return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error("invalid base64url value");
	}
	const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
		Math.ceil(value.length / 4) * 4,
		"=",
	);
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
