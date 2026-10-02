import type { Attachment } from "@msgflow/contracts";
import { emailConversationId, ParsedEmailSchema } from "@msgflow/contracts";
import { Either, Schema } from "effect";
import type {
	ChannelAdapter,
	NormalizedInbound,
	OutboundContext,
	OutboundMessage,
	ProviderSendResult,
	StructuredEmail,
} from "./types";
export interface ParsedEmail {
	from: string;
	to: string;
	subject: string;
	messageId: string | null;
	inReplyTo: string | null;
	references: string[] | null;
	text: string;
	attachments: Attachment[];
	mailbox: string;
	receivedAt: string;
}
export function normalizeEmailMessage(
	email: ParsedEmail,
): NormalizedInbound | null {
	const threadKey = email.messageId ?? crypto.randomUUID();
	return {
		conversationId: emailConversationId(email.mailbox, threadKey),
		channel: "email",
		providerMessageId: email.messageId,
		senderId: email.from,
		text: email.text,
		createdAt: email.receivedAt,
		payload: { subject: email.subject, to: email.to, threadKey },
		attachments: email.attachments,
	};
}
export function safeRfcId(id: string): string {
	if (!id || /[\r\n]/.test(id)) throw new Error("invalid RFC message id");
	return id.startsWith("<") ? id : `<${id}>`;
}
/** Provider owns Date, Message-ID and MIME framing. */
export async function buildStructuredEmail(
	ctx: OutboundContext,
	message: OutboundMessage,
): Promise<StructuredEmail> {
	if (!ctx.from) throw new Error("missing From identity");
	const headers: Record<string, string> = {};
	if (ctx.inReplyTo) headers["In-Reply-To"] = safeRfcId(ctx.inReplyTo);
	if (ctx.references?.length)
		headers.References = ctx.references.map(safeRfcId).join(" ");
	if (message.idempotencyKey) {
		if (/[\r\n]/.test(message.idempotencyKey))
			throw new Error("invalid correlation id");
		headers["X-MsgFlow-Intent"] = message.idempotencyKey;
	}
	const attachments: StructuredEmail["attachments"] = [];
	// Conservative MIME/base64 overhead allowance under the complete-message cap.
	let size =
		new TextEncoder().encode(
			message.text + (message.subject ?? "") + JSON.stringify(headers),
		).length + 4096;
	for (const attachment of message.attachments ?? []) {
		if (
			![
				"application/pdf",
				"image/png",
				"image/jpeg",
				"image/gif",
				"image/webp",
			].includes(attachment.type)
		)
			throw new Error("unsupported attachment type");
		const content = await ctx.attachmentReader?.read(attachment);
		if (!content) throw new Error("attachment unavailable");
		size +=
			Math.ceil(content.byteLength / 3) * 4 +
			Math.ceil(content.byteLength / 57) * 2 +
			1024;
		if (size > 5 * 1024 * 1024) throw new Error("message exceeds 5 MiB");
		attachments.push({
			content,
			filename: attachment.name.replace(/[\r\n"\\]/g, "-"),
			type: attachment.type,
			disposition: "attachment",
		});
	}
	if (size > 5 * 1024 * 1024) throw new Error("message exceeds 5 MiB");
	return {
		from: ctx.from,
		to: message.to,
		subject: message.subject ?? "",
		text: message.text,
		headers,
		attachments,
	};
}
export const emailAdapter: ChannelAdapter = {
	channel: "email",
	normalizeInbound(raw: unknown): NormalizedInbound[] {
		const decoded = Schema.decodeUnknownEither(ParsedEmailSchema)(raw);
		if (Either.isLeft(decoded)) return [];
		const result = normalizeEmailMessage(decoded.right as ParsedEmail);
		return result ? [result] : [];
	},
	async sendOutbound(
		ctx: OutboundContext,
		message: OutboundMessage,
	): Promise<ProviderSendResult> {
		if (!ctx.emailSender)
			return {
				ok: false,
				providerMessageId: null,
				error: "missing email provider",
			};
		let payload: StructuredEmail;
		try {
			payload = await buildStructuredEmail(ctx, message);
		} catch (error) {
			return {
				ok: false,
				providerMessageId: null,
				error: String(error),
				failureKind: "definitive",
			};
		}
		try {
			const result = await ctx.emailSender.send(payload);
			if (!result.messageId)
				throw new Error("provider acknowledgement missing id");
			return { ok: true, providerMessageId: result.messageId };
		} catch {
			return {
				ok: false,
				providerMessageId: null,
				error: "email provider outcome uncertain",
				failureKind: "uncertain",
			};
		}
	},
};
