import { afterEach, describe, expect, test } from "bun:test";
import { type AuthEnv, createAuth, createSetupAuth } from "@msgflow/auth";
import {
	acceptAgentInvitation,
	createAgentInvitation,
	registerInvitedAgent,
	resendAgentInvitation,
} from "../src/agent-onboarding";
import { onboardingApi } from "../src/onboarding-api";
import { setupInitialOwner } from "../src/setup";
import { createTestDb, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

const ownerInput = {
	email: "owner@example.test",
	password: "correct horse battery staple",
	username: "pilot.owner",
	workspaceName: "Pilot",
	workspaceSlug: "pilot",
	initialTeamName: "Support",
	initialInboxName: "Inbox",
};

async function fixture() {
	ctx = await createTestDb();
	const sent: { to: string; text: string }[] = [];
	const env: AuthEnv = {
		...ctx.env,
		AUTH_EMAIL_FROM: "auth@example.test",
		EMAIL: {
			send: async (mail: { to: string; text: string }) => {
				sent.push(mail);
				return { messageId: "mock" };
			},
		} as NonNullable<AuthEnv["EMAIL"]>,
	};
	const owner = await setupInitialOwner(env as typeof ctx.env, ownerInput);
	const verificationUrl = sent[0]?.text.match(/https:\/\/[^\s]+/)?.[0];
	if (!verificationUrl) throw new Error("owner verification email missing");
	await createAuth(env).handler(new Request(verificationUrl));
	return { env, owner, sent };
}

function invitationToken(sent: { text: string }[]) {
	const url = sent.at(-1)?.text.match(/https:\/\/[^\s]+/)?.[0];
	if (!url) throw new Error("invitation email missing");
	const token = new URL(url).searchParams.get("invite");
	if (!token) throw new Error("invitation token missing");
	return token;
}

describe("standard workspace invitations", () => {
	test("creates email-only seven-day invitations without exposing a capability", async () => {
		const { env, owner, sent } = await fixture();
		const before = sent.length;
		const invitation = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"Agent@Example.test",
		);
		expect(invitation).toMatchObject({
			email: "agent@example.test",
			workspaceId: owner.workspaceId,
			delivery: "email_sent",
		});
		expect(invitation).not.toHaveProperty("invitationUrl");
		expect(sent).toHaveLength(before + 1);
		expect(invitation.expiresAt - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
		expect(invitation.expiresAt - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
		await expect(createAgentInvitation(env, owner.userId, owner.workspaceId, "agent@example.test"))
			.rejects.toMatchObject({ status: 409 });
	});

	test("registration persists its submitted username, verifies, and joins atomically", async () => {
		const { env, owner, sent } = await fixture();
		await createAgentInvitation(env, owner.userId, owner.workspaceId, "agent@example.test");
		const result = await registerInvitedAgent(
			env,
			invitationToken(sent),
			"pilot.agent",
			"correct horse battery staple",
		);
		expect(result).toEqual({ membership: "joined" });
		const agent = await env.DB.prepare(
			"SELECT id,username,email_verified FROM user WHERE email=?",
		).bind("agent@example.test").first<{ id: string; username: string; email_verified: number }>();
		expect(agent).toMatchObject({ username: "pilot.agent", email_verified: 1 });
		expect(await env.DB.prepare(
			"SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
		).bind(owner.workspaceId, agent?.id).first()).toEqual({ role: "member" });
	});

	test("resend replaces the token and expiry on the same pending invitation", async () => {
		const { env, owner, sent } = await fixture();
		const invitation = await createAgentInvitation(env, owner.userId, owner.workspaceId, "resend@example.test");
		const oldToken = invitationToken(sent);
		const oldExpiry = invitation.expiresAt;
		const replacement = await resendAgentInvitation(env, owner.userId, owner.workspaceId, invitation.id);
		expect(replacement.id).toBe(invitation.id);
		expect(replacement).not.toHaveProperty("invitationUrl");
		expect(replacement.expiresAt).toBeGreaterThanOrEqual(oldExpiry);
		await expect(registerInvitedAgent(env, oldToken, "resend.agent", "correct horse battery staple"))
			.rejects.toMatchObject({ status: 409 });
	});

	test("existing matching accounts are verified before guarded acceptance", async () => {
		const { env, owner, sent } = await fixture();
		await createAgentInvitation(env, owner.userId, owner.workspaceId, "existing@example.test");
		const token = invitationToken(sent);
		const existing = await createSetupAuth(env).api.signUpEmail({
			body: {
				email: "existing@example.test",
				name: "Existing Agent",
				username: "existing.agent",
				password: "correct horse battery staple",
			},
		});
		await acceptAgentInvitation(env, token, existing.user.id);
		expect(await env.DB.prepare("SELECT email_verified FROM user WHERE id=?")
			.bind(existing.user.id).first()).toEqual({ email_verified: 1 });
		expect(await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?")
			.bind(owner.workspaceId, existing.user.id).first()).toEqual({ role: "member" });
	});

	test("registration API forwards username and password", async () => {
		const { env, owner, sent } = await fixture();
		await createAgentInvitation(env, owner.userId, owner.workspaceId, "api@example.test");
		const response = await onboardingApi.request("https://msgflow.test/invitations/register", {
			method: "POST",
			headers: { "content-type": "application/json", origin: "https://msgflow.test" },
			body: JSON.stringify({
				token: invitationToken(sent),
				username: "api.agent",
				password: "correct horse battery staple",
				confirmation: "correct horse battery staple",
			}),
		}, env);
		expect(response.status).toBe(201);
		expect(await env.DB.prepare("SELECT username,email_verified FROM user WHERE email=?")
			.bind("api@example.test").first()).toEqual({ username: "api.agent", email_verified: 1 });
	});
});
