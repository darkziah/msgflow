import type {
	SavedFilterCreateRequest,
	SavedFilterFilters,
	SavedFilterSummary,
	SidebarNode,
	SidebarPreferences,
	SidebarPreferencesUpdate,
	SidebarTreeResponse,
	WorkspaceCreateRequest,
	WorkspaceSummary,
} from "@msgflow/contracts";
import {
	SavedFilterFiltersSchema,
	SidebarItemOrderSchema,
	SidebarStringListSchema,
} from "@msgflow/contracts";
import {
	channels,
	conversations,
	inboxChannels,
	inboxes,
	mailboxes,
	savedFilters,
	tags,
	userSidebarPreferences,
	workspaces,
} from "@msgflow/db";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Either, Schema } from "effect";
import {
	listUserWorkspaces,
	requireWorkspaceAccess,
	requireWorkspaceOwnerAccess,
	userBelongsToWorkspace,
} from "./access";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { getReadableInboxIds } from "./inbox-tree";
import { provisionWorkspace } from "./workspace-provisioning";

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
const TREE_NODE_ID_RE =
	/^(section|smart|inbox|channel-group|channel|tag|view):/;
// These identifiers belong to the pre-tree renderer. They remain valid stored
// preference values, but are not guessed into semantically different nodes.
const LEGACY_ITEM_IDS = new Set([
	"system:all",
	"system:assigned-to-me",
	"system:unassigned",
	"system:snoozed",
	"system:closed",
]);
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
	"channelId",
	"tagId",
	"dateFrom",
	"dateTo",
]);

export async function getSidebar(
	env: Env,
	workspaceId: string,
	userId: string,
	dependencies: SidebarQueryDependencies = {},
): Promise<SidebarTreeResponse> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, userId);
	const ws = await db
		.select()
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
	if (!ws) throw new ManageError("workspace not found", 404);
	const readableIds = await getReadableInboxIds(db, workspaceId, userId);
	const readable = new Set(readableIds);
	const now = new Date().toISOString();
	const actionable = and(
		eq(conversations.status, "open"),
		or(
			isNull(conversations.snoozedUntil),
			lte(conversations.snoozedUntil, now),
		),
	);
	const scope = readableIds.length
		? inArray(conversations.inboxId, readableIds)
		: sql`0`;
	const safe = async <T>(
		label: string,
		run: () => Promise<T>,
	): Promise<T | null> => {
		try {
			return await run();
		} catch (error) {
			console.error("sidebar query failed", {
				label,
				workspaceId,
				error: String(error),
			});
			return null;
		}
	};
	const rows = readableIds.length
		? await db
				.select()
				.from(inboxes)
				.where(
					and(
						eq(inboxes.workspaceId, workspaceId),
						inArray(inboxes.id, readableIds),
					),
				)
				.orderBy(asc(inboxes.sortOrder), asc(inboxes.name))
				.all()
		: [];
	const countRows = await safe("inbox counts", () =>
		(dependencies.countInboxDescendants ?? countInboxDescendants)(
			env,
			workspaceId,
			readableIds,
			userId,
			now,
		),
	);
	const directCounts = await safe("sidebar count", () =>
		countWhere(db, [scope, actionable]),
	);
	const countByInbox = new Map(
		(countRows ?? []).map((row) => [row.inboxId, row]),
	);
	const make = (
		partial: Omit<SidebarNode, "children" | "isHidden">,
	): SidebarNode => ({ ...partial, children: [], isHidden: false });
	const childrenByParent = new Map<string, typeof rows>();
	for (const row of rows)
		if (row.parentInboxId && readable.has(row.parentInboxId))
			childrenByParent.set(row.parentInboxId, [
				...(childrenByParent.get(row.parentInboxId) ?? []),
				row,
			]);
	const buildInbox = (
		row: (typeof rows)[number],
		parentId: string,
	): SidebarNode => {
		const node = make({
			id: `inbox:${row.id}`,
			type: "inbox",
			parentId,
			label: row.name,
			icon: row.icon,
			color: row.color,
			// Direct counts cannot prove an ancestor's total. If the recursive
			// aggregate is unavailable, degrade every inbox-derived metric rather
			// than incorrectly displaying zero for a leaf or parent.
			count: countRows === null ? null : (countByInbox.get(row.id)?.count ?? 0),
			unread:
				countRows === null ? null : (countByInbox.get(row.id)?.unread ?? 0),
			unassigned:
				countRows === null ? null : (countByInbox.get(row.id)?.unassigned ?? 0),
			isCollapsible: false,
			isEditable:
				access.isAdmin && row.visibilityType === "shared" && !row.isArchived,
			permissionState: "allowed",
			filter: { status: "open", inboxId: row.id },
		});
		node.children = (childrenByParent.get(row.id) ?? []).map((child) =>
			buildInbox(child, node.id),
		);
		if (node.children.length) node.isCollapsible = true;
		return node;
	};
	const roots = rows
		.filter((row) => !row.parentInboxId || !readable.has(row.parentInboxId))
		.map((row) => buildInbox(row, "section:shared-inboxes"));
	const smartDefs: Array<[string, string, SavedFilterFilters, unknown[]]> = [
		[
			"assigned-to-me",
			"Assigned to me",
			{ status: "open", assigneeId: userId },
			[eq(conversations.assigneeId, userId), actionable],
		],
		[
			"unassigned",
			"Unassigned",
			{ status: "open", unassigned: true },
			[isNull(conversations.assigneeId), actionable],
		],
		[
			"snoozed",
			"Snoozed",
			{ status: "open", snoozed: true },
			[eq(conversations.status, "open"), gt(conversations.snoozedUntil, now)],
		],
		[
			"done",
			"Done/Closed",
			{ status: "archived" },
			[eq(conversations.status, "archived")],
		],
	];
	const smartChildren = await Promise.all(
		smartDefs.map(async ([name, label, filter, conditions]) =>
			make({
				id: `smart:${name}`,
				type: "smart-view",
				parentId: "section:my-work",
				label,
				icon: null,
				color: null,
				count: await safe(name, async () =>
					countWhere(db, [scope, ...(conditions as [])]),
				),
				isCollapsible: false,
				isEditable: false,
				permissionState: "allowed",
				filter,
			}),
		),
	);
	const [legacyLinks, directMailboxLinks, channelCountRows] = readableIds.length
		? await Promise.all([
				db
					.select({
						inboxId: inboxChannels.inboxId,
						channelId: channels.id,
						type: channels.type,
						label: channels.displayName,
					})
					.from(inboxChannels)
					.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
					.where(inArray(inboxChannels.inboxId, readableIds))
					.all(),
				db
					.select({
						inboxId: mailboxes.inboxId,
						channelId: channels.id,
						label: mailboxes.canonicalAddress,
					})
					.from(mailboxes)
					.innerJoin(
						channels,
						and(
							eq(channels.workspaceId, mailboxes.workspaceId),
							eq(channels.externalId, mailboxes.canonicalAddress),
							eq(channels.type, "email"),
						),
					)
					.where(
						and(
							eq(mailboxes.workspaceId, workspaceId),
							inArray(mailboxes.inboxId, readableIds),
						),
					)
					.all(),
				db
					.select({
						channelId: conversations.channelId,
						type: channels.type,
						count: sqlCount(),
					})
					.from(conversations)
					.innerJoin(channels, eq(conversations.channelId, channels.id))
					.where(and(scope, actionable))
					.groupBy(conversations.channelId, channels.type)
					.all(),
			])
		: [
				[],
				[] as Array<{
					inboxId: string | null;
					channelId: string;
					label: string;
				}>,
				[] as Array<{
					channelId: string;
					type: "facebook_page" | "email";
					count: number;
				}>,
			];
	const links = [
		...legacyLinks,
		...directMailboxLinks.flatMap((link) =>
			link.inboxId === null
				? []
				: [{ ...link, inboxId: link.inboxId, type: "email" as const }],
		),
	];
	const channelCountById = new Map(
		channelCountRows.map((row) => [row.channelId, row.count]),
	);
	const channelGroups = (["facebook_page", "email"] as const)
		.map((type) => {
			const linked = links.filter((link) => link.type === type);
			if (!linked.length) return null;
			// Aggregate by actual conversation channel, not linked inbox: a mixed
			// inbox must not make each channel appear to own every message.
			const groupCount = [
				...new Set(linked.map((link) => link.channelId)),
			].reduce((sum, id) => sum + (channelCountById.get(id) ?? 0), 0);
			const group = make({
				id: `channel-group:${type === "facebook_page" ? "facebook" : "email"}`,
				type: "channel-group",
				parentId: "section:channels",
				label: type === "facebook_page" ? "Facebook" : "Email",
				icon: null,
				color: null,
				count: groupCount,
				isCollapsible: true,
				isEditable: false,
				permissionState: "allowed",
				filter: {
					status: "open",
					channel: type === "facebook_page" ? "facebook" : "email",
				},
			});
			group.children = [
				...new Map(linked.map((link) => [link.channelId, link])).values(),
			].map((link) =>
				make({
					id: `channel:${link.channelId}`,
					type: "channel",
					parentId: group.id,
					label: link.label,
					icon: null,
					color: null,
					count: channelCountById.get(link.channelId) ?? 0,
					isCollapsible: false,
					isEditable: false,
					permissionState: "allowed",
					filter: {
						status: "open",
						channel: type === "facebook_page" ? "facebook" : "email",
						channelId: link.channelId,
					},
				}),
			);
			return group;
		})
		.filter((node): node is SidebarNode => node !== null);
	const visibleTags = await db
		.select()
		.from(tags)
		.where(
			and(
				eq(tags.workspaceId, workspaceId),
				or(
					eq(tags.visibility, "shared"),
					eq(tags.visibility, "company"),
					eq(tags.ownerUserId, userId),
				),
			),
		)
		.orderBy(asc(tags.name))
		.all();
	const tagsByParent = new Map<string, typeof visibleTags>();
	for (const tag of visibleTags)
		if (tag.parentTagId)
			tagsByParent.set(tag.parentTagId, [
				...(tagsByParent.get(tag.parentTagId) ?? []),
				tag,
			]);
	const buildTag = (
		tag: (typeof visibleTags)[number],
		parentId: string,
	): SidebarNode => {
		const node = make({
			id: `tag:${tag.id}`,
			type: "tag",
			parentId,
			label: tag.name,
			icon: null,
			color: tag.color,
			count: null,
			isCollapsible: false,
			isEditable: false,
			permissionState: "allowed",
			filter: { status: "open", tagId: tag.id },
		});
		node.children = (tagsByParent.get(tag.id) ?? []).map((child) =>
			buildTag(child, node.id),
		);
		node.isCollapsible = node.children.length > 0;
		return node;
	};
	const tagChildren = visibleTags
		.filter(
			(tag) =>
				!tag.parentTagId ||
				!visibleTags.some((parent) => parent.id === tag.parentTagId),
		)
		.map((tag) => buildTag(tag, "section:tags"));
	const filters = await db
		.select()
		.from(savedFilters)
		.where(
			and(
				eq(savedFilters.workspaceId, workspaceId),
				eq(savedFilters.createdBy, userId),
			),
		)
		.orderBy(asc(savedFilters.name))
		.all();
	const viewChildren = filters.flatMap((row) => {
		const filter = decodeStoredJson(
			row.filtersJson,
			Schema.NullOr(SavedFilterFiltersSchema),
			null,
		);
		return !filter ||
			(filter.inboxId && !readable.has(filter.inboxId)) ||
			(filter.tagId && !visibleTags.some((tag) => tag.id === filter.tagId))
			? []
			: [
					make({
						id: `view:${row.id}`,
						type: "saved-view",
						parentId: "section:saved-views",
						label: row.name,
						icon: null,
						color: null,
						count: null,
						isCollapsible: false,
						isEditable: false,
						permissionState: "allowed",
						filter: { savedViewId: row.id },
					}),
				];
	});
	const sections: SidebarNode[] = [
		make({
			id: "section:my-work",
			type: "section",
			parentId: null,
			label: "My Work",
			icon: null,
			color: null,
			count: null,
			isCollapsible: true,
			isEditable: false,
			permissionState: "allowed",
			filter: {},
		}),
		make({
			id: "section:shared-inboxes",
			type: "section",
			parentId: null,
			label: "Shared Inboxes",
			icon: null,
			color: null,
			count: directCounts,
			isCollapsible: true,
			isEditable: false,
			permissionState: "allowed",
			filter: { status: "open" },
		}),
		make({
			id: "section:channels",
			type: "section",
			parentId: null,
			label: "Channels",
			icon: null,
			color: null,
			count: directCounts,
			isCollapsible: true,
			isEditable: false,
			permissionState: "allowed",
			filter: { status: "open" },
		}),
		make({
			id: "section:tags",
			type: "section",
			parentId: null,
			label: "Tags",
			icon: null,
			color: null,
			count: null,
			isCollapsible: true,
			isEditable: false,
			permissionState: "allowed",
			filter: {},
		}),
		make({
			id: "section:saved-views",
			type: "section",
			parentId: null,
			label: "Saved Views",
			icon: null,
			color: null,
			count: null,
			isCollapsible: true,
			isEditable: false,
			permissionState: "allowed",
			filter: {},
		}),
	];
	for (const [section, children] of [
		[sections[0], smartChildren],
		[sections[1], roots],
		[sections[2], channelGroups],
		[sections[3], tagChildren],
		[sections[4], viewChildren],
	] as const) {
		if (section) section.children = children;
	}
	const preferences = sanitizePreferences(
		await loadPreferences(db, workspaceId, userId),
		new Set(flattenNodes(sections).map((node) => node.id)),
	);
	for (const node of flattenNodes(sections))
		node.isHidden = preferences.hiddenItemIds.includes(node.id);
	return {
		workspace: { id: ws.id, name: ws.name, slug: ws.slug },
		permissions: { isAdmin: access.isAdmin },
		preferences,
		sections,
	};
}

function flattenNodes(nodes: SidebarNode[]): SidebarNode[] {
	return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function sanitizePreferences(
	preferences: SidebarPreferences,
	permittedIds: Set<string>,
): SidebarPreferences {
	const isPermitted = (id: string) =>
		LEGACY_ITEM_IDS.has(id) || permittedIds.has(id);
	const itemOrder: Record<string, number> = {};
	for (const [id, value] of Object.entries(preferences.itemOrder)) {
		if (isPermitted(id)) itemOrder[id] = value;
	}
	return {
		...preferences,
		// Section keys are the legacy persisted collapse contract. They are not
		// tree node ids and must not be remapped to a coincidentally named node.
		collapsedSections: preferences.collapsedSections.filter((id) =>
			SECTION_KEYS.has(id),
		),
		collapsedNodeIds: (preferences.collapsedNodeIds ?? []).filter((id) =>
			permittedIds.has(id),
		),
		lastOpenBranchIds: (preferences.lastOpenBranchIds ?? []).filter((id) =>
			permittedIds.has(id),
		),
		pinnedItemIds: preferences.pinnedItemIds.filter(isPermitted),
		hiddenItemIds: preferences.hiddenItemIds.filter(isPermitted),
		itemOrder,
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

type DescendantCount = {
	inboxId: string;
	count: number;
	unread: number;
	unassigned: number;
};

type SidebarQueryDependencies = {
	/** Test seam: production uses the D1 recursive aggregate below. */
	countInboxDescendants?: (
		env: Env,
		workspaceId: string,
		readableIds: string[],
		userId: string,
		now: string,
	) => Promise<DescendantCount[]>;
};

/** Uses one recursive CTE so every authorized descendant contributes to each
 * ancestor exactly once; COUNT(DISTINCT ...) protects parent totals from joins. */
async function countInboxDescendants(
	env: Env,
	workspaceId: string,
	readableIds: string[],
	userId: string,
	now: string,
): Promise<DescendantCount[]> {
	if (!readableIds.length) return [];
	const placeholders = readableIds.map(() => "?").join(", ");
	const statement = `
		WITH RECURSIVE descendants(parent_id, inbox_id) AS (
			SELECT id, id FROM inboxes WHERE workspace_id = ? AND id IN (${placeholders})
			UNION
			SELECT descendants.parent_id, inboxes.id
			FROM descendants JOIN inboxes ON inboxes.parent_inbox_id = descendants.inbox_id
			WHERE inboxes.workspace_id = ? AND inboxes.id IN (${placeholders})
		)
		SELECT descendants.parent_id AS inboxId,
			COUNT(DISTINCT conversations.id) AS count,
			COUNT(DISTINCT CASE WHEN conversations.message_count > COALESCE(conversation_reads.last_read_seq, 0) THEN conversations.id END) AS unread,
			COUNT(DISTINCT CASE WHEN conversations.assignee_id IS NULL THEN conversations.id END) AS unassigned
		FROM descendants
		LEFT JOIN conversations ON conversations.inbox_id = descendants.inbox_id
			AND conversations.status = 'open'
			AND (conversations.snoozed_until IS NULL OR conversations.snoozed_until <= ?)
		LEFT JOIN conversation_reads ON conversation_reads.conversation_id = conversations.id
			AND conversation_reads.agent_id = ?
		GROUP BY descendants.parent_id`;
	const result = await env.DB.prepare(statement)
		.bind(workspaceId, ...readableIds, workspaceId, ...readableIds, now, userId)
		.all<DescendantCount>();
	return result.results;
}

// ---------------------------------------------------------------------------
// SIDEBAR PREFERENCES (personal UI state; never shared routing/config)
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES: SidebarPreferences = {
	collapsedSections: [],
	collapsedNodeIds: [],
	lastOpenBranchIds: [],
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
		collapsedNodeIds: parseJsonArray(row.collapsedNodeIdsJson),
		lastOpenBranchIds: parseJsonArray(row.lastOpenBranchIdsJson),
		pinnedItemIds: parseJsonArray(row.pinnedItemIdsJson),
		hiddenItemIds: parseJsonArray(row.hiddenItemIdsJson),
		itemOrder: parseJsonRecord(row.itemOrderJson),
	};
}

function parseJsonArray(raw: string): string[] {
	return [...decodeStoredJson(raw, SidebarStringListSchema, [])];
}

function parseJsonRecord(raw: string): Record<string, number> {
	return { ...decodeStoredJson(raw, SidebarItemOrderSchema, {}) };
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
		collapsedNodeIds: current.collapsedNodeIds,
		lastOpenBranchIds: current.lastOpenBranchIds,
		pinnedItemIds: current.pinnedItemIds,
		hiddenItemIds: current.hiddenItemIds,
		itemOrder: current.itemOrder,
	};
	if (update.collapsedSections !== undefined) {
		next.collapsedSections = validateSectionKeys(update.collapsedSections);
	}
	if (update.collapsedNodeIds !== undefined) {
		next.collapsedNodeIds = validateNodeIds(update.collapsedNodeIds);
	}
	if (update.lastOpenBranchIds !== undefined) {
		next.lastOpenBranchIds = validateNodeIds(update.lastOpenBranchIds);
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
	const permittedIds = new Set(
		flattenNodes((await getSidebar(env, workspaceId, userId)).sections).map(
			(node) => node.id,
		),
	);
	const persisted = sanitizePreferences(next, permittedIds);

	await db
		.insert(userSidebarPreferences)
		.values({
			id: crypto.randomUUID(),
			userId,
			workspaceId,
			collapsedSectionsJson: JSON.stringify(persisted.collapsedSections),
			collapsedNodeIdsJson: JSON.stringify(persisted.collapsedNodeIds),
			lastOpenBranchIdsJson: JSON.stringify(persisted.lastOpenBranchIds),
			pinnedItemIdsJson: JSON.stringify(persisted.pinnedItemIds),
			hiddenItemIdsJson: JSON.stringify(persisted.hiddenItemIds),
			itemOrderJson: JSON.stringify(persisted.itemOrder),
			updatedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: [
				userSidebarPreferences.userId,
				userSidebarPreferences.workspaceId,
			],
			set: {
				collapsedSectionsJson: JSON.stringify(persisted.collapsedSections),
				collapsedNodeIdsJson: JSON.stringify(persisted.collapsedNodeIds),
				lastOpenBranchIdsJson: JSON.stringify(persisted.lastOpenBranchIds),
				pinnedItemIdsJson: JSON.stringify(persisted.pinnedItemIds),
				hiddenItemIdsJson: JSON.stringify(persisted.hiddenItemIds),
				itemOrderJson: JSON.stringify(persisted.itemOrder),
				updatedAt: Date.now(),
			},
		})
		.run();
	return persisted;
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
		if (
			typeof id !== "string" ||
			(!ITEM_ID_RE.test(id) && !TREE_NODE_ID_RE.test(id))
		) {
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

function validateNodeIds(ids: string[]): string[] {
	if (!Array.isArray(ids))
		throw new ManageError("expected an array of node ids");
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (typeof id !== "string" || !TREE_NODE_ID_RE.test(id)) {
			throw new ManageError(`invalid sidebar node id: ${String(id)}`);
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
		if (!ITEM_ID_RE.test(id) && !TREE_NODE_ID_RE.test(id)) {
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
	const filters = await validateFilters(db, workspaceId, userId, input.filters);

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
			and(
				eq(savedFilters.id, id),
				eq(savedFilters.workspaceId, workspaceId),
				eq(savedFilters.createdBy, userId),
			),
		)
		.get();
	if (!existing) throw new ManageError("saved filter not found", 404);
	await db
		.delete(savedFilters)
		.where(
			and(
				eq(savedFilters.id, id),
				eq(savedFilters.workspaceId, workspaceId),
				eq(savedFilters.createdBy, userId),
			),
		)
		.run();
}

/** Resolves a saved view at selection time so stale access cannot leak into lists. */
export async function resolveSavedViewFilters(
	env: Env,
	workspaceId: string,
	userId: string,
	id: string,
): Promise<SavedFilterFilters> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const row = await db
		.select({ filtersJson: savedFilters.filtersJson })
		.from(savedFilters)
		.where(
			and(
				eq(savedFilters.id, id),
				eq(savedFilters.workspaceId, workspaceId),
				eq(savedFilters.createdBy, userId),
			),
		)
		.get();
	if (!row) throw new ManageError("saved filter not found", 404);
	const filters = decodeStoredJson(
		row.filtersJson,
		Schema.NullOr(SavedFilterFiltersSchema),
		null,
	);
	if (!filters) throw new ManageError("saved filter is invalid", 404);
	return validateFilters(db, workspaceId, userId, filters);
}

async function validateFilters(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
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
			case "channelId":
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
		const readable = new Set(
			await getReadableInboxIds(db, workspaceId, userId),
		);
		if (!readable.has(out.inboxId)) {
			throw new ManageError("inbox is not accessible to this user");
		}
	}
	if (out.tagId) {
		const tag = await db
			.select({
				id: tags.id,
				visibility: tags.visibility,
				ownerUserId: tags.ownerUserId,
			})
			.from(tags)
			.where(and(eq(tags.id, out.tagId), eq(tags.workspaceId, workspaceId)))
			.get();
		if (!tag || (tag.visibility === "private" && tag.ownerUserId !== userId)) {
			throw new ManageError("tag is not accessible to this user");
		}
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
	return [];
}

/**
 * Creates a Workspace graph for an already-authenticated actor. Authorization
 * is deliberately owned by the future workspace route; this service neither
 * creates an account nor reads or changes first-use setup state.
 */
export async function createWorkspaceForActor(
	env: Env,
	actorUserId: string,
	input: WorkspaceCreateRequest,
): Promise<WorkspaceSummary & { teamId: string; inboxId: string }> {
	try {
		const provisioned = await provisionWorkspace(env, actorUserId, input);
		return {
			id: provisioned.workspaceId,
			name: input.workspaceName,
			slug: input.workspaceSlug,
			role: "owner",
			createdAt: provisioned.createdAt,
			teamId: provisioned.teamId,
			inboxId: provisioned.inboxId,
		};
	} catch (cause) {
		const message = cause instanceof Error ? cause.message.toLowerCase() : "";
		if (
			message.includes("workspaces.slug") ||
			message.includes("unique constraint failed: workspaces.slug")
		) {
			throw new ManageError("workspace slug is already in use", 409);
		}
		throw cause;
	}
}

/** @deprecated Route-specific authorization wrapper retained for in-flight callers. */
export async function createWorkspace(
	env: Env,
	sourceWorkspaceId: string,
	actorUserId: string,
	input: WorkspaceCreateRequest,
): Promise<WorkspaceSummary & { teamId: string; inboxId: string }> {
	await requireWorkspaceOwnerAccess(
		drizzle(env.DB),
		sourceWorkspaceId,
		actorUserId,
	);
	return createWorkspaceForActor(env, actorUserId, input);
}

function decodeStoredJson<A, I>(
	raw: string,
	schema: Schema.Schema<A, I, never>,
	fallback: A,
): A {
	try {
		const decoded = Schema.decodeUnknownEither(schema)(JSON.parse(raw));
		return Either.isRight(decoded) ? decoded.right : fallback;
	} catch {
		return fallback;
	}
}
