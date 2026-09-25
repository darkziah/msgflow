import type { OutboundMessage, ProviderSendResult } from "@msgflow/channel";
import { emailAdapter, facebookAdapter } from "@msgflow/channel";
import type { Message } from "@msgflow/contracts";
import { parseConversationId } from "@msgflow/contracts";
import {
	channels,
	contactIdentities,
	conversations,
	outboundIntents,
	scheduledMessages,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { decryptChannelToken } from "./channel-token-crypto";
import {
	type EmailOutboundMetadata,
	getEmailOutboundMetadata,
	persistCanonicalEmail,
	persistEmailOutboundMetadata,
	projectCanonicalEmail,
	resolveEmailReplyMetadata,
} from "./email-persistence";
import { readPrivateEmailAttachment } from "./email-storage";
import { canAccessMailbox } from "./email-transport";
import type { Env } from "./env";
import { recordProviderAccepted } from "./outbound-state";
import { parseStoredAttachments } from "./persistence";

export interface SendParams {
	conversationId: string;
	text: string;
	subject?: string;
	attachments?: Message["attachments"];
	senderId: string;
	/** Stable command and canonical message id. Generated once when omitted. */
	clientMessageId?: string;
	mailboxId?: string;
	confirmPrivateIdentity?: boolean;
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
	if (!parsed)
		return { ok: false, error: "invalid conversation id", retryable: false };
	const text = params.text.trim();
	const attachments = params.attachments ?? [];
	if (!text && attachments.length === 0)
		return { ok: false, error: "empty message", retryable: false };
	// The From address is derived from the durable conversation/channel mapping,
	// never supplied by the client. Email sends are gated before an intent is
	// persisted so private/delegated and team permissions cannot be bypassed by
	// a caller-provided sender id.
	let emailMeta: Omit<
		EmailOutboundMetadata,
		"intent_id" | "created_at"
	> | null = null;
	if (parsed.channel === "email") {
		try {
			emailMeta = await resolveEmailReplyMetadata(
				env,
				params.conversationId,
				params.senderId,
				params.mailboxId,
				params.confirmPrivateIdentity,
			);
		} catch (error) {
			await auditEmailDenial(env, params);
			return { ok: false, error: errorMessage(error), retryable: false };
		}
	}

	const db = drizzle(env.DB);
	const id = params.clientMessageId ?? crypto.randomUUID();
	const now = new Date().toISOString();
	await insertBoundIntent(env, id, params, "pending", now, emailMeta);
	if (!(await intentMatchesCommand(env, id, params)))
		return {
			ok: false,
			error: "client message id is already bound to a different command",
			retryable: false,
		};
	if (emailMeta) {
		const saved = await persistEmailOutboundMetadata(env, id, emailMeta);
		if (
			saved.mailbox_id !== emailMeta.mailbox_id ||
			saved.confirm_private_identity !== emailMeta.confirm_private_identity
		)
			return {
				ok: false,
				error: "reply identity does not match stored intent",
				retryable: false,
			};
	}

	let intent = await db
		.select()
		.from(outboundIntents)
		.where(eq(outboundIntents.id, id))
		.get();
	if (!intent)
		return {
			ok: false,
			error: "outbound intent was not persisted",
			retryable: true,
		};

	if (intent.status === "accepted") {
		const existing = await getMessageFromDo(
			env,
			intent.conversationId,
			intent.id,
		);
		if (existing) return { ok: true, message: existing };
		return reconcileProviderSent(env, intent);
	}
	if (intent.status === "provider_sent") {
		return reconcileProviderSent(env, intent);
	}
	if (intent.status === "uncertain") {
		return {
			ok: false,
			error:
				intent.lastError ??
				"provider delivery outcome is uncertain; not re-sending",
			retryable: false,
		};
	}
	if (intent.status === "sending") {
		// A process can die after the provider receives the request and before D1 is
		// updated. Conservatively fence off all future provider retries.
		if (Date.now() - Date.parse(intent.updatedAt) < 300000)
			return {
				ok: false,
				error: "delivery is already being processed",
				retryable: false,
			};
		await markIntent(
			db,
			id,
			"uncertain",
			"previous provider dispatch did not finish recording",
		);
		return {
			ok: false,
			error: "provider delivery outcome is uncertain; not re-sending",
			retryable: false,
		};
	}
	if (intent.status === "queued" && !options.allowQueued) {
		return {
			ok: false,
			error: "message is scheduled for later",
			retryable: false,
		};
	}
	if (intent.status === "failed" && !options.retryDefinitiveFailure) {
		return {
			ok: false,
			error: intent.lastError ?? "provider send failed",
			retryable: false,
		};
	}

	const claim = await db
		.update(outboundIntents)
		.set({
			status: "sending",
			attempts: intent.attempts + 1,
			lastError: null,
			updatedAt: new Date().toISOString(),
		})
		.where(
			and(
				eq(outboundIntents.id, id),
				eq(outboundIntents.status, intent.status),
			),
		)
		.run();
	if (!claim.meta.changes) {
		return {
			ok: false,
			error: "delivery is already being processed",
			retryable: false,
		};
	}
	intent = await db
		.select()
		.from(outboundIntents)
		.where(eq(outboundIntents.id, id))
		.get();
	if (!intent)
		return {
			ok: false,
			error: "outbound intent disappeared",
			retryable: false,
		};

	const context = await resolveProviderContext(
		env,
		intent.conversationId,
		intent.id,
		intent.senderId,
	);
	if (!context.ok) {
		await markIntent(db, id, "failed", context.error);
		return { ok: false, error: context.error, retryable: true };
	}

	const result = context.send({
		to: context.to,
		text: intent.text,
		subject: intent.subject ?? undefined,
		idempotencyKey: id,
		attachments: parseStoredAttachments(intent.attachmentsJson),
	});
	const provider = await result;
	if (!provider.ok) {
		const uncertain = provider.failureKind === "uncertain";
		await markIntent(
			db,
			id,
			uncertain ? "uncertain" : "failed",
			provider.error ?? "provider send failed",
		);
		return {
			ok: false,
			error: provider.error ?? "provider send failed",
			retryable: !uncertain,
		};
	}

	const sentAt = new Date().toISOString();
	try {
		await recordProviderAccepted(env, id, provider.providerMessageId, sentAt);
	} catch {
		// The intent remains sending. A later invocation converts that to uncertain
		// instead of risking a second external send.
		return {
			ok: false,
			error: "provider accepted send but delivery state could not be recorded",
			retryable: false,
		};
	}
	return reconcileProviderSent(env, {
		...intent,
		status: "provider_sent",
		providerMessageId: provider.providerMessageId,
		providerSentAt: sentAt,
	});
}

/** Persist both scheduled work and its queued outbound intent before cron sees it. */
export async function scheduleOutbound(
	env: Env,
	params: SendParams & { sendAt: string },
): Promise<string> {
	const parsed = parseConversationId(params.conversationId);
	if (!parsed) throw new Error("invalid conversation id");
	const emailMeta =
		parsed.channel === "email"
			? await resolveEmailReplyMetadata(
					env,
					params.conversationId,
					params.senderId,
					params.mailboxId,
					params.confirmPrivateIdentity,
				)
			: null;
	const db = drizzle(env.DB);
	const id = params.clientMessageId ?? crypto.randomUUID();
	const now = new Date().toISOString();
	await insertBoundIntent(env, id, params, "queued", now, emailMeta);
	if (!(await intentMatchesCommand(env, id, params)))
		throw new Error(
			"client message id is already bound to a different command",
		);
	const existing = await db
		.select()
		.from(scheduledMessages)
		.where(eq(scheduledMessages.id, id))
		.get();
	if (existing && existing.sendAt !== params.sendAt)
		throw new Error("scheduled time conflicts with stored command");
	await db
		.insert(scheduledMessages)
		.values({
			id,
			conversationId: params.conversationId,
			text: params.text.trim(),
			attachmentsJson: JSON.stringify(params.attachments ?? []),
			sendAt: params.sendAt,
			createdBy: params.senderId,
		})
		.onConflictDoNothing()
		.run();
	return params.sendAt;
}

export async function reconcileProviderSent(
	env: Env,
	intent: typeof outboundIntents.$inferSelect,
): Promise<SendResult> {
	const parsed = parseConversationId(intent.conversationId);
	if (!parsed)
		return { ok: false, error: "invalid conversation id", retryable: false };
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
		if (parsed.channel === "email") {
			const meta = await getEmailOutboundMetadata(env, intent.id);
			if (!meta) throw new Error("email metadata missing");
			message.payload = {
				subject: intent.subject,
				from: meta.from_address,
				to: meta.to_address,
				mailboxId: meta.mailbox_id,
				inReplyTo: meta.in_reply_to,
				references: JSON.parse(meta.references_json),
			};
			await persistCanonicalEmail(
				env,
				message,
				{
					workspaceId: meta.workspace_id,
					mailboxId: meta.receiving_mailbox_id,
				},
				message.payload,
			);
			if (
				intent.providerMessageId &&
				meta.mailbox_id !== meta.receiving_mailbox_id
			) {
				await env.DB.prepare(
					"INSERT OR IGNORE INTO email_identity_bridges(intent_id,workspace_id,mailbox_id,conversation_id,provider_message_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",
				)
					.bind(
						intent.id,
						meta.workspace_id,
						meta.mailbox_id,
						intent.conversationId,
						intent.providerMessageId.startsWith("<")
							? intent.providerMessageId
							: `<${intent.providerMessageId}>`,
						intent.senderId,
						intent.providerSentAt ?? intent.createdAt,
					)
					.run();
			}
			await projectCanonicalEmail(env, intent.id);
		} else await appendToConversation(env, intent.conversationId, message);
		const now = new Date().toISOString();
		// SendEmail acknowledges handoff, not mailbox delivery. Delivery/bounce
		// events remain intentionally unimplemented until an event queue exists.
		await drizzle(env.DB)
			.update(outboundIntents)
			.set({ status: "accepted", updatedAt: now, lastError: null })
			.where(eq(outboundIntents.id, intent.id))
			.run();
		return { ok: true, message };
	} catch (error) {
		// Keep provider_sent: a later request may safely retry only the DO append,
		// which is idempotent by message id, without crossing the provider again.
		await markIntent(
			drizzle(env.DB),
			intent.id,
			"provider_sent",
			`provider accepted send but Conversation DO append failed: ${errorMessage(error)}`,
		);
		return {
			ok: false,
			error:
				"provider accepted send but Conversation DO append failed; provider will not be re-sent",
			retryable: false,
		};
	}
}

async function markIntent(
	db: ReturnType<typeof drizzle>,
	id: string,
	status: "failed" | "provider_sent" | "uncertain",
	lastError: string,
): Promise<void> {
	await db
		.update(outboundIntents)
		.set({ status, lastError, updatedAt: new Date().toISOString() })
		.where(eq(outboundIntents.id, id))
		.run();
}

async function resolveProviderContext(
	env: Env,
	conversationId: string,
	intentId: string,
	actorId: string,
): Promise<
	| { ok: false; error: string }
	| {
			ok: true;
			to: string;
			send: (message: OutboundMessage) => Promise<ProviderSendResult>;
	  }
> {
	const db = drizzle(env.DB);
	const conversation = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.get();
	if (!conversation) return { ok: false, error: "conversation not found" };
	const channel = await db
		.select()
		.from(channels)
		.where(eq(channels.id, conversation.channelId))
		.get();
	if (!channel) return { ok: false, error: "channel not found" };
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
	if (!identity?.externalUserId)
		return { ok: false, error: "contact identity not found" };
	if (channel.type === "facebook_page") {
		if (!channel.accessToken)
			return {
				ok: false,
				error: "page access token missing (connect the Page first)",
			};
		try {
			const pageAccessToken = await decryptChannelToken(
				channel.accessToken,
				env.CHANNEL_TOKEN_ENCRYPTION_KEY,
			);
			return {
				ok: true,
				to: identity.externalUserId,
				send: (message) =>
					facebookAdapter.sendOutbound({ pageAccessToken }, message),
			};
		} catch {
			return { ok: false, error: "channel access token cannot be decrypted" };
		}
	}
	const metadata = await getEmailOutboundMetadata(env, intentId);
	if (!metadata)
		return { ok: false, error: "durable email reply metadata missing" };
	return {
		ok: true,
		to: metadata.to_address,
		send: (message) =>
			emailAdapter.sendOutbound(
				{
					from: metadata.from_address,
					inReplyTo: metadata.in_reply_to ?? undefined,
					references: JSON.parse(metadata.references_json) as string[],
					attachmentReader: {
						read: async (attachment) =>
							(
								await readPrivateEmailAttachment(
									env,
									attachment.id,
									metadata.workspace_id,
									actorId,
									conversationId,
								)
							)?.bytes ?? null,
					},
					emailSender: { send: (payload) => env.EMAIL.send(payload) },
				},
				message,
			),
	};
}

export function outboundCommand(params: SendParams): string {
	return JSON.stringify({
		conversationId: params.conversationId,
		senderId: params.senderId,
		text: params.text.trim(),
		subject: params.subject ?? null,
		attachments: (params.attachments ?? []).map((a) => ({
			id: a.id,
			key: a.key,
			url: a.url,
			name: a.name,
			type: a.type,
			size: a.size,
		})),
		mailboxId: params.mailboxId ?? null,
		confirmPrivateIdentity: params.confirmPrivateIdentity === true,
	});
}
export async function intentMatchesCommand(
	env: Env,
	id: string,
	params: SendParams,
): Promise<boolean> {
	const row = await env.DB.prepare(
		"SELECT command_json,conversation_id,sender_id,text,subject,attachments_json FROM outbound_intents WHERE id=?",
	)
		.bind(id)
		.first<{
			command_json: string | null;
			conversation_id: string;
			sender_id: string;
			text: string;
			subject: string | null;
			attachments_json: string;
		}>();
	if (!row) return false;
	if (row.command_json) return row.command_json === outboundCommand(params);
	return (
		row.conversation_id === params.conversationId &&
		row.sender_id === params.senderId &&
		row.text === params.text.trim() &&
		row.subject === (params.subject ?? null) &&
		JSON.stringify(parseStoredAttachments(row.attachments_json)) ===
			JSON.stringify(params.attachments ?? []) &&
		!params.mailboxId &&
		!params.confirmPrivateIdentity
	);
}
async function insertBoundIntent(
	env: Env,
	id: string,
	params: SendParams,
	status: "pending" | "queued",
	now: string,
	meta: Omit<EmailOutboundMetadata, "intent_id" | "created_at"> | null = null,
): Promise<void> {
	const statements = [
		env.DB.prepare(
			`INSERT OR IGNORE INTO outbound_intents(id,conversation_id,text,attachments_json,subject,sender_id,status,scheduled_message_id,created_at,updated_at,command_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		).bind(
			id,
			params.conversationId,
			params.text.trim(),
			JSON.stringify(params.attachments ?? []),
			params.subject ?? null,
			params.senderId,
			status,
			status === "queued" ? id : null,
			now,
			now,
			outboundCommand(params),
		),
	];
	if (meta)
		statements.push(
			env.DB.prepare(
				`INSERT OR IGNORE INTO email_outbound_metadata(intent_id,workspace_id,receiving_mailbox_id,mailbox_id,from_address,to_address,in_reply_to,references_json,confirm_private_identity,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM outbound_intents WHERE id=? AND command_json=?)`,
			).bind(
				id,
				meta.workspace_id,
				meta.receiving_mailbox_id,
				meta.mailbox_id,
				meta.from_address,
				meta.to_address,
				meta.in_reply_to,
				meta.references_json,
				meta.confirm_private_identity,
				now,
				id,
				outboundCommand(params),
			),
		);
	await env.DB.batch(statements);
}
async function auditEmailDenial(env: Env, params: SendParams): Promise<void> {
	const receiving = await env.DB.prepare(
		"SELECT c.workspace_id,ch.external_id FROM conversations c JOIN channels ch ON ch.id=c.channel_id WHERE c.id=? AND ch.type='email'",
	)
		.bind(params.conversationId)
		.first<{ workspace_id: string; external_id: string }>();
	if (
		!receiving ||
		!(await canAccessMailbox(
			env,
			receiving.workspace_id,
			receiving.external_id,
			params.senderId,
		))
	)
		return;
	await env.DB.prepare(
		"INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at) VALUES(?,?,?,'outbound.denied',?,'{}',?)",
	)
		.bind(
			crypto.randomUUID(),
			receiving.workspace_id,
			params.senderId,
			params.conversationId,
			new Date().toISOString(),
		)
		.run();
}
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
	const response = await stub.fetch("https://do/append-message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(message),
	});
	if (!response.ok)
		throw new Error(`Conversation DO append failed (HTTP ${response.status})`);
}
