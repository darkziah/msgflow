import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import {
	INBOX_ASSIGNMENT_STRATEGIES,
	INBOX_ICON_KEYS,
	type CannedReplySummary,
	type CannedReplyWriteRequest,
	type InboxChannelRequest,
	type InboxCreateRequest,
	type InboxSummary,
	type InboxUpdateRequest,
	type RuleSummary,
	type RuleWriteRequest,
	type TagCreateRequest,
	type TagSummary,
	type TagUpdateRequest,
	type TeamSummary,
} from "@msgflow/contracts";
import {
	channels,
	cannedReplies,
	conversations,
	inboxChannels,
	inboxMembers,
	inboxes,
	ruleActions,
	ruleConditions,
	rules,
	tags,
	teams,
} from "@msgflow/db";
import type { Env } from "./env";
import { getOrCreateWorkspace } from "./workspace";
import {
	requireAdminAccess,
	requireWorkspaceAccess,
	userBelongsToWorkspace,
} from "./access";
import { ManageError } from "./errors";

export { ManageError } from "./errors";

/**
 * Management CRUD for tags, rules, and canned replies (ADR 0009/0010).
 * All rows are scoped to the single default workspace (RBAC is a later
 * phase). The ingest path reads these tables directly (evaluateRules), so
 * the shapes written here are the shapes it evaluates.
 */

// ---------------------------------------------------------------------------
// TAGS
// ---------------------------------------------------------------------------

export async function listTags(env: Env): Promise<TagSummary[]> {
	const db = drizzle(env.DB);
	const workspace = await getOrCreateWorkspace(db, new Date().toISOString());
	const rows = await db
		.select()
		.from(tags)
		.where(eq(tags.workspaceId, workspace.id))
		.orderBy(asc(tags.name))
		.all();
	return rows.map(toTagSummary);
}

export async function createTag(
	env: Env,
	input: TagCreateRequest,
	ownerUserId: string,
): Promise<TagSummary> {
	const db = drizzle(env.DB);
	const workspace = await getOrCreateWorkspace(db, new Date().toISOString());
	const now = new Date().toISOString();
	const name = input.name.trim();
	if (!name) throw new ManageError("name is required");
	const visibility = input.visibility ?? "shared";
	if (visibility !== "shared" && visibility !== "private") {
		throw new ManageError("visibility must be 'shared' or 'private'");
	}
	const row = {
		id: crypto.randomUUID(),
		workspaceId: workspace.id,
		name,
		color: input.color ?? null,
		visibility,
		parentTagId: input.parentTagId ?? null,
		ownerUserId: visibility === "private" ? ownerUserId : null,
		createdAt: now,
	};
	await db.insert(tags).values(row).run();
	return toTagSummary(row);
}

export async function updateTag(
	env: Env,
	id: string,
	input: TagUpdateRequest,
): Promise<TagSummary> {
	const db = drizzle(env.DB);
	const existing = await db.select().from(tags).where(eq(tags.id, id)).get();
	if (!existing) throw new ManageError("tag not found", 404);

	const set: Partial<typeof tags.$inferInsert> = {};
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new ManageError("name is required");
		set.name = name;
	}
	if (input.color !== undefined) set.color = input.color;
	if (input.visibility !== undefined) {
		if (input.visibility !== "shared" && input.visibility !== "private") {
			throw new ManageError("visibility must be 'shared' or 'private'");
		}
		set.visibility = input.visibility;
		// Private tags are owned by whoever made them private; clearing back to
		// shared releases the owner binding.
		set.ownerUserId =
			input.visibility === "private" ? (existing.ownerUserId ?? null) : null;
	}
	if (input.parentTagId !== undefined) set.parentTagId = input.parentTagId;

	if (Object.keys(set).length > 0) {
		await db.update(tags).set(set).where(eq(tags.id, id)).run();
	}
	const updated = await db.select().from(tags).where(eq(tags.id, id)).get();
	if (!updated) throw new ManageError("tag not found", 404);
	return toTagSummary(updated);
}

export async function deleteTag(env: Env, id: string): Promise<void> {
	const db = drizzle(env.DB);
	const existing = await db.select().from(tags).where(eq(tags.id, id)).get();
	if (!existing) throw new ManageError("tag not found", 404);
	// conversation_tags rows cascade on tag delete (schema FK onDelete cascade).
	await db.delete(tags).where(eq(tags.id, id)).run();
}

function toTagSummary(row: typeof tags.$inferSelect): TagSummary {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		visibility: row.visibility,
		parentTagId: row.parentTagId,
		ownerUserId: row.ownerUserId,
		createdAt: row.createdAt,
	};
}

// ---------------------------------------------------------------------------
// RULES (condition/action trees are written and read as one unit)
// ---------------------------------------------------------------------------

export async function listRules(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<RuleSummary[]> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const ruleRows = await db
		.select()
		.from(rules)
		.where(eq(rules.workspaceId, workspaceId))
		.orderBy(asc(rules.priority), asc(rules.createdAt))
		.all();
	if (ruleRows.length === 0) return [];

	const ids = ruleRows.map((row) => row.id);
	const conditions = await db
		.select()
		.from(ruleConditions)
		.where(inArray(ruleConditions.ruleId, ids))
		.all();
	const actions = await db
		.select()
		.from(ruleActions)
		.where(inArray(ruleActions.ruleId, ids))
		.all();

	const conditionsByRule = new Map<
		string,
		(typeof ruleConditions.$inferSelect)[]
	>();
	for (const condition of conditions) {
		const list = conditionsByRule.get(condition.ruleId) ?? [];
		list.push(condition);
		conditionsByRule.set(condition.ruleId, list);
	}
	const actionsByRule = new Map<string, (typeof ruleActions.$inferSelect)[]>();
	for (const action of actions) {
		const list = actionsByRule.get(action.ruleId) ?? [];
		list.push(action);
		actionsByRule.set(action.ruleId, list);
	}

	return ruleRows.map((row) => ({
		id: row.id,
		name: row.name,
		triggerType: row.triggerType,
		isActive: row.isActive,
		priority: row.priority,
		stopProcessing: row.stopProcessing,
		inboxId: row.inboxId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		conditions: (conditionsByRule.get(row.id) ?? []).map((condition) => ({
			field: condition.field,
			operator: condition.operator,
			value: condition.value,
			matchGroup: condition.matchGroup,
		})),
		actions: (actionsByRule.get(row.id) ?? []).map((action) => ({
			actionType: action.actionType,
			actionValue: action.actionValue,
			executionOrder: action.executionOrder,
		})),
	}));
}

export async function createRule(
	env: Env,
	workspaceId: string,
	input: RuleWriteRequest,
	createdBy: string,
): Promise<RuleSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, createdBy);
	const id = await validateAndWriteRule(
		db,
		workspaceId,
		input,
		createdBy,
		null,
	);
	const created = await getRuleById(db, id);
	if (!created) throw new ManageError("rule create failed");
	return created;
}

export async function updateRule(
	env: Env,
	workspaceId: string,
	id: string,
	input: RuleWriteRequest,
	updatedBy: string,
): Promise<RuleSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, updatedBy);
	const existing = await db
		.select()
		.from(rules)
		.where(and(eq(rules.id, id), eq(rules.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("rule not found", 404);
	await validateAndWriteRule(db, existing.workspaceId, input, updatedBy, id);
	const updated = await getRuleById(db, id);
	if (!updated) throw new ManageError("rule update failed");
	return updated;
}

export async function deleteRule(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select()
		.from(rules)
		.where(and(eq(rules.id, id), eq(rules.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("rule not found", 404);
	// conditions/actions/log cascade on rule delete (schema FK onDelete cascade).
	await db.delete(rules).where(eq(rules.id, id)).run();
}

/**
 * Validate + upsert a rule and its condition/action children. When `ruleId` is
 * null a new rule (and children) is inserted; otherwise children are replaced
 * wholesale (delete + reinsert) so the stored tree always matches the request.
 */
async function validateAndWriteRule(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	input: RuleWriteRequest,
	createdBy: string,
	ruleId: string | null,
): Promise<string> {
	const now = new Date().toISOString();
	const name = input.name.trim();
	if (!name) throw new ManageError("name is required");
	if (!input.triggerType) throw new ManageError("triggerType is required");
	if (!Array.isArray(input.conditions) || !Array.isArray(input.actions)) {
		throw new ManageError("conditions and actions are required");
	}
	// Rule scope: inboxId (when set) must belong to this workspace and must not
	// be archived — archived inboxes cannot receive new rule-routing actions.
	if (input.inboxId) {
		const inbox = await db
			.select({ id: inboxes.id, isArchived: inboxes.isArchived })
			.from(inboxes)
			.where(
				and(
					eq(inboxes.id, input.inboxId),
					eq(inboxes.workspaceId, workspaceId),
				),
			)
			.get();
		if (!inbox) throw new ManageError("rule inbox not found", 404);
		if (inbox.isArchived) {
			throw new ManageError("rules cannot target an archived inbox", 409);
		}
	}
	const conditions = input.conditions.map((condition, index) => ({
		field: condition.field.trim(),
		operator: condition.operator.trim(),
		value: condition.value,
		matchGroup: Number.isInteger(condition.matchGroup)
			? condition.matchGroup
			: 0,
		createdAt: now,
		orderHint: index,
	}));
	const actions = input.actions.map((action, index) => ({
		actionType: action.actionType.trim(),
		actionValue: action.actionValue,
		executionOrder: Number.isInteger(action.executionOrder)
			? action.executionOrder
			: index,
		createdAt: now,
	}));
	if (conditions.some((c) => !c.field || !c.operator)) {
		throw new ManageError("each condition needs a field and operator");
	}
	if (actions.some((a) => !a.actionType)) {
		throw new ManageError("each action needs a type");
	}

	if (!ruleId) {
		ruleId = crypto.randomUUID();
		await db
			.insert(rules)
			.values({
				id: ruleId,
				workspaceId,
				inboxId: input.inboxId ?? null,
				name,
				triggerType: input.triggerType,
				isActive: input.isActive,
				priority: input.priority ?? 0,
				stopProcessing: input.stopProcessing ?? false,
				createdBy,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	} else {
		await db
			.update(rules)
			.set({
				inboxId: input.inboxId ?? null,
				name,
				triggerType: input.triggerType,
				isActive: input.isActive,
				priority: input.priority ?? 0,
				stopProcessing: input.stopProcessing ?? false,
				updatedAt: now,
			})
			.where(eq(rules.id, ruleId))
			.run();
		await db
			.delete(ruleConditions)
			.where(eq(ruleConditions.ruleId, ruleId))
			.run();
		await db.delete(ruleActions).where(eq(ruleActions.ruleId, ruleId)).run();
	}

	for (const condition of conditions) {
		await db
			.insert(ruleConditions)
			.values({
				id: crypto.randomUUID(),
				ruleId,
				field: condition.field,
				operator:
					condition.operator as (typeof ruleConditions.$inferInsert)["operator"],
				value: condition.value,
				matchGroup: condition.matchGroup,
				createdAt: condition.createdAt,
			})
			.run();
	}
	for (const action of actions) {
		await db
			.insert(ruleActions)
			.values({
				id: crypto.randomUUID(),
				ruleId,
				actionType:
					action.actionType as (typeof ruleActions.$inferInsert)["actionType"],
				actionValue: action.actionValue,
				executionOrder: action.executionOrder,
				createdAt: action.createdAt,
			})
			.run();
	}
	return ruleId;
}

async function getRuleById(
	db: ReturnType<typeof drizzle>,
	id: string,
): Promise<RuleSummary | null> {
	const row = await db.select().from(rules).where(eq(rules.id, id)).get();
	if (!row) return null;
	const conditions = await db
		.select()
		.from(ruleConditions)
		.where(eq(ruleConditions.ruleId, id))
		.all();
	const actions = await db
		.select()
		.from(ruleActions)
		.where(eq(ruleActions.ruleId, id))
		.all();
	return {
		id: row.id,
		name: row.name,
		triggerType: row.triggerType,
		isActive: row.isActive,
		priority: row.priority,
		stopProcessing: row.stopProcessing,
		inboxId: row.inboxId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		conditions: conditions.map((condition) => ({
			field: condition.field,
			operator: condition.operator,
			value: condition.value,
			matchGroup: condition.matchGroup,
		})),
		actions: actions.map((action) => ({
			actionType: action.actionType,
			actionValue: action.actionValue,
			executionOrder: action.executionOrder,
		})),
	};
}

// ---------------------------------------------------------------------------
// CANNED REPLIES
// ---------------------------------------------------------------------------

export async function listCannedReplies(
	env: Env,
): Promise<CannedReplySummary[]> {
	const db = drizzle(env.DB);
	const workspace = await getOrCreateWorkspace(db, new Date().toISOString());
	const rows = await db
		.select()
		.from(cannedReplies)
		.where(eq(cannedReplies.workspaceId, workspace.id))
		.orderBy(asc(cannedReplies.name))
		.all();
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		body: row.body,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
}

export async function createCannedReply(
	env: Env,
	input: CannedReplyWriteRequest,
): Promise<CannedReplySummary> {
	const db = drizzle(env.DB);
	const workspace = await getOrCreateWorkspace(db, new Date().toISOString());
	const now = new Date().toISOString();
	const name = input.name.trim();
	const body = input.body.trim();
	if (!name || !body) {
		throw new ManageError("name and body are required");
	}
	const row = {
		id: crypto.randomUUID(),
		workspaceId: workspace.id,
		name,
		body,
		createdAt: now,
		updatedAt: now,
	};
	await db.insert(cannedReplies).values(row).run();
	return { id: row.id, name, body, createdAt: now, updatedAt: now };
}

export async function updateCannedReply(
	env: Env,
	id: string,
	input: CannedReplyWriteRequest,
): Promise<CannedReplySummary> {
	const db = drizzle(env.DB);
	const existing = await db
		.select()
		.from(cannedReplies)
		.where(eq(cannedReplies.id, id))
		.get();
	if (!existing) throw new ManageError("canned reply not found", 404);
	const name = input.name.trim();
	const body = input.body.trim();
	if (!name || !body) {
		throw new ManageError("name and body are required");
	}
	const updatedAt = new Date().toISOString();
	await db
		.update(cannedReplies)
		.set({ name, body, updatedAt })
		.where(eq(cannedReplies.id, id))
		.run();
	return { id, name, body, createdAt: existing.createdAt, updatedAt };
}

export async function deleteCannedReply(env: Env, id: string): Promise<void> {
	const db = drizzle(env.DB);
	const existing = await db
		.select()
		.from(cannedReplies)
		.where(eq(cannedReplies.id, id))
		.get();
	if (!existing) throw new ManageError("canned reply not found", 404);
	await db.delete(cannedReplies).where(eq(cannedReplies.id, id)).run();
}

// ---------------------------------------------------------------------------
// INBOXES (ADR 0008 + routing spec): shared queues. Channels link via
// inbox_channels (exactly one default per channel — enforced by the partial
// unique index in migration 0004); agents join via inbox_members. All config
// mutations require workspace owner/admin; reads require workspace membership.
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function assertInboxConfig(
	input: {
		name?: string;
		color?: string;
		icon?: string | null;
		assignmentStrategy?: string;
		teamId?: string | null;
	},
	teamsInWorkspace: string[],
): { name?: string; icon?: string | null } {
	const cleaned: { name?: string; icon?: string | null } = {};
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new ManageError("inbox name is required");
		cleaned.name = name;
	}
	if (input.color !== undefined && !HEX_COLOR.test(input.color)) {
		throw new ManageError("color must be a hex value like #3B82F6");
	}
	if (input.icon !== undefined && input.icon !== null) {
		if (
			!INBOX_ICON_KEYS.includes(input.icon as (typeof INBOX_ICON_KEYS)[number])
		) {
			throw new ManageError(
				`icon must be one of: ${INBOX_ICON_KEYS.join(", ")}`,
			);
		}
		cleaned.icon = input.icon;
	}
	if (
		input.assignmentStrategy !== undefined &&
		!INBOX_ASSIGNMENT_STRATEGIES.includes(
			input.assignmentStrategy as (typeof INBOX_ASSIGNMENT_STRATEGIES)[number],
		)
	) {
		throw new ManageError(
			`assignmentStrategy must be one of: ${INBOX_ASSIGNMENT_STRATEGIES.join(", ")}`,
		);
	}
	if (input.teamId !== undefined && input.teamId !== null) {
		if (!teamsInWorkspace.includes(input.teamId)) {
			throw new ManageError("team does not belong to this workspace");
		}
	}
	return cleaned;
}

async function assertUniqueInboxName(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	name: string,
	excludeId?: string,
): Promise<void> {
	const existing = await db
		.select({ id: inboxes.id })
		.from(inboxes)
		.where(and(eq(inboxes.workspaceId, workspaceId), eq(inboxes.name, name)))
		.all();
	const clash = existing.find((row) => row.id !== excludeId);
	if (clash) {
		throw new ManageError(
			`an inbox named "${name}" already exists in this workspace`,
			409,
		);
	}
}

export async function listTeams(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<TeamSummary[]> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const rows = await db
		.select({ id: teams.id, name: teams.name })
		.from(teams)
		.where(eq(teams.workspaceId, workspaceId))
		.orderBy(asc(teams.name))
		.all();
	return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function listInboxes(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<InboxSummary[]> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const rows = await db
		.select()
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.orderBy(asc(inboxes.sortOrder), asc(inboxes.name))
		.all();
	if (rows.length === 0) return [];

	const inboxIds = rows.map((row) => row.id);
	const links = await db
		.select({
			inboxId: inboxChannels.inboxId,
			channelId: inboxChannels.channelId,
			isDefault: inboxChannels.isDefault,
			channelDisplayName: channels.displayName,
			channelType: channels.type,
		})
		.from(inboxChannels)
		.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
		.where(inArray(inboxChannels.inboxId, inboxIds))
		.all();
	const members = await db
		.select()
		.from(inboxMembers)
		.where(inArray(inboxMembers.inboxId, inboxIds))
		.all();
	const counts = await db
		.select({
			inboxId: conversations.inboxId,
			count: sqlCount(),
		})
		.from(conversations)
		.where(inArray(conversations.inboxId, inboxIds))
		.groupBy(conversations.inboxId)
		.all();
	const teamRows = await db
		.select({ id: teams.id, name: teams.name })
		.from(teams)
		.where(eq(teams.workspaceId, workspaceId))
		.all();
	const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

	const linksByInbox = new Map<string, InboxSummary["channels"]>();
	for (const link of links) {
		const list = linksByInbox.get(link.inboxId) ?? [];
		list.push({
			channelId: link.channelId,
			channelDisplayName: link.channelDisplayName,
			channelType: link.channelType,
			isDefault: link.isDefault,
		});
		linksByInbox.set(link.inboxId, list);
	}
	const membersByInbox = new Map<string, string[]>();
	for (const member of members) {
		const list = membersByInbox.get(member.inboxId) ?? [];
		list.push(member.userId);
		membersByInbox.set(member.inboxId, list);
	}
	const countByInbox = new Map<string, number>();
	for (const row of counts) countByInbox.set(row.inboxId, row.count ?? 0);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		description: row.description,
		color: row.color,
		icon: row.icon,
		teamId: row.teamId,
		teamName: row.teamId ? (teamNameById.get(row.teamId) ?? null) : null,
		sortOrder: row.sortOrder,
		isArchived: row.isArchived,
		assignmentStrategy: row.assignmentStrategy,
		isDefault: (linksByInbox.get(row.id) ?? []).some((link) => link.isDefault),
		channels: linksByInbox.get(row.id) ?? [],
		memberIds: membersByInbox.get(row.id) ?? [],
		conversationCount: countByInbox.get(row.id) ?? 0,
		createdAt: row.createdAt,
		updatedAtMs: row.updatedAt,
	}));
}

// SQL count helper (drizzle's count() needs an alias; this keeps the query flat).
function sqlCount() {
	return sql<number>`count(*)`;
}

export async function createInbox(
	env: Env,
	workspaceId: string,
	input: InboxCreateRequest,
	creatorUserId: string,
): Promise<InboxSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, creatorUserId);
	const now = new Date().toISOString();
	const name = input.name.trim();
	if (!name) throw new ManageError("inbox name is required");

	const teamIds = await db
		.select({ id: teams.id })
		.from(teams)
		.where(eq(teams.workspaceId, workspaceId))
		.all();
	const cleaned = assertInboxConfig(
		{ ...input, teamId: input.teamId ?? null },
		teamIds.map((t) => t.id),
	);
	await assertUniqueInboxName(db, workspaceId, name);

	const inboxId = crypto.randomUUID();
	const updatedAtMs = Date.now();
	await db
		.insert(inboxes)
		.values({
			id: inboxId,
			workspaceId,
			name: cleaned.name ?? name,
			description: input.description ?? null,
			color: input.color ?? "#64748B",
			icon: cleaned.icon ?? input.icon ?? null,
			teamId: input.teamId ?? null,
			assignmentStrategy: input.assignmentStrategy ?? "manual",
			createdAt: now,
			updatedAt: updatedAtMs,
		})
		.run();
	// The creator joins their own inbox; other agents join explicitly.
	await db
		.insert(inboxMembers)
		.values({ id: crypto.randomUUID(), inboxId, userId: creatorUserId })
		.onConflictDoNothing()
		.run();

	// First listed channel becomes this inbox's default for that channel
	// (demotion handled transactionally by setDefaultInbox).
	if (input.channelIds?.length) {
		for (const channelId of input.channelIds) {
			await setDefaultInbox(
				env,
				workspaceId,
				channelId,
				inboxId,
				creatorUserId,
			);
		}
	}

	const created = await getInboxById(db, inboxId);
	if (!created) throw new ManageError("inbox create failed");
	return created;
}

export async function updateInbox(
	env: Env,
	workspaceId: string,
	id: string,
	input: InboxUpdateRequest,
	actorUserId: string,
): Promise<InboxSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, id), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("inbox not found", 404);

	const teamIds = await db
		.select({ id: teams.id })
		.from(teams)
		.where(eq(teams.workspaceId, workspaceId))
		.all();
	const cleaned = assertInboxConfig(
		input,
		teamIds.map((t) => t.id),
	);

	const set: Partial<typeof inboxes.$inferInsert> = { updatedAt: Date.now() };
	if (cleaned.name !== undefined) {
		await assertUniqueInboxName(db, workspaceId, cleaned.name, id);
		set.name = cleaned.name;
	}
	if (input.description !== undefined) set.description = input.description;
	if (input.color !== undefined) set.color = input.color;
	if (input.icon !== undefined) set.icon = input.icon;
	if (input.teamId !== undefined) set.teamId = input.teamId;
	if (input.assignmentStrategy !== undefined) {
		set.assignmentStrategy = input.assignmentStrategy;
	}
	// Un-archive is allowed through PATCH; archiving goes through archiveInbox
	// so dependency validation runs (a channel's only default cannot archive).
	if (input.isArchived !== undefined && !input.isArchived) {
		set.isArchived = false;
	}

	await db.update(inboxes).set(set).where(eq(inboxes.id, id)).run();
	const updated = await getInboxById(db, id);
	if (!updated) throw new ManageError("inbox update failed");
	return updated;
}

/**
 * Archive an inbox. Rejected when the inbox is the ONLY active default for any
 * channel (the system never leaves an active channel without a default inbox).
 * Also rejected when the inbox is already archived (no-op protection).
 */
export async function archiveInbox(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<InboxSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, id), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("inbox not found", 404);
	if (existing.isArchived) return getInboxById(db, id) as Promise<InboxSummary>;

	// Dependency check: any channel for which this inbox is the only default?
	const channelIds = await db
		.select({ channelId: inboxChannels.channelId })
		.from(inboxChannels)
		.where(
			and(eq(inboxChannels.inboxId, id), eq(inboxChannels.isDefault, true)),
		)
		.all();
	if (channelIds.length > 0) {
		const ids = channelIds.map((row) => row.channelId);
		// Count ACTIVE defaults per channel (the archive check must not count
		// this inbox itself — it is the one being archived).
		const allDefaults = await db
			.select({ channelId: inboxChannels.channelId })
			.from(inboxChannels)
			.where(
				and(
					inArray(inboxChannels.channelId, ids),
					eq(inboxChannels.isDefault, true),
				),
			)
			.all();
		const defaultCounts = new Map<string, number>();
		for (const row of allDefaults) {
			const list = defaultCounts.get(row.channelId) ?? 0;
			defaultCounts.set(row.channelId, list + 1);
		}
		// Any channel where THIS inbox is the only default would be orphaned.
		const orphaned = ids.filter(
			(channelId) => (defaultCounts.get(channelId) ?? 0) <= 1,
		);
		if (orphaned.length > 0) {
			throw new ManageError(
				"cannot archive this inbox: it is the only default inbox for a connected channel. Set another default inbox for that channel first.",
				409,
			);
		}
	}

	await db
		.update(inboxes)
		.set({ isArchived: true, updatedAt: Date.now() })
		.where(eq(inboxes.id, id))
		.run();
	const archived = await getInboxById(db, id);
	if (!archived) throw new ManageError("inbox not found", 404);
	return archived;
}

export async function deleteInbox(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, id), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("inbox not found", 404);

	// Conversations in this inbox must re-route, never orphan (ADR 0008: the
	// FK is NOT NULL with no ON DELETE). Re-home to the workspace's first
	// remaining inbox, then remove links/members and the inbox itself.
	const fallback = await db
		.select()
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.all();
	const target = fallback.find((row) => row.id !== id);
	if (!target) throw new ManageError("cannot delete the last inbox", 409);

	await db
		.update(conversations)
		.set({ inboxId: target.id, updatedAt: new Date().toISOString() })
		.where(eq(conversations.inboxId, id))
		.run();
	await db.delete(inboxChannels).where(eq(inboxChannels.inboxId, id)).run();
	await db.delete(inboxMembers).where(eq(inboxMembers.inboxId, id)).run();
	await db.delete(inboxes).where(eq(inboxes.id, id)).run();
}

/**
 * Link a channel to an inbox. When isDefault, the link is made the channel's
 * default (transactionally demoting others). Archived inboxes can never be
 * selected as a default (they cannot receive new default-channel routing).
 */
export async function linkChannelToInbox(
	env: Env,
	workspaceId: string,
	inboxId: string,
	input: InboxChannelRequest,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const inbox = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, inboxId), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	const channel = await db
		.select()
		.from(channels)
		.where(
			and(
				eq(channels.id, input.channelId),
				eq(channels.workspaceId, workspaceId),
			),
		)
		.get();
	if (!channel) throw new ManageError("channel not found", 404);

	if (input.isDefault) {
		if (inbox.isArchived) {
			throw new ManageError(
				"an archived inbox cannot be a channel's default inbox",
				409,
			);
		}
		await setDefaultInbox(
			env,
			workspaceId,
			input.channelId,
			inboxId,
			actorUserId,
		);
		return;
	}

	await db
		.insert(inboxChannels)
		.values({
			id: crypto.randomUUID(),
			inboxId,
			channelId: input.channelId,
			isDefault: false,
		})
		.onConflictDoNothing()
		.run();
}

/**
 * Unlink a channel from an inbox. Rejected when the link is the channel's only
 * default: the system never leaves an active channel without a default inbox —
 * pick a replacement default first (POST .../channels/:channelId/default-inbox).
 */
export async function unlinkChannelFromInbox(
	env: Env,
	workspaceId: string,
	inboxId: string,
	channelId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);

	const link = await db
		.select()
		.from(inboxChannels)
		.where(
			and(
				eq(inboxChannels.inboxId, inboxId),
				eq(inboxChannels.channelId, channelId),
			),
		)
		.get();
	if (!link) throw new ManageError("channel link not found", 404);

	if (link.isDefault) {
		const otherDefaults = await db
			.select({ id: inboxChannels.id })
			.from(inboxChannels)
			.where(
				and(
					eq(inboxChannels.channelId, channelId),
					eq(inboxChannels.isDefault, true),
				),
			)
			.all();
		if (otherDefaults.length <= 1) {
			throw new ManageError(
				"cannot unlink: this is the channel's only default inbox. Set another default inbox for the channel first.",
				409,
			);
		}
	}
	await db
		.delete(inboxChannels)
		.where(
			and(
				eq(inboxChannels.inboxId, inboxId),
				eq(inboxChannels.channelId, channelId),
			),
		)
		.run();
}

/**
 * Make `inboxId` the channel's default inbox. Runs in a D1 transaction
 * (db.batch): unset every current default for the channel, then set the
 * target row — so the "exactly one default per channel" invariant holds even
 * mid-operation. The partial unique index (migration 0004) backstops it.
 */
export async function setDefaultInbox(
	env: Env,
	workspaceId: string,
	channelId: string,
	inboxId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);

	const channel = await db
		.select()
		.from(channels)
		.where(
			and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)),
		)
		.get();
	if (!channel) throw new ManageError("channel not found", 404);
	const inbox = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, inboxId), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	if (inbox.isArchived) {
		throw new ManageError(
			"an archived inbox cannot be a channel's default inbox",
			409,
		);
	}

	// Ensure a link row exists (link if the channel isn't connected here yet).
	await db
		.insert(inboxChannels)
		.values({
			id: crypto.randomUUID(),
			inboxId,
			channelId,
			isDefault: false,
		})
		.onConflictDoNothing()
		.run();

	await db.batch([
		db
			.update(inboxChannels)
			.set({ isDefault: false })
			.where(eq(inboxChannels.channelId, channelId)),
		db
			.update(inboxChannels)
			.set({ isDefault: true })
			.where(
				and(
					eq(inboxChannels.channelId, channelId),
					eq(inboxChannels.inboxId, inboxId),
				),
			),
	]);
}

/**
 * Shared admin ordering: rewrite sort_order across the given inbox ids.
 * Accepts the full ordered list of workspace inboxes; unknown ids or ids from
 * another workspace are rejected so sort_order never goes stale.
 */
export async function reorderInboxes(
	env: Env,
	workspaceId: string,
	inboxIds: string[],
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	if (!Array.isArray(inboxIds) || inboxIds.length === 0) {
		throw new ManageError("inboxIds is required");
	}
	const rows = await db
		.select({ id: inboxes.id, sortOrder: inboxes.sortOrder })
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.all();
	const validIds = new Set(rows.map((row) => row.id));
	const seen = new Set<string>();
	for (const id of inboxIds) {
		if (!validIds.has(id)) {
			throw new ManageError("inbox does not belong to this workspace", 404);
		}
		if (seen.has(id)) throw new ManageError("duplicate inboxId in reorder");
		seen.add(id);
	}
	// Partial orders are allowed: listed ids take 0..n in the given order, then
	// every untouched inbox is appended after them in its current order — so a
	// group-level drag never collides with (or silently demotes) the rest.
	const remaining = rows
		.filter((row) => !seen.has(row.id))
		.sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1));
	const nowMs = Date.now();
	const updates = [
		...inboxIds.map((id, index) =>
			db
				.update(inboxes)
				.set({ sortOrder: index, updatedAt: nowMs })
				.where(eq(inboxes.id, id)),
		),
		...remaining.map((row, index) =>
			db
				.update(inboxes)
				.set({ sortOrder: inboxIds.length + index, updatedAt: nowMs })
				.where(eq(inboxes.id, row.id)),
		),
	];
	await db.batch(
		updates as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
	);
}

export async function joinInbox(
	env: Env,
	workspaceId: string,
	inboxId: string,
	userId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const inbox = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, inboxId), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	await db
		.insert(inboxMembers)
		.values({ id: crypto.randomUUID(), inboxId, userId })
		.onConflictDoNothing()
		.run();
}

/**
 * Admin member management (drawer): add any workspace member to an inbox.
 * Self-service join stays in joinInbox; this requires owner/admin.
 */
export async function addInboxMember(
	env: Env,
	workspaceId: string,
	inboxId: string,
	targetUserId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const inbox = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, inboxId), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	if (!(await userBelongsToWorkspace(db, workspaceId, targetUserId))) {
		throw new ManageError("user is not a member of this workspace", 404);
	}
	await db
		.insert(inboxMembers)
		.values({ id: crypto.randomUUID(), inboxId, userId: targetUserId })
		.onConflictDoNothing()
		.run();
}

export async function removeInboxMember(
	env: Env,
	workspaceId: string,
	inboxId: string,
	targetUserId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const inbox = await db
		.select()
		.from(inboxes)
		.where(and(eq(inboxes.id, inboxId), eq(inboxes.workspaceId, workspaceId)))
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	await db
		.delete(inboxMembers)
		.where(
			and(
				eq(inboxMembers.inboxId, inboxId),
				eq(inboxMembers.userId, targetUserId),
			),
		)
		.run();
}

export async function leaveInbox(
	env: Env,
	workspaceId: string,
	inboxId: string,
	userId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, userId);
	await db
		.delete(inboxMembers)
		.where(
			and(eq(inboxMembers.inboxId, inboxId), eq(inboxMembers.userId, userId)),
		)
		.run();
}

async function getInboxById(
	db: ReturnType<typeof drizzle>,
	id: string,
): Promise<InboxSummary | null> {
	const row = await db.select().from(inboxes).where(eq(inboxes.id, id)).get();
	if (!row) return null;
	const links = await db
		.select({
			inboxId: inboxChannels.inboxId,
			channelId: inboxChannels.channelId,
			isDefault: inboxChannels.isDefault,
			channelDisplayName: channels.displayName,
			channelType: channels.type,
		})
		.from(inboxChannels)
		.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
		.where(eq(inboxChannels.inboxId, id))
		.all();
	const members = await db
		.select()
		.from(inboxMembers)
		.where(eq(inboxMembers.inboxId, id))
		.all();
	const count = await db
		.select({ c: sqlCount() })
		.from(conversations)
		.where(eq(conversations.inboxId, id))
		.get();
	let teamName: string | null = null;
	if (row.teamId) {
		const team = await db
			.select({ name: teams.name })
			.from(teams)
			.where(eq(teams.id, row.teamId))
			.get();
		teamName = team?.name ?? null;
	}
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		color: row.color,
		icon: row.icon,
		teamId: row.teamId,
		teamName,
		sortOrder: row.sortOrder,
		isArchived: row.isArchived,
		assignmentStrategy: row.assignmentStrategy,
		isDefault: links.some((link) => link.isDefault),
		channels: links.map((link) => ({
			channelId: link.channelId,
			channelDisplayName: link.channelDisplayName,
			channelType: link.channelType,
			isDefault: link.isDefault,
		})),
		memberIds: members.map((member) => member.userId),
		conversationCount: count?.c ?? 0,
		createdAt: row.createdAt,
		updatedAtMs: row.updatedAt,
	};
}
