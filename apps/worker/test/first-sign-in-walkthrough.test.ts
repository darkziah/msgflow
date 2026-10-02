import { afterEach, describe, expect, test } from "bun:test";
import { createAuth } from "@msgflow/auth";
import { createTestDb, type TestCtx } from "./helpers";
import { setupInitialOwner } from "../src/setup";
import { firstSignInWalkthroughApi } from "../src/first-sign-in-walkthrough-api";

let ctx: TestCtx | undefined;

afterEach(async () => {
	await ctx?.mf.dispose();
	ctx = undefined;
});

async function authenticatedAgent() {
	ctx = await createTestDb();
	const setup = await setupInitialOwner(ctx.env, {
		email: "agent@example.test",
		password: "correct horse battery staple",
		username: "agent",
		workspaceName: "Support",
		workspaceSlug: "support",
		initialTeamName: "Support",
		initialInboxName: "Inbox",
	});
	const login = await createAuth(ctx.env).handler(
		new Request("https://msgflow.test/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "agent@example.test",
				password: "correct horse battery staple",
			}),
		}),
	);
	const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
	if (!cookie) throw new Error("sign-in did not issue a session cookie");
	return { cookie, userId: setup.userId };
}

describe("first-sign-in walkthrough progress", () => {
	test("persists completion for the authenticated Agent across browser sessions", async () => {
		const { cookie, userId } = await authenticatedAgent();
		const request = (method: "GET" | "POST", token = cookie) =>
			firstSignInWalkthroughApi.request("https://msgflow.test/onboarding/first-sign-in", {
				method,
				headers: { cookie: token },
			}, ctx?.env);

		expect((await request("GET")).status).toBe(200);
		expect(await (await request("GET")).json()).toEqual({ completed: false });

		expect((await request("POST")).status).toBe(200);
		expect(await (await request("POST")).json()).toEqual({ completed: true });

		const secondLogin = await createAuth(ctx.env).handler(
			new Request("https://msgflow.test/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "agent@example.test",
					password: "correct horse battery staple",
				}),
			}),
		);
		const secondCookie = secondLogin.headers.get("set-cookie")?.split(";", 1)[0];
		if (!secondCookie) throw new Error("second sign-in did not issue a session cookie");
		expect(await (await request("GET", secondCookie)).json()).toEqual({
			completed: true,
		});

		const database = ctx?.env.DB;
		if (!database) throw new Error("test database was not created");
		const row = await database
			.prepare("SELECT onboarding_tour_completed_at FROM user WHERE id = ?")
			.bind(userId)
			.first<{ onboarding_tour_completed_at: number }>();
		expect(row?.onboarding_tour_completed_at).toEqual(expect.any(Number));
	});

	test("rejects unauthenticated progress reads and writes", async () => {
		ctx = await createTestDb();
		for (const method of ["GET", "POST"] as const) {
			expect(
				(await firstSignInWalkthroughApi.request(
					"https://msgflow.test/onboarding/first-sign-in",
					{ method },
					ctx.env,
				))
					.status,
			).toBe(401);
		}
	});
});
