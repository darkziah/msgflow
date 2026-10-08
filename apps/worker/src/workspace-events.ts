import type { Env } from "./env";

/**
 * Notify a workspace's inbox views after a committed conversation-list mutation.
 * Fanout is deliberately best-effort: D1 remains authoritative if this fails.
 */
export async function notifyWorkspaceConversationChange(
	env: Env,
	workspaceId: string,
): Promise<void> {
	try {
		const namespace = env.WORKSPACE_EVENTS_DO;
		await namespace
			.get(namespace.idFromName(workspaceId))
			.fetch("https://workspace-events/notify", {
				method: "POST",
				headers: { "x-workspace-id": workspaceId },
			});
	} catch {
		// A DO outage must never turn an already-committed D1 mutation into a failure.
	}
}
