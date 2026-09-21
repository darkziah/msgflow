import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { EmailMessage } from "cloudflare:email";
import { emailAdapter, facebookAdapter } from "@msgflow/channel";
import type { Message } from "@msgflow/contracts";
import { parseConversationId } from "@msgflow/contracts";
import {
	channels,
	contactIdentities,
	conversations,
	scheduledMessages,
} from "@msgflow/db";
import type { Env } from "./env";

/**
 * Outbound send path (per ADR 0005): the Worker resolves D1 context (conversation,
 * channel credentials, contact identity), dispatches to the channel adapter, and
 * appends the canonical outbound Message to the Conversation DO. The same path
 * serves live sends (POST /api/conversations/:id/messages) and the send-later cron.
 */

export interface SendParams {
	conversationId: string;
	text: string;
	/** Email only: subject line. */
	subject?: string;
	/** Agent (session user) id; stored as the outbound message's senderId. */
	senderId: string;
	/** Idempotency key: the message id; skips the provider call if already sent. */
	clientMessageId?: string;
}

export type SendResult =
	| { ok: true; message: Message }
	| { ok: false; error: string };

export async function sendOutbound(
	env: Env,
	params: SendParams,
): Promise<SendResult> {
	const parsed = parseConversationId(params.conversationId);
	if (!parsed) {
		return { ok: false, error: "invalid conversation id" };
	}
	const text = params.text.trim();
	if (!text) {
		return { ok: false, error: "empty message" };
	}

	// Idempotency: if the client supplied a message id and the DO already holds it,
	// the send already happened — return the stored message without calling the
	// provider again (guards client retries from double-sending).
	if (params.clientMessageId) {
		const existing = await getMessageFromDo(
			env,
			params.conversationId,
			params.clientMessageId,
		);
		if (existing) {
			return { ok: true, message: existing };
		}
	}

	const db = drizzle(env.DB);
	const conversation = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, params.conversationId))
		.get();
	if (!conversation) {
		return { ok: false, error: "conversation not found" };
	}
	const channel = await db
		.select()
		.from(channels)
		.where(eq(channels.id, conversation.channelId))
		.get();
	if (!channel) {
		return { ok: false, error: "channel not found" };
	}
	// Recipient identity for this conversation's channel (PSIDs are Page-scoped).
	const identity = await db
		.select({ externalUserId: contactIdentities.externalUserId })
		.from(contactIdentities)
		.where(
			and(
				eq(contactIdentities.contactId, conversation.contactId),
				eq(contactIdentities.channelId, conversation.channelId),
			),
		)
		.get();
	if (!identity?.externalUserId) {
		return { ok: false, error: "contact identity not found" };
	}

	// Resolve the provider context (credentials only ever touch the Worker layer).
	let result: Awaited<ReturnType<typeof emailAdapter.sendOutbound>>;
	if (channel.type === "facebook_page") {
		if (!channel.accessToken) {
			return {
				ok: false,
				error: "page access token missing (connect the Page first)",
			};
		}
		result = await facebookAdapter.sendOutbound(
			{ pageAccessToken: channel.accessToken },
			{ to: identity.externalUserId, text },
		);
	} else {
		const threadKey = parsed.right;
		result = await emailAdapter.sendOutbound(
			{
				from: channel.externalId, // mailbox, e.g. support@yehey.com
				threadKey,
				emailSender: {
					send: async (from: string, to: string, raw: string) => {
						await env.EMAIL.send(new EmailMessage(from, to, raw));
					},
				},
			},
			{ to: identity.externalUserId, text, subject: params.subject },
		);
	}

	if (!result.ok) {
		return { ok: false, error: result.error ?? "provider send failed" };
	}

	const message: Message = {
		id: params.clientMessageId ?? crypto.randomUUID(),
		conversationId: params.conversationId,
		kind: "outbound",
		channel: parsed.channel,
		providerMessageId: result.providerMessageId,
		senderId: params.senderId,
		text,
		payload: params.subject ? { subject: params.subject } : null,
		attachments: [],
		createdAt: new Date().toISOString(),
	};

	await appendToConversation(env, params.conversationId, message);
	return { ok: true, message };
}

/** Insert a row into scheduled_messages; returns the ISO sendAt it will fire at. */
export async function scheduleOutbound(
	env: Env,
	params: SendParams & { sendAt: string },
): Promise<string> {
	const db = drizzle(env.DB);
	const id = params.clientMessageId ?? crypto.randomUUID();
	await db
		.insert(scheduledMessages)
		.values({
			id,
			conversationId: params.conversationId,
			text: params.text,
			sendAt: params.sendAt,
			createdBy: params.senderId,
		})
		.run();
	return params.sendAt;
}

async function getMessageFromDo(
	env: Env,
	conversationId: string,
	messageId: string,
): Promise<Message | null> {
	const stub = env.CONVERSATION_DO.get(
		env.CONVERSATION_DO.idFromName(conversationId),
	);
	const response = await stub.fetch(
		`https://do/message?id=${encodeURIComponent(messageId)}`,
	);
	if (!response.ok) return null;
	return (await response.json()) as Message;
}

async function appendToConversation(
	env: Env,
	conversationId: string,
	message: Message,
): Promise<void> {
	const stub = env.CONVERSATION_DO.get(
		env.CONVERSATION_DO.idFromName(conversationId),
	);
	await stub.fetch("https://do/append-message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(message),
	});
}
