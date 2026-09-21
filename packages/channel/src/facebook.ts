import { facebookConversationId } from "@msgflow/contracts";
import type {
	ChannelAdapter,
	NormalizedInbound,
	OutboundContext,
	OutboundMessage,
	ProviderSendResult,
} from "./types";

/**
 * Facebook Messenger adapter. Normalizes Meta webhook payloads into canonical
 * inbound messages and sends outbound replies via the Graph API. Signature
 * verification and per-Page token selection are the Worker's job (the ingress
 * layer), not this adapter's (per ADR 0005).
 */

interface MessengerWebhookEntry {
	id?: string;
	messaging?: MessengerEvent[];
}

interface MessengerEvent {
	sender?: { id?: string };
	recipient?: { id?: string };
	timestamp?: number;
	message?: { mid?: string; text?: string };
}

interface GraphSendResponse {
	recipient_id?: string;
	message_id?: string;
	error?: { message?: string; code?: number; error_subcode?: number };
}

function isMessengerWebhook(
	raw: unknown,
): raw is { entry?: MessengerWebhookEntry[] } {
	return (
		typeof raw === "object" &&
		raw !== null &&
		"entry" in raw &&
		Array.isArray((raw as { entry?: unknown }).entry)
	);
}

export function normalizeFacebookWebhook(raw: unknown): NormalizedInbound[] {
	if (!isMessengerWebhook(raw)) return [];

	const results: NormalizedInbound[] = [];
	for (const entry of raw.entry ?? []) {
		const pageId = entry.id;
		if (!pageId) continue;

		for (const event of entry.messaging ?? []) {
			const senderPsid = event.sender?.id;
			const message = event.message;
			// Only handle plain-text messages; skip postbacks, echoes, reads, etc.
			if (!senderPsid || !message?.mid || message.text == null) continue;

			results.push({
				conversationId: facebookConversationId(pageId, senderPsid),
				channel: "facebook",
				providerMessageId: message.mid,
				senderId: senderPsid,
				text: message.text,
				// Meta sends the messaging event timestamp in MILLISECONDS; guard
				// against seconds-epoch payloads (and Date.now() is already ms)
				// so the clock is never off by 1000x.
				createdAt: (() => {
					const ts = event.timestamp ?? Date.now();
					return new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
				})(),
				payload: { pageId, senderPsid },
			});
		}
	}
	return results;
}

export const facebookAdapter: ChannelAdapter = {
	channel: "facebook",
	normalizeInbound: normalizeFacebookWebhook,
	async sendOutbound(
		ctx: OutboundContext,
		message: OutboundMessage,
	): Promise<ProviderSendResult> {
		const token = ctx.pageAccessToken;
		if (!token) {
			return {
				ok: false,
				providerMessageId: null,
				error: "missing page access token",
			};
		}
		const text = message.text.trim();
		if (!text) {
			return { ok: false, providerMessageId: null, error: "empty message" };
		}
		// Messenger text messages cap at 2000 characters.
		if (text.length > 2000) {
			return {
				ok: false,
				providerMessageId: null,
				error: "message exceeds 2000 characters",
			};
		}

		let response: Response;
		try {
			response = await fetch(
				`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						recipient: { id: message.to },
						message: { text },
					}),
				},
			);
		} catch (err) {
			return {
				ok: false,
				providerMessageId: null,
				error: `graph api request failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		let json: GraphSendResponse;
		try {
			json = (await response.json()) as GraphSendResponse;
		} catch {
			return {
				ok: false,
				providerMessageId: null,
				error: `graph api returned non-JSON (HTTP ${response.status})`,
			};
		}

		if (!response.ok || json.error || !json.message_id) {
			const code = json.error?.code;
			const subcode = json.error?.error_subcode;
			const detail = json.error?.message ?? `HTTP ${response.status}`;
			// 2001: recipient unreachable / outside the 24h messaging window.
			if (code === 2001) {
				return {
					ok: false,
					providerMessageId: null,
					error: `recipient unreachable (outside the 24h messaging window)${subcode ? ` [${subcode}]` : ""}`,
				};
			}
			if (code === 190) {
				return {
					ok: false,
					providerMessageId: null,
					error: "page access token expired or revoked",
				};
			}
			return {
				ok: false,
				providerMessageId: null,
				error: `graph api error: ${detail}`,
			};
		}

		return { ok: true, providerMessageId: json.message_id };
	},
};
