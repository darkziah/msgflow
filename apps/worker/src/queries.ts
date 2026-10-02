import type {
	ConversationListResponse,
	ConversationSummary,
	TagSummary,
} from "@msgflow/contracts";
import {
	channels,
	contacts,
	conversationReads,
	conversations,
	conversationTags,
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
import { canReadConversation } from "./conversation-permissions";
import { conversationReadPredicate } from "./email-transport";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { getInboxDescendantIds, getReadableInboxIds } from "./inbox-tree";

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
	channelType: "facebook_page" | "email" | "whatsapp_phone";
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
		channel:
			row.channelType === "facebook_page"
				? "facebook"
				: row.channelType === "whatsapp_phone"
					? "whatsapp"
					: "email",
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
	/** Opaque keyset cursor for the last returned conversation. */
	cursor?: string;
	/** Page size, constrained to 1..100 (defaults to 50). */
	limit?: number;
	mailboxId?: string;
	status?: "open" | "archived" | "all";
	inboxId?: string;
	/** A tree-node selection resolved server-side; clients never submit id arrays. */
	inboxScope?: "exact" | "descendants";
	/** Free text: contact name/email, subject, last-message preview. */
	q?: string;
	assigneeId?: string;
	/** Open conversations with no assignee (sidebar "Unassigned" queue). */
	unassigned?: boolean;
	/** Open conversations snoozed until the future (sidebar "Snoozed" queue). */
	snoozed?: boolean;
	channel?: "facebook" | "email" | "whatsapp";
	channelId?: string;
	tagId?: string;
	savedViewId?: string;
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
): Promise<ConversationListResponse> {
	const db = drizzle(env.DB);
	const pageSize = validatePageSize(opts.limit);
	const initialCursor = opts.cursor === undefined ? undefined : decodeCursor(opts.cursor);
	if (!workspaceId) return { conversations: [], nextCursor: null };
	const readableInboxIds = await getReadableInboxIds(db, workspaceId, agentId);
	const readableInboxSet = new Set(readableInboxIds);
	let scopedInboxIds = readableInboxIds;
	if (opts.inboxId) {
		// A guessed, foreign, or inaccessible node has the same empty result as an
		// empty filter, so list selection cannot reveal hierarchy membership.
		if (!readableInboxSet.has(opts.inboxId))
			return { conversations: [], nextCursor: null };
		scopedInboxIds =
			opts.inboxScope === "descendants"
				? await getInboxDescendantIds(
						db,
						workspaceId,
						opts.inboxId,
						readableInboxSet,
					)
				: [opts.inboxId];
	}
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
		scopedInboxIds.length
			? inArray(conversations.inboxId, scopedInboxIds)
			: sql`0`,
		opts.mailboxId
			? sql`EXISTS (SELECT 1 FROM mailboxes m WHERE m.id = ${opts.mailboxId} AND m.workspace_id = ${conversations.workspaceId} AND m.canonical_address = ${channels.externalId} AND ${channels.type} = 'email')`
			: undefined,
		workspaceId ? eq(conversations.workspaceId, workspaceId) : undefined,
		opts.status && opts.status !== "all"
			? eq(conversations.status, opts.status)
			: undefined,
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
					({
						facebook: "facebook_page",
						email: "email",
						whatsapp: "whatsapp_phone",
					} as const)[opts.channel],
				)
			: undefined,
		opts.channelId
			? and(
					eq(conversations.channelId, opts.channelId),
					eq(channels.workspaceId, workspaceId),
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
		conversationReadPredicate(agentId),
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
			.where(
				and(
					...conditions,
					initialCursor ? conversationCursorPredicate(initialCursor) : undefined,
				),
			)
			.orderBy(
				sql`${conversations.lastMessageAt} IS NULL`,
				desc(conversations.lastMessageAt),
				desc(conversations.id),
			)
			.limit(pageSize + 1)
			.all();
	const hasMore = rows.length > pageSize;
	const visibleRows = rows.slice(0, pageSize);
	const tagsByConversation = await loadTagsForConversations(
		db,
		visibleRows.map((row) => row.id),
	);
	return {
		conversations: visibleRows.map((row) =>
			toSummary(row, tagsByConversation[row.id] ?? []),
		),
		nextCursor: hasMore ? encodeCursor(toCursor(visibleRows.at(-1)!)) : null,
	};
}

interface ConversationCursor {
	lastMessageAt: string | null;
	id: string;
}

function validatePageSize(limit: number | undefined): number {
	if (limit === undefined) return 50;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100)
		throw new ManageError("limit must be an integer between 1 and 100", 400);
	return limit;
}

function toCursor(row: Pick<ConversationRow, "lastMessageAt" | "id">): ConversationCursor {
	return { lastMessageAt: row.lastMessageAt, id: row.id };
}

function encodeCursor(cursor: ConversationCursor): string {
	const bytes = new TextEncoder().encode(JSON.stringify(cursor));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeCursor(value: string): ConversationCursor {
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
		const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
		const binary = atob(padded);
		const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
		if (
			typeof parsed !== "object" || parsed === null ||
			Object.keys(parsed).length !== 2 ||
			!("id" in parsed) || !("lastMessageAt" in parsed) ||
			typeof parsed.id !== "string" || parsed.id.length === 0 ||
			!(typeof parsed.lastMessageAt === "string" || parsed.lastMessageAt === null)
		) throw new Error("invalid cursor shape");
		return { id: parsed.id, lastMessageAt: parsed.lastMessageAt };
	} catch {
		throw new ManageError("invalid conversation cursor", 400);
	}
}

function conversationCursorPredicate(cursor: ConversationCursor) {
	if (cursor.lastMessageAt === null)
		return and(isNull(conversations.lastMessageAt), sql`${conversations.id} < ${cursor.id}`);
	return or(
		and(sql`${conversations.lastMessageAt} < ${cursor.lastMessageAt}`),
		and(eq(conversations.lastMessageAt, cursor.lastMessageAt), sql`${conversations.id} < ${cursor.id}`),
		isNull(conversations.lastMessageAt),
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
	if (!(await canReadConversation(env, agentId, id, workspaceId))) return null;
	const tagsByConversation = await loadTagsForConversations(db, [row.id]);
	return toSummary(row, tagsByConversation[row.id] ?? []);
}


/** Tags attached to the given conversations, keyed by conversation id. */
async function loadTagsForConversations(
	db: ReturnType<typeof drizzle>,
	conversationIds: string[],
): Promise<Record<string, TagSummary[]>> {
	if (conversationIds.length === 0) return {};
	// D1 rejects statements with more than 100 bound parameters. The inbox list
	// intentionally returns up to 100 conversations, so its tag projection must
	// be split before building the IN clause.
	const rows = (
		await Promise.all(
			chunk(conversationIds, 100).map((ids) =>
				db
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
					.where(inArray(conversationTags.conversationId, ids))
					.all(),
			),
		)
	).flat();
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

function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}
