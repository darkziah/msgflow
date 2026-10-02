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

	test("0027 preserves existing identities and globally fences active WhatsApp Phone Number IDs", async () => {
		ctx = await createTestDb({
			throughMigration: "0026_inbox_tree_sidebar_preferences.sql",
		});
		const workspaceA = (await seedWorkspace(ctx)).workspaceId;
		const now = new Date().toISOString();
		await ctx.env.DB.prepare(
			"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
		)
			.bind("workspace-b", "Workspace B", "workspace-b", now, now)
			.run();
		await ctx.env.DB.batch([
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				"existing-page",
				workspaceA,
				"facebook_page",
				"Existing Page",
				"page-1",
				"active",
				now,
				now,
			),
			ctx.env.DB.prepare(
				"INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES (?,?,?,?)",
			).bind("existing-contact", workspaceA, now, now),
			ctx.env.DB.prepare(
				"INSERT INTO contact_identities (id,contact_id,channel_id,channel_type,external_user_id,created_at) VALUES (?,?,?,?,?,?)",
			).bind(
				"existing-identity",
				"existing-contact",
				"existing-page",
				"facebook_page",
				"psid-1",
				now,
			),
		]);

		await applyMigrations(ctx.env.DB, {
			fromMigration: "0027_whatsapp_phone_identity.sql",
			throughMigration: "0027_whatsapp_phone_identity.sql",
		});

		expect(await indexExists("idx_channels_whatsapp_phone_identity")).toBe(
			true,
		);
		expect(
			await ctx.env.DB.prepare(
				"SELECT channel_type FROM contact_identities WHERE id='existing-identity'",
			).first(),
		).toEqual({ channel_type: "facebook_page" });
		await ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
		)
			.bind(
				"phone-a",
				workspaceA,
				"whatsapp_phone",
				"Phone A",
				"phone-number-id",
				"active",
				now,
				now,
			)
			.run();
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			)
				.bind(
					"phone-b",
					"workspace-b",
					"whatsapp_phone",
					"Phone B",
					"phone-number-id",
					"disconnected",
					now,
					now,
				)
				.run(),
		).rejects.toThrow();
		await ctx.env.DB.prepare(
			"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
		)
			.bind(
				"phone-deleted",
				"workspace-b",
				"whatsapp_phone",
				"Deleted Phone",
				"phone-number-id",
				"deleted",
				now,
				now,
			)
			.run();
	});

	test("0027 blocks existing non-deleted WhatsApp Phone Number ID collisions", async () => {
		ctx = await createTestDb({
			throughMigration: "0026_inbox_tree_sidebar_preferences.sql",
		});
		const workspaceA = (await seedWorkspace(ctx)).workspaceId;
		const now = new Date().toISOString();
		await ctx.env.DB.prepare(
			"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
		)
			.bind("workspace-b", "Workspace B", "workspace-b", now, now)
			.run();
		await ctx.env.DB.batch([
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				"phone-a",
				workspaceA,
				"whatsapp_phone",
				"Phone A",
				"shared-phone-number-id",
				"active",
				now,
				now,
			),
			ctx.env.DB.prepare(
				"INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				"phone-b",
				"workspace-b",
				"whatsapp_phone",
				"Phone B",
				"shared-phone-number-id",
				"disconnected",
				now,
				now,
			),
		]);

		await expect(
			applyMigrations(ctx.env.DB, {
				fromMigration: "0027_whatsapp_phone_identity.sql",
				throughMigration: "0027_whatsapp_phone_identity.sql",
			}),
		).rejects.toThrow();
		expect(await indexExists("idx_channels_whatsapp_phone_identity")).toBe(
			false,
		);
		const collisionRows = await ctx.env.DB.prepare(
			"SELECT id, status FROM channels WHERE id IN ('phone-a', 'phone-b') ORDER BY id",
		).all<{ id: string; status: string }>();
		expect(collisionRows.results).toEqual([
			{ id: "phone-a", status: "active" },
			{ id: "phone-b", status: "disconnected" },
		]);
	});
});
