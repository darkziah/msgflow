import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	teamMembers,
	teams,
	workspaceMembers,
	workspaces,
} from "@msgflow/db";

import {
	createCallQueue,
	createRingGroup,
	deleteRingGroup,
	listCallQueues,
	listRingGroups,
	updateCallQueue,
	updateQueueStages,
	updateRingGroup,
} from "../src/calling-config";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf?.dispose();
});

async function seedConfig() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	for (const id of ["owner", "member", "outside"]) {
		await seedUser(ctx, id, `${id}@test.dev`);
	}
	await ctx.db
		.insert(workspaceMembers)
		.values([
			{
				id: crypto.randomUUID(),
				workspaceId,
				userId: "owner",
				role: "owner",
				createdAt: now,
			},
			{
				id: crypto.randomUUID(),
				workspaceId,
				userId: "member",
				role: "member",
				createdAt: now,
			},
		])
		.run();
	const teamId = crypto.randomUUID();
	await ctx.db
		.insert(teams)
		.values({ id: teamId, workspaceId, name: "Support", createdAt: now })
		.run();
	await ctx.db
		.insert(teamMembers)
		.values({
			id: crypto.randomUUID(),
			teamId,
			userId: "owner",
			role: "member",
			createdAt: now,
		})
		.run();
	const facebookChannelId = crypto.randomUUID();
	const emailChannelId = crypto.randomUUID();
	await ctx.db
		.insert(channels)
		.values([
			{
				id: facebookChannelId,
				workspaceId,
				type: "facebook_page",
				displayName: "Page",
				externalId: "page-1",
				accessToken: "secret-token",
				status: "active",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: emailChannelId,
				workspaceId,
				type: "email",
				displayName: "Email",
				externalId: "support@test.dev",
				status: "active",
				createdAt: now,
				updatedAt: now,
			},
		])
		.run();
	return { workspaceId, teamId, facebookChannelId, emailChannelId };
}

describe("calling configuration", () => {
	test("fences workspace resources and validates Page channels, team members, and bounded stages", async () => {
		const { workspaceId, teamId, facebookChannelId, emailChannelId } =
			await seedConfig();
		const foreignWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign",
				slug: "foreign-calling",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id: crypto.randomUUID(),
				workspaceId: foreignWorkspaceId,
				userId: "owner",
				role: "owner",
				createdAt: now,
			})
			.run();

		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await expect(
			createCallQueue(
				ctx.env,
				foreignWorkspaceId,
				{
					channelId: facebookChannelId,
					teamId,
					name: "Queue",
					timezoneId: "UTC",
					weeklyOperatingHours: [],
					noAgentReplyText: "Unavailable",
					stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
				},
				"owner",
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			createCallQueue(
				ctx.env,
				workspaceId,
				{
					channelId: emailChannelId,
					teamId,
					name: "Queue",
					timezoneId: "UTC",
					weeklyOperatingHours: [],
					noAgentReplyText: "Unavailable",
					stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
				},
				"owner",
			),
		).rejects.toThrow(/Facebook Page/i);
		await expect(
			createRingGroup(
				ctx.env,
				workspaceId,
				{
					teamId,
					name: "Invalid",
					strategy: "simultaneous",
					memberIds: ["outside"],
				},
				"owner",
			),
		).rejects.toThrow(/team member/i);
		const queue = await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId: facebookChannelId,
				teamId,
				name: "Queue",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		await expect(
			updateQueueStages(
				ctx.env,
				workspaceId,
				queue.id,
				[
					{ ringGroupId: ringGroup.id, ringDurationSeconds: 26 },
					{ ringGroupId: ringGroup.id, ringDurationSeconds: 25 },
				],
				"owner",
			),
		).rejects.toThrow(/50 seconds/i);
		await expect(
			updateQueueStages(
				ctx.env,
				workspaceId,
				queue.id,
				[{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
				"member",
			),
		).rejects.toMatchObject({ status: 403 });
	});

	test("returns a deliberately safe queue summary", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId: facebookChannelId,
				teamId,
				name: "Queue",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		const queues = await listCallQueues(ctx.env, workspaceId, "owner");
		expect(queues).toHaveLength(1);
		const serialized = JSON.stringify(queues[0]);
		expect(serialized).not.toContain("secret-token");
		expect(serialized).not.toMatch(/appSecret|accessToken|presence|webrtc/i);
		expect(queues[0]).toMatchObject({
			channelId: facebookChannelId,
			stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
		});
	});

	test("deletes unreferenced groups and rejects referenced groups without deleting members", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const disposable = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Disposable",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await deleteRingGroup(ctx.env, workspaceId, disposable.id, "owner");
		expect(await listRingGroups(ctx.env, workspaceId, "owner")).toEqual([]);

		const referenced = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Referenced",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId: facebookChannelId,
				teamId,
				name: "Queue",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: referenced.id, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		await expect(
			deleteRingGroup(ctx.env, workspaceId, referenced.id, "owner"),
		).rejects.toMatchObject({ status: 409 });
		expect(await listRingGroups(ctx.env, workspaceId, "owner")).toEqual([
			expect.objectContaining({ id: referenced.id, memberIds: ["owner"] }),
		]);
	});

	test("rolls back ring group creation when its member insert fails", async () => {
		const { workspaceId, teamId } = await seedConfig();
		await ctx.env.DB.prepare(
			"CREATE TRIGGER fail_ring_group_member_insert BEFORE INSERT ON ring_group_members BEGIN SELECT RAISE(ABORT, 'forced ring group member failure'); END",
		).run();

		await expect(
			createRingGroup(
				ctx.env,
				workspaceId,
				{
					teamId,
					name: "Must not persist",
					strategy: "simultaneous",
					memberIds: ["owner"],
				},
				"owner",
			),
		).rejects.toThrow(/forced ring group member failure/i);
		expect(await listRingGroups(ctx.env, workspaceId, "owner")).toEqual([]);
	});

	test("rolls back ring group changes when member replacement fails", async () => {
		const { workspaceId, teamId } = await seedConfig();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId,
				userId: "member",
				role: "member",
				createdAt: new Date().toISOString(),
			})
			.run();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Original",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await ctx.env.DB.prepare(
			`CREATE TRIGGER fail_ring_group_member_delete BEFORE DELETE ON ring_group_members WHEN OLD.ring_group_id = '${ringGroup.id}' BEGIN SELECT RAISE(ABORT, 'forced ring group member replacement failure'); END`,
		).run();

		await expect(
			updateRingGroup(
				ctx.env,
				workspaceId,
				ringGroup.id,
				{
					teamId,
					name: "Changed",
					strategy: "round_robin",
					memberIds: ["member"],
				},
				"owner",
			),
		).rejects.toThrow(/forced ring group member replacement failure/i);
		expect(await listRingGroups(ctx.env, workspaceId, "owner")).toEqual([
			expect.objectContaining({
				id: ringGroup.id,
				name: "Original",
				strategy: "simultaneous",
				memberIds: ["owner"],
			}),
		]);
	});

	test("rolls back queue creation when its stage insert fails", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		await ctx.env.DB.prepare(
			"CREATE TRIGGER fail_queue_stage_insert BEFORE INSERT ON call_queue_stages BEGIN SELECT RAISE(ABORT, 'forced queue stage failure'); END",
		).run();

		await expect(
			createCallQueue(
				ctx.env,
				workspaceId,
				{
					channelId: facebookChannelId,
					teamId,
					name: "Must not persist",
					timezoneId: "UTC",
					weeklyOperatingHours: [],
					noAgentReplyText: "Unavailable",
					stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
				},
				"owner",
			),
		).rejects.toThrow(/forced queue stage failure/i);
		expect(await listCallQueues(ctx.env, workspaceId, "owner")).toEqual([]);
	});

	test("rolls back queue changes when stage replacement fails", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		const queue = await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId: facebookChannelId,
				teamId,
				name: "Original",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		await ctx.env.DB.prepare("UPDATE call_queues SET is_enabled=1 WHERE id=?")
			.bind(queue.id)
			.run();
		await ctx.env.DB.prepare(
			`CREATE TRIGGER fail_queue_stage_delete BEFORE DELETE ON call_queue_stages WHEN OLD.queue_id = '${queue.id}' BEGIN SELECT RAISE(ABORT, 'forced queue stage replacement failure'); END`,
		).run();

		await expect(
			updateCallQueue(
				ctx.env,
				workspaceId,
				queue.id,
				{
					channelId: facebookChannelId,
					teamId,
					name: "Changed",
					timezoneId: "America/New_York",
					weeklyOperatingHours: [],
					noAgentReplyText: "Changed reply",
					stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 20 }],
				},
				"owner",
			),
		).rejects.toThrow(/forced queue stage replacement failure/i);
		expect(await listCallQueues(ctx.env, workspaceId, "owner")).toEqual([
			expect.objectContaining({
				id: queue.id,
				name: "Original",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
			}),
		]);
	});

	test("rolls back stage replacement when a D1 trigger rejects the new stage", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		const queue = await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId: facebookChannelId,
				teamId,
				name: "Queue",
				timezoneId: "UTC",
				weeklyOperatingHours: [],
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		await ctx.env.DB.prepare(
			`CREATE TRIGGER fail_stage_replacement BEFORE INSERT ON call_queue_stages WHEN NEW.queue_id = '${queue.id}' BEGIN SELECT RAISE(ABORT, 'forced stage failure'); END`,
		).run();
		await expect(
			updateQueueStages(
				ctx.env,
				workspaceId,
				queue.id,
				[{ ringGroupId: ringGroup.id, ringDurationSeconds: 20 }],
				"owner",
			),
		).rejects.toThrow(/forced stage failure/i);
		expect(
			(await listCallQueues(ctx.env, workspaceId, "owner"))[0]?.stages,
		).toEqual([{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }]);
	});

	test("disables an enabled queue atomically when configuration changes", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const group = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		const input = {
			channelId: facebookChannelId,
			teamId,
			name: "Queue",
			timezoneId: "UTC",
			weeklyOperatingHours: [],
			noAgentReplyText: "Unavailable",
			stages: [{ ringGroupId: group.id, ringDurationSeconds: 10 }],
		};
		const queue = await createCallQueue(ctx.env, workspaceId, input, "owner");
		await ctx.env.DB.prepare("UPDATE call_queues SET is_enabled=1 WHERE id=?")
			.bind(queue.id)
			.run();
		const updated = await updateCallQueue(
			ctx.env,
			workspaceId,
			queue.id,
			{
				...input,
				name: "Changed",
				weeklyOperatingHours: [
					{ day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
				],
			},
			"owner",
		);
		expect(updated.isEnabled).toBe(false);
		expect(updated.weeklyOperatingHours).toEqual([
			{ day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
		]);
	});

	test("rejects invalid documented weekly hours", async () => {
		const { workspaceId, teamId, facebookChannelId } = await seedConfig();
		const ringGroup = await createRingGroup(
			ctx.env,
			workspaceId,
			{
				teamId,
				name: "Primary",
				strategy: "simultaneous",
				memberIds: ["owner"],
			},
			"owner",
		);
		const input = {
			channelId: facebookChannelId,
			teamId,
			name: "Queue",
			timezoneId: "UTC",
			noAgentReplyText: "Unavailable",
			stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
		};
		await expect(
			createCallQueue(
				ctx.env,
				workspaceId,
				{
					...input,
					weeklyOperatingHours: [
						{ day_of_week: "MONDAY", open_time: "1700", close_time: "0900" },
					],
				},
				"owner",
			),
		).rejects.toThrow(/precede/i);
		await expect(
			createCallQueue(
				ctx.env,
				workspaceId,
				{
					...input,
					weeklyOperatingHours: [
						{ day_of_week: "MONDAY", open_time: "0900", close_time: "1200" },
						{ day_of_week: "MONDAY", open_time: "1100", close_time: "1300" },
					],
				},
				"owner",
			),
		).rejects.toThrow(/overlap/i);
	});
});
