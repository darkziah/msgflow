import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { api } from "@/lib/api";
import { emailApi } from "@/lib/email-api";
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";

vi.mock("@/lib/api", () => ({
	api: {
		getConversation: vi.fn(),
		getMessages: vi.fn(),
		listUsers: vi.fn(),
		markRead: vi.fn(),
	},
	conversationSocketUrl: vi.fn(() => "ws://localhost/ws"),
}));

vi.mock("@/lib/email-api", () => ({
	emailApi: { context: vi.fn(), getDraft: vi.fn() },
}));

function withQueryClient(ui: ReactNode, queryClient: QueryClient) {
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

describe("sidebar live updates", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("invalidates only the active workspace sidebar and conversation lists", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		invalidateWorkspaceConversationViews(queryClient, "workspace-a");

		expect(invalidate).toHaveBeenCalledTimes(2);
		expect(invalidate).toHaveBeenNthCalledWith(1, {
			queryKey: ["sidebar", "workspace-a"],
		});
		expect(invalidate).toHaveBeenNthCalledWith(2, {
			queryKey: ["conversations", "workspace-a"],
		});
	});

	it("bounds an inbound conversation event to its workspace sidebar tree", async () => {
		let socket:
			| { onmessage: ((event: MessageEvent) => void) | null }
			| undefined;
		vi.stubGlobal(
			"WebSocket",
			class {
				onmessage: ((event: MessageEvent) => void) | null = null;
				constructor() {
					socket = this;
				}
				close() {}
			},
		);
		vi.mocked(api.getConversation).mockReturnValue(new Promise(() => {}));
		vi.mocked(api.getMessages).mockReturnValue(new Promise(() => {}));
		vi.mocked(api.listUsers).mockResolvedValue({ users: [] });
		vi.mocked(emailApi.context).mockResolvedValue({} as never);
		vi.mocked(emailApi.getDraft).mockResolvedValue({ draft: null } as never);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		withQueryClient(
			<ConversationThread
				conversationId="conversation-a"
				workspaceId="workspace-a"
			/>,
			queryClient,
		);

		await waitFor(() => expect(socket).toBeDefined());
		act(() => {
			socket?.onmessage?.({
				data: JSON.stringify({ type: "conversation-updated" }),
			} as MessageEvent);
		});

		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["sidebar", "workspace-a"],
		});
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["conversations", "workspace-a"],
		});
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["conversation", "workspace-a", "conversation-a"],
		});
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["sidebar", "workspace-b"],
		});
	});
});
