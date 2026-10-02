const WHATSAPP_GRAPH_VERSION = "v25.0";

/**
 * Confirms that a bearer token can access the exact Meta Phone Number ID.
 * Provider payloads and credentials are intentionally not exposed to callers.
 */
export async function validateWhatsAppPhoneNumber(
	phoneNumberId: string,
	accessToken: string,
): Promise<{ phoneNumberId: string; displayName: string }> {
	const fields = new URLSearchParams({
		fields: "id,display_phone_number,verified_name",
	});
	const response = await fetch(
		`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}?${fields}`,
		{
			headers: { authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(3_000),
		},
	);
	if (!response.ok) throw new Error("WhatsApp phone number validation failed");

	const payload = (await response.json()) as {
		id?: unknown;
		display_phone_number?: unknown;
		verified_name?: unknown;
	};
	if (payload.id !== phoneNumberId) {
		throw new Error("WhatsApp phone number validation failed");
	}
	const verifiedName =
		typeof payload.verified_name === "string"
			? payload.verified_name.trim()
			: "";
	const displayPhoneNumber =
		typeof payload.display_phone_number === "string"
			? payload.display_phone_number.trim()
			: "";
	const displayName = verifiedName || displayPhoneNumber;
	if (!displayName) throw new Error("WhatsApp phone number validation failed");
	return { phoneNumberId, displayName };
}
