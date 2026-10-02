import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isValidUsername } from "./src/username-policy";

// Used by `@better-auth/cli generate` to emit the D1 (SQLite) auth schema.
// The generated tables are user / session / account / verification.
export const auth = betterAuth({
	appName: "MsgFlow",
	emailAndPassword: { enabled: true },
	plugins: [
		username({
			displayUsername: false,
			immutableUsername: true,
			usernameValidator: isValidUsername,
		}),
	],
	database: drizzleAdapter(drizzle({} as never), { provider: "sqlite" }),
});
