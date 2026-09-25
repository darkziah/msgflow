import type { ConversationSummary, TagSummary } from "@msgflow/contracts";
import {
	channels,
	contacts,
	conversationReads,
	conversations,
	conversationTags,
	mailboxes,
	tags,
} from "@msgflow/db";
import {
	and,
	desc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNull,
	like,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { canAccessMailbox, conversationReadPredicate } from "./email-transport";
import type { Env } from "./env";

// Fields shared by the list and single-conversation queries. The unread count
// (ADR 0015) is computed per agent: unread = message_count − last_read_seq.
const conversationColumns = {
	id: conversations.id,
	channelId: conversations.channelId,
	channelType: channels.type,
	channelDisplayName: channels.displayName,
	channelExternalId: channels.externalId,
	inboxId: conversations.inboxId,
	subject: conversations.subject,
	status: conversations.status,
	assigneeId: conversations.assigneeId,
	lastMessageAt: conversations.lastMessageAt,
	lastMessagePreview: conversations.lastMessagePreview,
	messageCount: conversations.messageCount,
	snoozedUntil: conversations.snoozedUntil,
	createdAt: conversations.createdAt,
	updatedAt: conversations.updatedAt,
	contactId: contacts.id,
	contactDisplayName: contacts.displayName,
	contactPrimaryEmail: contacts.primaryEmail,
	contactAvatarUrl: contacts.avatarUrl,
	lastReadSeq: conversationReads.lastReadSeq,
} as const;

interface ConversationRow {
	id: string;
	channelId: string;
	channelType: "facebook_page" | "email";
	channelDisplayName: string;
	channelExternalId: string;
	inboxId: string;
	subject: string | null;
	status: "open" | "archived";
	assigneeId: string | null;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
	messageCount: number;
	snoozedUntil: string | null;
	createdAt: string;
	updatedAt: string;
	contactId: string;
	contactDisplayName: string | null;
	contactPrimaryEmail: string | null;
	contactAvatarUrl: string | null;
	lastReadSeq: number | null;
}

function toSummary(
	row: ConversationRow,
	rowTags: TagSummary[] = [],
): ConversationSummary {
	return {
		id: row.id,
		channel: row.channelType === "facebook_page" ? "facebook" : "email",
		channelId: row.channelId,
		channelDisplayName: row.channelDisplayName,
		inboxId: row.inboxId,
		subject: row.subject,
		status: row.status,
		assigneeId: row.assigneeId,
		contact: {
			id: row.contactId,
			displayName: row.contactDisplayName,
			primaryEmail: row.contactPrimaryEmail,
			avatarUrl: row.contactAvatarUrl,
		},
		lastMessageAt: row.lastMessageAt,
		lastMessagePreview: row.lastMessagePreview,
		messageCount: row.messageCount,
		unreadCount: Math.max(0, row.messageCount - (row.lastReadSeq ?? 0)),
		snoozedUntil: row.snoozedUntil,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		tags: rowTags,
	};
}

/** Faceted search filters (ADR 0013): q, assignee, channel, tag, date range. */
export interface ConversationListOptions {
	mailboxId?: string;
	status?: "open" | "archived" | "all";
	inboxId?: string;
	/** Free text: contact name/email, subject, last-message preview. */
	q?: string;
	assigneeId?: string;
	/** Open conversations with no assignee (sidebar "Unassigned" queue). */
	unassigned?: boolean;
	/** Open conversations snoozed until the future (sidebar "Snoozed" queue). */
	snoozed?: boolean;
	channel?: "facebook" | "email";
	tagId?: string;
	/** ISO date range bound on lastMessageAt (inclusive). */
	dateFrom?: string;
	dateTo?: string;
}

/**
 * Inbox list — D1 is authoritative for conversation metadata, so this is a
 * plain D1 read (no DO fan-out). Ordered by last activity, newest first.
 * Supports the ADR 0013 facets: free-text q, assignee, channel, tag, date range.
 */
export async function listConversations(
	env: Env,
	agentId: string,
	opts: ConversationListOptions = {},
	workspaceId?: string,
): Promise<ConversationSummary[]> {
	const db = drizzle(env.DB);
	const q = opts.q?.trim();
	const now = new Date().toISOString();
	// Future-snoozed open conversations belong exclusively to the Snoozed
	// virtual queue. Archived conversations remain discoverable even if they
	// retain a stale snooze timestamp.
	const visibleOutsideSnoozedQueue = or(
		eq(conversations.status, "archived"),
		isNull(conversations.snoozedUntil),
		lte(conversations.snoozedUntil, now),
	);
	const conditions = [
		conversationReadPredicate(agentId),
		opts.mailboxId
			? sql`EXISTS (SELECT 1 FROM mailboxes m WHERE m.id = ${opts.mailboxId} AND m.workspace_id = ${conversations.workspaceId} AND m.canonical_address = ${channels.externalId} AND ${channels.type} = 'email')`
			: undefined,
		workspaceId ? eq(conversations.workspaceId, workspaceId) : undefined,
		opts.status && opts.status !== "all"
			? eq(conversations.status, opts.status)
			: undefined,
		opts.inboxId ? eq(conversations.inboxId, opts.inboxId) : undefined,
		opts.assigneeId ? eq(conversations.assigneeId, opts.assigneeId) : undefined,
		opts.unassigned ? isNull(conversations.assigneeId) : undefined,
		opts.snoozed
			? and(
					eq(conversations.status, "open"),
					gt(conversations.snoozedUntil, now),
				)
			: visibleOutsideSnoozedQueue,
		opts.channel
			? eq(
					channels.type,
					opts.channel === "facebook" ? "facebook_page" : "email",
				)
			: undefined,
		opts.tagId
			? exists(
					db
						.select({ id: conversationTags.id })
						.from(conversationTags)
						.where(
							and(
								eq(conversationTags.conversationId, conversations.id),
								eq(conversationTags.tagId, opts.tagId),
							),
						),
				)
			: undefined,
		q
			? or(
					like(contacts.displayName, `%${q}%`),
					like(contacts.primaryEmail, `%${q}%`),
					like(conversations.subject, `%${q}%`),
					like(conversations.lastMessagePreview, `%${q}%`),
				)
			: undefined,
		opts.dateFrom ? gte(conversations.lastMessageAt, opts.dateFrom) : undefined,
		opts.dateTo ? lte(conversations.lastMessageAt, opts.dateTo) : undefined,
	];

	const rows = await db
		.select(conversationColumns)
		.from(conversations)
		.innerJoin(channels, eq(conversations.channelId, channels.id))
		.innerJoin(contacts, eq(conversations.contactId, contacts.id))
		.leftJoin(
			conversationReads,
			and(
				eq(conversationReads.conversationId, conversations.id),
				eq(conversationReads.agentId, agentId),
			),
		)
		.where(and(...conditions))
		.orderBy(
			sql`${conversations.lastMessageAt} IS NULL`,
			desc(conversations.lastMessageAt),
		)
		.limit(200)
		.all();

	const visibleRows = await filterMailboxAccess(
		env,
		agentId,
		workspaceId,
		rows,
	);
	const tagsByConversation = await loadTagsForConversations(
		db,
		visibleRows.map((row) => row.id),
	);
	return visibleRows.map((row) =>
		toSummary(row, tagsByConversation[row.id] ?? []),
	);
}

/** Single conversation (metadata + contact + agent unread) or null. */
export async function getConversation(
	env: Env,
	agentId: string,
	id: string,
	workspaceId?: string,
): Promise<ConversationSummary | null> {
	const db = drizzle(env.DB);
	const row = await db
		.select(conversationColumns)
		.from(conversations)
		.innerJoin(channels, eq(conversations.channelId, channels.id))
		.innerJoin(contacts, eq(conversations.contactId, contacts.id))
		.leftJoin(
			conversationReads,
			and(
				eq(conversationReads.conversationId, conversations.id),
				eq(conversationReads.agentId, agentId),
			),
		)
		.where(
			workspaceId
				? and(
						eq(conversations.id, id),
						eq(conversations.workspaceId, workspaceId),
					)
				: eq(conversations.id, id),
		)
		.get();

	if (!row) return null;
	if (!(await canReadConversation(env, agentId, workspaceId, row))) return null;
	const tagsByConversation = await loadTagsForConversations(db, [row.id]);
	return toSummary(row, tagsByConversation[row.id] ?? []);
}

async function filterMailboxAccess(
	env: Env,
	userId: string,
	workspaceId: string | undefined,
	rows: ConversationRow[],
): Promise<ConversationRow[]> {
	return (
		await Promise.all(
			rows.map(async (row) =>
				(await canReadConversation(env, userId, workspaceId, row)) ? row : null,
			),
		)
	).filter((row): row is ConversationRow => row !== null);
}

async function canReadConversation(
	env: Env,
	userId: string,
	workspaceId: string | undefined,
	row: ConversationRow,
): Promise<boolean> {
	if (row.channelType !== "email") return true;
	if (!workspaceId) return false;
	// Logical mailbox rows carry private/team visibility rules and must always
	// pass that authorization. Channels created before logical mailboxes existed
	// retain the existing workspace-scoped visibility model; hiding them would
	// make established queues (including Snoozed) disappear during migration.
	const mailbox = await drizzle(env.DB)
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(
			and(
				eq(mailboxes.workspaceId, workspaceId),
				eq(mailboxes.canonicalAddress, row.channelExternalId),
			),
		)
		.get();
	return (
		!mailbox ||
		canAccessMailbox(env, workspaceId, row.channelExternalId, userId)
	);
}

/** Tags attached to the given conversations, keyed by conversation id. */
async function loadTagsForConversations(
	db: ReturnType<typeof drizzle>,
	conversationIds: string[],
): Promise<Record<string, TagSummary[]>> {
	if (conversationIds.length === 0) return {};
	const rows = await db
		.select({
			conversationId: conversationTags.conversationId,
			id: tags.id,
			name: tags.name,
			color: tags.color,
			visibility: tags.visibility,
			parentTagId: tags.parentTagId,
			ownerUserId: tags.ownerUserId,
			createdAt: tags.createdAt,
		})
		.from(conversationTags)
		.innerJoin(tags, eq(conversationTags.tagId, tags.id))
		.where(inArray(conversationTags.conversationId, conversationIds))
		.all();
	const byConversation: Record<string, TagSummary[]> = {};
	for (const row of rows) {
		const list = byConversation[row.conversationId];
		if (list) {
			list.push({
				id: row.id,
				name: row.name,
				color: row.color,
				visibility: row.visibility,
				parentTagId: row.parentTagId,
				ownerUserId: row.ownerUserId,
				createdAt: row.createdAt,
			});
		} else {
			byConversation[row.conversationId] = [
				{
					id: row.id,
					name: row.name,
					color: row.color,
					visibility: row.visibility,
					parentTagId: row.parentTagId,
					ownerUserId: row.ownerUserId,
					createdAt: row.createdAt,
				},
			];
		}
	}
	return byConversation;
}
