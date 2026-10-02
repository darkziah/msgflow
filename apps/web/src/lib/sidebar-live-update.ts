import type { QueryClient } from "@tanstack/react-query";

/**
 * Refresh server-authoritative sidebar counts and only the active workspace's
 * conversation list variants after a conversation changes. Cursor pages are a
 * chain rooted in page one, so a changed sort boundary must discard that chain
 * instead of refetching it with stale cursors.
 */
export function invalidateWorkspaceConversationViews(
	queryClient: QueryClient,
	workspaceId: string,
): void {
	void queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] });
	void queryClient.resetQueries({
		queryKey: ["conversations", workspaceId],
	});
}
