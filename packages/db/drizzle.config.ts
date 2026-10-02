import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: ["./src/schema.ts", "./src/auth-schema.ts", "./src/email-pilot-schema.ts", "./src/agent-onboarding-schema.ts"],
	out: "./migrations",
	dialect: "sqlite",
});
