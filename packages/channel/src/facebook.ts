import { facebookConversationId } from "@msgflow/contracts";
import type {
	ChannelAdapter,
	NormalizedInbound,
	OutboundContext,
	OutboundMessage,
	ProviderSendResult,
} from "./types";

interface MessengerWebhookEntry { id?: string; messaging?: MessengerEvent[]; }
interface MessengerEvent {
	sender?: { id?: string };
	recipient?: { id?: string };
	timestamp?: number;
	message?: {
		mid?: string;
		text?: string;
		attachments?: Array<{ type?: string; payload?: { url?: string } }>;
	};
}
interface GraphSendResponse {
	recipient_id?: string;
	message_id?: string;
	error?: { message?: string; code?: number; error_subcode?: number };
}
function isMessengerWebhook(raw: unknown): raw is { entry?: MessengerWebhookEntry[] } {
	return typeof raw === "object" && raw !== null && "entry" in raw && Array.isArray((raw as { entry?: unknown }).entry);
}

export function normalizeFacebookWebhook(raw: unknown): NormalizedInbound[] {
	if (!isMessengerWebhook(raw)) return [];
	const results: NormalizedInbound[] = [];
	for (const entry of raw.entry ?? []) {
		if (!entry.id) continue;
		for (const event of entry.messaging ?? []) {
			const senderPsid = event.sender?.id;
			const message = event.message;
			if (!senderPsid || !message?.mid) continue;
			const providerAttachments = (message.attachments ?? []).flatMap((attachment) =>
				attachment.type === "image" && attachment.payload?.url
					? [{ type: "image" as const, url: attachment.payload.url }]
					: [],
			);
			// Ignore non-message events, but accept a text-less image message.
			if (message.text == null && providerAttachments.length === 0) continue;
			const ts = event.timestamp ?? Date.now();
			results.push({
				conversationId: facebookConversationId(entry.id, senderPsid),
				channel: "facebook",
				providerMessageId: message.mid,
				senderId: senderPsid,
				text: message.text ?? "",
				createdAt: new Date(ts > 1e11 ? ts : ts * 1000).toISOString(),
				payload: { pageId: entry.id, senderPsid },
				attachments: [],
				providerAttachments,
			});
		}
	}
	return results;
}

async function graphSend(token: string, body: unknown): Promise<ProviderSendResult> {
	let response: Response;
	try {
		response = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
		});
	} catch (err) {
		return { ok: false, providerMessageId: null, error: `graph api request failed: ${err instanceof Error ? err.message : String(err)}`, failureKind: "uncertain" };
	}
	let json: GraphSendResponse;
	try { json = (await response.json()) as GraphSendResponse; } catch {
		return { ok: false, providerMessageId: null, error: `graph api returned non-JSON (HTTP ${response.status})`, failureKind: response.ok ? "uncertain" : "definitive" };
	}
	if (!response.ok || json.error || !json.message_id) {
		const code = json.error?.code;
		const detail = json.error?.message ?? `HTTP ${response.status}`;
		if (code === 2001) return { ok: false, providerMessageId: null, error: "recipient unreachable (outside the 24h messaging window)" };
		if (code === 190) return { ok: false, providerMessageId: null, error: "page access token expired or revoked" };
		return { ok: false, providerMessageId: null, error: `graph api error: ${detail}` };
	}
	return { ok: true, providerMessageId: json.message_id };
}

export const facebookAdapter: ChannelAdapter = {
	channel: "facebook",
	normalizeInbound: normalizeFacebookWebhook,
	async sendOutbound(ctx: OutboundContext, message: OutboundMessage): Promise<ProviderSendResult> {
		if (!ctx.pageAccessToken) return { ok: false, providerMessageId: null, error: "missing page access token" };
		const text = message.text.trim();
		if (!text && !(message.attachments?.length)) return { ok: false, providerMessageId: null, error: "empty message" };
		if (text.length > 2000) return { ok: false, providerMessageId: null, error: "message exceeds 2000 characters" };
		let lastProviderMessageId: string | null = null;
		// Deterministic sequence: text first (when present), then every image.
		if (text) {
			const sent = await graphSend(ctx.pageAccessToken, { recipient: { id: message.to }, message: { text } });
			if (!sent.ok) return sent;
			lastProviderMessageId = sent.providerMessageId;
		}
		for (const attachment of message.attachments ?? []) {
			const sent = await graphSend(ctx.pageAccessToken, {
				recipient: { id: message.to },
				message: { attachment: { type: "image", payload: { url: attachment.url, is_reusable: true } } },
			});
			if (!sent.ok) return sent;
			lastProviderMessageId = sent.providerMessageId;
		}
		return { ok: true, providerMessageId: lastProviderMessageId };
	},
};
