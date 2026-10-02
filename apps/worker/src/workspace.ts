import type { drizzle } from "drizzle-orm/d1";
import { workspaces } from "@msgflow/db";

/** The installation has one explicitly created Workspace; never bootstrap it from traffic. */
export async function getConfiguredWorkspace(
	db: ReturnType<typeof drizzle>,
): Promise<typeof workspaces.$inferSelect> {
	const workspace = await db.select().from(workspaces).limit(1).get();
	if (!workspace) throw new Error("MsgFlow setup is not complete");
	return workspace;
}
