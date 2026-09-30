import {
	WhatsAppGraphSendResponseSchema,
	WhatsAppWebhookEnvelopeSchema,
	whatsappConversationId,
} from "@msgflow/contracts";
import { Either, Schema } from "effect";
import type {
	ChannelAdapter,
	NormalizedInbound,
	OutboundContext,
	OutboundMessage,
	ProviderSendResult,
} from "./types";

/** Kept in one place so Graph upgrades are deliberate and reviewable. */
export const WHATSAPP_GRAPH_VERSION = "v25.0";
const WHATSAPP_TEXT_MAX_LENGTH = 4096;

function failureKindForHttpResponse(response: Response) {
	return response.ok || response.status >= 500 ? "uncertain" : "definitive";
}

export function normalizeWhatsAppWebhook(raw: unknown): NormalizedInbound[] {
	const decoded = Schema.decodeUnknownEither(WhatsAppWebhookEnvelopeSchema)(
		raw,
	);
	if (Either.isLeft(decoded)) return [];

	const results: NormalizedInbound[] = [];
	for (const entry of decoded.right.entry) {
		for (const change of entry.changes) {
			const phoneNumberId = change.value.metadata?.phone_number_id;
			if (!phoneNumberId) continue;
			for (const message of change.value.messages ?? []) {
				if (
					message.type !== "text" ||
					!message.id ||
					!message.from ||
					!message.timestamp ||
					message.text?.body == null
				) {
					continue;
				}
				const timestamp = Number(message.timestamp);
				if (!Number.isFinite(timestamp)) continue;
				const createdAt = new Date(timestamp * 1000);
				if (Number.isNaN(createdAt.getTime())) continue;
				const profileName = change.value.contacts?.find(
					(contact) => contact.wa_id === message.from,
				)?.profile?.name;

				results.push({
					conversationId: whatsappConversationId(phoneNumberId, message.from),
					channel: "whatsapp",
					providerMessageId: message.id,
					senderId: message.from,
					text: message.text.body,
					createdAt: createdAt.toISOString(),
					payload: { phoneNumberId, waId: message.from, profileName },
					attachments: [],
				});
			}
		}
	}
	return results;
}

async function sendWhatsAppText(
	accessToken: string,
	phoneNumberId: string,
	body: unknown,
): Promise<ProviderSendResult> {
	let response: Response;
	try {
		response = await fetch(
			`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);
	} catch (error) {
		return {
			ok: false,
			providerMessageId: null,
			error: `whatsapp graph api request failed: ${error instanceof Error ? error.message : String(error)}`,
			failureKind: "uncertain",
		};
	}

	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		return {
			ok: false,
			providerMessageId: null,
			error: `whatsapp graph api returned non-JSON (HTTP ${response.status})`,
			failureKind: failureKindForHttpResponse(response),
		};
	}
	const decoded = Schema.decodeUnknownEither(WhatsAppGraphSendResponseSchema)(
		raw,
	);
	if (Either.isLeft(decoded)) {
		return {
			ok: false,
			providerMessageId: null,
			error: `whatsapp graph api returned invalid JSON (HTTP ${response.status})`,
			failureKind: failureKindForHttpResponse(response),
		};
	}

	const json = decoded.right;
	const messageId = json.messages?.[0]?.id;
	if (!response.ok || json.error) {
		return {
			ok: false,
			providerMessageId: null,
			error: `whatsapp graph api error: ${json.error?.message ?? `HTTP ${response.status}`}`,
			failureKind: failureKindForHttpResponse(response),
		};
	}
	if (!messageId) {
		return {
			ok: false,
			providerMessageId: null,
			error: "whatsapp graph api acknowledgement missing message id",
			failureKind: "uncertain",
		};
	}
	return { ok: true, providerMessageId: messageId };
}

export const whatsappAdapter: ChannelAdapter = {
	channel: "whatsapp",
	normalizeInbound: normalizeWhatsAppWebhook,
	async sendOutbound(
		ctx: OutboundContext,
		message: OutboundMessage,
	): Promise<ProviderSendResult> {
		if (!ctx.whatsapp) {
			return {
				ok: false,
				providerMessageId: null,
				error: "missing WhatsApp provider context",
				failureKind: "definitive",
			};
		}
		if (message.attachments?.length) {
			return {
				ok: false,
				providerMessageId: null,
				error: "WhatsApp attachments are not supported",
				failureKind: "definitive",
			};
		}
		if (!message.text.trim()) {
			return {
				ok: false,
				providerMessageId: null,
				error: "empty message",
				failureKind: "definitive",
			};
		}
		if (message.text.length > WHATSAPP_TEXT_MAX_LENGTH) {
			return {
				ok: false,
				providerMessageId: null,
				error: `message exceeds ${WHATSAPP_TEXT_MAX_LENGTH} characters`,
				failureKind: "definitive",
			};
		}
		return sendWhatsAppText(
			ctx.whatsapp.accessToken,
			ctx.whatsapp.phoneNumberId,
			{
				messaging_product: "whatsapp",
				recipient_type: "individual",
				to: message.to,
				type: "text",
				text: { body: message.text, preview_url: false },
			},
		);
	},
};
