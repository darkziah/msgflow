import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "@msgflow/db";

export interface AuthEnv {
	DB: D1Database;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL?: string;
	/**
	 * Comma-separated origins allowed for cookie/bearer auth requests, e.g.
	 * "http://localhost:5174,https://inbox.yehey.jp". Required when the web app
	 * is served from a different origin than the Worker (dev proxy, split
	 * hosting) — better-auth rejects cross-origin requests otherwise.
	 */
	BETTER_AUTH_TRUSTED_ORIGINS?: string;
}

/**
 * Create a Better Auth instance bound to the request's env. Email + password for
 * Phase 1; D1 (SQLite) via the official drizzle adapter (per ADR 0006).
 */
export function createAuth(env: AuthEnv) {
	const db = drizzle(env.DB);
	return betterAuth({
		appName: "MsgFlow",
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		emailAndPassword: { enabled: true },
		trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS
			? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
			: undefined,
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
	});
}

export type Auth = ReturnType<typeof createAuth>;
