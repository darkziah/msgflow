import { afterEach, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createTestDb,
	seedWorkspace,
	type TestCtx,
} from "./helpers";

let ctx: TestCtx;

afterEach(async () => {
	await ctx?.mf.dispose();
});

async function oldSchema(): Promise<void> {
	ctx = await createTestDb({
		throughMigration: "0021_meta_app_webhook_tokens.sql",
	});
	await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await ctx.env.DB.prepare(
		"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
	)
		.bind("workspace-b", "Workspace B", "workspace-b", now, now)
		.run();
}

async function indexExists(name: string): Promise<boolean> {
	return Boolean(
		await ctx.env.DB.prepare(
			"SELECT 1 AS present FROM sqlite_master WHERE type='index' AND name=?",
		)
			.bind(name)
			.first(),
	);
}

describe("provider identity migration preflight", () => {
	test("0022 blocks duplicate Meta apps before replacing the old fence", async () => {
		await oldSchema();
		const now = new Date().toISOString();
		await ctx.env.DB.batch([
			ctx.env.DB.prepare(
				"INSERT INTO meta_apps (id,workspace_id,display_name,app_id,app_secret,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
			).bind(
				"app-a",
				(await seedWorkspace(ctx)).workspaceId,
				"App A",
				"shared-app",
				"secret-a",
				now,
				now,
			),
			ctx.env.DB.prepare(
				"INSERT INTO meta_apps (id,workspace_id,display_name,app_id,app_secret,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
			).bind(
				"app-b",
				"workspace-b",
				"App B",
				"shared-app",
				"secret-b",
				now,
				now,
			),
		]);
		await expect(
			applyMigrations(ctx.env.DB, {
				fromMigration: "0022_multi_workspace_meta_app_identity.sql",
				throughMigration: "0022_multi_workspace_meta_app_identity.sql",
			}),
		).rejects.toThrow("migration 0022 blocked");
		expect(await indexExists("idx_meta_apps_workspace_app_id")).toBe(true);
		expect(await indexExists("idx_meta_apps_app_id")).toBe(false);
		expect(
			await ctx.env.DB.prepare(
				"SELECT app_secret FROM meta_apps WHERE id='app-b'",
			).first(),
		).toEqual({ app_secret: "secret-b" });
	});

	test("0023 blocks active cross-workspace Page collisions before adding the global fence", async () => {
		await oldSchema();
		const now = new Date().toISOString();
		const workspaceA = (await seedWorkspace(ctx)).workspaceId;
		await ctx.env.DB.batch([
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				"page-a",
				workspaceA,
				"facebook_page",
				"Page A",
				"shared-page",
				"active",
				now,
				now,
			),
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				"page-b",
				"workspace-b",
				"facebook_page",
				"Page B",
				"shared-page",
				"active",
				now,
				now,
			),
		]);
		await expect(
			applyMigrations(ctx.env.DB, {
				fromMigration: "0023_multi_workspace_facebook_page_identity.sql",
				throughMigration: "0023_multi_workspace_facebook_page_identity.sql",
			}),
		).rejects.toThrow("migration 0023 blocked");
		expect(await indexExists("idx_channels_facebook_page_identity")).toBe(
			false,
		);
		expect(await indexExists("idx_channels_workspace_external")).toBe(true);
		expect(
			await ctx.env.DB.prepare(
				"SELECT status FROM channels WHERE id='page-b'",
			).first(),
		).toEqual({ status: "active" });
	});
});
