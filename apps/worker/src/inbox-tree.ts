import {
	channels,
	inboxChannels,
	inboxes,
	inboxMembers,
	mailboxDelegates,
	mailboxes,
	teamMembers,
	teams,
	workspaceMembers,
} from "@msgflow/db";
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { ManageError } from "./errors";

export const MAX_INBOX_TREE_DEPTH = 64;
type Db = ReturnType<typeof drizzle>;

/**
 * The single authorization primitive for inbox/sidebar selection. Archived
 * inboxes are deliberately omitted: archive hides a tree selection node; it
 * does not re-home its conversations. A separate lifecycle path may retain an
 * archived conversation, but cannot use it to expand a tree node.
 *
 * There is no persisted public/restricted column. Until one exists, the
 * accepted convention is: a shared inbox with any inbox_members grant is
 * restricted; one with no grants is workspace-shared.
 */
export async function getReadableInboxIds(
	db: Db,
	workspaceId: string,
	userId: string,
): Promise<string[]> {
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
	if (!member) return [];

	const rows = await db
		.select()
		.from(inboxes)
		.where(
			and(eq(inboxes.workspaceId, workspaceId), eq(inboxes.isArchived, false)),
		)
		.all();
	if (!rows.length) return [];
	const ids = rows.map((row) => row.id);
	const [
		grants,
		memberships,
		workspaceTeams,
		directMailboxes,
		legacyLinkedMailboxes,
	] = await Promise.all([
		db
			.select({ inboxId: inboxMembers.inboxId, userId: inboxMembers.userId })
			.from(inboxMembers)
			.where(inArray(inboxMembers.inboxId, ids))
			.all(),
		db
			.select({ teamId: teamMembers.teamId })
			.from(teamMembers)
			.where(eq(teamMembers.userId, userId))
			.all(),
		db
			.select({ id: teams.id })
			.from(teams)
			.where(eq(teams.workspaceId, workspaceId))
			.all(),
		// mailboxes.inbox_id is the current, authoritative association. It must
		// be consulted even when a mailbox has no legacy inbox_channels row.
		db
			.select({
				inboxId: mailboxes.inboxId,
				mailboxId: mailboxes.id,
				type: mailboxes.type,
				ownerUserId: mailboxes.ownerUserId,
				teamId: mailboxes.teamId,
			})
			.from(mailboxes)
			.where(
				and(
					eq(mailboxes.workspaceId, workspaceId),
					inArray(mailboxes.inboxId, ids),
				),
			)
			.all(),
		// Keep the historical channel-address linkage while existing data may
		// still rely on it. Direct and legacy rows are deduplicated below.
		db
			.select({
				inboxId: inboxChannels.inboxId,
				mailboxId: mailboxes.id,
				type: mailboxes.type,
				ownerUserId: mailboxes.ownerUserId,
				teamId: mailboxes.teamId,
			})
			.from(inboxChannels)
			.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
			.innerJoin(
				mailboxes,
				and(
					eq(mailboxes.workspaceId, workspaceId),
					eq(mailboxes.canonicalAddress, channels.externalId),
				),
			)
			.where(
				and(inArray(inboxChannels.inboxId, ids), eq(channels.type, "email")),
			)
			.all(),
	]);
	const linkedMailboxByInboxAndId = new Map<
		string,
		{
			inboxId: string;
			mailboxId: string;
			type: "private" | "shared";
			ownerUserId: string | null;
			teamId: string | null;
		}
	>();
	for (const mailbox of [...directMailboxes, ...legacyLinkedMailboxes]) {
		if (mailbox.inboxId !== null) {
			linkedMailboxByInboxAndId.set(`${mailbox.inboxId}:${mailbox.mailboxId}`, {
				inboxId: mailbox.inboxId,
				mailboxId: mailbox.mailboxId,
				type: mailbox.type,
				ownerUserId: mailbox.ownerUserId,
				teamId: mailbox.teamId,
			});
		}
	}
	const linkedMailboxes = Array.from(linkedMailboxByInboxAndId.values());
	const grantsByInbox = new Map<string, Set<string>>();
	for (const grant of grants) {
		const users = grantsByInbox.get(grant.inboxId) ?? new Set<string>();
		users.add(grant.userId);
		grantsByInbox.set(grant.inboxId, users);
	}
	const teamIds = new Set(memberships.map((row) => row.teamId));
	const validTeamIds = new Set(workspaceTeams.map((row) => row.id));
	const mailboxByInbox = new Map<string, typeof linkedMailboxes>();
	for (const mailbox of linkedMailboxes) {
		const list = mailboxByInbox.get(mailbox.inboxId) ?? [];
		list.push(mailbox);
		mailboxByInbox.set(mailbox.inboxId, list);
	}
	const privateMailboxIds = linkedMailboxes
		.filter((mailbox) => mailbox.type === "private")
		.map((mailbox) => mailbox.mailboxId);
	const delegates = privateMailboxIds.length
		? await db
				.select({ mailboxId: mailboxDelegates.mailboxId })
				.from(mailboxDelegates)
				.where(
					and(
						inArray(mailboxDelegates.mailboxId, privateMailboxIds),
						eq(mailboxDelegates.userId, userId),
					),
				)
				.all()
		: [];
	const delegateMailboxIds = new Set(delegates.map((row) => row.mailboxId));

	return rows
		.filter((inbox) => {
			const grantsForInbox = grantsByInbox.get(inbox.id) ?? new Set<string>();
			const inboxAllowed =
				inbox.visibilityType === "system" ||
				(inbox.visibilityType === "shared" &&
					(grantsForInbox.size === 0 || grantsForInbox.has(userId))) ||
				(inbox.visibilityType === "private" && grantsForInbox.has(userId)) ||
				(inbox.visibilityType === "team" &&
					inbox.teamId !== null &&
					validTeamIds.has(inbox.teamId) &&
					teamIds.has(inbox.teamId));
			if (!inboxAllowed) return false;
			// Every mailbox backing this inbox is an additional predicate. In
			// particular, private mailbox access needs owner/delegate *and* the
			// synchronized private inbox_members grant above.
			return (mailboxByInbox.get(inbox.id) ?? []).every((mailbox) =>
				mailbox.type === "private"
					? mailbox.ownerUserId === userId ||
						delegateMailboxIds.has(mailbox.mailboxId)
					: mailbox.teamId
						? // A team mailbox may only back its matching team inbox.
							inbox.visibilityType === "team" &&
							inbox.teamId === mailbox.teamId &&
							validTeamIds.has(mailbox.teamId) &&
							teamIds.has(mailbox.teamId)
						: // A no-team shared mailbox follows its linked inbox's
							// public/restricted policy: no grants means workspace-public.
							grantsForInbox.size === 0 || grantsForInbox.has(userId),
			);
		})
		.map((inbox) => inbox.id);
}

/** Returns root plus readable descendants in deterministic sibling order. */
export async function getInboxDescendantIds(
	db: Db,
	workspaceId: string,
	rootInboxId: string,
	readableInboxIds: ReadonlySet<string>,
): Promise<string[]> {
	const rows = await db
		.select({
			id: inboxes.id,
			parentInboxId: inboxes.parentInboxId,
			sortOrder: inboxes.sortOrder,
		})
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.orderBy(inboxes.sortOrder, inboxes.id)
		.all();
	const ids = new Set(rows.map((row) => row.id));
	if (!ids.has(rootInboxId)) throw new ManageError("inbox not found", 404);
	if (!readableInboxIds.has(rootInboxId)) {
		throw new ManageError("inbox is not readable", 403);
	}
	const children = new Map<string, string[]>();
	for (const row of rows) {
		if (row.parentInboxId === null) continue;
		if (!ids.has(row.parentInboxId)) {
			throw new ManageError("invalid inbox hierarchy", 409);
		}
		const list = children.get(row.parentInboxId) ?? [];
		list.push(row.id);
		children.set(row.parentInboxId, list);
	}
	const result: string[] = [];
	const visited = new Set<string>();
	const visit = (id: string, depth: number) => {
		if (visited.has(id)) throw new ManageError("invalid inbox hierarchy", 409);
		if (depth > MAX_INBOX_TREE_DEPTH)
			throw new ManageError("inbox hierarchy exceeds maximum depth", 409);
		visited.add(id);
		if (readableInboxIds.has(id)) result.push(id);
		for (const child of children.get(id) ?? []) visit(child, depth + 1);
	};
	visit(rootInboxId, 0);
	return result;
}

/** Validates a proposed navigation-only parent link defensively. */
export async function assertValidInboxParent(
	db: Db,
	workspaceId: string,
	inboxId: string,
	parentInboxId: string | null,
): Promise<void> {
	const rows = await db
		.select({ id: inboxes.id, parentInboxId: inboxes.parentInboxId })
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.all();
	const byId = new Map(rows.map((row) => [row.id, row]));
	if (!byId.has(inboxId)) throw new ManageError("inbox not found", 404);
	if (parentInboxId === null) return;
	if (parentInboxId === inboxId)
		throw new ManageError("an inbox cannot be its own parent", 409);
	if (!byId.has(parentInboxId))
		throw new ManageError("parent inbox not found", 404);
	const children = new Map<string, string[]>();
	for (const row of rows) {
		if (row.parentInboxId !== null && byId.has(row.parentInboxId)) {
			children.set(row.parentInboxId, [
				...(children.get(row.parentInboxId) ?? []),
				row.id,
			]);
		}
	}
	let deepestDescendant = 0;
	const descendants = new Set<string>();
	const walkDown = (id: string, depth: number) => {
		if (descendants.has(id))
			throw new ManageError("invalid inbox hierarchy", 409);
		if (depth > MAX_INBOX_TREE_DEPTH)
			throw new ManageError("inbox hierarchy exceeds maximum depth", 409);
		descendants.add(id);
		deepestDescendant = Math.max(deepestDescendant, depth);
		for (const child of children.get(id) ?? []) walkDown(child, depth + 1);
	};
	walkDown(inboxId, 0);
	if (descendants.has(parentInboxId))
		throw new ManageError("inbox parent would create a cycle", 409);
	let parentDepth = 0;
	const ancestors = new Set<string>();
	let current: string | null = parentInboxId;
	while (current !== null) {
		if (ancestors.has(current))
			throw new ManageError("invalid inbox hierarchy", 409);
		if (++parentDepth > MAX_INBOX_TREE_DEPTH)
			throw new ManageError("inbox hierarchy exceeds maximum depth", 409);
		ancestors.add(current);
		const ancestor = byId.get(current);
		if (!ancestor) throw new ManageError("invalid inbox hierarchy", 409);
		current = ancestor.parentInboxId;
	}
	if (parentDepth + deepestDescendant > MAX_INBOX_TREE_DEPTH) {
		throw new ManageError("inbox hierarchy exceeds maximum depth", 409);
	}
}
