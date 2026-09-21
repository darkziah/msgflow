import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Used by `@better-auth/cli generate` to emit the D1 (SQLite) auth schema.
// The generated tables are user / session / account / verification.
export const auth = betterAuth({
	appName: "MsgFlow",
	emailAndPassword: { enabled: true },
	database: drizzleAdapter(drizzle({} as never), { provider: "sqlite" }),
});
