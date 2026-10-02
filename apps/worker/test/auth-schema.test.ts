import { afterEach, describe, expect, test } from "bun:test";
import { user } from "@msgflow/db";
import { createTestDb, type TestCtx } from "./helpers";

let ctx: TestCtx;

afterEach(async () => {
	await ctx?.mf.dispose();
});

describe("auth username migrations", () => {
	test("preserves nullable users and enforces global uniqueness", async () => {
		ctx = await createTestDb();
		await ctx.db.insert(user).values([
			{ id: "existing-a", name: "Existing A", email: "existing-a@test.dev", emailVerified: true },
			{ id: "existing-b", name: "Existing B", email: "existing-b@test.dev", emailVerified: true },
			{ id: "agent-a", name: "Agent A", email: "agent-a@test.dev", emailVerified: true, username: "agent-a" },
		]).run();

		await expect(
			ctx.db.insert(user).values({
				id: "agent-b",
				name: "Agent B",
				email: "agent-b@test.dev",
				emailVerified: true,
				username: "agent-a",
			}).run(),
		).rejects.toThrow();
	});

	test("permits one valid assignment but rejects invalid or changed usernames", async () => {
		ctx = await createTestDb();
		await ctx.db.insert(user).values({
			id: "legacy",
			name: "Legacy",
			email: "legacy@test.dev",
			emailVerified: true,
		}).run();

		await expect(ctx.env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
			.bind("legacy_agent", "legacy").run()).rejects.toThrow();
		await ctx.env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
			.bind("legacy.agent", "legacy").run();
		await ctx.env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
			.bind("legacy.agent", "legacy").run();

		for (const username of ["legacy_agent", "Legacy-agent", "legacy..agent", ".legacy", "legacy."]) {
			await expect(ctx.db.insert(user).values({
				id: `invalid-${username}`,
				name: "Invalid",
				email: `invalid-${username}@test.dev`,
				emailVerified: true,
				username,
			}).run()).rejects.toThrow();
		}

		await expect(ctx.env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
			.bind("other-agent", "legacy").run()).rejects.toThrow();
		await expect(ctx.env.DB.prepare("UPDATE user SET username = NULL WHERE id = ?")
			.bind("legacy").run()).rejects.toThrow();
		await expect(ctx.env.DB.prepare("UPDATE user SET username = ? WHERE id = ?")
			.bind("legacy_agent", "legacy").run()).rejects.toThrow();
	});
});
