import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type {
	SavedFilterCreateRequest,
	SavedFilterFilters,
	SavedFilterSummary,
	SidebarGroup,
	SidebarInboxItem,
	SidebarItem,
	SidebarPreferences,
	SidebarPreferencesUpdate,
	SidebarResponse,
	SidebarSection,
	SidebarTagItem,
	WorkspaceSummary,
} from "@msgflow/contracts";
import {
	channels,
	conversationTags,
	conversations,
	inboxChannels,
	inboxes,
	savedFilters,
	tags,
	teams,
	userSidebarPreferences,
	workspaces,
} from "@msgflow/db";
import type { Env } from "./env";
import {
	requireWorkspaceAccess,
	listUserWorkspaces,
	userBelongsToWorkspace,
	getWorkspaceAccess,
} from "./access";
import { getOrCreateWorkspace } from "./workspace";
import { ManageError } from "./errors";

/**
 * Workspace-scoped inbox-routing surface: the left sidebar (Front-style),
 * per-user sidebar preferences, and saved filters ("Views").
 *
 * The sidebar is a pure read shape: sections, groups, stable item ids, counts
 * (scoped to the user's permitted inboxes), permissions, and the user's
 * personal preferences. The client applies preferences (collapse/pin/hide/
 * local order) on top; it never writes shared state through them.
 */

const ITEM_ID_RE = /^(system|inbox|tag|view):/;
// Section keys are NOT item ids — they are the sidebar section identifiers.
const SECTION_KEYS = new Set(["inbox", "assigned", "teams", "tags", "views"]);
const FILTER_KEYS = new Set([
	"status",
	"inboxId",
	"q",
	"assigneeId",
	"unassigned",
	"snoozed",
	"channel",
	"tagId",
	"dateFrom",
	"dateTo",
]);

export async function getSidebar(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<SidebarResponse> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, userId);
	const ws = await db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
	if (!ws) throw new ManageError("workspace not found", 404);

	const now = new Date().toISOString();
	// Future-snoozed open conversations are counted only by the Snoozed virtual
	// queue. Archived work remains visible in Closed even with a stale snooze.
	const visibleOutsideSnoozedQueue = or(
		eq(conversations.status, "archived"),
		isNull(conversations.snoozedUntil),
		lte(conversations.snoozedUntil, now),
	);

	const allInboxes = await db
		.select()
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.orderBy(asc(inboxes.sortOrder), asc(inboxes.name))
		.all();
	const allInboxIds = allInboxes.map((row) => row.id);

	const [links, teamRows] = await Promise.all([
		db
			.select({
				inboxId: inboxChannels.inboxId,
				channelId: inboxChannels.channelId,
				isDefault: inboxChannels.isDefault,
				channelType: channels.type,
			})
			.from(inboxChannels)
			.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
			.where(inArray(inboxChannels.inboxId, allInboxIds))
			.all(),
		db
			.select({ id: teams.id, name: teams.name })
			.from(teams)
			.where(eq(teams.workspaceId, workspaceId))
			.all(),
	]);
	const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

	const channelTypeByInbox = new Map<string, Set<"facebook_page" | "email">>();
	for (const link of links) {
		const set = channelTypeByInbox.get(link.inboxId) ?? new Set();
		set.add(link.channelType);
		channelTypeByInbox.set(link.inboxId, set);
	}

	// Visibility: admins see every inbox; members see inboxes they joined or
	// have an open conversation assigned to them inside (the never-remove rule
	// keeps those visible even after archiving/hiding until resolved).
	const openAssigned = await db
		.select({ inboxId: conversations.inboxId })
		.from(conversations)
		.where(
			and(
				eq(conversations.assigneeId, userId),
				eq(conversations.status, "open"),
				inArray(conversations.inboxId, allInboxIds),
			),
		)
		.all();
	const openAssignedInboxIds = new Set(openAssigned.map((row) => row.inboxId));

	// Visibility: every workspace member sees all non-archived inboxes. This
	// matches the app's read model (the conversation list is workspace-scoped,
	// not inbox-membership-scoped), so the sidebar can never hide an inbox that
	// the list would still show. Archived inboxes stay visible only when the
	// user has an open conversation assigned inside them (the never-remove
	// rule: an inbox with assigned work is never taken off the sidebar until
	// that work is resolved or reassigned).
	const visibleInboxIds = new Set(
		allInboxes.filter((row) => !row.isArchived).map((row) => row.id),
	);
	const countInboxIds = new Set([...visibleInboxIds, ...openAssignedInboxIds]);

	// Counts, scoped to the visible inbox set.
	const [
		openCounts,
		allCount,
		assignedCount,
		unassignedCount,
		snoozedCount,
		closedCount,
		tagCounts,
	] = await Promise.all([
		db
			.select({
				inboxId: conversations.inboxId,
				count: sqlCount(),
			})
			.from(conversations)
			.where(
				and(
					inArray(conversations.inboxId, [...countInboxIds]),
					eq(conversations.status, "open"),
					visibleOutsideSnoozedQueue,
				),
			)
			.groupBy(conversations.inboxId)
			.all(),
		countWhere(db, [
			inArray(conversations.inboxId, [...countInboxIds]),
			visibleOutsideSnoozedQueue,
		]),
		countWhere(db, [
			inArray(conversations.inboxId, [...countInboxIds]),
			eq(conversations.status, "open"),
			eq(conversations.assigneeId, userId),
			visibleOutsideSnoozedQueue,
		]),
		countWhere(db, [
			inArray(conversations.inboxId, [...visibleInboxIds]),
			eq(conversations.status, "open"),
			isNull(conversations.assigneeId),
			visibleOutsideSnoozedQueue,
		]),
		countWhere(db, [
			inArray(conversations.inboxId, [...countInboxIds]),
			eq(conversations.status, "open"),
			gt(conversations.snoozedUntil, now),
		]),
		countWhere(db, [
			inArray(conversations.inboxId, [...countInboxIds]),
			eq(conversations.status, "archived"),
		]),
		db
			.select({
				tagId: conversationTags.tagId,
				count: sqlCount(),
			})
			.from(conversationTags)
			.innerJoin(
				conversations,
				eq(conversationTags.conversationId, conversations.id),
			)
			.where(
				and(
					inArray(conversations.inboxId, [...countInboxIds]),
					eq(conversations.status, "open"),
					visibleOutsideSnoozedQueue,
				),
			)
			.groupBy(conversationTags.tagId)
			.all(),
	]);

	const countByInbox = new Map(
		openCounts.map((row) => [row.inboxId, row.count ?? 0]),
	);
	const tagCountById = new Map(
		tagCounts.map((row) => [row.tagId, row.count ?? 0]),
	);

	// Inbox items visible in navigation (archived hidden unless open-assigned).
	const inboxItemById = new Map<string, SidebarInboxItem>();
	for (const row of allInboxes) {
		const keepVisible =
			visibleInboxIds.has(row.id) ||
			(row.isArchived && openAssignedInboxIds.has(row.id));
		if (!keepVisible) continue;
		const item: SidebarInboxItem = {
			kind: "inbox",
			id: `inbox:${row.id}`,
			label: row.name,
			inboxId: row.id,
			color: row.color,
			icon: row.icon,
			teamId: row.teamId,
			isArchived: row.isArchived,
			isDefault: links.some(
				(link) => link.inboxId === row.id && link.isDefault,
			),
			count: countByInbox.get(row.id) ?? 0,
			hasOpenAssigned: openAssignedInboxIds.has(row.id),
		};
		inboxItemById.set(row.id, item);
	}

	// Inbox section: All Messages + channel-type groups (+ linkless "General").
	const inboxItems: SidebarItem[] = [
		{
			kind: "system",
			id: "system:all",
			label: "All Messages",
			count: allCount,
		},
	];
	const inboxGroups: SidebarGroup[] = [];
	const groupMap = new Map<string, SidebarInboxItem[]>();
	for (const item of inboxItemById.values()) {
		const types = channelTypeByInbox.get(item.inboxId);
		if (!types || types.size === 0) {
			groupMap.set("general", [...(groupMap.get("general") ?? []), item]);
			continue;
		}
		for (const type of types) {
			groupMap.set(type, [...(groupMap.get(type) ?? []), item]);
		}
	}
	for (const [type, label] of [
		["facebook_page", "Facebook"],
		["email", "Email"],
		["general", "General"],
	] as const) {
		const items = groupMap.get(type);
		if (!items || items.length === 0) continue;
		inboxGroups.push({ id: `channel:${type}`, label, items });
	}

	// Assigned section: the four virtual queues.
	const assignedItems: SidebarItem[] = [
		{
			kind: "system",
			id: "system:assigned-to-me",
			label: "My open conversations",
			count: assignedCount,
		},
		{
			kind: "system",
			id: "system:unassigned",
			label: "Unassigned",
			count: unassignedCount,
		},
		{
			kind: "system",
			id: "system:snoozed",
			label: "Snoozed",
			count: snoozedCount,
		},
		{
			kind: "system",
			id: "system:closed",
			label: "Closed",
			count: closedCount,
		},
	];

	// Teams section: inboxes grouped by their team.
	const teamGroups: SidebarGroup[] = [];
	const byTeam = new Map<string, SidebarInboxItem[]>();
	for (const item of inboxItemById.values()) {
		if (!item.teamId) continue;
		const list = byTeam.get(item.teamId) ?? [];
		list.push(item);
		byTeam.set(item.teamId, list);
	}
	for (const [teamId, items] of byTeam) {
		const name = teamNameById.get(teamId) ?? "Team";
		teamGroups.push({ id: `team:${teamId}`, label: name, items });
	}

	// Tags section: root tags as items; parents with children become groups.
	const tagRows = await db
		.select()
		.from(tags)
		.where(eq(tags.workspaceId, workspaceId))
		.orderBy(asc(tags.name))
		.all();
	const tagItems: SidebarItem[] = [];
	const tagGroups: SidebarGroup[] = [];
	const childrenByParent = new Map<string, typeof tagRows>();
	for (const tag of tagRows) {
		if (tag.parentTagId) {
			const list = childrenByParent.get(tag.parentTagId) ?? [];
			list.push(tag);
			childrenByParent.set(tag.parentTagId, list);
		} else {
			const hasChildren = tagRows.some((t) => t.parentTagId === tag.id);
			if (!hasChildren) {
				tagItems.push(toTagItem(tag, tagCountById));
			}
		}
	}
	for (const [parentId, children] of childrenByParent) {
		const parent = tagRows.find((t) => t.id === parentId);
		if (!parent) continue;
		tagGroups.push({
			id: `tag:${parentId}`,
			label: parent.name,
			items: children.map((child) => toTagItem(child, tagCountById)),
		});
	}
	// Childless roots with children already handled above; parents appear as
	// group headers only (Front-style). Sort groups by parent name.

	// Views section: saved filters.
	const filterRows = await db
		.select()
		.from(savedFilters)
		.where(eq(savedFilters.workspaceId, workspaceId))
		.orderBy(asc(savedFilters.name))
		.all();
	const viewItems: SidebarItem[] = filterRows.map((row) => ({
		kind: "view",
		id: `view:${row.id}`,
		label: row.name,
	}));

	const preferences = await loadPreferences(db, workspaceId, userId);

	const sections: SidebarSection[] = [
		{ key: "inbox", label: "Inbox", items: inboxItems, groups: inboxGroups },
		{
			key: "assigned",
			label: "Assigned to me",
			items: assignedItems,
			groups: [],
		},
		{ key: "teams", label: "Teams", items: [], groups: teamGroups },
		{ key: "tags", label: "Tags", items: tagItems, groups: tagGroups },
		{ key: "views", label: "Views", items: viewItems, groups: [] },
	];

	return {
		workspace: { id: ws.id, name: ws.name, slug: ws.slug },
		permissions: { isAdmin: access.isAdmin },
		preferences,
		sections,
	};
}

function toTagItem(
	tag: typeof tags.$inferSelect,
	tagCountById: Map<string, number>,
): SidebarTagItem {
	return {
		kind: "tag",
		id: `tag:${tag.id}`,
		label: tag.name,
		color: tag.color ?? null,
		count: tagCountById.get(tag.id) ?? 0,
	};
}

async function countWhere(
	db: ReturnType<typeof drizzle>,
	conditions: Parameters<typeof and>[0][],
): Promise<number> {
	const row = await db
		.select({ c: sqlCount() })
		.from(conversations)
		.where(and(...conditions))
		.get();
	return row?.c ?? 0;
}

function sqlCount() {
	return sql<number>`count(*)`;
}

// ---------------------------------------------------------------------------
// SIDEBAR PREFERENCES (personal UI state; never shared routing/config)
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES: SidebarPreferences = {
	collapsedSections: [],
	pinnedItemIds: [],
	hiddenItemIds: [],
	itemOrder: {},
};

async function loadPreferences(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<SidebarPreferences> {
	const row = await db
		.select()
		.from(userSidebarPreferences)
		.where(
			and(
				eq(userSidebarPreferences.workspaceId, workspaceId),
				eq(userSidebarPreferences.userId, userId),
			),
		)
		.get();
	if (!row) return DEFAULT_PREFERENCES;
	return {
		collapsedSections: parseJsonArray(row.collapsedSectionsJson),
		pinnedItemIds: parseJsonArray(row.pinnedItemIdsJson),
		hiddenItemIds: parseJsonArray(row.hiddenItemIdsJson),
		itemOrder: parseJsonRecord(row.itemOrderJson),
	};
}

function parseJsonArray(raw: string): string[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value)
			? value.filter((v) => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

function parseJsonRecord(raw: string): Record<string, number> {
	try {
		const value = JSON.parse(raw);
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const out: Record<string, number> = {};
			for (const [key, v] of Object.entries(value)) {
				if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
			}
			return out;
		}
		return {};
	} catch {
		return {};
	}
}

export async function updateSidebarPreferences(
	env: Env,
	workspaceId: string,
	userId: string,
	update: SidebarPreferencesUpdate,
): Promise<SidebarPreferences> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);

	const current = await loadPreferences(db, workspaceId, userId);
	const next: SidebarPreferences = {
		collapsedSections: current.collapsedSections,
		pinnedItemIds: current.pinnedItemIds,
		hiddenItemIds: current.hiddenItemIds,
		itemOrder: current.itemOrder,
	};
	if (update.collapsedSections !== undefined) {
		next.collapsedSections = validateSectionKeys(update.collapsedSections);
	}
	if (update.pinnedItemIds !== undefined) {
		next.pinnedItemIds = validateItemIds(update.pinnedItemIds);
	}
	if (update.hiddenItemIds !== undefined) {
		next.hiddenItemIds = validateItemIds(update.hiddenItemIds);
	}
	if (update.itemOrder !== undefined) {
		next.itemOrder = validateItemOrder(update.itemOrder);
	}

	await db
		.insert(userSidebarPreferences)
		.values({
			id: crypto.randomUUID(),
			userId,
			workspaceId,
			collapsedSectionsJson: JSON.stringify(next.collapsedSections),
			pinnedItemIdsJson: JSON.stringify(next.pinnedItemIds),
			hiddenItemIdsJson: JSON.stringify(next.hiddenItemIds),
			itemOrderJson: JSON.stringify(next.itemOrder),
			updatedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: [
				userSidebarPreferences.userId,
				userSidebarPreferences.workspaceId,
			],
			set: {
				collapsedSectionsJson: JSON.stringify(next.collapsedSections),
				pinnedItemIdsJson: JSON.stringify(next.pinnedItemIds),
				hiddenItemIdsJson: JSON.stringify(next.hiddenItemIds),
				itemOrderJson: JSON.stringify(next.itemOrder),
				updatedAt: Date.now(),
			},
		})
		.run();
	return next;
}

function validateSectionKeys(keys: string[]): string[] {
	if (!Array.isArray(keys)) {
		throw new ManageError("collapsedSections must be an array of section keys");
	}
	const out: string[] = [];
	for (const key of keys) {
		if (typeof key !== "string" || !SECTION_KEYS.has(key)) {
			throw new ManageError(
				`invalid sidebar section key: ${String(key)} — expected one of ${[
					...SECTION_KEYS,
				].join(", ")}`,
			);
		}
		if (!out.includes(key)) out.push(key);
	}
	return out;
}

function validateItemIds(ids: string[]): string[] {
	if (!Array.isArray(ids))
		throw new ManageError("expected an array of item ids");
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (typeof id !== "string" || !ITEM_ID_RE.test(id)) {
			throw new ManageError(
				`invalid sidebar item id: ${String(id)} — expected system:*, inbox:*, tag:* or view:*`,
			);
		}
		if (!seen.has(id)) {
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

function validateItemOrder(
	order: Record<string, number>,
): Record<string, number> {
	if (!order || typeof order !== "object" || Array.isArray(order)) {
		throw new ManageError("itemOrder must be a record of item id -> number");
	}
	const out: Record<string, number> = {};
	for (const [id, value] of Object.entries(order)) {
		if (!ITEM_ID_RE.test(id)) {
			throw new ManageError(`invalid sidebar item id in itemOrder: ${id}`);
		}
		if (!Number.isFinite(value)) {
			throw new ManageError(`itemOrder values must be numbers (${id})`);
		}
		out[id] = value;
	}
	return out;
}

// ---------------------------------------------------------------------------
// SAVED FILTERS (Views section)
// ---------------------------------------------------------------------------

export async function createSavedFilter(
	env: Env,
	workspaceId: string,
	userId: string,
	input: SavedFilterCreateRequest,
): Promise<SavedFilterSummary> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const name = input.name?.trim();
	if (!name) throw new ManageError("name is required");
	const filters = await validateFilters(db, workspaceId, input.filters);

	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await db
		.insert(savedFilters)
		.values({
			id,
			workspaceId,
			name,
			filtersJson: JSON.stringify(filters),
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id, name, filters, createdAt: now, updatedAt: now };
}

export async function deleteSavedFilter(
	env: Env,
	workspaceId: string,
	id: string,
	userId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const existing = await db
		.select()
		.from(savedFilters)
		.where(
			and(eq(savedFilters.id, id), eq(savedFilters.workspaceId, workspaceId)),
		)
		.get();
	if (!existing) throw new ManageError("saved filter not found", 404);
	await db.delete(savedFilters).where(eq(savedFilters.id, id)).run();
}

async function validateFilters(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	input: SavedFilterFilters,
): Promise<SavedFilterFilters> {
	if (!input || typeof input !== "object") {
		throw new ManageError("filters is required");
	}
	const out: SavedFilterFilters = {};
	for (const [key, value] of Object.entries(input)) {
		if (!FILTER_KEYS.has(key)) {
			throw new ManageError(`unknown filter key: ${key}`);
		}
		if (value === undefined || value === null) continue;
		switch (key) {
			case "status":
				if (value !== "open" && value !== "archived" && value !== "all") {
					throw new ManageError("status must be open, archived or all");
				}
				out.status = value;
				break;
			case "channel":
				if (value !== "facebook" && value !== "email") {
					throw new ManageError("channel must be facebook or email");
				}
				out.channel = value;
				break;
			case "unassigned":
			case "snoozed":
				if (typeof value !== "boolean") {
					throw new ManageError(`${key} must be a boolean`);
				}
				out[key] = value;
				break;
			case "inboxId":
			case "tagId":
			case "assigneeId":
			case "q":
			case "dateFrom":
			case "dateTo":
				if (typeof value !== "string") {
					throw new ManageError(`${key} must be a string`);
				}
				out[key] = value;
				break;
		}
	}
	if (out.inboxId) {
		const inbox = await db
			.select({ id: inboxes.id })
			.from(inboxes)
			.where(
				and(eq(inboxes.id, out.inboxId), eq(inboxes.workspaceId, workspaceId)),
			)
			.get();
		if (!inbox)
			throw new ManageError("inbox does not belong to this workspace");
	}
	if (out.tagId) {
		const tag = await db
			.select({ id: tags.id })
			.from(tags)
			.where(and(eq(tags.id, out.tagId), eq(tags.workspaceId, workspaceId)))
			.get();
		if (!tag) throw new ManageError("tag does not belong to this workspace");
	}
	if (
		out.assigneeId &&
		!(await userBelongsToWorkspace(db, workspaceId, out.assigneeId))
	) {
		throw new ManageError("assignee does not belong to this workspace");
	}
	return out;
}

export async function listWorkspacesForUser(
	env: Env,
	userId: string,
): Promise<WorkspaceSummary[]> {
	const db = drizzle(env.DB);
	const rows = await listUserWorkspaces(db, userId);
	if (rows.length > 0) return rows;
	// Single-tenant bootstrap: a fresh signup has no membership rows yet, and
	// the workspaces list is the FIRST call the web client makes — so claiming
	// the lazy default workspace here (creating it on first use) is what makes
	// the sidebar mount at all. Once the workspace has any members, new users
	// are strictly gated by membership (they'd need an invite).
	const ws = await getOrCreateWorkspace(db, new Date().toISOString());
	const access = await getWorkspaceAccess(db, ws.id, userId);
	if (!access) return [];
	return [{ id: ws.id, name: ws.name, slug: ws.slug, role: access.role }];
}
