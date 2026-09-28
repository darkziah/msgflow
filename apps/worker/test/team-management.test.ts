import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import {
	OffboardWorkspaceMemberRequestSchema,
	UpdateWorkspaceMemberRoleRequestSchema,
} from "@msgflow/contracts";
import { session, workspaceMembers } from "@msgflow/db";
import {
	listWorkspaceTeam,
	offboardWorkspaceMember,
	updateWorkspaceMemberRole,
} from "../src/team-management";
import { decodeJsonBody } from "../src/validation";
import { createTestDb, seedUser, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

async function seedLifecycleFixture() {
	ctx = await createTestDb();
	const now = new Date().toISOString();
	await Promise.all([
		seedUser(ctx, "owner", "owner@example.test"),
		seedUser(ctx, "owner-2", "owner-2@example.test"),
		seedUser(ctx, "admin", "admin@example.test"),
		seedUser(ctx, "member", "Member@Example.Test"),
		seedUser(ctx, "foreign", "foreign@example.test"),
	]);
	await ctx.env.DB.batch([
		ctx.env.DB.prepare("INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)").bind("a", "A", "a", now, now),
		ctx.env.DB.prepare("INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)").bind("b", "B", "b", now, now),
		ctx.env.DB.prepare("INSERT INTO agent_invitations (id,token_hash,workspace_id,email,reserved_username,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)").bind("invite-a", "private-token-hash", "a", "invitee@example.test", "invitee", "owner", Date.now() + 60_000, Date.now()),
		...[["owner", "owner"], ["owner-2", "owner"], ["admin", "admin"], ["member", "member"]].map(([id, role]) => ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind(`a-${id}`, "a", id, role, now)),
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("b-foreign", "b", "foreign", "member", now),
		ctx.env.DB.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("b-member", "b", "member", "member", now),
		ctx.env.DB.prepare("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)").bind("team-a", "a", "A Team", now),
		ctx.env.DB.prepare("INSERT INTO teams (id,workspace_id,name,created_at) VALUES (?,?,?,?)").bind("team-b", "b", "B Team", now),
		ctx.env.DB.prepare("INSERT INTO inboxes (id,workspace_id,name,color,sort_order,is_archived,assignment_strategy,created_at) VALUES (?,?,?,?,?,?,?,?)").bind("inbox-a", "a", "A Inbox", "#000000", 0, 0, "manual", now),
		ctx.env.DB.prepare("INSERT INTO inboxes (id,workspace_id,name,color,sort_order,is_archived,assignment_strategy,created_at) VALUES (?,?,?,?,?,?,?,?)").bind("inbox-b", "b", "B Inbox", "#000000", 0, 0, "manual", now),
		ctx.env.DB.prepare("INSERT INTO team_members (id,team_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("tm-a", "team-a", "member", "member", now),
		ctx.env.DB.prepare("INSERT INTO team_members (id,team_id,user_id,role,created_at) VALUES (?,?,?,?,?)").bind("tm-b", "team-b", "member", "member", now),
		ctx.env.DB.prepare("INSERT INTO inbox_members (id,inbox_id,user_id) VALUES (?,?,?)").bind("im-a", "inbox-a", "member"),
		ctx.env.DB.prepare("INSERT INTO inbox_members (id,inbox_id,user_id) VALUES (?,?,?)").bind("im-b", "inbox-b", "member"),
		ctx.env.DB.prepare("INSERT INTO email_domains (id,workspace_id,canonical_domain,created_at,updated_at) VALUES (?,?,?,?,?)").bind("domain-a", "a", "a.example.test", now, now),
		ctx.env.DB.prepare("INSERT INTO email_domains (id,workspace_id,canonical_domain,created_at,updated_at) VALUES (?,?,?,?,?)").bind("domain-b", "b", "b.example.test", now, now),
		ctx.env.DB.prepare("INSERT INTO mailboxes (id,workspace_id,email_domain_id,local_part,canonical_address,type,owner_user_id,is_enabled,is_send_enabled,created_at,updated_at) VALUES (?,?,?,?,?,'private',?,1,1,?,?)").bind("mb-a", "a", "domain-a", "member", "member@a.example.test", "member", now, now),
		ctx.env.DB.prepare("INSERT INTO mailboxes (id,workspace_id,email_domain_id,local_part,canonical_address,type,owner_user_id,is_enabled,is_send_enabled,created_at,updated_at) VALUES (?,?,?,?,?,'private',?,1,1,?,?)").bind("mb-b", "b", "domain-b", "member", "member@b.example.test", "member", now, now),
		ctx.env.DB.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").bind("member-session", Date.now() + 60_000, "member-token", Date.now(), Date.now(), "member"),
	]);
}

async function expectStatus(promise: Promise<unknown>, status: number) {
	try { await promise; throw new Error("expected rejection"); } catch (error) { expect(error).toMatchObject({ status }); }
}

describe("team management lifecycle", () => {
	test("hides invitations from members while retaining their active roster", async () => {
		await seedLifecycleFixture();
		await ctx.env.DB
			.prepare(
				"INSERT INTO agent_invitations (id,token_hash,workspace_id,email,reserved_username,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
			)
			.bind(
				"pending-invitation",
				"c".repeat(64),
				"a",
				"pending@example.test",
				"pending",
				"owner",
				Date.now() + 60_000,
				Date.now(),
			)
			.run();
		const summary = await listWorkspaceTeam(ctx.env, "member", "a");
		expect(summary.members.map((member) => member.id)).toContain("member");
		expect(summary.invitations).toEqual([]);
		expect(summary.canManage).toBe(false);
		const ownerSummary = await listWorkspaceTeam(ctx.env, "owner", "a");
		expect(ownerSummary.invitations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "pending-invitation", canRevoke: true }),
			]),
		);
	});

	test("serializes manager invitations without invitation capabilities", async () => {
		await seedLifecycleFixture();
		const summary = await listWorkspaceTeam(ctx.env, "owner", "a");
		expect(summary.invitations).toHaveLength(1);
		expect(summary.invitations[0]).toEqual({
			id: "invite-a", email: "invitee@example.test", username: "invitee",
			invitedByName: "owner", createdAt: expect.any(Number), expiresAt: expect.any(Number),
			lifecycle: "awaiting_activation", canRevoke: true,
		});
		expect(Object.keys(summary.invitations[0])).not.toEqual(
			expect.arrayContaining(["token", "tokenHash", "token_hash", "cooldownUntil"]),
		);
	});

	test("registers canonical typed team lifecycle routes", () => {
		const source = readFileSync(new URL("../src/team-api.ts", import.meta.url), "utf8");
		expect(source).toContain('teamApi.patch("/workspaces/:workspaceId/members/:userId/role"');
		expect(source).toContain('teamApi.delete("/workspaces/:workspaceId/members/:userId"');
		expect(source).toContain('teamApi.get("/workspaces/:workspaceId/invitations"');
		expect(source).toContain("UpdateWorkspaceMemberRoleRequestSchema");
		expect(source).toContain("OffboardWorkspaceMemberRequestSchema");
		expect(source).toContain("decodeJsonBody");
		expect(source).toContain("updateWorkspaceMemberRole(");
		expect(source).toContain("offboardWorkspaceMember(");
		expect(source).toContain("getTeamManagement(");
		expect(source).toContain('c.header("Cache-Control", "private, no-store")');
		expect(source).not.toContain("clientActor");
		expect(source).not.toContain("requireDefaultWorkspaceAccess");
	});

	test("strips unknown role and offboarding body keys at the route boundary", async () => {
		const request = (body: unknown) => new Request("https://msgflow.test/api/workspaces/a/members/member", {
			method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
		});
		await expect(decodeJsonBody(request({ role: "admin", actorId: "forged" }), UpdateWorkspaceMemberRoleRequestSchema)).resolves.toEqual({ ok: true, value: { role: "admin" } });
		await expect(decodeJsonBody(request({ confirmation: "member@example.test", actorId: "forged" }), OffboardWorkspaceMemberRequestSchema)).resolves.toEqual({ ok: true, value: { confirmation: "member@example.test" } });
	});

	test("allows only owners to mutate roles and preserves the final owner", async () => {
		await seedLifecycleFixture();
		await expectStatus(updateWorkspaceMemberRole(ctx.env, "a", "admin", "member", "admin"), 403);
		await expectStatus(updateWorkspaceMemberRole(ctx.env, "a", "owner", "foreign", "admin"), 404);
		await updateWorkspaceMemberRole(ctx.env, "a", "owner", "member", "admin");
		expect((await ctx.db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, "member")).get())?.role).toBe("admin");
		await updateWorkspaceMemberRole(ctx.env, "a", "owner", "owner-2", "member");
		await expectStatus(updateWorkspaceMemberRole(ctx.env, "a", "owner", "owner", "member"), 409);
	});

	test("atomically retains an owner when two owners offboard each other concurrently", async () => {
		await seedLifecycleFixture();
		const results = await Promise.allSettled([
			offboardWorkspaceMember(ctx.env, "a", "owner", "owner-2", "owner-2@example.test"),
			offboardWorkspaceMember(ctx.env, "a", "owner-2", "owner", "owner@example.test"),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected).toMatchObject({ reason: { status: 409 } });
		expect(
			await ctx.env.DB.prepare(
				"SELECT count(*) AS count FROM workspace_members WHERE workspace_id='a' AND role='owner'",
			).first<{ count: number }>(),
		).toEqual({ count: 1 });
	});

	test("allows an admin to offboard a member but not an owner", async () => {
		await seedLifecycleFixture();
		await expectStatus(offboardWorkspaceMember(ctx.env, "a", "admin", "owner-2", "owner-2"), 403);
		await offboardWorkspaceMember(ctx.env, "a", "admin", "member", "member@example.test");
		expect(await ctx.env.DB.prepare("SELECT 1 FROM workspace_members WHERE workspace_id='a' AND user_id='member'").first()).toBeNull();
		expect(await ctx.env.DB.prepare("SELECT actor_user_id FROM workspace_member_offboardings WHERE workspace_id='a' AND user_id='member'").first()).toEqual({ actor_user_id: "admin" });
	});

	test("offboards only within one workspace, disables owned mailboxes, audits, and keeps sessions", async () => {
		await seedLifecycleFixture();
		await expectStatus(offboardWorkspaceMember(ctx.env, "a", "admin", "owner-2", "owner-2"), 403);
		await expectStatus(offboardWorkspaceMember(ctx.env, "a", "owner", "foreign", "foreign"), 404);
		await expectStatus(offboardWorkspaceMember(ctx.env, "a", "owner", "member", "Member@Example.Test"), 400);
		await offboardWorkspaceMember(ctx.env, "a", "owner", "member", "member@example.test");
		expect(await ctx.env.DB.prepare("SELECT 1 FROM workspace_members WHERE workspace_id='a' AND user_id='member'").first()).toBeNull();
		expect(await ctx.env.DB.prepare("SELECT 1 FROM workspace_members WHERE workspace_id='b' AND user_id='member'").first()).not.toBeNull();
		expect(await ctx.env.DB.prepare("SELECT is_enabled,is_send_enabled FROM mailboxes WHERE id='mb-a'").first()).toEqual({ is_enabled: 0, is_send_enabled: 0 });
		expect(await ctx.env.DB.prepare("SELECT is_enabled,is_send_enabled FROM mailboxes WHERE id='mb-b'").first()).toEqual({ is_enabled: 1, is_send_enabled: 1 });
		expect(await ctx.env.DB.prepare("SELECT prior_role,confirmation_identifier,private_mailboxes_disabled FROM workspace_member_offboardings WHERE workspace_id='a' AND user_id='member'").first()).toEqual({ prior_role: "member", confirmation_identifier: "member@example.test", private_mailboxes_disabled: 1 });
		expect(await ctx.db.select().from(session).where(eq(session.id, "member-session")).get()).toBeTruthy();
		await expect(
			ctx.env.DB.prepare(
				"DELETE FROM workspace_member_offboardings WHERE workspace_id='a' AND user_id='member'",
			).run(),
		).rejects.toThrow("workspace member offboarding audit is immutable");
		await expectStatus(listWorkspaceTeam(ctx.env, "member", "a"), 403);
	});
});
