import type { Attachment, Channel } from "@msgflow/contracts";

/** A provider-hosted image which the Worker must copy into durable storage. */
export interface ProviderImageAttachment {
	type: "image";
	url: string;
	name?: string;
}

/**
 * A canonical inbound message, already channel-agnostic, ready to be routed
 * and appended to a Conversation DO. The DO never sees provider-specific raw
 * payloads — only these (per ADR 0005).
 */
export interface NormalizedInbound {
	conversationId: string;
	channel: Channel;
	providerMessageId: string | null;
	senderId: string;
	text: string;
	createdAt: string;
	payload: unknown;
	/** Durable R2-backed images, populated before routeInbound appends the message. */
	attachments: Attachment[];
	/** Provider-hosted images awaiting Worker-side copy to R2. */
	providerAttachments?: ProviderImageAttachment[];
}

export interface OutboundMessage {
	/** Facebook: sender PSID. Email: recipient address. */
	to: string;
	text: string;
	/** Email only: the subject line to send with. */
	subject?: string;
	/** Stable client key, used by providers that support request idempotency. */
	idempotencyKey?: string;
	attachments?: Attachment[];
}

/**
 * Provider context resolved by the Worker (the only layer that may hold
 * credentials, per ADR 0005). Each adapter picks the fields it needs; the
 * Worker supplies exactly the fields for the conversation's channel.
 */
export interface OutboundContext {
	/** Facebook: the Page access token for the conversation's Page. */
	pageAccessToken?: string;
	/** Email: the conversation's own mailbox (From address, e.g. support@yehey.com). */
	from?: string;
	/** Email: root thread key (RFC 822 Message-ID) for In-Reply-To/References. */
	threadKey?: string;
	/**
	 * Email: structural wrapper around the Worker's SendEmail binding, so this
	 * package stays environment-neutral (no Cloudflare types here).
	 */
	emailSender?: { send(from: string, to: string, raw: string): Promise<void> };
	/** Structural R2 reader supplied by the Worker; no Worker types leak here. */
	attachmentReader?: {
		read(attachment: Attachment): Promise<ArrayBuffer | null>;
	};
}

export interface ProviderSendResult {
	ok: boolean;
	providerMessageId: string | null;
	/** Human-readable provider error when ok is false. */
	error?: string;
	/** An ambiguous transport failure may have reached the provider; never retry it blindly. */
	failureKind?: "definitive" | "uncertain";
}

export interface ChannelAdapter {
	readonly channel: Channel;
	normalizeInbound(raw: unknown): NormalizedInbound[];
	sendOutbound(
		ctx: OutboundContext,
		message: OutboundMessage,
	): Promise<ProviderSendResult>;
}
