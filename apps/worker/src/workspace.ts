import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { workspaces } from "@msgflow/db";

// Single-tenant bootstrap: a "default" workspace is created lazily (see
// ingest.ts). The API routes for tags/rules/canned replies resolve the same
// workspace so management CRUD and the ingest-time rule evaluation share one
// scope. Workspace RBAC enforcement (workspace_members) is a later phase.
export const DEFAULT_WORKSPACE_SLUG = "default";

export async function getOrCreateWorkspace(
	db: ReturnType<typeof drizzle>,
	now: string,
): Promise<typeof workspaces.$inferSelect> {
	const existing = await db
		.select()
		.from(workspaces)
		.where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG))
		.get();
	if (existing) return existing;
	await db
		.insert(workspaces)
		.values({
			id: crypto.randomUUID(),
			name: "Yehey Japan",
			slug: DEFAULT_WORKSPACE_SLUG,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	const created = await db
		.select()
		.from(workspaces)
		.where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG))
		.get();
	if (!created) throw new Error("workspace bootstrap failed");
	return created;
}
