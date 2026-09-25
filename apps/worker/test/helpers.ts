import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { user, workspaces } from "@msgflow/db";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../src/env";

/**
 * Miniflare-backed D1 test database: fresh instance per call, full migration
 * chain (0000 → 0005) applied, wrapped in the worker Env shape so the real
 * manage/access/rules/workspace-api functions run against actual SQLite.
 *
 * This is how the routing-spec invariants are tested for real: default-inbox
 * uniqueness (partial unique index), archived-inbox validation, rule priority
 * / stop_processing / skipped logging, and workspace permission boundaries.
 */

const MIGRATIONS_DIR = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"packages",
	"db",
	"migrations",
);

export interface TestCtx {
	env: Env;
	db: ReturnType<typeof drizzle>;
	mf: Miniflare;
	activityRequests: unknown[];
}

export async function createTestDb(
	options: { script?: string } = {},
): Promise<TestCtx> {
	// Miniflare v5 validates the new workers[] shape; the exported v4→v5
	// converter keeps the classic script/modules/d1Databases form readable.
	const mf = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			script:
				options.script ??
				"export default { fetch() { return new Response('ok'); } }",
			durableObjects: options.script
				? { CONVERSATION_DO: { className: "ConversationDO", useSQLite: true } }
				: undefined,
			d1Databases: {
				DB: `msgflow-test-${Date.now()}-${Math.random()}`,
			},
			r2Buckets: ["ATTACHMENTS", "EMAIL_ARCHIVE"],
			compatibilityDate: "2025-01-01",
		}),
	);
	await mf.ready;
	const d1 = await mf.getD1Database("DB");
	const attachments = await mf.getR2Bucket("ATTACHMENTS");
	const emailArchive = await mf.getR2Bucket("EMAIL_ARCHIVE");
	await applyMigrations(d1);
	const db = drizzle(d1 as unknown as D1Database);
	const activityRequests: unknown[] = [];
	const conversationDo = {
		idFromName: (name: string) => name,
		get: () => ({
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				const request =
					input instanceof Request ? input : new Request(input, init);
				activityRequests.push(await request.json());
				return new Response("ok");
			},
		}),
	} as unknown as Env["CONVERSATION_DO"];
	return {
		env: {
			DB: d1 as unknown as Env["DB"],
			CONVERSATION_DO: conversationDo,
			ATTACHMENTS: attachments as unknown as Env["ATTACHMENTS"],
			EMAIL_ARCHIVE: emailArchive as unknown as Env["EMAIL_ARCHIVE"],
			ATTACHMENT_PUBLIC_BASE_URL: "https://attachments.test",
			BETTER_AUTH_SECRET: "test-better-auth-secret-that-is-long-enough",
			BETTER_AUTH_URL: "https://msgflow.test",
		} as Env,
		db,
		mf,
		activityRequests,
	};
}

async function applyMigrations(d1: D1Database): Promise<void> {
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((name) => /^\d{4}_.+\.sql$/.test(name))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
		for (const statement of sql.split("--> statement-breakpoint")) {
			const trimmed = statement.trim();
			if (!trimmed) continue;
			await d1.prepare(trimmed).run();
		}
	}
}

/** Minimal rows tests need: the default workspace + auth users. */
export async function seedWorkspace(
	ctx: TestCtx,
): Promise<{ workspaceId: string }> {
	const now = new Date().toISOString();
	await ctx.db
		.insert(workspaces)
		.values({
			id: crypto.randomUUID(),
			name: "Test Workspace",
			slug: "default",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	const ws = await ctx.db
		.select()
		.from(workspaces)
		.where(eq(workspaces.slug, "default"))
		.get();
	if (!ws) throw new Error("workspace seed failed");
	return { workspaceId: ws.id };
}

export async function seedUser(
	ctx: TestCtx,
	id: string,
	email: string,
): Promise<void> {
	await ctx.db
		.insert(user)
		.values({ id, name: id, email, emailVerified: true })
		.onConflictDoNothing()
		.run();
}
