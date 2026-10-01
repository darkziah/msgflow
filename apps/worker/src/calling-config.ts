import {
	callQueueStages,
	callQueues,
	channels,
	metaApps,
	ringGroupMembers,
	ringGroups,
	teamMembers,
	teams,
} from "@msgflow/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Schema } from "effect";
import { requireAdminAccess } from "./access";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { configureMessengerInboundCalling } from "./facebook-calling-provider";

const Identifier = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(128),
);
const ShortName = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120));
const StageSchema = Schema.Struct({
	ringGroupId: Identifier,
	ringDurationSeconds: Schema.Number.pipe(Schema.int(), Schema.between(1, 50)),
});
const DayOfWeekSchema = Schema.Literal(
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
	"SUNDAY",
);
const OperatingTimeSchema = Schema.String.pipe(
	Schema.pattern(/^(?:[01]\d|2[0-3])[0-5]\d$/),
);
const WeeklyOperatingHoursSchema = Schema.Array(
	Schema.Struct({
		day_of_week: DayOfWeekSchema,
		open_time: OperatingTimeSchema,
		close_time: OperatingTimeSchema,
	}),
).pipe(Schema.maxItems(14));
type WeeklyOperatingHours = Schema.Schema.Type<
	typeof WeeklyOperatingHoursSchema
>;

/** Request bodies are decoded at the route boundary; workspace and actor stay route-derived. */
export const RingGroupWriteSchema = Schema.Struct({
	teamId: Identifier,
	name: ShortName,
	strategy: Schema.Literal("simultaneous", "round_robin"),
	memberIds: Schema.Array(Identifier).pipe(
		Schema.minItems(1),
		Schema.maxItems(50),
	),
});
export type RingGroupWriteInput = Schema.Schema.Type<
	typeof RingGroupWriteSchema
>;

export const CallQueueWriteSchema = Schema.Struct({
	channelId: Identifier,
	teamId: Identifier,
	name: ShortName,
	timezoneId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120)),
	weeklyOperatingHours: WeeklyOperatingHoursSchema,
	noAgentReplyText: Schema.String.pipe(Schema.maxLength(2_000)),
	stages: Schema.Array(StageSchema).pipe(
		Schema.minItems(1),
		Schema.maxItems(50),
	),
});
export type CallQueueWriteInput = Schema.Schema.Type<
	typeof CallQueueWriteSchema
>;
export type QueueStageInput = Schema.Schema.Type<typeof StageSchema>;

function serializeWeeklyOperatingHours(value: WeeklyOperatingHours): string {
	const perDay = new Map<string, Array<{ open: number; close: number }>>();
	for (const entry of value) {
		const open = Number(entry.open_time);
		const close = Number(entry.close_time);
		if (open >= close)
			throw new ManageError(
				"weekly operating hours open_time must precede close_time",
			);
		const day = perDay.get(entry.day_of_week) ?? [];
		if (day.length >= 2)
			throw new ManageError(
				"weekly operating hours allows at most two intervals per day",
			);
		if (day.some((interval) => open < interval.close && close > interval.open))
			throw new ManageError(
				"weekly operating hours intervals must not overlap",
			);
		day.push({ open, close });
		perDay.set(entry.day_of_week, day);
	}
	return JSON.stringify(value);
}

function toD1Statement(
	env: Env,
	query: { toSQL(): { sql: string; params: unknown[] } },
) {
	const { sql, params } = query.toSQL();
	return env.DB.prepare(sql).bind(...params);
}

function isConstraintFailure(error: unknown): boolean {
	return (
		error instanceof Error && /constraint|foreign key/i.test(error.message)
	);
}

export interface RingGroupSummary {
	id: string;
	teamId: string;
	name: string;
	strategy: "simultaneous" | "round_robin";
	memberIds: string[];
}

export interface CallQueueSummary {
	id: string;
	channelId: string;
	teamId: string;
	name: string;
	timezoneId: string;
	weeklyOperatingHours: WeeklyOperatingHours;
	noAgentReplyText: string;
	isEnabled: boolean;
	stages: Array<{ ringGroupId: string; ringDurationSeconds: number }>;
}

function validateStages(stages: readonly QueueStageInput[]): void {
	const total = stages.reduce(
		(sum, stage) => sum + stage.ringDurationSeconds,
		0,
	);
	if (total > 50)
		throw new ManageError("queue stages cannot total more than 50 seconds");
	if (
		new Set(stages.map((stage) => stage.ringGroupId)).size !== stages.length
	) {
		throw new ManageError("a ring group can appear only once in a queue");
	}
}

async function requireTeam(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	teamId: string,
) {
	const team = await db
		.select({ id: teams.id })
		.from(teams)
		.where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
		.get();
	if (!team) throw new ManageError("team not found", 404);
}

async function requireMembersOnTeam(
	db: ReturnType<typeof drizzle>,
	teamId: string,
	memberIds: readonly string[],
) {
	if (new Set(memberIds).size !== memberIds.length)
		throw new ManageError("ring group members must be unique");
	const found = await db
		.select({ userId: teamMembers.userId })
		.from(teamMembers)
		.where(
			and(
				eq(teamMembers.teamId, teamId),
				inArray(teamMembers.userId, memberIds),
			),
		)
		.all();
	if (found.length !== memberIds.length)
		throw new ManageError("each ring group member must be a team member");
}

async function requireFacebookChannel(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	channelId: string,
) {
	const channel = await db
		.select({ id: channels.id, type: channels.type, status: channels.status })
		.from(channels)
		.where(
			and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)),
		)
		.get();
	if (!channel) throw new ManageError("channel not found", 404);
	if (channel.type !== "facebook_page" || channel.status !== "active") {
		throw new ManageError("an active Facebook Page channel is required");
	}
}

async function requireQueue(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	queueId: string,
) {
	const queue = await db
		.select()
		.from(callQueues)
		.where(
			and(eq(callQueues.id, queueId), eq(callQueues.workspaceId, workspaceId)),
		)
		.get();
	if (!queue) throw new ManageError("call queue not found", 404);
	return queue;
}

async function requireStageGroups(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	teamId: string,
	stages: readonly QueueStageInput[],
) {
	validateStages(stages);
	const found = await db
		.select({ id: ringGroups.id, teamId: ringGroups.teamId })
		.from(ringGroups)
		.where(
			and(
				eq(ringGroups.workspaceId, workspaceId),
				inArray(
					ringGroups.id,
					stages.map((stage) => stage.ringGroupId),
				),
			),
		)
		.all();
	if (found.length !== stages.length)
		throw new ManageError("ring group not found", 404);
	if (found.some((group) => group.teamId !== teamId))
		throw new ManageError(
			"each queue ring group must belong to the queue team",
		);
}

async function summarizeRingGroup(
	db: ReturnType<typeof drizzle>,
	group: typeof ringGroups.$inferSelect,
): Promise<RingGroupSummary> {
	const members = await db
		.select({ userId: ringGroupMembers.userId })
		.from(ringGroupMembers)
		.where(eq(ringGroupMembers.ringGroupId, group.id))
		.orderBy(asc(ringGroupMembers.sortOrder))
		.all();
	return {
		id: group.id,
		teamId: group.teamId,
		name: group.name,
		strategy: group.strategy,
		memberIds: members.map((member) => member.userId),
	};
}

async function summarizeQueue(
	db: ReturnType<typeof drizzle>,
	queue: typeof callQueues.$inferSelect,
): Promise<CallQueueSummary> {
	const stages = await db
		.select({
			ringGroupId: callQueueStages.ringGroupId,
			ringDurationSeconds: callQueueStages.ringDurationSeconds,
		})
		.from(callQueueStages)
		.where(eq(callQueueStages.queueId, queue.id))
		.orderBy(asc(callQueueStages.stageOrder))
		.all();
	let weeklyOperatingHours: WeeklyOperatingHours;
	try {
		weeklyOperatingHours = JSON.parse(
			queue.weeklyOperatingHoursJson,
		) as WeeklyOperatingHours;
	} catch {
		weeklyOperatingHours = [];
	}
	return {
		id: queue.id,
		channelId: queue.channelId,
		teamId: queue.teamId,
		name: queue.name,
		timezoneId: queue.timezoneId,
		weeklyOperatingHours,
		noAgentReplyText: queue.noAgentReplyText,
		isEnabled: queue.isEnabled,
		stages,
	};
}

export async function listRingGroups(
	env: Env,
	workspaceId: string,
	actorUserId: string,
): Promise<RingGroupSummary[]> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	return Promise.all(
		(
			await db
				.select()
				.from(ringGroups)
				.where(eq(ringGroups.workspaceId, workspaceId))
				.orderBy(asc(ringGroups.name))
				.all()
		).map((group) => summarizeRingGroup(db, group)),
	);
}

export async function createRingGroup(
	env: Env,
	workspaceId: string,
	input: RingGroupWriteInput,
	actorUserId: string,
): Promise<RingGroupSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	await requireTeam(db, workspaceId, input.teamId);
	await requireMembersOnTeam(db, input.teamId, input.memberIds);
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	const createGroup = db.insert(ringGroups).values({
		id,
		workspaceId,
		teamId: input.teamId,
		name: input.name,
		strategy: input.strategy,
		createdAt: now,
		updatedAt: now,
	});
	const createMembers = db.insert(ringGroupMembers).values(
		input.memberIds.map((userId, sortOrder) => ({
			id: crypto.randomUUID(),
			ringGroupId: id,
			userId,
			sortOrder,
			createdAt: now,
		})),
	);
	await env.DB.batch([
		toD1Statement(env, createGroup),
		toD1Statement(env, createMembers),
	]);
	const created = await db
		.select()
		.from(ringGroups)
		.where(eq(ringGroups.id, id))
		.get();
	if (!created) throw new ManageError("ring group not found", 404);
	return summarizeRingGroup(db, created);
}

export async function updateRingGroup(
	env: Env,
	workspaceId: string,
	ringGroupId: string,
	input: RingGroupWriteInput,
	actorUserId: string,
): Promise<RingGroupSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const group = await db
		.select({ id: ringGroups.id, teamId: ringGroups.teamId })
		.from(ringGroups)
		.where(
			and(
				eq(ringGroups.id, ringGroupId),
				eq(ringGroups.workspaceId, workspaceId),
			),
		)
		.get();
	if (!group) throw new ManageError("ring group not found", 404);
	await requireTeam(db, workspaceId, input.teamId);
	await requireMembersOnTeam(db, input.teamId, input.memberIds);
	if (group.teamId !== input.teamId) {
		const queueReferences = await db
			.select({ teamId: callQueues.teamId })
			.from(callQueueStages)
			.innerJoin(callQueues, eq(callQueueStages.queueId, callQueues.id))
			.where(eq(callQueueStages.ringGroupId, ringGroupId))
			.all();
		if (queueReferences.some((queue) => queue.teamId !== input.teamId)) {
			throw new ManageError(
				"ring group team cannot change while used by another queue team",
				409,
			);
		}
	}
	const now = new Date().toISOString();
	const updateGroup = db
		.update(ringGroups)
		.set({
			teamId: input.teamId,
			name: input.name,
			strategy: input.strategy,
			updatedAt: now,
		})
		.where(eq(ringGroups.id, ringGroupId));
	const deleteMembers = db
		.delete(ringGroupMembers)
		.where(eq(ringGroupMembers.ringGroupId, ringGroupId));
	const createMembers = db.insert(ringGroupMembers).values(
		input.memberIds.map((userId, sortOrder) => ({
			id: crypto.randomUUID(),
			ringGroupId,
			userId,
			sortOrder,
			createdAt: now,
		})),
	);
	await env.DB.batch([
		toD1Statement(env, updateGroup),
		toD1Statement(env, deleteMembers),
		toD1Statement(env, createMembers),
	]);
	const updated = await db
		.select()
		.from(ringGroups)
		.where(eq(ringGroups.id, ringGroupId))
		.get();
	if (!updated) throw new ManageError("ring group not found", 404);
	return summarizeRingGroup(db, updated);
}

export async function deleteRingGroup(
	env: Env,
	workspaceId: string,
	ringGroupId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const group = await db
		.select({ id: ringGroups.id })
		.from(ringGroups)
		.where(
			and(
				eq(ringGroups.id, ringGroupId),
				eq(ringGroups.workspaceId, workspaceId),
			),
		)
		.get();
	if (!group) throw new ManageError("ring group not found", 404);
	const deleteMembers = db
		.delete(ringGroupMembers)
		.where(eq(ringGroupMembers.ringGroupId, ringGroupId));
	const deleteGroup = db
		.delete(ringGroups)
		.where(
			and(
				eq(ringGroups.id, ringGroupId),
				eq(ringGroups.workspaceId, workspaceId),
			),
		);
	try {
		await env.DB.batch([
			toD1Statement(env, deleteMembers),
			toD1Statement(env, deleteGroup),
		]);
	} catch (error) {
		if (isConstraintFailure(error)) {
			throw new ManageError(
				"ring group cannot be deleted while used by a call queue",
				409,
			);
		}
		throw error;
	}
}

export async function listCallQueues(
	env: Env,
	workspaceId: string,
	actorUserId: string,
): Promise<CallQueueSummary[]> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	return Promise.all(
		(
			await db
				.select()
				.from(callQueues)
				.where(eq(callQueues.workspaceId, workspaceId))
				.orderBy(asc(callQueues.name))
				.all()
		).map((queue) => summarizeQueue(db, queue)),
	);
}

export async function createCallQueue(
	env: Env,
	workspaceId: string,
	input: CallQueueWriteInput,
	actorUserId: string,
): Promise<CallQueueSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	await requireTeam(db, workspaceId, input.teamId);
	await requireFacebookChannel(db, workspaceId, input.channelId);
	await requireStageGroups(db, workspaceId, input.teamId, input.stages);
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	const weeklyOperatingHoursJson = serializeWeeklyOperatingHours(
		input.weeklyOperatingHours,
	);
	const createQueue = db.insert(callQueues).values({
		id,
		workspaceId,
		channelId: input.channelId,
		teamId: input.teamId,
		name: input.name,
		isEnabled: false,
		noAgentReplyText: input.noAgentReplyText,
		timezoneId: input.timezoneId,
		weeklyOperatingHoursJson,
		createdAt: now,
		updatedAt: now,
	});
	const createStages = db.insert(callQueueStages).values(
		input.stages.map((stage, stageOrder) => ({
			id: crypto.randomUUID(),
			queueId: id,
			ringGroupId: stage.ringGroupId,
			ringDurationSeconds: stage.ringDurationSeconds,
			stageOrder,
			createdAt: now,
		})),
	);
	await env.DB.batch([
		toD1Statement(env, createQueue),
		toD1Statement(env, createStages),
	]);
	const created = await db
		.select()
		.from(callQueues)
		.where(eq(callQueues.id, id))
		.get();
	if (!created) throw new ManageError("call queue not found", 404);
	return summarizeQueue(db, created);
}

export async function updateQueueStages(
	env: Env,
	workspaceId: string,
	queueId: string,
	stages: readonly QueueStageInput[],
	actorUserId: string,
): Promise<CallQueueSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const queue = await requireQueue(db, workspaceId, queueId);
	await requireStageGroups(db, workspaceId, queue.teamId, stages);
	const now = new Date().toISOString();
	const deleteStages = db
		.delete(callQueueStages)
		.where(eq(callQueueStages.queueId, queueId));
	const createStages = db.insert(callQueueStages).values(
		stages.map((stage, stageOrder) => ({
			id: crypto.randomUUID(),
			queueId,
			ringGroupId: stage.ringGroupId,
			ringDurationSeconds: stage.ringDurationSeconds,
			stageOrder,
			createdAt: now,
		})),
	);
	const updateQueue = db
		.update(callQueues)
		.set({ isEnabled: false, updatedAt: now })
		.where(eq(callQueues.id, queueId));
	await env.DB.batch([
		toD1Statement(env, deleteStages),
		toD1Statement(env, createStages),
		toD1Statement(env, updateQueue),
	]);
	return summarizeQueue(db, await requireQueue(db, workspaceId, queueId));
}

export async function updateCallQueue(
	env: Env,
	workspaceId: string,
	queueId: string,
	input: CallQueueWriteInput,
	actorUserId: string,
): Promise<CallQueueSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	await requireQueue(db, workspaceId, queueId);
	await requireTeam(db, workspaceId, input.teamId);
	await requireFacebookChannel(db, workspaceId, input.channelId);
	await requireStageGroups(db, workspaceId, input.teamId, input.stages);
	const now = new Date().toISOString();
	const weeklyOperatingHoursJson = serializeWeeklyOperatingHours(
		input.weeklyOperatingHours,
	);
	const updateQueue = db
		.update(callQueues)
		.set({
			channelId: input.channelId,
			teamId: input.teamId,
			name: input.name,
			timezoneId: input.timezoneId,
			noAgentReplyText: input.noAgentReplyText,
			weeklyOperatingHoursJson,
			isEnabled: false,
			updatedAt: now,
		})
		.where(eq(callQueues.id, queueId));
	const deleteStages = db
		.delete(callQueueStages)
		.where(eq(callQueueStages.queueId, queueId));
	const createStages = db.insert(callQueueStages).values(
		input.stages.map((stage, stageOrder) => ({
			id: crypto.randomUUID(),
			queueId,
			ringGroupId: stage.ringGroupId,
			ringDurationSeconds: stage.ringDurationSeconds,
			stageOrder,
			createdAt: now,
		})),
	);
	await env.DB.batch([
		toD1Statement(env, updateQueue),
		toD1Statement(env, deleteStages),
		toD1Statement(env, createStages),
	]);
	return summarizeQueue(db, await requireQueue(db, workspaceId, queueId));
}

export async function enableCallQueue(
	env: Env,
	workspaceId: string,
	queueId: string,
	actorUserId: string,
): Promise<CallQueueSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const queue = await requireQueue(db, workspaceId, queueId);
	const channel = await db
		.select({
			externalId: channels.externalId,
			accessToken: channels.accessToken,
			metaAppId: channels.metaAppId,
			type: channels.type,
			status: channels.status,
		})
		.from(channels)
		.where(
			and(
				eq(channels.id, queue.channelId),
				eq(channels.workspaceId, workspaceId),
			),
		)
		.get();
	if (
		channel?.type !== "facebook_page" ||
		channel.status !== "active" ||
		!channel.metaAppId ||
		!channel.accessToken
	) {
		throw new ManageError(
			"an active Facebook Page channel with a connected Meta App is required",
		);
	}
	const metaApp = await db
		.select({ confirmedAt: metaApps.webhookSubscriptionConfirmedAt })
		.from(metaApps)
		.where(
			and(
				eq(metaApps.id, channel.metaAppId),
				eq(metaApps.workspaceId, workspaceId),
			),
		)
		.get();
	if (!metaApp?.confirmedAt) {
		throw new ManageError(
			"Before enabling calling, an Owner must confirm in Meta that this App callback is verified and its webhook subscription includes calls",
			409,
		);
	}

	// A lease is deliberately separate from is_enabled: dispatch cannot observe
	// it. The partial unique index fences a competing enable before any Graph IO.
	const lease = crypto.randomUUID();
	const reserved = await env.DB
		.prepare(
			`UPDATE call_queues
			 SET provisioning_lease_token = ?, updated_at = ?
			 WHERE id = ? AND workspace_id = ?
			   AND is_enabled = 0 AND provisioning_lease_token IS NULL
			   AND NOT EXISTS (
				 SELECT 1 FROM call_queues AS contender
				 WHERE contender.channel_id = call_queues.channel_id
				   AND (contender.is_enabled = 1 OR contender.provisioning_lease_token IS NOT NULL)
			   )`,
		)
		.bind(lease, new Date().toISOString(), queueId, workspaceId)
		.run();
	if (!reserved.meta.changes) {
		throw new ManageError(
			"another enabled or provisioning call queue already owns this Facebook Page",
			409,
		);
	}
	try {
		await configureMessengerInboundCalling({
			pageId: channel.externalId,
			encryptedPageAccessToken: channel.accessToken,
			channelTokenEncryptionKey: env.CHANNEL_TOKEN_ENCRYPTION_KEY,
			timezoneId: queue.timezoneId,
			weeklyOperatingHours: JSON.parse(
				queue.weeklyOperatingHoursJson,
			) as WeeklyOperatingHours,
		});
		const completed = await env.DB
			.prepare(
				"UPDATE call_queues SET is_enabled = 1, provisioning_lease_token = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND provisioning_lease_token = ?",
			)
			.bind(new Date().toISOString(), queueId, workspaceId, lease)
			.run();
		if (!completed.meta.changes)
			throw new ManageError(
				"call queue enable was cancelled because the queue was disabled",
				409,
			);
	} catch (error) {
		// Clear only our lease. A provider failure never makes the queue active.
		await env.DB
			.prepare(
				"UPDATE call_queues SET provisioning_lease_token = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND provisioning_lease_token = ?",
			)
			.bind(new Date().toISOString(), queueId, workspaceId, lease)
			.run();
		throw error;
	}
	return summarizeQueue(db, await requireQueue(db, workspaceId, queueId));
}

/**
 * Disabling is intentionally local-only: it immediately prevents MsgFlow call
 * dispatch, but does not change Page-wide Meta routing or icon visibility until
 * product policy explicitly chooses the operator consequence of doing so.
 */
export async function disableCallQueue(
	env: Env,
	workspaceId: string,
	queueId: string,
	actorUserId: string,
): Promise<CallQueueSummary> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	await requireQueue(db, workspaceId, queueId);
	const disable = db
		.update(callQueues)
		.set({
			isEnabled: false,
			provisioningLeaseToken: null,
			updatedAt: new Date().toISOString(),
		})
		.where(
			and(eq(callQueues.id, queueId), eq(callQueues.workspaceId, workspaceId)),
		);
	await env.DB.batch([toD1Statement(env, disable)]);
	return summarizeQueue(db, await requireQueue(db, workspaceId, queueId));
}

export async function deleteCallQueue(
	env: Env,
	workspaceId: string,
	queueId: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireAdminAccess(db, workspaceId, actorUserId);
	const result = await db
		.delete(callQueues)
		.where(
			and(eq(callQueues.id, queueId), eq(callQueues.workspaceId, workspaceId)),
		)
		.run();
	if (!result.meta.changes) throw new ManageError("call queue not found", 404);
}
