import {
	channels,
	conversations,
	emailDomains,
	inboxChannels,
	inboxes,
	inboxMembers,
	mailboxDelegates,
	mailboxes,
	teamMembers,
	workspaceMembers,
} from "@msgflow/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { canonicalAddress } from "./email-address";
import type { Env } from "./env";

export interface AuthorizedEmailInboundRoute {
	workspaceId: string;
	mailboxId: string;
	canonicalAddress: string;
	channelId: string;
	inboxId: string;
}

export type EmailTransportResolution =
	| { ok: true; route: AuthorizedEmailInboundRoute }
	| { ok: false; reason: string };

/**
 * Canonicalize only a Cloudflare envelope address. Header recipients are
 * untrusted and may contain display names or multiple addresses.
 */
export function canonicalEnvelopeAddress(address: string): string | null {
	const trimmed = address.trim();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0 || at !== trimmed.indexOf("@") || at === trimmed.length - 1) {
		return null;
	}
	try {
		return canonicalAddress(trimmed.slice(0, at), trimmed.slice(at + 1));
	} catch {
		return null;
	}
}

/**
 * Resolve an envelope recipient to an enabled, inbound-ready logical mailbox.
 *
 * Phase 2 intentionally requires a pre-provisioned active email channel and a
 * non-archived inbox. Mailboxes do not yet own channel rows, so creating either
 * here would bypass configuration and reintroduce legacy lazy ingress.
 */
export async function resolveInboundEmailRoute(
	env: Env,
	envelopeTo: string,
): Promise<EmailTransportResolution> {
	const canonical = canonicalEnvelopeAddress(envelopeTo);
	if (!canonical) return { ok: false, reason: "invalid recipient address" };
	const db = drizzle(env.DB);
	const mailbox = await db
		.select({ mailbox: mailboxes, domain: emailDomains })
		.from(mailboxes)
		.innerJoin(emailDomains, eq(mailboxes.emailDomainId, emailDomains.id))
		.where(eq(mailboxes.canonicalAddress, canonical))
		.get();
	if (
		!mailbox?.mailbox.isEnabled ||
		mailbox.domain.inboundState !== "ready" ||
		mailbox.domain.outboundState === "suspended"
	) {
		return { ok: false, reason: "recipient mailbox is unavailable" };
	}
	if (mailbox.mailbox.workspaceId !== mailbox.domain.workspaceId) {
		return { ok: false, reason: "recipient mailbox is unavailable" };
	}
	const defaultLink = await db
		.select({ inboxId: inboxChannels.inboxId })
		.from(inboxChannels)
		.innerJoin(channels, eq(channels.id, inboxChannels.channelId))
		.where(
			and(
				eq(channels.workspaceId, mailbox.mailbox.workspaceId),
				eq(channels.externalId, canonical),
				eq(inboxChannels.isDefault, true),
			),
		)
		.get();
	const routeInboxId =
		mailbox.mailbox.type === "private"
			? defaultLink?.inboxId
			: mailbox.mailbox.inboxId;
	if (!routeInboxId)
		return { ok: false, reason: "mailbox transport is not provisioned" };
	const [channel, inbox] = await Promise.all([
		db
			.select({ id: channels.id })
			.from(channels)
			.where(
				and(
					eq(channels.workspaceId, mailbox.mailbox.workspaceId),
					eq(channels.type, "email"),
					eq(channels.externalId, canonical),
					eq(channels.status, "active"),
				),
			)
			.get(),
		db
			.select({ id: inboxes.id })
			.from(inboxes)
			.where(
				and(
					eq(inboxes.id, routeInboxId),
					eq(inboxes.workspaceId, mailbox.mailbox.workspaceId),
					eq(inboxes.isArchived, false),
				),
			)
			.get(),
	]);
	if (!channel || !inbox) {
		return { ok: false, reason: "mailbox transport is not provisioned" };
	}
	return {
		ok: true,
		route: {
			workspaceId: mailbox.mailbox.workspaceId,
			mailboxId: mailbox.mailbox.id,
			canonicalAddress: canonical,
			channelId: channel.id,
			inboxId: inbox.id,
		},
	};
}

export async function authorizeIncomingEmail(
	env: Env,
	message: { to: string; setReject(reason: string): void },
): Promise<AuthorizedEmailInboundRoute | null> {
	const route = await resolveInboundEmailRoute(env, message.to);
	if (!route.ok) {
		// Cloudflare Email Workers documents setReject(reason) for SMTP rejection.
		message.setReject(`550 ${route.reason}`);
		return null;
	}
	return route.route;
}

/** Active mailbox permission: private owner/delegate, or shared team member. */
export async function canAccessMailbox(
	env: Env,
	workspaceId: string,
	canonicalAddress: string,
	userId: string,
): Promise<boolean> {
	const db = drizzle(env.DB);
	const mailbox = await db
		.select()
		.from(mailboxes)
		.where(
			and(
				eq(mailboxes.workspaceId, workspaceId),
				eq(mailboxes.canonicalAddress, canonicalAddress),
			),
		)
		.get();
	if (!mailbox) return false;
	const member = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(
			and(
				eq(workspaceMembers.workspaceId, workspaceId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.get();
	if (!member) return false;
	if (mailbox.type === "private") {
		if (mailbox.ownerUserId === userId) return true;
		return !!(await db
			.select({ mailboxId: mailboxDelegates.mailboxId })
			.from(mailboxDelegates)
			.where(
				and(
					eq(mailboxDelegates.mailboxId, mailbox.id),
					eq(mailboxDelegates.userId, userId),
				),
			)
			.get());
	}
	// A shared mailbox needs an explicit inbox grant OR its linked team grant.
	if (
		mailbox.inboxId &&
		(await db
			.select({ id: inboxMembers.id })
			.from(inboxMembers)
			.where(
				and(
					eq(inboxMembers.inboxId, mailbox.inboxId),
					eq(inboxMembers.userId, userId),
				),
			)
			.get())
	)
		return true;
	return !!(
		mailbox.teamId &&
		(await db
			.select({ teamId: teamMembers.teamId })
			.from(teamMembers)
			.where(
				and(
					eq(teamMembers.teamId, mailbox.teamId),
					eq(teamMembers.userId, userId),
				),
			)
			.get())
	);
}

/** Authorize the server-derived From mailbox for an email conversation. */
export async function authorizeEmailOutbound(
	env: Env,
	conversationId: string,
	userId: string,
	senderMailboxId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const db = drizzle(env.DB);
	const row = await db
		.select({
			conversation: conversations,
			channel: channels,
			mailbox: mailboxes,
			domain: emailDomains,
		})
		.from(conversations)
		.innerJoin(channels, eq(conversations.channelId, channels.id))
		.leftJoin(
			mailboxes,
			and(
				eq(mailboxes.workspaceId, conversations.workspaceId),
				eq(mailboxes.canonicalAddress, channels.externalId),
			),
		)
		.leftJoin(emailDomains, eq(mailboxes.emailDomainId, emailDomains.id))
		.where(eq(conversations.id, conversationId))
		.get();
	if (!row) return { ok: false, error: "conversation not found" };
	if (row.channel.type !== "email") return { ok: true };
	if (
		!row.mailbox ||
		!row.domain ||
		row.mailbox.workspaceId !== row.conversation.workspaceId ||
		row.domain.workspaceId !== row.conversation.workspaceId
	) {
		return {
			ok: false,
			error: "email mailbox is not provisioned for this conversation",
		};
	}
	if (senderMailboxId && senderMailboxId !== row.mailbox.id)
		return {
			ok: false,
			error: "reply From must match the conversation mailbox",
		};
	if (
		row.channel.status !== "active" ||
		!row.mailbox.isEnabled ||
		!row.mailbox.isSendEnabled ||
		row.domain.outboundState !== "ready" ||
		row.domain.inboundState === "suspended"
	) {
		return { ok: false, error: "email mailbox is not outbound-ready" };
	}
	if (
		!(await canAccessMailbox(
			env,
			row.conversation.workspaceId,
			row.mailbox.canonicalAddress,
			userId,
		))
	) {
		return { ok: false, error: "you do not have access to this mailbox" };
	}
	return { ok: true };
}

/** Correlated SQL grant; deliberately independent of lifecycle for historical reads. */
export function mailboxReadPredicate(userId: string) {
	return sql`EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = mailboxes.workspace_id AND wm.user_id = ${userId}) AND (
	 (mailboxes.type = 'private' AND (mailboxes.owner_user_id = ${userId} OR EXISTS (SELECT 1 FROM mailbox_delegates md WHERE md.mailbox_id = mailboxes.id AND md.user_id = ${userId}))) OR
	 (mailboxes.type = 'shared' AND ((mailboxes.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = mailboxes.team_id AND tm.user_id = ${userId})) OR
	 (EXISTS (SELECT 1 FROM inbox_members im WHERE im.inbox_id = mailboxes.inbox_id AND im.user_id = ${userId})))))`;
}

export function conversationReadPredicate(userId: string) {
	return sql`NOT EXISTS (SELECT 1 FROM channels c JOIN mailboxes ON mailboxes.canonical_address = c.external_id AND mailboxes.workspace_id = conversations.workspace_id WHERE c.id = conversations.channel_id AND c.type = 'email' AND NOT (${mailboxReadPredicate(userId)}))`;
}
