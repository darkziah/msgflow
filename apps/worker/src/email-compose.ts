import {
	channels,
	contactIdentities,
	contacts,
	conversations,
	inboxChannels,
	inboxes,
	mailboxes,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { canonicalEnvelopeAddress, canAccessMailbox } from "./email-transport";
import type { Env } from "./env";
import { sendOutbound, type SendResult } from "./outbound";
import { notifyWorkspaceConversationChange } from "./workspace-events";

export interface ComposeEmailInput {
	workspaceId: string;
	actorId: string;
	to: string;
	subject: string;
	text: string;
	mailboxId: string;
	clientMessageId?: string;
}

/** Create a new email conversation and cross the outbound boundary once. */
export async function composeEmail(
	env: Env,
	input: ComposeEmailInput,
): Promise<SendResult & { conversationId?: string }> {
	const to = canonicalEnvelopeAddress(input.to);
	if (!to || /[\r\n]/.test(input.subject))
		return {
			ok: false,
			error: "invalid recipient or subject",
			retryable: false,
		};
	const db = drizzle(env.DB);
	const mailbox = await db
		.select({ mailbox: mailboxes, channel: channels, inbox: inboxes })
		.from(mailboxes)
		.innerJoin(
			channels,
			and(
				eq(channels.workspaceId, mailboxes.workspaceId),
				eq(channels.type, "email"),
				eq(channels.externalId, mailboxes.canonicalAddress),
				eq(channels.status, "active"),
			),
		)
		.leftJoin(inboxes, eq(inboxes.id, mailboxes.inboxId))
		.where(
			and(
				eq(mailboxes.id, input.mailboxId),
				eq(mailboxes.workspaceId, input.workspaceId),
			),
		)
		.get();
	if (!mailbox) {
		return {
			ok: false,
			error: "selected From mailbox unavailable or unauthorized",
			retryable: false,
		};
	}
	if (
		!mailbox.mailbox.isEnabled ||
		!mailbox.mailbox.isSendEnabled ||
		!(await canAccessMailbox(
			env,
			input.workspaceId,
			mailbox.mailbox.canonicalAddress,
			input.actorId,
		))
	) {
		return {
			ok: false,
			error: "selected From mailbox unavailable or unauthorized",
			retryable: false,
		};
	}
	const inboxId = mailbox.inbox?.isArchived ? null : mailbox.inbox?.id;
	const defaultInbox = inboxId
		? null
		: await db
				.select({ inboxId: inboxChannels.inboxId })
				.from(inboxChannels)
				.innerJoin(inboxes, eq(inboxes.id, inboxChannels.inboxId))
				.where(
					and(
						eq(inboxChannels.channelId, mailbox.channel.id),
						eq(inboxChannels.isDefault, true),
						eq(inboxes.isArchived, false),
					),
				)
				.get();
	const destinationInboxId = inboxId ?? defaultInbox?.inboxId;
	if (!destinationInboxId)
		return {
			ok: false,
			error: "selected From mailbox has no active inbox",
			retryable: false,
		};

	const now = new Date().toISOString();
	const existingIdentity = await db
		.select({ contactId: contactIdentities.contactId })
		.from(contactIdentities)
		.where(
			and(
				eq(contactIdentities.channelId, mailbox.channel.id),
				eq(contactIdentities.externalUserId, to),
			),
		)
		.get();
	const contactId = existingIdentity?.contactId ?? crypto.randomUUID();
	if (!existingIdentity) {
		await db.batch([
			db
				.insert(contacts)
				.values({
					id: contactId,
					workspaceId: input.workspaceId,
					primaryEmail: to,
					createdAt: now,
					updatedAt: now,
				}),
			db
				.insert(contactIdentities)
				.values({
					id: crypto.randomUUID(),
					contactId,
					channelId: mailbox.channel.id,
					channelType: "email",
					externalUserId: to,
					createdAt: now,
				}),
		]);
	}
	const conversationId = `email:${mailbox.mailbox.canonicalAddress}:${crypto.randomUUID()}`;
	await db
		.insert(conversations)
		.values({
			id: conversationId,
			workspaceId: input.workspaceId,
			channelId: mailbox.channel.id,
			inboxId: destinationInboxId,
			contactId,
			doBindingId: conversationId,
			subject: input.subject.trim() || null,
			status: "open",
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await notifyWorkspaceConversationChange(env, input.workspaceId);
	const result = await sendOutbound(env, {
		conversationId,
		text: input.text,
		subject: input.subject.trim(),
		senderId: input.actorId,
		clientMessageId: input.clientMessageId,
		mailboxId: mailbox.mailbox.id,
		emailMetadata: {
			workspace_id: input.workspaceId,
			receiving_mailbox_id: mailbox.mailbox.id,
			mailbox_id: mailbox.mailbox.id,
			from_address: mailbox.mailbox.canonicalAddress,
			to_address: to,
			in_reply_to: null,
			references_json: "[]",
			confirm_private_identity: 0,
		},
	});
	return result.ok ? { ...result, conversationId } : result;
}
