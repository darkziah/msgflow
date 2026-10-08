import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { KeyboardShortcutsProvider } from "@/components/inbox/KeyboardShortcutsProvider";
import { api } from "@/lib/api";
import { emailApi } from "@/lib/email-api";
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";
import {
	createWorkspaceSocketReconnector,
	handleWorkspaceConversationSocketEvent,
} from "./index";

vi.mock("@/lib/api", () => ({
	api: {
		getConversation: vi.fn(),
		getMessages: vi.fn(),
		listUsers: vi.fn(),
		markRead: vi.fn(),
	},
	conversationSocketUrl: vi.fn(() => "ws://localhost/ws"),
	workspaceSocketUrl: vi.fn(() => "ws://localhost/ws/workspace"),
}));

vi.mock("@/lib/email-api", () => ({
	emailApi: { context: vi.fn(), getDraft: vi.fn() },
}));

function withQueryClient(ui: ReactNode, queryClient: QueryClient) {
	return render(
		<QueryClientProvider client={queryClient}>
			<KeyboardShortcutsProvider>{ui}</KeyboardShortcutsProvider>
		</QueryClientProvider>,
	);
}

describe("sidebar live updates", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reconnects one workspace socket after close and cancels it on cleanup", () => {
		vi.useFakeTimers();
		const sockets: Array<{
			onopen: ((event: Event) => void) | null;
			onclose: ((event: CloseEvent) => void) | null;
			onerror: ((event: Event) => void) | null;
			onmessage: ((event: MessageEvent) => void) | null;
			close: ReturnType<typeof vi.fn>;
		}> = [];
		const reconnect = createWorkspaceSocketReconnector(
			"workspace-a",
			() => {},
			() => {
				const socket = {
					onopen: null,
					onclose: null,
					onerror: null,
					onmessage: null,
					close: vi.fn(),
				};
				sockets.push(socket);
				return socket;
			},
		);

		reconnect.start();
		expect(sockets).toHaveLength(1);
		sockets[0]?.onclose?.(new CloseEvent("close"));
		vi.advanceTimersByTime(249);
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(2);

		reconnect.stop();
		expect(sockets[1]?.close).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(10_000);
		expect(sockets).toHaveLength(2);
	});

	it("resets retry backoff after a successful workspace socket open", () => {
		vi.useFakeTimers();
		const sockets: Array<{
			onopen: ((event: Event) => void) | null;
			onclose: ((event: CloseEvent) => void) | null;
			onerror: ((event: Event) => void) | null;
			onmessage: ((event: MessageEvent) => void) | null;
			close: () => void;
		}> = [];
		const reconnect = createWorkspaceSocketReconnector("workspace-a", () => {}, () => {
			const socket = { onopen: null, onclose: null, onerror: null, onmessage: null, close() {} };
			sockets.push(socket);
			return socket;
		});

		reconnect.start();
		sockets[0]?.onclose?.(new CloseEvent("close"));
		vi.advanceTimersByTime(250);
		sockets[1]?.onopen?.(new Event("open"));
		sockets[1]?.onclose?.(new CloseEvent("close"));
		vi.advanceTimersByTime(249);
		expect(sockets).toHaveLength(2);
		vi.advanceTimersByTime(1);
		expect(sockets).toHaveLength(3);
		reconnect.stop();
	});

	it("retires an errored socket and schedules exactly one reconnect", () => {
		vi.useFakeTimers();
		const sockets: Array<{
			onopen: ((event: Event) => void) | null;
			onclose: ((event: CloseEvent) => void) | null;
			onerror: ((event: Event) => void) | null;
			onmessage: ((event: MessageEvent) => void) | null;
			close: ReturnType<typeof vi.fn>;
		}> = [];
		const reconnect = createWorkspaceSocketReconnector("workspace-a", () => {}, () => {
			const socket = {
				onopen: null,
				onclose: null,
				onerror: null,
				onmessage: null,
				close: vi.fn(),
			};
			sockets.push(socket);
			return socket;
		});

		reconnect.start();
		sockets[0]?.onerror?.(new Event("error"));
		expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
		// A browser may deliver close after error. It is stale and cannot enqueue
		// another retry.
		sockets[0]?.onclose?.(new CloseEvent("close"));
		vi.advanceTimersByTime(250);
		expect(sockets).toHaveLength(2);
		vi.advanceTimersByTime(10_000);
		expect(sockets).toHaveLength(2);
		reconnect.stop();
	});

	it("invalidates sidebar data and resets active workspace cursor chains", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		const reset = vi.spyOn(queryClient, "resetQueries");

		invalidateWorkspaceConversationViews(queryClient, "workspace-a");

		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(invalidate).toHaveBeenNthCalledWith(1, {
			queryKey: ["sidebar", "workspace-a"],
		});
		expect(reset).toHaveBeenCalledWith({
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
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["conversations", "workspace-a"],
		});
		expect(queryClient.getQueryState(["conversations", "workspace-a"])).toBeUndefined();
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["conversation", "workspace-a", "conversation-a"],
		});
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["sidebar", "workspace-b"],
		});
	});

	it("resets only the active workspace for valid workspace events and retains no poll", () => {
		const queryClient = new QueryClient();
		const reset = vi.spyOn(queryClient, "resetQueries");
		handleWorkspaceConversationSocketEvent(
			queryClient,
			"workspace-a",
			{ data: JSON.stringify({ type: "workspace:conversations-changed" }) } as MessageEvent,
		);
		expect(reset).toHaveBeenCalledWith({ queryKey: ["conversations", "workspace-a"] });
		expect(reset).not.toHaveBeenCalledWith({ queryKey: ["conversations", "workspace-b"] });
		reset.mockClear();
		for (const data of [
			JSON.stringify({ type: "workspace:conversations-changed", workspaceId: "workspace-b" }),
			JSON.stringify({ type: "workspace:other" }),
			"not json",
		]) {
			handleWorkspaceConversationSocketEvent(queryClient, "workspace-a", { data } as MessageEvent);
		}
		expect(reset).not.toHaveBeenCalled();
		expect(readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8")).not.toContain("setInterval");
	});
});
