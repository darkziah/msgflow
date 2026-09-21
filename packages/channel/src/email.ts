import { emailConversationId } from "@msgflow/contracts";
import type {
	ChannelAdapter,
	NormalizedInbound,
	OutboundContext,
	OutboundMessage,
	ProviderSendResult,
} from "./types";

/**
 * Email adapter (Cloudflare Email Service). Normalizes a parsed inbound email
 * into a canonical message and sends outbound replies through the Worker's
 * SendEmail binding. Threading is derived from RFC 822 headers — there is no
 * provider threadId (per ADR 0014).
 */

export interface ParsedEmail {
	from: string;
	to: string;
	subject: string;
	messageId: string | null;
	inReplyTo: string | null;
	references: string[] | null;
	text: string;
	mailbox: string; // e.g. support@yehey.com
	receivedAt: string;
}

function deriveThreadKey(email: ParsedEmail): string {
	// Root thread key: first References entry, else In-Reply-To, else own Message-ID.
	const firstReference = email.references?.[0];
	return (
		firstReference ??
		email.inReplyTo ??
		email.messageId ??
		email.messageId ??
		"orphan"
	);
}

export function normalizeEmailMessage(
	email: ParsedEmail,
): NormalizedInbound | null {
	if (!email.text && !email.subject) return null;
	const threadKey = deriveThreadKey(email);
	return {
		conversationId: emailConversationId(email.mailbox, threadKey),
		channel: "email",
		providerMessageId: email.messageId,
		senderId: email.from,
		text: email.text,
		createdAt: email.receivedAt,
		payload: { subject: email.subject, to: email.to, threadKey },
	};
}

// Build a raw RFC 5322 message. The thread key is the root Message-ID from the
// inbound chain; replying with In-Reply-To/References pointing at it keeps the
// whole thread together in the customer's mail client.
export function buildEmailRaw(input: {
	from: string;
	to: string;
	subject: string;
	threadKey: string;
	text: string;
}): string {
	const wrapMessageId = (id: string): string =>
		id.startsWith("<") ? id : `<${id}>`;
	// Headers must be single-line ASCII; strip CR/LF so a hostile subject can't
	// inject extra headers.
	const cleanSubject = input.subject.replace(/[\r\n]+/g, " ").trim();
	const cleanText = input.text.replace(/\r\n/g, "\n").trimEnd();

	const headers = [
		`From: ${input.from}`,
		`To: ${input.to}`,
		cleanSubject ? `Subject: ${cleanSubject}` : "Subject:",
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@msgflow>`,
		`In-Reply-To: ${wrapMessageId(input.threadKey)}`,
		`References: ${wrapMessageId(input.threadKey)}`,
		"Content-Type: text/plain; charset=utf-8",
		"MIME-Version: 1.0",
	].join("\r\n");

	return `${headers}\r\n\r\n${cleanText}\r\n`;
}

export const emailAdapter: ChannelAdapter = {
	channel: "email",
	// The email() handler passes a parsed ParsedEmail; unlike Facebook there is no
	// array of events per payload, so wrap the single result.
	normalizeInbound(raw: unknown): NormalizedInbound[] {
		const parsed = raw as ParsedEmail;
		const result = normalizeEmailMessage(parsed);
		return result ? [result] : [];
	},
	async sendOutbound(
		ctx: OutboundContext,
		message: OutboundMessage,
	): Promise<ProviderSendResult> {
		if (!ctx.emailSender || !ctx.from || !ctx.threadKey) {
			return {
				ok: false,
				providerMessageId: null,
				error: "missing email send context",
			};
		}
		const text = message.text.trim();
		if (!text) {
			return { ok: false, providerMessageId: null, error: "empty message" };
		}

		const raw = buildEmailRaw({
			from: ctx.from,
			to: message.to,
			subject: message.subject ?? "",
			threadKey: ctx.threadKey,
			text,
		});

		try {
			await ctx.emailSender.send(ctx.from, message.to, raw);
		} catch (err) {
			return {
				ok: false,
				providerMessageId: null,
				error: `email send failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		// The Message-ID we generated is our own provider message id.
		const match = /Message-ID: <([^>]+)>/.exec(raw);
		return { ok: true, providerMessageId: match?.[1] ?? null };
	},
};
