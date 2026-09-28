import type { SidebarNode, SidebarTreeResponse } from "@msgflow/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { Sidebar } from "./Sidebar";

function node(
	id: string,
	label: string,
	children: SidebarNode[] = [],
): SidebarNode {
	return {
		id,
		label,
		children,
		parentId: null,
		type: id.startsWith("inbox") ? "inbox" : "section",
		icon: null,
		color: null,
		count: null,
		isCollapsible: children.length > 0,
		isEditable: false,
		isHidden: false,
		permissionState: "allowed",
		filter: id.startsWith("inbox")
			? { status: "open", inboxId: id.slice("inbox:".length) }
			: { status: "open" },
	};
}

function sidebarTree(): SidebarTreeResponse {
	const child = node("inbox:child", "Child");
	child.parentId = "inbox:parent";
	const parent = node("inbox:parent", "Parent", [child]);
	parent.parentId = "section:shared";
	return {
		workspace: { id: "workspace", name: "Workspace", slug: "workspace" },
		permissions: { isAdmin: false },
		preferences: {
			collapsedSections: [],
			collapsedNodeIds: [],
			lastOpenBranchIds: [],
			pinnedItemIds: [],
			hiddenItemIds: [],
			itemOrder: {},
		},
		sections: [node("section:shared", "Shared Inboxes", [parent])],
	};
}

async function renderSidebar(
): Promise<void> {
	vi.spyOn(api, "getSidebar").mockResolvedValue(sidebarTree());
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<Sidebar
					workspaceId="workspace"
					currentUserId="user-1"
					activeFilters={{}}
					onSelect={vi.fn()}
					compact={false}
					onToggleCompact={vi.fn()}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
	await screen.findByRole("treeitem", { name: /parent/i });
}

async function collapseParent(): Promise<void> {
	const parent = screen.getByRole("treeitem", { name: /parent/i });
	const control = parent.querySelector<HTMLElement>("span[aria-hidden='true']");
	expect(control).not.toBeNull();
	await act(async () => {
		fireEvent.click(control as HTMLElement);
		await Promise.resolve();
	});
}

describe("Sidebar preference persistence", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	test("persists a collapsed node after the 250ms debounce", async () => {
		const updatePreferences = vi
			.spyOn(api, "updateSidebarPreferences")
			.mockResolvedValue({
				preferences: {
					...sidebarTree().preferences,
					collapsedNodeIds: ["inbox:parent"],
				},
			});
		await renderSidebar();
		vi.useFakeTimers();

		await collapseParent();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(updatePreferences).toHaveBeenCalledWith("workspace", {
			collapsedNodeIds: ["inbox:parent"],
		});
		expect(screen.queryByRole("treeitem", { name: /child/i })).not.toBeInTheDocument();
	});

	test("rolls back a collapsed node when preference persistence fails", async () => {
		const updatePreferences = vi
			.spyOn(api, "updateSidebarPreferences")
			.mockRejectedValueOnce(new Error("network failed"));
		await renderSidebar();
		vi.useFakeTimers();

		await collapseParent();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(1);
		});

		expect(updatePreferences).toHaveBeenCalledWith("workspace", {
			collapsedNodeIds: ["inbox:parent"],
		});
		expect(screen.getByRole("treeitem", { name: /child/i })).toBeInTheDocument();
	});
});
