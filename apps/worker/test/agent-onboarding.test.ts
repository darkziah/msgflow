import { afterEach, describe, expect, test } from "bun:test";
import { type AuthEnv, createAuth } from "@msgflow/auth";
import {
	acceptAgentInvitation,
	createAgentInvitation,
	registerInvitedAgent,
	requestAccountVerification,
} from "../src/agent-onboarding";
import { onboardingApi } from "../src/onboarding-api";
import { setupInitialOwner } from "../src/setup";
import { createTestDb, type TestCtx } from "./helpers";

function required<T>(value: T | null | undefined): T {
 if (value === null || value === undefined) throw new Error("Missing expected test value");
 return value;
}
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
async function fixture(sender = true) {
	ctx = await createTestDb();
	const sent: { to: string; text: string }[] = [];
	const env: AuthEnv = {
		...ctx.env,
		...(sender
			? {
					AUTH_EMAIL_FROM: "auth@example.test",
					EMAIL: {
						send: async (mail: { to: string; text: string }) => {
							sent.push(mail);
							return { messageId: "mock" };
						},
					} as SendEmail,
				}
			: {}),
	};
	const owner = await setupInitialOwner(env as typeof ctx.env, ownerInput);
	return { env, owner, sent };
}
async function verifyMail(
	env: AuthEnv,
	sent: { text: string }[],
	index = sent.length - 1,
) {
	const url = sent[index]?.text.match(/https:\/\/[^\s]+/)?.[0];
	expect(url).toBeDefined();
	const response = await createAuth(env).handler(new Request(required(url)));
	expect([200, 302]).toContain(response.status);
}
async function verifiedFixture() {
	const f = await fixture();
	await verifyMail(f.env, f.sent);
	return f;
}
function token(url: string) {
	return required(new URL(url).searchParams.get("invite"));
}

describe("verified owner and invited agent onboarding", () => {
	test("owner remains pending without sender; invite fails closed; existing signin works", async () => {
		const { env, owner } = await fixture(false);
		expect(owner.verification).toBe("pending_sender_configuration");
		await expect(
			createAgentInvitation(
				env,
				owner.userId,
				owner.workspaceId,
				"agent@example.test",
			),
		).rejects.toMatchObject({ status: 403 });
		expect(
			(
				await createAuth(env).api.signInEmail({
					body: { email: ownerInput.email, password: ownerInput.password },
				})
			).user.id,
		).toBe(owner.userId);
		expect(await requestAccountVerification(env, ownerInput.email)).toBe(
			"pending_sender_configuration",
		);
	});
	test("actual Better Auth verification, invited credential signup, and atomic verified membership", async () => {
		const { env, owner, sent } = await verifiedFixture();
		expect(owner.verification).toBe("verification_sent");
		const invitation = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"Agent@example.test",
		);
		expect(invitation.delivery).toBe("email_sent");
		const capability = token(invitation.invitationUrl);
		expect(
			await registerInvitedAgent(
				env,
				capability,
				"pilot.agent",
				ownerInput.password,
			),
		).toMatchObject({
			verification: "verification_sent",
			membership: "pending_verification",
		});
		const agent = await env.DB.prepare(
			"SELECT id,email_verified FROM user WHERE email=?",
		)
			.bind("agent@example.test")
			.first<{ id: string; email_verified: number }>();
		expect(agent?.email_verified).toBe(0);
		expect(
			await env.DB.prepare("SELECT id FROM workspace_members WHERE user_id=?")
				.bind(required(agent).id)
				.first(),
		).toBeNull();
		await expect(
			acceptAgentInvitation(env, capability, required(agent).id),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			registerInvitedAgent(env, capability, "pilot.other", ownerInput.password),
		).rejects.toMatchObject({ status: 409 });
		await verifyMail(env, sent);
		const outcomes = await Promise.allSettled([
			acceptAgentInvitation(env, capability, required(agent).id),
			acceptAgentInvitation(env, capability, required(agent).id),
		]);
		expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const membership = await env.DB.prepare(
			"SELECT workspace_id,role FROM workspace_members WHERE user_id=?",
		)
			.bind(required(agent).id)
			.all();
		expect(membership.results).toEqual([
			{ workspace_id: owner.workspaceId, role: "member" },
		]);
		await expect(
			env.DB.prepare("UPDATE user SET username=? WHERE id=?")
				.bind("changed.name", required(agent).id)
				.run(),
		).rejects.toThrow();
		const login = await createAuth(env).api.signInUsername({
			body: { username: "pilot.agent", password: ownerInput.password },
		});
		expect(login.user.id).toBe(required(agent).id);
	});
	test("invites require owner, expire, reject wrong identities and reserved/unnormalized usernames", async () => {
		const { env, owner } = await verifiedFixture();
		await expect(
			createAgentInvitation(
				env,
				owner.userId,
				"other-workspace",
				"agent@example.test",
			),
		).rejects.toMatchObject({ status: 403 });
		const invitation = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"agent@example.test",
		);
		const capability = token(invitation.invitationUrl);
		for (const username of ["support", "Agent", "two..dots", "a+b"])
			await expect(
				registerInvitedAgent(env, capability, username, ownerInput.password),
			).rejects.toMatchObject({ status: 400 });
		await expect(
			acceptAgentInvitation(env, capability, owner.userId),
		).rejects.toMatchObject({ status: 403 });
		await env.DB.prepare("UPDATE agent_invitations SET expires_at=0 WHERE id=?")
			.bind(invitation.id)
			.run();
		await expect(
			registerInvitedAgent(env, capability, "pilot.agent", ownerInput.password),
		).rejects.toMatchObject({ status: 409 });
	});
	test("copyable invitation fallback and mail failure are honest", async () => {
		const { env, owner } = await verifiedFixture();
		const noSender = { ...env, AUTH_EMAIL_FROM: undefined };
		expect(
			(
				await createAgentInvitation(
					noSender,
					owner.userId,
					owner.workspaceId,
					"copy@example.test",
				)
			).delivery,
		).toBe("copy_link");
		const broken = {
			...env,
			EMAIL: {
				send: async () => {
					throw new Error("mock delivery failure");
				},
			} as SendEmail,
		};
		expect(
			(
				await createAgentInvitation(
					broken,
					owner.userId,
					owner.workspaceId,
					"failed@example.test",
				)
			).delivery,
		).toBe("email_delivery_failed");
		const pending = await createAgentInvitation(
			noSender,
			owner.userId,
			owner.workspaceId,
			"unverified@example.test",
		);
		await registerInvitedAgent(
			noSender,
			token(pending.invitationUrl),
			"unverified.agent",
			ownerInput.password,
		);
		expect(
			await requestAccountVerification(broken, "unverified@example.test"),
		).toBe("verification_delivery_failed");
	});
	test("Better Auth recovery sends only for verified email, resets once, revokes sessions", async () => {
		const { env, owner, sent } = await fixture();
		const auth = createAuth(env);
		const before = sent.length;
		await auth.api.requestPasswordReset({
			body: {
				email: ownerInput.email,
				redirectTo: "https://msgflow.test/login",
			},
		});
		expect(sent).toHaveLength(before);
		await verifyMail(env, sent);
		const login = await auth.api.signInEmail({
			body: { email: ownerInput.email, password: ownerInput.password },
		});
		expect(login.token).toBeTruthy();
		await auth.api.requestPasswordReset({
			body: {
				email: ownerInput.email,
				redirectTo: "https://msgflow.test/login",
			},
		});
		expect(sent).toHaveLength(before + 1);
		const url = required(required(sent.at(-1)).text.match(/https:\/\/[^\s]+/)?.[0]);
		const resetToken = required(new URL(url).pathname.split("/").at(-1));
		expect(
			await auth.api.resetPassword({
				body: {
					token: resetToken,
					newPassword: "new correct horse battery staple",
				},
			}),
		).toMatchObject({ status: true });
		await expect(
			auth.api.resetPassword({
				body: { token: resetToken, newPassword: ownerInput.password },
			}),
		).rejects.toThrow();
		expect(
			await env.DB.prepare("SELECT id FROM session WHERE user_id=?")
				.bind(owner.userId)
				.first(),
		).toBeNull();
		expect(
			(
				await auth.api.signInEmail({
					body: {
						email: ownerInput.email,
						password: "new correct horse battery staple",
					},
				})
			).user.id,
		).toBe(owner.userId);
	});
	test("parallel signup creates one credential account and trigger rolls back failed membership", async () => {
		const { env, owner, sent } = await verifiedFixture();
		const invitation = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"parallel@example.test",
		);
		const capability = token(invitation.invitationUrl);
		const outcomes = await Promise.allSettled([
			registerInvitedAgent(
				env,
				capability,
				"parallel.one",
				ownerInput.password,
			),
			registerInvitedAgent(
				env,
				capability,
				"parallel.two",
				ownerInput.password,
			),
		]);
		expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const users = await env.DB.prepare("SELECT id FROM user WHERE email=?")
			.bind("parallel@example.test")
			.all<{ id: string }>();
		expect(users.results).toHaveLength(1);
		await verifyMail(env, sent);
		// Force the membership trigger to hit a primary-key collision: acceptance must roll back.
		await env.DB.prepare("UPDATE workspace_members SET id=? WHERE user_id=?")
			.bind(invitation.id, owner.userId)
			.run();
		await expect(
			acceptAgentInvitation(env, capability, required(users.results[0]).id),
		).rejects.toThrow();
		expect(
			await env.DB.prepare(
				"SELECT accepted_at FROM agent_invitations WHERE id=?",
			)
				.bind(invitation.id)
				.first(),
		).toEqual({ accepted_at: null });
	});
	test("an existing verified account accepts only its invitation without credential overwrite", async () => {
		const { env, owner, sent } = await verifiedFixture();
		const first = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"existing@example.test",
		);
		await registerInvitedAgent(
			env,
			token(first.invitationUrl),
			"existing.agent",
			ownerInput.password,
		);
		await verifyMail(env, sent);
		const second = await createAgentInvitation(
			env,
			owner.userId,
			owner.workspaceId,
			"existing@example.test",
		);
		await expect(
			registerInvitedAgent(
				env,
				token(second.invitationUrl),
				"changed.agent",
				"different password",
			),
		).rejects.toMatchObject({ status: 409 });
		const existing = await createAuth(env).api.signInEmail({
			body: { email: "existing@example.test", password: ownerInput.password },
		});
		expect(
			await acceptAgentInvitation(
				env,
				token(second.invitationUrl),
				existing.user.id,
			),
		).toEqual({ workspaceId: owner.workspaceId });
	});
	test("HTTP routes deny unauthenticated owners, foreign origins and malformed capabilities", async () => {
		const { env, owner } = await fixture(false);
		const post = (
			path: string,
			body: unknown,
			origin = "https://msgflow.test",
		) =>
			onboardingApi.request(
				`https://msgflow.test${path}`,
				{
					method: "POST",
					headers: { "content-type": "application/json", origin },
					body: JSON.stringify(body),
				},
				env,
			);
		expect(
			(
				await post(`/workspaces/${owner.workspaceId}/invitations`, {
					email: "a@example.test",
				})
			).status,
		).toBe(401);
		expect(
			(
				await post("/invitations/register", {
					token: "bad",
					username: "agent",
					password: ownerInput.password,
				})
			).status,
		).toBe(400);
		expect(
			(await post("/invitations/register", {}, "https://evil.test")).status,
		).toBe(403);
	});
});
