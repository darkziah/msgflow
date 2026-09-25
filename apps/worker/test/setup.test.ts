import { afterEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
	inboxMembers,
	inboxes,
	teamMembers,
	teams,
	user,
	workspaceMembers,
	workspaces,
	workspaceSetupClaim,
} from "@msgflow/db";
import { getWorkspaceAccess } from "../src/access";
import { OwnerSetupError, setupInitialOwner } from "../src/setup";
import { decodeJsonBody } from "../src/validation";
import { OwnerSetupRequestSchema } from "@msgflow/contracts";
import { createAuth } from "@msgflow/auth";
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
	test("uses Better Auth credentials and atomically creates the initial workspace graph", async () => {
		ctx = await createTestDb();
		const result = await setupInitialOwner(ctx.env, input);
		expect(result.verification).toBe("pending_sender_configuration");

		const owner = await ctx.db.select().from(user).where(eq(user.id, result.userId)).get();
		expect(owner).toMatchObject({ email: input.email, username: input.username, emailVerified: false });
		const workspace = await ctx.db.select().from(workspaces).where(eq(workspaces.id, result.workspaceId)).get();
		expect(workspace).toMatchObject({ name: input.workspaceName, slug: input.workspaceSlug });
		expect(await getWorkspaceAccess(ctx.db, result.workspaceId, result.userId)).toMatchObject({ role: "owner", isAdmin: true });
		expect(await ctx.db.select().from(teams).where(eq(teams.id, result.teamId)).get()).toMatchObject({ workspaceId: result.workspaceId, name: input.initialTeamName });
		expect(await ctx.db.select().from(inboxes).where(eq(inboxes.id, result.inboxId)).get()).toMatchObject({ workspaceId: result.workspaceId, teamId: result.teamId, name: input.initialInboxName });
		expect(await ctx.db.select().from(teamMembers).where(and(eq(teamMembers.teamId, result.teamId), eq(teamMembers.userId, result.userId))).get()).not.toBeNull();
		expect(await ctx.db.select().from(inboxMembers).where(and(eq(inboxMembers.inboxId, result.inboxId), eq(inboxMembers.userId, result.userId))).get()).not.toBeNull();
		expect(await ctx.db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, result.workspaceId), eq(workspaceMembers.userId, result.userId))).get()).toMatchObject({ role: "owner" });
		expect(await ctx.db.select().from(workspaceSetupClaim).get()).toMatchObject({ userId: result.userId, workspaceId: result.workspaceId });
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

		const signup = await createAuth(ctx.env).handler(new Request("https://msgflow.test/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Public", email: "public@example.test", password: input.password, username: "public.user" }),
		}));
		expect(signup.status).toBe(400);
		expect(await signup.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
	});

	test("rejects reserved usernames before creating an account", async () => {
		ctx = await createTestDb();
		await expect(setupInitialOwner(ctx.env, { ...input, username: "support" })).rejects.toMatchObject({ status: 400 });
		expect(await ctx.db.select().from(user).all()).toHaveLength(0);
	});

	test("allows exactly one concurrent first-use claim and reports every loser as a conflict", async () => {
		ctx = await createTestDb();
		const contenders = [input, ...["second", "third", "fourth"].map((name) => ({
			...input,
			email: `${name}@example.test`,
			username: `${name}.owner`,
			workspaceSlug: `${name}-workspace`,
		}))];
		const outcomes = await Promise.allSettled(contenders.map((contender) => setupInitialOwner(ctx.env, contender)));
		expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
		const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
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

	test("does not implicitly promote a caller in an empty legacy workspace", async () => {
		ctx = await createTestDb();
		const now = new Date().toISOString();
		await ctx.db.insert(workspaces).values({ id: "legacy", name: "Legacy", slug: "legacy", createdAt: now, updatedAt: now }).run();
		await ctx.db.insert(user).values({ id: "legacy-user", name: "Legacy", email: "legacy@example.test", emailVerified: true }).run();
		expect(await getWorkspaceAccess(ctx.db, "legacy", "legacy-user")).toBeNull();
		expect(await ctx.db.select().from(workspaceMembers).all()).toHaveLength(0);
	});
});
