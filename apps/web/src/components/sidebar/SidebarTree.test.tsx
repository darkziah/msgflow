import type { SidebarNode, SidebarTreeResponse } from "@msgflow/contracts";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { nodeFilter, SidebarTree } from "./SidebarTree";

function node(
	id: string,
	label: string,
	children: SidebarNode[] = [],
	editable = false,
): SidebarNode {
	return {
		id,
		label,
		children,
		parentId: null,
		type: id.startsWith("inbox")
			? "inbox"
			: id.startsWith("smart")
				? "smart-view"
				: "section",
		icon: null,
		color: null,
		count: id === "inbox:child" ? 1024 : null,
		isCollapsible: children.length > 0,
		isEditable: editable,
		isHidden: false,
		permissionState: "allowed",
		filter: id.startsWith("inbox")
			? { status: "open", inboxId: id.slice(6) }
			: { status: "open" },
	};
}
function tree({
	collapsed = false,
	admin = true,
	empty = false,
	editable = true,
	searchable = false,
} = {}): SidebarTreeResponse {
	const grandchild = node("inbox:grandchild", "Needle");
	grandchild.parentId = "inbox:child";
	const child = node("inbox:child", "Child", searchable ? [grandchild] : []);
	child.parentId = "inbox:parent";
	const parent = node("inbox:parent", "Parent", empty ? [] : [child], editable);
	parent.parentId = "section:shared";
	const filler = searchable
		? Array.from({ length: 13 }, (_, index) =>
				node(`inbox:filler-${index}`, `Other ${index}`),
			)
		: [];
	return {
		workspace: { id: "w", name: "W", slug: "w" },
		permissions: { isAdmin: admin },
		preferences: {
			collapsedSections: [],
			collapsedNodeIds: collapsed ? ["inbox:parent", "inbox:child"] : [],
			lastOpenBranchIds: [],
			pinnedItemIds: [],
			hiddenItemIds: [],
			itemOrder: {},
		},
		sections: [
			node(
				"section:shared",
				"Shared Inboxes",
				empty ? [] : [parent, ...filler],
			),
			node("section:my", "My Work", [node("smart:assigned", "Assigned")]),
		],
	};
}
function renderTree(response = tree(), activeFilters = {}) {
	const onSelect = vi.fn();
	const onEditInbox = vi.fn();
	const onCreateInbox = vi.fn();
	function Harness() {
		const [current, setCurrent] = useState(response);
		return (
			<TooltipProvider>
				<SidebarTree
					tree={current}
					activeFilters={activeFilters}
					compact={false}
					currentUserId="user-1"
					onSelect={onSelect}
					onPreferencesChange={(patch) =>
						setCurrent({
							...current,
							preferences: { ...current.preferences, ...patch },
						})
					}
					onCreateInbox={onCreateInbox}
					onEditInbox={onEditInbox}
				/>
			</TooltipProvider>
		);
	}
	render(<Harness />);
	return { onSelect, onEditInbox, onCreateInbox };
}

describe("SidebarTree", () => {
	test("orders My Work first and exposes a semantic tree without nested buttons", () => {
		renderTree();
		expect(screen.getByRole("tree")).toBeInTheDocument();
		expect(
			screen
				.getAllByRole("region")
				.map((section) => section.getAttribute("aria-label")),
		).toEqual(["My Work", "Shared Inboxes"]);
		const parent = screen.getByRole("treeitem", { name: /parent/i });
		expect(parent).toHaveAttribute("aria-level", "1");
		expect(parent.querySelector("button")).toBeNull();
	});

	test("hides collapsed children and supports up/down/right/left navigation", async () => {
		renderTree(tree({ collapsed: true }));
		const assigned = screen.getByRole("treeitem", { name: /assigned/i });
		const parent = screen.getByRole("treeitem", { name: /parent/i });
		expect(
			screen.queryByRole("treeitem", { name: /child/i }),
		).not.toBeInTheDocument();
		fireEvent.keyDown(assigned, { key: "ArrowDown" });
		expect(parent).toHaveFocus();
		fireEvent.keyDown(parent, { key: "ArrowUp" });
		expect(assigned).toHaveFocus();
		fireEvent.keyDown(parent, { key: "ArrowRight" });
		const child = await screen.findByRole("treeitem", { name: /child/i });
		await waitFor(() => expect(child).toHaveFocus());
		fireEvent.keyDown(child, { key: "ArrowLeft" });
		expect(parent).toHaveFocus();
		fireEvent.keyDown(parent, { key: "ArrowLeft" });
		expect(
			screen.queryByRole("treeitem", { name: /child/i }),
		).not.toBeInTheDocument();
	});

	test("normalizes active selection and selection filters for parent and leaf nodes", () => {
		const parentFilters = nodeFilter(tree().sections[0].children[0]);
		expect(parentFilters).not.toHaveProperty("queueLabel");
		const { onSelect } = renderTree(tree(), parentFilters);
		const parent = screen.getByRole("treeitem", { name: /parent/i });
		expect(parent).toHaveAttribute("aria-selected", "true");
		fireEvent.keyDown(parent, { key: "Enter" });
		expect(onSelect).toHaveBeenLastCalledWith(parentFilters);

		const leafFilters = nodeFilter(tree().sections[0].children[0].children[0]);
		renderTree(tree(), leafFilters);
		expect(
			screen.getAllByRole("treeitem", { name: /child/i }).at(-1),
		).toHaveAttribute("aria-selected", "true");
	});

	test("falls back to My Work assigned to the current user when its selected node is removed", async () => {
		const { onSelect } = renderTree(tree(), {
			status: "open",
			inboxId: "removed-inbox",
		});
		await waitFor(() =>
			expect(onSelect).toHaveBeenCalledWith({
				status: "open",
				assigneeId: "user-1",
			}),
		);
	});

	test("uses exact accessible badge text while displaying a capped count", () => {
		renderTree();
		expect(
			screen.getByLabelText("1024 actionable conversations"),
		).toHaveTextContent("999+");
	});

	test("keeps matching ancestor paths visible during search without changing collapse preferences", () => {
		renderTree(tree({ collapsed: true, searchable: true }));
		fireEvent.change(screen.getByLabelText("Search sidebar"), {
			target: { value: "Needle" },
		});
		expect(screen.getByRole("treeitem", { name: /parent/i })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		expect(screen.getByRole("treeitem", { name: /child/i })).toHaveAttribute(
			"aria-expanded",
			"true",
		);
		expect(
			screen.getByRole("treeitem", { name: /needle/i }),
		).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Search sidebar"), {
			target: { value: "" },
		});
		expect(
			screen.queryByRole("treeitem", { name: /child/i }),
		).not.toBeInTheDocument();
	});

	test("only exposes edit access for editable inboxes and passes the actual inbox id", () => {
		const { onEditInbox } = renderTree(tree({ editable: true }));
		fireEvent.click(screen.getByRole("button", { name: "Edit Parent" }));
		expect(onEditInbox).toHaveBeenCalledWith("parent");
		cleanup();
		renderTree(tree({ editable: false }));
		expect(
			screen.queryByRole("button", { name: "Edit Parent" }),
		).not.toBeInTheDocument();
	});

	test("shows empty shared-inbox controls only to administrators", () => {
		renderTree(tree({ empty: true, admin: true }));
		expect(screen.getByText("No shared inboxes yet.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Create inbox" }),
		).toBeInTheDocument();
		cleanup();
		renderTree(tree({ empty: true, admin: false }));
		expect(
			screen.queryByRole("button", { name: "Create inbox" }),
		).not.toBeInTheDocument();
	});
});
