import { and, asc, eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
	cannedReplies,
	conversationTags,
	inboxes,
	ruleActions,
	ruleConditions,
	ruleExecutionLog,
	rules,
	scheduledMessages,
	tags,
	teamMembers,
	teams,
	type RuleAction,
	type RuleCondition,
} from "@msgflow/db";
import type { Env } from "./env";
import { userBelongsToWorkspace } from "./access";

/**
 * Rules engine (ADR 0009 + routing spec): synchronous pre-append evaluation in
 * the ingest path — after contact/channel/inbox resolution, before the DO
 * append — so the DO receives a fully-routed message (final inbox, assignee,
 * tags, status).
 *
 * Semantics:
 * - Rules are ordered by priority asc, then created_at asc.
 * - Routing actions (assign_user, assign_team, move_inbox) are first-match-wins
 *   in rule order; additive actions (add_tag, remove_tag, set_status,
 *   send_canned_reply) all apply.
 * - Conditions: match_group members are OR'd; groups are AND'd. A rule with no
 *   conditions matches everything.
 * - Every candidate rule evaluation is logged: matched, skipped (no condition
 *   match / invalid target), or error.
 * - A matching rule with stop_processing = true halts further evaluation.
 * - Action targets are validated against the workspace: move_inbox rejects
 *   archived inboxes (archived inboxes cannot receive rule-routing), and
 *   assign/tag/reply targets must belong to the workspace.
 * - Canned replies never recurse: outbound sends go through the DO append
 *   path, never back through routeInbound, and the ingest dedup key
 *   (processed_messages) prevents re-running this chain for a replay.
 */

export interface RuleEvaluationContext {
	conversationId: string;
	workspaceId: string;
	/** Inbox the conversation currently sits in (rules may re-route it). */
	inboxId: string;
	assigneeId: string | null;
	status: "open" | "archived";
	channelType: "facebook_page" | "email";
	/** Email sender address; null on Facebook. */
	senderEmail: string | null;
	/** Email subject; null on Facebook. */
	subject: string | null;
	messageText: string;
	/** Tag ids already on the conversation (condition field "tags"). */
	conversationTagIds: string[];
}

export interface RuleOutcome {
	inboxId: string;
	assigneeId: string | null;
	status: "open" | "archived";
}

export async function evaluateRules(
	env: Env,
	ctx: RuleEvaluationContext,
): Promise<RuleOutcome> {
	const outcome: RuleOutcome = {
		inboxId: ctx.inboxId,
		assigneeId: ctx.assigneeId,
		status: ctx.status,
	};
	const db = drizzle(env.DB);
	const now = () => new Date().toISOString();

	// Workspace-wide rules + rules scoped to the conversation's current inbox.
	const candidates = await db
		.select()
		.from(rules)
		.where(
			and(
				eq(rules.workspaceId, ctx.workspaceId),
				eq(rules.isActive, true),
				eq(rules.triggerType, "message_received"),
				or(eq(rules.inboxId, ctx.inboxId), isNull(rules.inboxId)),
			),
		)
		.orderBy(asc(rules.priority), asc(rules.createdAt))
		.all();

	let routingApplied = false;

	for (const rule of candidates) {
		const conditions = await db
			.select()
			.from(ruleConditions)
			.where(eq(ruleConditions.ruleId, rule.id))
			.orderBy(asc(ruleConditions.matchGroup), asc(ruleConditions.createdAt))
			.all();
		if (!matchConditions(conditions, ctx)) {
			await logExecution(
				db,
				rule.id,
				ctx.conversationId,
				"skipped",
				"conditions did not match",
				now(),
			);
			continue;
		}

		const actions = await db
			.select()
			.from(ruleActions)
			.where(eq(ruleActions.ruleId, rule.id))
			.orderBy(asc(ruleActions.executionOrder))
			.all();

		const applied: string[] = [];
		try {
			for (const action of actions) {
				const isRouting = isRoutingAction(action.actionType);
				if (isRouting && routingApplied) {
					applied.push(`${action.actionType}:skipped`);
					continue;
				}
				const result = await applyAction(db, action, ctx, outcome, now());
				if (isRouting && result === "applied") routingApplied = true;
				applied.push(`${action.actionType}:${result}`);
			}
			await logExecution(
				db,
				rule.id,
				ctx.conversationId,
				"matched",
				applied.join(", "),
				now(),
			);
		} catch (err) {
			await logExecution(
				db,
				rule.id,
				ctx.conversationId,
				"error",
				err instanceof Error ? err.message : String(err),
				now(),
			);
		}

		// stop_processing: an explicitly configured matching rule halts the
		// chain — later-priority rules never run for this message.
		if (rule.stopProcessing) break;
	}

	return outcome;
}

function isRoutingAction(
	actionType: RuleAction["actionType"],
): actionType is "assign_user" | "assign_team" | "move_inbox" {
	return (
		actionType === "assign_user" ||
		actionType === "assign_team" ||
		actionType === "move_inbox"
	);
}

function matchConditions(
	conditions: RuleCondition[],
	ctx: RuleEvaluationContext,
): boolean {
	if (conditions.length === 0) return true;
	// Group conditions by match_group; groups are AND'd, members within OR'd.
	const groups = new Map<number, RuleCondition[]>();
	for (const condition of conditions) {
		const group = groups.get(condition.matchGroup) ?? [];
		group.push(condition);
		groups.set(condition.matchGroup, group);
	}
	for (const group of groups.values()) {
		if (!group.some((c) => evalCondition(c, ctx))) return false;
	}
	return true;
}

function resolveField(
	field: string,
	ctx: RuleEvaluationContext,
): string | null {
	switch (field) {
		case "sender.email":
			return ctx.senderEmail;
		case "channel.type":
			return ctx.channelType;
		case "message.body":
			return ctx.messageText;
		case "subject":
			return ctx.subject;
		case "status":
			return ctx.status;
		case "inbox.id":
			return ctx.inboxId;
		default:
			return null; // unknown field → condition never matches
	}
}

function evalCondition(
	condition: RuleCondition,
	ctx: RuleEvaluationContext,
): boolean {
	const expected = condition.value;
	// "tags" is a set condition (tag ids on the conversation), not a scalar.
	if (condition.field === "tags") {
		switch (condition.operator) {
			case "contains":
				return ctx.conversationTagIds.includes(expected);
			case "not_contains":
				return !ctx.conversationTagIds.includes(expected);
			case "equals":
				return (
					ctx.conversationTagIds.length === 1 &&
					ctx.conversationTagIds[0] === expected
				);
			case "not_equals":
				return (
					ctx.conversationTagIds.length !== 1 ||
					ctx.conversationTagIds[0] !== expected
				);
			default:
				return false;
		}
	}
	const actual = resolveField(condition.field, ctx);
	if (actual === null) return false;
	switch (condition.operator) {
		case "equals":
			return actual === expected;
		case "not_equals":
			return actual !== expected;
		case "contains":
			return actual.includes(expected);
		case "not_contains":
			return !actual.includes(expected);
		case "starts_with":
			return actual.startsWith(expected);
		case "ends_with":
			return actual.endsWith(expected);
		case "regex":
			try {
				return new RegExp(expected).test(actual);
			} catch {
				return false; // malformed regex → no match
			}
		default:
			return false; // unknown operator → no match
	}
}

type ApplyResult = "applied" | "skipped";

async function applyAction(
	db: ReturnType<typeof drizzle>,
	action: RuleAction,
	ctx: RuleEvaluationContext,
	outcome: RuleOutcome,
	now: string,
): Promise<ApplyResult> {
	switch (action.actionType) {
		case "assign_user": {
			// The assignee must be an active workspace member.
			if (
				!(await userBelongsToWorkspace(db, ctx.workspaceId, action.actionValue))
			) {
				return "skipped";
			}
			outcome.assigneeId = action.actionValue;
			return "applied";
		}

		case "assign_team": {
			// Team must belong to the workspace; first team member becomes the
			// assignee (round-robin/least-busy counters are a later phase).
			const team = await db
				.select({ id: teams.id })
				.from(teams)
				.where(
					and(
						eq(teams.id, action.actionValue),
						eq(teams.workspaceId, ctx.workspaceId),
					),
				)
				.get();
			if (!team) return "skipped";
			const member = await db
				.select({ userId: teamMembers.userId })
				.from(teamMembers)
				.where(eq(teamMembers.teamId, action.actionValue))
				.get();
			if (!member) return "skipped";
			outcome.assigneeId = member.userId;
			return "applied";
		}

		case "move_inbox": {
			// Destination must exist, belong to this workspace, and be active —
			// archived inboxes cannot receive new rule-routing actions.
			const target = await db
				.select({ id: inboxes.id, isArchived: inboxes.isArchived })
				.from(inboxes)
				.where(
					and(
						eq(inboxes.id, action.actionValue),
						eq(inboxes.workspaceId, ctx.workspaceId),
					),
				)
				.get();
			if (!target || target.isArchived) return "skipped";
			outcome.inboxId = action.actionValue;
			return "applied";
		}

		case "add_tag": {
			if (!(await workspaceHasTag(db, ctx.workspaceId, action.actionValue))) {
				return "skipped";
			}
			await db
				.insert(conversationTags)
				.values({
					id: crypto.randomUUID(),
					conversationId: ctx.conversationId,
					tagId: action.actionValue,
					createdAt: now,
				})
				.onConflictDoNothing()
				.run();
			return "applied";
		}

		case "remove_tag": {
			if (!(await workspaceHasTag(db, ctx.workspaceId, action.actionValue))) {
				return "skipped";
			}
			await db
				.delete(conversationTags)
				.where(
					and(
						eq(conversationTags.conversationId, ctx.conversationId),
						eq(conversationTags.tagId, action.actionValue),
					),
				)
				.run();
			return "applied";
		}

		case "set_status": {
			// Domain status is open | archived only (ADR 0008). Map legacy literals
			// defensively: closed → archived, snoozed → open (snoozing is orthogonal,
			// handled via snoozed_until).
			if (action.actionValue === "open" || action.actionValue === "archived") {
				outcome.status = action.actionValue;
				return "applied";
			}
			if (action.actionValue === "closed") {
				outcome.status = "archived";
				return "applied";
			}
			if (action.actionValue === "snoozed") {
				outcome.status = "open";
				return "applied";
			}
			return "skipped";
		}

		case "send_canned_reply": {
			const reply = await db
				.select({ body: cannedReplies.body })
				.from(cannedReplies)
				.where(
					and(
						eq(cannedReplies.id, action.actionValue),
						eq(cannedReplies.workspaceId, ctx.workspaceId),
					),
				)
				.get();
			if (!reply) return "skipped";
			// Enqueue through the send-later machinery: the next cron tick delivers
			// it. Keeps the ingest path synchronous and provider-call-free, and
			// gives retries for free (ADR 0013). The delivered message is an
			// outbound DO append — it never re-enters routeInbound, so canned
			// replies cannot recursively trigger this rule chain.
			await db
				.insert(scheduledMessages)
				.values({
					id: crypto.randomUUID(),
					conversationId: ctx.conversationId,
					text: reply.body,
					sendAt: now,
					createdBy: null,
				})
				.run();
			return "applied";
		}
		default:
			return "skipped"; // unknown action type (defensive; enum covers all)
	}
}

async function workspaceHasTag(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	tagId: string,
): Promise<boolean> {
	const tag = await db
		.select({ id: tags.id })
		.from(tags)
		.where(and(eq(tags.id, tagId), eq(tags.workspaceId, workspaceId)))
		.get();
	return tag !== null;
}

async function logExecution(
	db: ReturnType<typeof drizzle>,
	ruleId: string,
	conversationId: string,
	result: "matched" | "skipped" | "error",
	detail: string,
	now: string,
): Promise<void> {
	await db
		.insert(ruleExecutionLog)
		.values({
			id: crypto.randomUUID(),
			ruleId,
			conversationId,
			executedAt: now,
			result,
			detail: detail || null,
		})
		.run();
}
