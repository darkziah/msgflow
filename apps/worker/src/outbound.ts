import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { EmailMessage } from "cloudflare:email";
import { emailAdapter, facebookAdapter } from "@msgflow/channel";
import type { OutboundMessage, ProviderSendResult } from "@msgflow/channel";
import type { Message } from "@msgflow/contracts";
import { parseConversationId } from "@msgflow/contracts";
import {
	channels,
	contactIdentities,
	conversations,
	outboundIntents,
	scheduledMessages,
} from "@msgflow/db";
import type { Env } from "./env";
import { decryptChannelToken } from "./channel-token-crypto";
import { readAttachment } from "./attachments";
import { parseStoredAttachments } from "./persistence";

export interface SendParams {
	conversationId: string;
	text: string;
	subject?: string;
	attachments?: Message["attachments"];
	senderId: string;
	/** Stable command and canonical message id. Generated once when omitted. */
	clientMessageId?: string;
}

export type SendResult =
	| { ok: true; message: Message }
	| { ok: false; error: string; retryable: boolean };

export interface SendOptions {
	/** Cron may retry only a provider-declared definitive failure. */
	retryDefinitiveFailure?: boolean;
	/** Permit a queued send-later intent to cross the provider boundary. */
	allowQueued?: boolean;
}

/**
 * Persisted outbound state machine. D1 is written before provider dispatch;
 * after a provider acknowledgement, failures appending to the DO are retained
 * as provider_sent/uncertain and are never re-sent automatically.
 */
export async function sendOutbound(
	env: Env,
	params: SendParams,
	options: SendOptions = {},
): Promise<SendResult> {
	const parsed = parseConversationId(params.conversationId);
	if (!parsed) return { ok: false, error: "invalid conversation id", retryable: false };
	const text = params.text.trim();
	const attachments = params.attachments ?? [];
	if (!text && attachments.length === 0) return { ok: false, error: "empty message", retryable: false };

	const db = drizzle(env.DB);
	const id = params.clientMessageId ?? crypto.randomUUID();
	const now = new Date().toISOString();
	await db
		.insert(outboundIntents)
		.values({
			id,
			conversationId: params.conversationId,
			text,
			attachmentsJson: JSON.stringify(attachments),
			subject: params.subject ?? null,
			senderId: params.senderId,
			status: "pending",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();

	let intent = await db
		.select()
		.from(outboundIntents)
		.where(eq(outboundIntents.id, id))
		.get();
	if (!intent) return { ok: false, error: "outbound intent was not persisted", retryable: true };

	if (intent.status === "delivered") {
		const existing = await getMessageFromDo(env, intent.conversationId, intent.id);
		if (existing) return { ok: true, message: existing };
		return { ok: false, error: "delivery recorded but message is unavailable", retryable: false };
	}
	if (intent.status === "provider_sent") {
		return reconcileProviderSent(env, intent);
	}
	if (intent.status === "uncertain") {
		return { ok: false, error: intent.lastError ?? "provider delivery outcome is uncertain; not re-sending", retryable: false };
	}
	if (intent.status === "sending") {
		// A process can die after the provider receives the request and before D1 is
		// updated. Conservatively fence off all future provider retries.
		await markIntent(db, id, "uncertain", "previous provider dispatch did not finish recording");
		return { ok: false, error: "provider delivery outcome is uncertain; not re-sending", retryable: false };
	}
	if (intent.status === "queued" && !options.allowQueued) {
		return { ok: false, error: "message is scheduled for later", retryable: false };
	}
	if (intent.status === "failed" && !options.retryDefinitiveFailure) {
		return { ok: false, error: intent.lastError ?? "provider send failed", retryable: false };
	}

	const claim = await db
		.update(outboundIntents)
		.set({ status: "sending", attempts: intent.attempts + 1, lastError: null, updatedAt: new Date().toISOString() })
		.where(and(eq(outboundIntents.id, id), eq(outboundIntents.status, intent.status)))
		.run();
	if (!claim.meta.changes) {
		return { ok: false, error: "delivery is already being processed", retryable: false };
	}
	intent = await db.select().from(outboundIntents).where(eq(outboundIntents.id, id)).get();
	if (!intent) return { ok: false, error: "outbound intent disappeared", retryable: false };

	const context = await resolveProviderContext(env, intent.conversationId, parsed.right);
	if (!context.ok) {
		await markIntent(db, id, "failed", context.error);
		return { ok: false, error: context.error, retryable: true };
	}

	const result = context.send({ to: context.to, text: intent.text, subject: intent.subject ?? undefined, idempotencyKey: id, attachments: parseStoredAttachments(intent.attachmentsJson) });
	const provider = await result;
	if (!provider.ok) {
		const uncertain = provider.failureKind === "uncertain";
		await markIntent(db, id, uncertain ? "uncertain" : "failed", provider.error ?? "provider send failed");
		return { ok: false, error: provider.error ?? "provider send failed", retryable: !uncertain };
	}

	const sentAt = new Date().toISOString();
	try {
		await db.update(outboundIntents).set({
			status: "provider_sent",
			providerMessageId: provider.providerMessageId,
			providerSentAt: sentAt,
			updatedAt: sentAt,
		}).where(eq(outboundIntents.id, id)).run();
	} catch {
		// The intent remains sending. A later invocation converts that to uncertain
		// instead of risking a second external send.
		return { ok: false, error: "provider accepted send but delivery state could not be recorded", retryable: false };
	}
	return reconcileProviderSent(env, { ...intent, status: "provider_sent", providerMessageId: provider.providerMessageId });
}

/** Persist both scheduled work and its queued outbound intent before cron sees it. */
export async function scheduleOutbound(env: Env, params: SendParams & { sendAt: string }): Promise<string> {
	const db = drizzle(env.DB);
	const id = params.clientMessageId ?? crypto.randomUUID();
	const now = new Date().toISOString();
	await db.insert(outboundIntents).values({
		id,
		conversationId: params.conversationId,
		text: params.text.trim(),
		attachmentsJson: JSON.stringify(params.attachments ?? []),
		subject: params.subject ?? null,
		senderId: params.senderId,
		status: "queued",
		scheduledMessageId: id,
		createdAt: now,
		updatedAt: now,
	}).onConflictDoNothing().run();
	await db.insert(scheduledMessages).values({
		id,
		conversationId: params.conversationId,
		text: params.text.trim(),
		attachmentsJson: JSON.stringify(params.attachments ?? []),
		sendAt: params.sendAt,
		createdBy: params.senderId,
	}).onConflictDoNothing().run();
	return params.sendAt;
}

async function reconcileProviderSent(env: Env, intent: typeof outboundIntents.$inferSelect): Promise<SendResult> {
	const parsed = parseConversationId(intent.conversationId);
	if (!parsed) return { ok: false, error: "invalid conversation id", retryable: false };
	const message: Message = {
		id: intent.id,
		conversationId: intent.conversationId,
		kind: "outbound",
		channel: parsed.channel,
		providerMessageId: intent.providerMessageId,
		senderId: intent.senderId,
		text: intent.text,
		payload: intent.subject ? { subject: intent.subject } : null,
		attachments: parseStoredAttachments(intent.attachmentsJson),
		createdAt: intent.providerSentAt ?? intent.createdAt,
	};
	try {
		await appendToConversation(env, intent.conversationId, message);
		const now = new Date().toISOString();
		await drizzle(env.DB).update(outboundIntents).set({ status: "delivered", deliveredAt: now, updatedAt: now, lastError: null }).where(eq(outboundIntents.id, intent.id)).run();
		return { ok: true, message };
	} catch (error) {
		// Keep provider_sent: a later request may safely retry only the DO append,
		// which is idempotent by message id, without crossing the provider again.
		await markIntent(drizzle(env.DB), intent.id, "provider_sent", `provider accepted send but Conversation DO append failed: ${errorMessage(error)}`);
		return { ok: false, error: "provider accepted send but Conversation DO append failed; provider will not be re-sent", retryable: false };
	}
}

async function markIntent(db: ReturnType<typeof drizzle>, id: string, status: "failed" | "provider_sent" | "uncertain", lastError: string): Promise<void> {
	await db.update(outboundIntents).set({ status, lastError, updatedAt: new Date().toISOString() }).where(eq(outboundIntents.id, id)).run();
}

async function resolveProviderContext(env: Env, conversationId: string, threadKey: string): Promise<
	| { ok: false; error: string }
	| { ok: true; to: string; send: (message: OutboundMessage) => Promise<ProviderSendResult> }
> {
	const db = drizzle(env.DB);
	const conversation = await db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
	if (!conversation) return { ok: false, error: "conversation not found" };
	const channel = await db.select().from(channels).where(eq(channels.id, conversation.channelId)).get();
	if (!channel) return { ok: false, error: "channel not found" };
	const identity = await db.select({ externalUserId: contactIdentities.externalUserId }).from(contactIdentities).where(and(eq(contactIdentities.contactId, conversation.contactId), eq(contactIdentities.channelId, conversation.channelId))).get();
	if (!identity?.externalUserId) return { ok: false, error: "contact identity not found" };
	if (channel.type === "facebook_page") {
		if (!channel.accessToken) return { ok: false, error: "page access token missing (connect the Page first)" };
		try {
			const pageAccessToken = await decryptChannelToken(channel.accessToken, env.CHANNEL_TOKEN_ENCRYPTION_KEY);
			return { ok: true, to: identity.externalUserId, send: (message) => facebookAdapter.sendOutbound({ pageAccessToken }, message) };
		} catch { return { ok: false, error: "channel access token cannot be decrypted" }; }
	}
	return {
		ok: true,
		to: identity.externalUserId,
		send: (message) => emailAdapter.sendOutbound({ from: channel.externalId, threadKey, attachmentReader: { read: (attachment) => readAttachment(env, attachment) }, emailSender: { send: async (from, to, raw) => { await env.EMAIL.send(new EmailMessage(from, to, raw)); } } }, message),
	};
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function getMessageFromDo(env: Env, conversationId: string, messageId: string): Promise<Message | null> {
	const stub = env.CONVERSATION_DO.get(env.CONVERSATION_DO.idFromName(conversationId));
	const response = await stub.fetch(`https://do/message?id=${encodeURIComponent(messageId)}`);
	if (!response.ok) return null;
	return (await response.json()) as Message;
}

async function appendToConversation(env: Env, conversationId: string, message: Message): Promise<void> {
	const stub = env.CONVERSATION_DO.get(env.CONVERSATION_DO.idFromName(conversationId));
	const response = await stub.fetch("https://do/append-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) });
	if (!response.ok) throw new Error(`Conversation DO append failed (HTTP ${response.status})`);
}
