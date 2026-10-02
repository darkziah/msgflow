import type { QueryClient } from "@tanstack/react-query";

/**
 * Refresh server-authoritative sidebar counts and only the active workspace's
 * conversation list variants after a conversation changes.
 */
export function invalidateWorkspaceConversationViews(
	queryClient: QueryClient,
	workspaceId: string,
): void {
	void queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] });
	void queryClient.invalidateQueries({
		queryKey: ["conversations", workspaceId],
	});
}
