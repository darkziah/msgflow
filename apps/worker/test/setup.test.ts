import { afterEach, describe, expect, test } from "bun:test";
import { createAuth } from "@msgflow/auth";
import { OwnerSetupRequestSchema } from "@msgflow/contracts";
import {
	inboxes,
	inboxMembers,
	teamMembers,
	teams,
	user,
	workspaceMembers,
	workspaceSetupClaim,
	workspaces,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { getWorkspaceAccess } from "../src/access";
import { OwnerSetupError, setupInitialOwner } from "../src/setup";
import { isInitialSetupComplete } from "../src/setup-state";
import { decodeJsonBody } from "../src/validation";
import { provisionWorkspace } from "../src/workspace-provisioning";
import { createTestDb, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf?.dispose());

const input = {
	email: "owner@example.test",
	password: "correct horse battery staple",
	username: "workspace.owner",
	workspaceName: "Example Workspace",
	workspaceSlug: "example-workspace",
	initialTeamName: "Operations",
	initialInboxName: "Support",
};

describe("explicit initial Workspace Owner setup", () => {
	test("keeps normal application gates closed until first-use setup completes", async () => {
		ctx = await createTestDb();
		expect(await isInitialSetupComplete(ctx.env)).toBeFalse();
	});

	test("opens normal application gates only after setup completes", async () => {
		ctx = await createTestDb();
		await setupInitialOwner(ctx.env, input);
		expect(await isInitialSetupComplete(ctx.env)).toBeTrue();
	});

	test("uses Better Auth credentials and atomically creates the initial workspace graph", async () => {
		ctx = await createTestDb();
		const result = await setupInitialOwner(ctx.env, input);
		expect(result.verification).toBe("pending_sender_configuration");

		const owner = await ctx.db
			.select()
			.from(user)
			.where(eq(user.id, result.userId))
			.get();
		expect(owner).toMatchObject({
			email: input.email,
			username: input.username,
			emailVerified: false,
		});
		const workspace = await ctx.db
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, result.workspaceId))
			.get();
		expect(workspace).toMatchObject({
			name: input.workspaceName,
			slug: input.workspaceSlug,
		});
		expect(
			await getWorkspaceAccess(ctx.db, result.workspaceId, result.userId),
		).toMatchObject({ role: "owner", isAdmin: true });
		expect(
			await ctx.db
				.select()
				.from(teams)
				.where(eq(teams.id, result.teamId))
				.get(),
		).toMatchObject({
			workspaceId: result.workspaceId,
			name: input.initialTeamName,
		});
		expect(
			await ctx.db
				.select()
				.from(inboxes)
				.where(eq(inboxes.id, result.inboxId))
				.get(),
		).toMatchObject({
			workspaceId: result.workspaceId,
			teamId: result.teamId,
			name: input.initialInboxName,
		});
		expect(
			await ctx.db
				.select()
				.from(teamMembers)
				.where(
					and(
						eq(teamMembers.teamId, result.teamId),
						eq(teamMembers.userId, result.userId),
					),
				)
				.get(),
		).not.toBeNull();
		expect(
			await ctx.db
				.select()
				.from(inboxMembers)
				.where(
					and(
						eq(inboxMembers.inboxId, result.inboxId),
						eq(inboxMembers.userId, result.userId),
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
						eq(workspaceMembers.workspaceId, result.workspaceId),
						eq(workspaceMembers.userId, result.userId),
					),
				)
				.get(),
		).toMatchObject({ role: "owner" });
		expect(await ctx.db.select().from(workspaceSetupClaim).get()).toMatchObject(
			{
				userId: result.userId,
				workspaceId: result.workspaceId,
				completedAt: expect.any(String),
			},
		);
	});

	test("rejects malformed Effect input and keeps generic Better Auth signup disabled", async () => {
		ctx = await createTestDb();
		const malformed = await decodeJsonBody(
			new Request("https://msgflow.test/api/setup/owner", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...input, username: "Owner" }),
			}),
			OwnerSetupRequestSchema,
		);
		expect(malformed).toMatchObject({ ok: false });

		const signup = await createAuth(ctx.env).handler(
			new Request("https://msgflow.test/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Public",
					email: "public@example.test",
					password: input.password,
					username: "public.user",
				}),
			}),
		);
		expect(signup.status).toBe(400);
		expect(await signup.json()).toMatchObject({
			code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
		});
	});

	test("rejects reserved usernames before creating an account", async () => {
		ctx = await createTestDb();
		await expect(
			setupInitialOwner(ctx.env, { ...input, username: "support" }),
		).rejects.toMatchObject({ status: 400 });
		expect(await ctx.db.select().from(user).all()).toHaveLength(0);
	});

	test("allows exactly one concurrent first-use claim and reports every loser as a conflict", async () => {
		ctx = await createTestDb();
		const contenders = [
			input,
			...["second", "third", "fourth"].map((name) => ({
				...input,
				email: `${name}@example.test`,
				username: `${name}.owner`,
				workspaceSlug: `${name}-workspace`,
			})),
		];
		const outcomes = await Promise.allSettled(
			contenders.map((contender) => setupInitialOwner(ctx.env, contender)),
		);
		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = outcomes.filter(
			(outcome): outcome is PromiseRejectedResult =>
				outcome.status === "rejected",
		);
		expect(rejected).toHaveLength(contenders.length - 1);
		for (const outcome of rejected) {
			expect(outcome.reason).toBeInstanceOf(OwnerSetupError);
			expect(outcome.reason).toMatchObject({ status: 409 });
		}
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(1);
		expect(await ctx.db.select().from(user).all()).toHaveLength(1);
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(1);
		expect(await ctx.db.select().from(teams).all()).toHaveLength(1);
		expect(await ctx.db.select().from(teamMembers).all()).toHaveLength(1);
		expect(await ctx.db.select().from(inboxes).all()).toHaveLength(1);
		expect(await ctx.db.select().from(inboxMembers).all()).toHaveLength(1);
	});

	test("retains the claim when Better Auth finds a partially created account", async () => {
		ctx = await createTestDb();
		await ctx.db
			.insert(user)
			.values({
				id: "partial-owner",
				name: input.username,
				email: input.email,
				emailVerified: false,
			})
			.run();

		await expect(setupInitialOwner(ctx.env, input)).rejects.toMatchObject({
			status: 400,
		});
		expect(await ctx.db.select().from(workspaceSetupClaim).get()).toMatchObject(
			{
				email: input.email,
				userId: null,
				workspaceId: null,
				completedAt: null,
			},
		);
		await expect(
			setupInitialOwner(ctx.env, {
				...input,
				email: "second-owner@example.test",
				username: "second.owner",
				workspaceSlug: "second-workspace",
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(0);
	});

	test("keeps initial setup singleton after a later Workspace is provisioned", async () => {
		ctx = await createTestDb();
		const initial = await setupInitialOwner(ctx.env, input);
		const later = await provisionWorkspace(ctx.env, initial.userId, {
			workspaceName: "Later Workspace",
			workspaceSlug: "later-workspace",
			initialTeamName: "Later Team",
			initialInboxName: "Later Inbox",
		});

		await expect(
			setupInitialOwner(ctx.env, {
				...input,
				email: "second-owner@example.test",
				username: "second.owner",
				workspaceSlug: "second-workspace",
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(await ctx.db.select().from(workspaces).all()).toHaveLength(2);
		expect(await ctx.db.select().from(workspaceSetupClaim).get()).toMatchObject(
			{
				userId: initial.userId,
				workspaceId: initial.workspaceId,
			},
		);
		expect(await ctx.db.select().from(workspaceSetupClaim).all()).toHaveLength(
			1,
		);
		expect(later.workspaceId).not.toBe(initial.workspaceId);
	});

	test("does not implicitly promote a caller in an empty legacy workspace", async () => {
		ctx = await createTestDb();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: "legacy",
				name: "Legacy",
				slug: "legacy",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(user)
			.values({
				id: "legacy-user",
				name: "Legacy",
				email: "legacy@example.test",
				emailVerified: true,
			})
			.run();
		expect(
			await getWorkspaceAccess(ctx.db, "legacy", "legacy-user"),
		).toBeNull();
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(0);
	});
});
