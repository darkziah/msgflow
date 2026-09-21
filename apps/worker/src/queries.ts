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
import type { ConversationSummary, TagSummary } from "@msgflow/contracts";
import {
	channels,
	contacts,
	conversationReads,
	conversationTags,
	conversations,
	tags,
} from "@msgflow/db";
import type { Env } from "./env";

// Fields shared by the list and single-conversation queries. The unread count
// (ADR 0015) is computed per agent: unread = message_count − last_read_seq.
const conversationColumns = {
	id: conversations.id,
	channelId: conversations.channelId,
	channelType: channels.type,
	channelDisplayName: channels.displayName,
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
): Promise<ConversationSummary[]> {
	const db = drizzle(env.DB);
	const q = opts.q?.trim();
	const conditions = [
		opts.status && opts.status !== "all"
			? eq(conversations.status, opts.status)
			: undefined,
		opts.inboxId ? eq(conversations.inboxId, opts.inboxId) : undefined,
		opts.assigneeId ? eq(conversations.assigneeId, opts.assigneeId) : undefined,
		opts.unassigned ? isNull(conversations.assigneeId) : undefined,
		opts.snoozed
			? and(
					eq(conversations.status, "open"),
					gt(conversations.snoozedUntil, new Date().toISOString()),
				)
			: undefined,
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

	const tagsByConversation = await loadTagsForConversations(
		db,
		rows.map((row) => row.id),
	);
	return rows.map((row) => toSummary(row, tagsByConversation[row.id] ?? []));
}

/** Single conversation (metadata + contact + agent unread) or null. */
export async function getConversation(
	env: Env,
	agentId: string,
	id: string,
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
		.where(eq(conversations.id, id))
		.get();

	if (!row) return null;
	const tagsByConversation = await loadTagsForConversations(db, [row.id]);
	return toSummary(row, tagsByConversation[row.id] ?? []);
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
