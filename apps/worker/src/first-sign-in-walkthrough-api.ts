import { createAuth } from "@msgflow/auth";
import { user } from "@msgflow/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Env } from "./env";

/** Per-Agent walkthrough completion, retained across browser sessions. */
export const firstSignInWalkthroughApi = new Hono<{ Bindings: Env }>();

firstSignInWalkthroughApi.get("/onboarding/first-sign-in", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);

	const row = await drizzle(c.env.DB)
		.select({ completedAt: user.onboardingTourCompletedAt })
		.from(user)
		.where(eq(user.id, session.user.id))
		.get();
	return c.json({ completed: Boolean(row?.completedAt) });
});

firstSignInWalkthroughApi.post("/onboarding/first-sign-in", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);

	await drizzle(c.env.DB)
		.update(user)
		.set({ onboardingTourCompletedAt: new Date() })
		.where(eq(user.id, session.user.id));
	return c.json({ completed: true });
});
