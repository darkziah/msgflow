import { afterEach, describe, expect, test } from "bun:test";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;

const now = "2026-09-30T00:00:00.000Z";

async function execute(sql: string, ...values: unknown[]) {
	return ctx.env.DB.prepare(sql).bind(...values).run();
}

async function setup() {
	ctx = await createTestDb();
	const { workspaceId: workspaceA } = await seedWorkspace(ctx);
	const workspaceB = "workspace-b";
	await execute(
		"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
		workspaceB,
		"Workspace B",
		"workspace-b",
		now,
		now,
	);
	for (const userId of ["agent-a", "agent-b"]) {
		await seedUser(ctx, userId, `${userId}@test.dev`);
	}
	await execute("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)", "team-a", workspaceA, "Support", now);
	await execute("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)", "team-a-other", workspaceA, "Sales", now);
	await execute("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)", "team-b", workspaceB, "Foreign", now);
	await execute("INSERT INTO team_members (id,team_id,user_id,role,created_at) VALUES (?,?,?,?,?)", "tm-a", "team-a", "agent-a", "member", now);
	for (const { id, workspaceId, type, status } of [
		{ id: "page-a", workspaceId: workspaceA, type: "facebook_page", status: "active" },
		{ id: "page-a-2", workspaceId: workspaceA, type: "facebook_page", status: "active" },
		{ id: "page-a-disconnected", workspaceId: workspaceA, type: "facebook_page", status: "disconnected" },
		{ id: "page-a-deleted", workspaceId: workspaceA, type: "facebook_page", status: "deleted" },
		{ id: "email-a", workspaceId: workspaceA, type: "email", status: "active" },
		{ id: "whatsapp-a", workspaceId: workspaceA, type: "whatsapp_phone", status: "active" },
		{ id: "page-b", workspaceId: workspaceB, type: "facebook_page", status: "active" },
	]) {
		await execute(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			id,
			workspaceId,
			type,
			id,
			`${id}-external`,
			status,
			now,
			now,
		);
	}
	return { workspaceA, workspaceB };
}

async function insertGroup(id: string, workspaceId: string, teamId: string) {
	return execute(
		"INSERT INTO ring_groups (id,workspace_id,team_id,name,strategy,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
		id,
		workspaceId,
		teamId,
		id,
		"simultaneous",
		now,
		now,
	);
}

async function insertQueue(id: string, workspaceId: string, channelId: string, teamId: string, enabled = false) {
	return execute(
		"INSERT INTO call_queues (id,workspace_id,channel_id,team_id,name,is_enabled,no_agent_reply_text,timezone_id,weekly_operating_hours_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		id,
		workspaceId,
		channelId,
		teamId,
		id,
		enabled ? 1 : 0,
		"No agent available",
		"UTC",
		"{}",
		now,
		now,
	);
}

async function insertStage(id: string, queueId: string, groupId: string, order: number, duration: number) {
	return execute(
		"INSERT INTO call_queue_stages (id,queue_id,ring_group_id,stage_order,ring_duration_seconds,created_at) VALUES (?,?,?,?,?,?)",
		id,
		queueId,
		groupId,
		order,
		duration,
		now,
	);
}

async function insertConversation(id: string, workspaceId: string, channelId: string) {
	await execute("INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES (?,?,?,?)", `contact-${id}`, workspaceId, now, now);
	await execute(
		"INSERT INTO inboxes (id,workspace_id,name,created_at) VALUES (?,?,?,?)",
		`inbox-${id}`,
		workspaceId,
		`Inbox ${id}`,
		now,
	);
	await execute(
		"INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
		id,
		workspaceId,
		channelId,
		`inbox-${id}`,
		`contact-${id}`,
		`do-${id}`,
		now,
		now,
	);
}

async function insertEvent(id: string, workspaceId: string, channelId: string, providerEventId: string, conversationId: string | null = null, queueId: string | null = null) {
	return execute(
		"INSERT INTO call_events (id,workspace_id,channel_id,conversation_id,queue_id,provider_call_id,provider_event_id,direction,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		id,
		workspaceId,
		channelId,
		conversationId,
		queueId,
		`call-${id}`,
		providerEventId,
		"consumer_to_business",
		"ringing",
		now,
		now,
	);
}

afterEach(async () => {
	await ctx?.mf.dispose();
});

describe("Facebook Page calling persistence migration", () => {
	test("creates the approved calling contract and enforces its durable fences", async () => {
		const { workspaceA, workspaceB } = await setup();
		const expectedColumns: Record<string, string[]> = {
			ring_groups: ["id", "workspace_id", "team_id", "name", "strategy", "next_member_cursor", "created_at", "updated_at"],
			ring_group_members: ["id", "ring_group_id", "user_id", "sort_order", "created_at"],
			call_queues: ["id", "workspace_id", "channel_id", "team_id", "name", "is_enabled", "provisioning_lease_token", "no_agent_reply_text", "timezone_id", "weekly_operating_hours_json", "created_at", "updated_at"],
			call_queue_stages: ["id", "queue_id", "ring_group_id", "stage_order", "ring_duration_seconds", "created_at"],
			agent_call_presence: ["workspace_id", "user_id", "status", "socket_connected_at", "heartbeat_expires_at", "updated_at"],
			call_events: ["id", "workspace_id", "channel_id", "conversation_id", "queue_id", "provider_call_id", "provider_event_id", "direction", "state", "accepted_by_user_id", "terminal_reason", "quality_summary_json", "created_at", "updated_at"],
		};
		for (const [table, columns] of Object.entries(expectedColumns)) {
			const rows = await ctx.env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
			expect(rows.results.map((row: { name: string }) => row.name)).toEqual(columns);
		}
		const eligibleIndex = await ctx.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_call_presence_eligible'").first();
		expect(eligibleIndex).not.toBeNull();
		for (const trigger of [
			"ring_groups_team_workspace_insert",
			"ring_groups_team_workspace_update",
			"ring_group_members_team_insert",
			"ring_group_members_team_update",
			"call_queues_scope_insert",
			"call_queues_scope_update",
			"call_queue_stages_scope_insert",
			"call_queue_stages_scope_update",
			"call_queue_stages_total_insert",
			"call_queue_stages_total_update",
			"call_events_scope_insert",
			"call_events_scope_update",
		]) {
			const row = await ctx.env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").bind(trigger).first();
			expect(row).not.toBeNull();
		}

		await insertGroup("group-a", workspaceA, "team-a");
		await execute("INSERT INTO ring_group_members (id,ring_group_id,user_id,sort_order,created_at) VALUES (?,?,?,?,?)", "member-a", "group-a", "agent-a", 0, now);
		await insertQueue("queue-a", workspaceA, "page-a", "team-a", true);
		await insertStage("stage-a", "queue-a", "group-a", 0, 30);
		await execute("INSERT INTO agent_call_presence (workspace_id,user_id,status,updated_at) VALUES (?,?,?,?)", workspaceA, "agent-a", "available", now);
		await insertEvent("event-a", workspaceA, "page-a", "provider-event-a");

		await expect(insertGroup("foreign-group", workspaceA, "team-b")).rejects.toThrow("ring group team must belong to its workspace");
		await expect(execute("UPDATE ring_groups SET team_id = ? WHERE id = ?", "team-b", "group-a")).rejects.toThrow("ring group team must belong to its workspace");
		await expect(execute("UPDATE ring_groups SET workspace_id = ? WHERE id = ?", workspaceB, "group-a")).rejects.toThrow("ring group team must belong to its workspace");
		await expect(insertQueue("foreign-queue", workspaceA, "page-a-2", "team-b")).rejects.toThrow("call queue team must belong to its workspace");
		await expect(insertQueue("email-queue", workspaceA, "email-a", "team-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(insertQueue("disconnected-page-queue", workspaceA, "page-a-disconnected", "team-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(insertQueue("deleted-page-queue", workspaceA, "page-a-deleted", "team-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(insertQueue("cross-workspace-page-queue", workspaceA, "page-b", "team-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(execute("UPDATE call_queues SET channel_id = ? WHERE id = ?", "page-b", "queue-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(execute("UPDATE call_queues SET channel_id = ? WHERE id = ?", "page-a-disconnected", "queue-a")).rejects.toThrow("call queue channel must be an active Facebook Page in its workspace");
		await expect(insertQueue("second-enabled", workspaceA, "page-a", "team-a", true)).rejects.toThrow();

		await expect(execute("INSERT INTO ring_group_members (id,ring_group_id,user_id,sort_order,created_at) VALUES (?,?,?,?,?)", "member-b", "group-a", "agent-b", 1, now)).rejects.toThrow("ring group member must be an active member of the group team");
		await expect(execute("UPDATE ring_group_members SET user_id = ? WHERE id = ?", "agent-b", "member-a")).rejects.toThrow("ring group member must be an active member of the group team");

		await insertGroup("group-b", workspaceB, "team-b");
		await insertGroup("group-a-other", workspaceA, "team-a-other");
		await expect(insertStage("foreign-stage", "queue-a", "group-b", 1, 10)).rejects.toThrow("call queue stage ring group must belong to the queue workspace and team");
		await expect(insertStage("other-team-stage", "queue-a", "group-a-other", 1, 10)).rejects.toThrow("call queue stage ring group must belong to the queue workspace and team");
		await expect(execute("UPDATE call_queue_stages SET ring_group_id = ? WHERE id = ?", "group-b", "stage-a")).rejects.toThrow("call queue stage ring group must belong to the queue workspace and team");
		await expect(execute("UPDATE call_queue_stages SET ring_group_id = ? WHERE id = ?", "group-a-other", "stage-a")).rejects.toThrow("call queue stage ring group must belong to the queue workspace and team");
		await expect(insertStage("zero-stage", "queue-a", "group-a", 1, 0)).rejects.toThrow();
		await expect(insertStage("fifty-one-stage", "queue-a", "group-a", 1, 51)).rejects.toThrow();
		await expect(insertStage("too-much-insert", "queue-a", "group-a", 1, 21)).rejects.toThrow("call queue stages may not exceed 50 seconds");
		await insertStage("stage-b", "queue-a", "group-a", 1, 20);
		await expect(execute("UPDATE call_queue_stages SET ring_duration_seconds = ? WHERE id = ?", 21, "stage-b")).rejects.toThrow("call queue stages may not exceed 50 seconds");
		await insertQueue("queue-a-2", workspaceA, "page-a-2", "team-a");
		await insertGroup("group-a-2", workspaceA, "team-a");
		await insertStage("stage-destination", "queue-a-2", "group-a-2", 0, 10);
		await execute("UPDATE call_queue_stages SET queue_id = ?, ring_group_id = ? WHERE id = ?", "queue-a-2", "group-a-2", "stage-b");
		const movedStageTotals = await ctx.env.DB.prepare(
			"SELECT queue_id, SUM(ring_duration_seconds) AS total FROM call_queue_stages WHERE queue_id IN (?, ?) GROUP BY queue_id ORDER BY queue_id",
		).bind("queue-a", "queue-a-2").all<{ queue_id: string; total: number }>();
		expect(movedStageTotals.results).toEqual([
			{ queue_id: "queue-a", total: 30 },
			{ queue_id: "queue-a-2", total: 30 },
		]);
		await insertQueue("queue-a-3", workspaceA, "page-a", "team-a");
		await insertStage("stage-overflow-source", "queue-a-3", "group-a", 0, 21);
		await expect(execute("UPDATE call_queue_stages SET queue_id = ?, ring_group_id = ? WHERE id = ?", "queue-a-2", "group-a-2", "stage-overflow-source")).rejects.toThrow("call queue stages may not exceed 50 seconds");
		await expect(execute("UPDATE call_queue_stages SET ring_duration_seconds = ? WHERE id = ?", 41, "stage-b")).rejects.toThrow("call queue stages may not exceed 50 seconds");
		await expect(execute("INSERT INTO agent_call_presence (workspace_id,user_id,status,updated_at) VALUES (?,?,?,?)", workspaceA, "agent-b", "busy", now)).rejects.toThrow(/CHECK constraint failed/);

		await expect(insertEvent("duplicate-event", workspaceA, "page-a", "provider-event-a")).rejects.toThrow();
		await expect(insertEvent("email-event", workspaceA, "email-a", "provider-email-event")).rejects.toThrow("call event channel must be an active Facebook Page in its workspace");
		await expect(insertEvent("whatsapp-event", workspaceA, "whatsapp-a", "provider-whatsapp-event")).rejects.toThrow("call event channel must be an active Facebook Page in its workspace");
		await expect(insertEvent("disconnected-page-event", workspaceA, "page-a-disconnected", "provider-disconnected-event")).rejects.toThrow("call event channel must be an active Facebook Page in its workspace");
		await expect(execute("UPDATE call_events SET channel_id = ? WHERE id = ?", "email-a", "event-a")).rejects.toThrow("call event channel must be an active Facebook Page in its workspace");
		await expect(execute("UPDATE call_events SET channel_id = ? WHERE id = ?", "page-a-disconnected", "event-a")).rejects.toThrow("call event channel must be an active Facebook Page in its workspace");
		await insertEvent("same-provider-other-channel", workspaceA, "page-a-2", "provider-event-a");
		await insertConversation("conversation-b", workspaceB, "page-b");
		await insertQueue("queue-b", workspaceB, "page-b", "team-b");
		await insertConversation("conversation-a", workspaceA, "page-a");
		await insertEvent("event-with-references", workspaceA, "page-a", "provider-event-with-references", "conversation-a", "queue-a");
		await execute("UPDATE call_events SET queue_id = NULL WHERE id = ?", "event-with-references");
		const clearedQueue = await ctx.env.DB.prepare("SELECT conversation_id, queue_id FROM call_events WHERE id = ?").bind("event-with-references").first<{ conversation_id: string | null; queue_id: string | null }>();
		expect(clearedQueue?.conversation_id).toBe("conversation-a");
		expect(clearedQueue?.queue_id).toBeNull();
		await execute("UPDATE call_events SET conversation_id = NULL WHERE id = ?", "event-with-references");
		const clearedConversation = await ctx.env.DB.prepare("SELECT conversation_id, queue_id FROM call_events WHERE id = ?").bind("event-with-references").first<{ conversation_id: string | null; queue_id: string | null }>();
		expect(clearedConversation?.conversation_id).toBeNull();
		expect(clearedConversation?.queue_id).toBeNull();
		await expect(insertEvent("cross-conversation", workspaceA, "page-a", "provider-cross-conversation", "conversation-b")).rejects.toThrow("call event conversation must belong to its workspace and channel");
		await expect(insertEvent("cross-queue", workspaceA, "page-a", "provider-cross-queue", null, "queue-b")).rejects.toThrow("call event queue must belong to its workspace and channel");
		await expect(execute("UPDATE call_events SET conversation_id = ? WHERE id = ?", "conversation-b", "event-a")).rejects.toThrow("call event conversation must belong to its workspace and channel");
		await expect(execute("UPDATE call_events SET queue_id = ? WHERE id = ?", "queue-b", "event-a")).rejects.toThrow("call event queue must belong to its workspace and channel");

		await insertQueue("queue-delete", workspaceA, "page-a", "team-a");
		await insertStage("stage-delete", "queue-delete", "group-a", 0, 10);
		await insertEvent("event-delete", workspaceA, "page-a", "provider-event-delete", null, "queue-delete");
		await execute("DELETE FROM call_queues WHERE id = ?", "queue-delete");
		const deletedQueueStage = await ctx.env.DB.prepare("SELECT 1 FROM call_queue_stages WHERE id = ?").bind("stage-delete").first();
		expect(deletedQueueStage).toBeNull();
		const retainedEvent = await ctx.env.DB.prepare("SELECT id, queue_id FROM call_events WHERE id = ?").bind("event-delete").first<{ id: string; queue_id: string | null }>();
		expect(retainedEvent).toEqual({ id: "event-delete", queue_id: null });
	});
});
