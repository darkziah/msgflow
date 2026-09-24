import { Either, Schema } from "effect";
import {
	emailConversationId,
	ParsedEmailSchema,
} from "@msgflow/contracts";
import type { Attachment } from "@msgflow/contracts";
import type { ChannelAdapter, NormalizedInbound, OutboundContext, OutboundMessage, ProviderSendResult } from "./types";

export interface ParsedEmail {
	from: string; to: string; subject: string; messageId: string | null;
	inReplyTo: string | null; references: string[] | null; text: string;
	attachments: Attachment[]; mailbox: string; receivedAt: string;
}
function deriveThreadKey(email: ParsedEmail): string {
	return email.references?.[0] ?? email.inReplyTo ?? email.messageId ?? "orphan";
}
export function normalizeEmailMessage(email: ParsedEmail): NormalizedInbound | null {
	if (!email.text && email.attachments.length === 0 && !email.subject) return null;
	const threadKey = deriveThreadKey(email);
	return {
		conversationId: emailConversationId(email.mailbox, threadKey), channel: "email",
		providerMessageId: email.messageId, senderId: email.from, text: email.text,
		createdAt: email.receivedAt, payload: { subject: email.subject, to: email.to, threadKey },
		attachments: email.attachments,
	};
}
function wrapMessageId(id: string): string { return id.startsWith("<") ? id : `<${id}>`; }
function headerText(value: string): string {
	const clean = value.replace(/[\r\n]+/g, " ").trim();
	return /[^\x20-\x7e]/.test(clean) ? `=?UTF-8?B?${btoa(unescape(encodeURIComponent(clean)))}?=` : clean;
}
function base64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer); let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** Build a UTF-8 multipart/mixed RFC 5322 email, including R2-backed images. */
export async function buildEmailRaw(input: {
	from: string; to: string; subject: string; threadKey: string; text: string;
	messageId?: string; attachments: Attachment[];
	attachmentReader?: OutboundContext["attachmentReader"];
}): Promise<string> {
	const messageId = `${input.messageId ?? crypto.randomUUID()}@msgflow`;
	const boundary = `=_msgflow_${crypto.randomUUID()}`;
	const headers = [
		`From: ${input.from}`, `To: ${input.to}`, `Subject: ${headerText(input.subject)}`,
		`Date: ${new Date().toUTCString()}`, `Message-ID: <${messageId}>`,
		`In-Reply-To: ${wrapMessageId(input.threadKey)}`, `References: ${wrapMessageId(input.threadKey)}`,
		"MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`,
	].join("\r\n");
	const parts = [
		`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${input.text.replace(/\r?\n/g, "\r\n")}\r\n`,
	];
	for (const attachment of input.attachments) {
		const bytes = await input.attachmentReader?.read(attachment);
		if (!bytes) throw new Error(`attachment unavailable: ${attachment.id}`);
		const filename = attachment.name.replace(/[\r\n"\\]/g, "-");
		parts.push(`--${boundary}\r\nContent-Type: ${attachment.type}; name="${filename}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: inline; filename="${filename}"\r\n\r\n${base64(bytes)}\r\n`);
	}
	parts.push(`--${boundary}--\r\n`);
	return `${headers}\r\n\r\n${parts.join("")}`;
}
export const emailAdapter: ChannelAdapter = {
	channel: "email",
	normalizeInbound(raw: unknown): NormalizedInbound[] {
		const decoded = Schema.decodeUnknownEither(ParsedEmailSchema)(raw);
		if (Either.isLeft(decoded)) return [];
		const result = normalizeEmailMessage(decoded.right as ParsedEmail);
		return result ? [result] : [];
	},
	async sendOutbound(ctx: OutboundContext, message: OutboundMessage): Promise<ProviderSendResult> {
		if (!ctx.emailSender || !ctx.from || !ctx.threadKey) return { ok: false, providerMessageId: null, error: "missing email send context" };
		if (!message.text.trim() && !(message.attachments?.length)) return { ok: false, providerMessageId: null, error: "empty message" };
		let raw: string;
		try {
			raw = await buildEmailRaw({ from: ctx.from, to: message.to, subject: message.subject ?? "", threadKey: ctx.threadKey, text: message.text, messageId: message.idempotencyKey, attachments: message.attachments ?? [], attachmentReader: ctx.attachmentReader });
		} catch (err) { return { ok: false, providerMessageId: null, error: `email attachment failed: ${err instanceof Error ? err.message : String(err)}` }; }
		try { await ctx.emailSender.send(ctx.from, message.to, raw); }
		catch (err) { return { ok: false, providerMessageId: null, error: `email send failed: ${err instanceof Error ? err.message : String(err)}`, failureKind: "uncertain" }; }
		const match = /Message-ID: <([^>]+)>/.exec(raw);
		return { ok: true, providerMessageId: match?.[1] ?? null };
	},
};
