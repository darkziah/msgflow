import { afterEach, describe, expect, test } from "bun:test";
import { createAuth } from "@msgflow/auth";
import { WorkspaceCreateRequestSchema } from "@msgflow/contracts";
import {
	inboxes,
	inboxMembers,
	teamMembers,
	teams,
	workspaceMembers,
	workspaceSetupClaim,
	workspaces,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { Either, Schema } from "effect";
import { ManageError } from "../src/errors";
import { setupInitialOwner } from "../src/setup";
import {
	createWorkspaceForActor,
	listWorkspacesForUser,
} from "../src/workspace-api";
import { workspaceApi } from "../src/workspace-api-route";
import { provisionWorkspace } from "../src/workspace-provisioning";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

const input = {
	workspaceName: "Second Workspace",
	workspaceSlug: "second-workspace",
	initialTeamName: "Operations",
	initialInboxName: "Support",
};

async function seedOwnerWithCurrentWorkspace(): Promise<{
	workspaceId: string;
}> {
	const source = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "owner", "owner@example.test");
	await seedUser(ctx, "current-member", "current-member@example.test");
	await ctx.db
		.insert(workspaceMembers)
		.values([
			{
				id: crypto.randomUUID(),
				workspaceId: source.workspaceId,
				userId: "owner",
				role: "owner",
				createdAt: now,
			},
			{
				id: crypto.randomUUID(),
				workspaceId: source.workspaceId,
				userId: "current-member",
				role: "member",
				createdAt: now,
			},
		])
		.run();
	const currentTeamId = crypto.randomUUID();
	const currentInboxId = crypto.randomUUID();
	await ctx.db
		.insert(teams)
		.values({
			id: currentTeamId,
			workspaceId: source.workspaceId,
			name: "Current Team",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(teamMembers)
		.values({
			id: crypto.randomUUID(),
			teamId: currentTeamId,
			userId: "current-member",
			role: "member",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxes)
		.values({
			id: currentInboxId,
			workspaceId: source.workspaceId,
			teamId: currentTeamId,
			name: "Current Inbox",
			color: "#64748B",
			sortOrder: 0,
			isArchived: false,
			assignmentStrategy: "manual",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxMembers)
		.values({
			id: crypto.randomUUID(),
			inboxId: currentInboxId,
			userId: "current-member",
		})
		.run();
	return source;
}

describe("Workspace provisioning", () => {
	test("publishes a bounded, trimmed request without server-owned fields", () => {
		const decoded = Schema.decodeUnknownEither(WorkspaceCreateRequestSchema)({
			workspaceName: "  Second Workspace  ",
			workspaceSlug: "second-workspace",
			initialTeamName: "  Operations  ",
			initialInboxName: "  Support  ",
			id: "client-controlled-id",
			actorId: "client-controlled-actor",
			role: "owner",
			state: "active",
		});
		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("workspace request did not decode");
		expect(decoded.right).toEqual(input);
		expect(
			Schema.decodeUnknownEither(WorkspaceCreateRequestSchema)({
				...input,
				workspaceSlug: "Second Workspace",
			}),
		).toMatchObject({ _tag: "Left" });
	});

	test("creates only the independent owner, team, and shared inbox graph", async () => {
		ctx = await createTestDb();
		const source = await seedOwnerWithCurrentWorkspace();

		const created = await createWorkspaceForActor(ctx.env, "owner", input);
		expect(created.id).not.toBe(source.workspaceId);
		expect(
			await ctx.db
				.select()
				.from(workspaces)
				.where(eq(workspaces.id, created.id))
				.get(),
		).toMatchObject({
			name: input.workspaceName,
			slug: input.workspaceSlug,
		});
		expect(
			await ctx.db
				.select()
				.from(workspaceMembers)
				.where(eq(workspaceMembers.workspaceId, created.id))
				.all(),
		).toMatchObject([{ userId: "owner", role: "owner" }]);
		expect(
			await ctx.db
				.select()
				.from(teams)
				.where(eq(teams.workspaceId, created.id))
				.all(),
		).toMatchObject([{ id: created.teamId, name: input.initialTeamName }]);
		expect(
			await ctx.db
				.select()
				.from(inboxes)
				.where(eq(inboxes.workspaceId, created.id))
				.all(),
		).toMatchObject([
			{
				id: created.inboxId,
				teamId: created.teamId,
				name: input.initialInboxName,
			},
		]);
		expect(
			await ctx.db
				.select()
				.from(teamMembers)
				.where(
					and(
						eq(teamMembers.teamId, created.teamId),
						eq(teamMembers.userId, "owner"),
					),
				)
				.get(),
		).toMatchObject({ role: "admin" });
		expect(
			await ctx.db
				.select()
				.from(inboxMembers)
				.where(
					and(
						eq(inboxMembers.inboxId, created.inboxId),
						eq(inboxMembers.userId, "owner"),
					),
				)
				.get(),
		).not.toBeNull();
		expect(
			await ctx.db
				.select()
				.from(workspaceMembers)
				.where(
					and(
						eq(workspaceMembers.workspaceId, created.id),
						eq(workspaceMembers.userId, "current-member"),
					),
				)
				.get(),
		).toBeUndefined();
	});

	test("allows exactly one concurrent normalized slug and maps losers to conflict", async () => {
		ctx = await createTestDb();
		await seedUser(ctx, "owner", "owner@example.test");
		const outcomes = await Promise.allSettled([
			createWorkspaceForActor(ctx.env, "owner", input),
			createWorkspaceForActor(ctx.env, "owner", {
				...input,
				workspaceName: "Other Workspace",
			}),
		]);
		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = outcomes.filter(
			(outcome): outcome is PromiseRejectedResult =>
				outcome.status === "rejected",
		);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toBeInstanceOf(ManageError);
		expect(rejected[0]?.reason).toMatchObject({
			status: 409,
			message: "workspace slug is already in use",
		});
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(1);
		expect(await ctx.db.select().from(teams).all()).toHaveLength(1);
		expect(await ctx.db.select().from(inboxes).all()).toHaveLength(1);
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(1);
		expect(await ctx.db.select().from(teamMembers).all()).toHaveLength(1);
		expect(await ctx.db.select().from(inboxMembers).all()).toHaveLength(1);
	});

	test("rolls back every graph row when a later batch statement fails", async () => {
		ctx = await createTestDb();
		await expect(
			provisionWorkspace(ctx.env, "missing-user", input),
		).rejects.toThrow();
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(0);
		expect(await ctx.db.select().from(teams).all()).toHaveLength(0);
		expect(await ctx.db.select().from(inboxes).all()).toHaveLength(0);
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(0);
		expect(await ctx.db.select().from(teamMembers).all()).toHaveLength(0);
		expect(await ctx.db.select().from(inboxMembers).all()).toHaveLength(0);
	});

	test("rolls back the initial graph and claim completion when a later batch statement fails", async () => {
		ctx = await createTestDb();
		await seedUser(ctx, "initial-owner", "owner@example.test");
		const now = new Date().toISOString();
		await ctx.env.DB.prepare(
			"INSERT INTO workspace_setup_claim (id, email, claimed_at) VALUES (1, ?, ?)",
		)
			.bind("owner@example.test", now)
			.run();

		await expect(
			provisionWorkspace(ctx.env, "initial-owner", input, {
				afterStatements: ({ workspaceId }) => [
					ctx.env.DB.prepare(
						"UPDATE workspace_setup_claim SET user_id = ?, workspace_id = ?, completed_at = ? WHERE id = 1",
					).bind("initial-owner", workspaceId, now),
					ctx.env.DB.prepare(
						"INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
					).bind(crypto.randomUUID(), workspaceId, "missing-user", now),
				],
			}),
		).rejects.toThrow();

		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(0);
		expect(await ctx.db.select().from(teams).all()).toHaveLength(0);
		expect(await ctx.db.select().from(inboxes).all()).toHaveLength(0);
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(0);
		expect(await ctx.db.select().from(teamMembers).all()).toHaveLength(0);
		expect(await ctx.db.select().from(inboxMembers).all()).toHaveLength(0);
		expect(await ctx.db.select().from(workspaceSetupClaim).get()).toMatchObject(
			{
				userId: null,
				workspaceId: null,
				completedAt: null,
			},
		);
	});
});

describe("POST /api/workspaces", () => {
	async function authenticatedOwner(): Promise<{
		workspaceId: string;
		token: string;
		userId: string;
	}> {
		ctx = await createTestDb();
		const setup = await setupInitialOwner(ctx.env, {
			email: "owner@example.test",
			password: "correct horse battery staple",
			username: "owner",
			workspaceName: "Source Workspace",
			workspaceSlug: "source-workspace",
			initialTeamName: "Source Team",
			initialInboxName: "Source Inbox",
		});
		await ctx.env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
			.bind(setup.userId)
			.run();
		const login = await createAuth(ctx.env).handler(
			new Request("https://msgflow.test/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "owner@example.test",
					password: "correct horse battery staple",
				}),
			}),
		);
		const token = login.headers.get("set-cookie")?.split(";", 1)[0];
		if (!token) throw new Error("sign-in did not issue a session cookie");
		return { workspaceId: setup.workspaceId, userId: setup.userId, token };
	}

	function createRequest(
		sourceWorkspaceId: string,
		token?: string,
		body: Record<string, unknown> = input,
	): Request {
		return new Request(
			`https://msgflow.test/workspaces?sourceWorkspaceId=${encodeURIComponent(sourceWorkspaceId)}`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(token ? { cookie: token } : {}),
				},
				body: JSON.stringify(body),
			},
		);
	}

	test("requires a verified owner of the explicitly queried source workspace", async () => {
		const actor = await authenticatedOwner();
		expect(
			(await workspaceApi.fetch(createRequest(actor.workspaceId), ctx.env))
				.status,
		).toBe(401);
		expect(
			(
				await workspaceApi.fetch(
					createRequest("not-a-workspace-id", actor.token),
					ctx.env,
				)
			).status,
		).toBe(400);
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token, {
						...input,
						workspaceSlug: "not a slug",
					}),
					ctx.env,
				)
			).status,
		).toBe(400);

		const created = await workspaceApi.fetch(
			createRequest(actor.workspaceId, actor.token, {
				...input,
				role: "admin",
			}),
			ctx.env,
		);
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as {
			workspace: {
				id: string;
				role: string;
				createdAt: string;
				teamId: string;
				inboxId: string;
			};
		};
		expect(createdBody.workspace).toMatchObject({ role: "owner" });
		expect(createdBody.workspace.createdAt).toBeTruthy();
		expect(createdBody.workspace.teamId).toBeTruthy();
		expect(createdBody.workspace.inboxId).toBeTruthy();
		expect(await listWorkspacesForUser(ctx.env, actor.userId)).toMatchObject([
			{ id: actor.workspaceId, role: "owner" },
			{ id: createdBody.workspace.id, role: "owner" },
		]);
	});

	test("rejects admin, member, unverified owner, outsider, and foreign-source bypasses", async () => {
		const actor = await authenticatedOwner();
		await seedUser(ctx, "source-co-owner", "source-co-owner@example.test");
		await ctx.db.insert(workspaceMembers).values({
			id: crypto.randomUUID(),
			workspaceId: actor.workspaceId,
			userId: "source-co-owner",
			role: "owner",
			createdAt: new Date().toISOString(),
		}).run();
		const setActor = async (
			role: "owner" | "admin" | "member",
			verified = true,
		) => {
			await ctx.db
				.update(workspaceMembers)
				.set({ role })
				.where(
					and(
						eq(workspaceMembers.workspaceId, actor.workspaceId),
						eq(workspaceMembers.userId, actor.userId),
					),
				)
				.run();
			await ctx.env.DB.prepare(
				"UPDATE user SET email_verified = ? WHERE id = ?",
			)
				.bind(verified ? 1 : 0, actor.userId)
				.run();
		};
		await setActor("admin");
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(403);
		await setActor("member");
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(403);
		await setActor("owner", false);
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(403);
		await ctx.db
			.delete(workspaceMembers)
			.where(
				and(
					eq(workspaceMembers.workspaceId, actor.workspaceId),
					eq(workspaceMembers.userId, actor.userId),
				),
			)
			.run();
		await ctx.env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
			.bind(actor.userId)
			.run();
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(403);

		const foreign = await seedWorkspace(ctx);
		const foreignResponse = await workspaceApi.fetch(
			createRequest(foreign.workspaceId, actor.token),
			ctx.env,
		);
		const unknownResponse = await workspaceApi.fetch(
			createRequest(crypto.randomUUID(), actor.token),
			ctx.env,
		);
		expect(foreignResponse.status).toBe(403);
		expect(unknownResponse.status).toBe(403);
		expect(await foreignResponse.json()).toEqual(await unknownResponse.json());
	});

	test("lists authenticated memberships in created_at/id order with membership roles", async () => {
		const actor = await authenticatedOwner();
		const created = await workspaceApi.fetch(
			createRequest(actor.workspaceId, actor.token),
			ctx.env,
		);
		const createdBody = (await created.json()) as { workspace: { id: string } };
		await seedUser(ctx, "created-co-owner", "created-co-owner@example.test");
		await ctx.db.insert(workspaceMembers).values({
			id: crypto.randomUUID(),
			workspaceId: createdBody.workspace.id,
			userId: "created-co-owner",
			role: "owner",
			createdAt: new Date().toISOString(),
		}).run();
		await ctx.db
			.update(workspaces)
			.set({ createdAt: "2025-01-02T00:00:00.000Z" })
			.where(eq(workspaces.id, actor.workspaceId))
			.run();
		await ctx.db
			.update(workspaces)
			.set({ createdAt: "2025-01-03T00:00:00.000Z" })
			.where(eq(workspaces.id, createdBody.workspace.id))
			.run();
		await ctx.db
			.update(workspaceMembers)
			.set({ role: "member" })
			.where(
				and(
					eq(workspaceMembers.workspaceId, createdBody.workspace.id),
					eq(workspaceMembers.userId, actor.userId),
				),
			)
			.run();

		const listed = await workspaceApi.fetch(
			new Request("https://msgflow.test/workspaces", {
				headers: { cookie: actor.token },
			}),
			ctx.env,
		);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({
			workspaces: [
				{
					id: actor.workspaceId,
					name: "Source Workspace",
					slug: "source-workspace",
					role: "owner",
					createdAt: "2025-01-02T00:00:00.000Z",
				},
				{
					id: createdBody.workspace.id,
					name: input.workspaceName,
					slug: input.workspaceSlug,
					role: "member",
					createdAt: "2025-01-03T00:00:00.000Z",
				},
			],
		});
	});

	test("rejects an unauthenticated workspace list", async () => {
		ctx = await createTestDb();
		const response = await workspaceApi.fetch(
			new Request("https://msgflow.test/workspaces"),
			ctx.env,
		);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			success: false,
			error: "unauthorized",
		});
	});

	test("maps duplicate slugs to conflict without creating another workspace", async () => {
		const actor = await authenticatedOwner();
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(201);
		expect(
			(
				await workspaceApi.fetch(
					createRequest(actor.workspaceId, actor.token),
					ctx.env,
				)
			).status,
		).toBe(409);
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(2);
	});
});
