import type { SidebarNode, SidebarTreeResponse } from "@msgflow/contracts";
import { describe, expect, test } from "vitest";
import { adaptSidebarTree, sidebarItemFilters } from "./api";

function node(
	id: string,
	type: SidebarNode["type"],
	filter: SidebarNode["filter"],
	children: SidebarNode[] = [],
): SidebarNode {
	return {
		id,
		type,
		parentId: null,
		label: id,
		icon: null,
		color: null,
		count: null,
		children,
		isCollapsible: children.length > 0,
		isEditable: false,
		isHidden: false,
		permissionState: "allowed",
		filter,
	};
}

function tree(): SidebarTreeResponse {
	const childInbox = node("inbox:child", "inbox", {
		status: "open",
		inboxId: "child",
	});
	childInbox.parentId = "inbox:parent";
	const parentInbox = node(
		"inbox:parent",
		"inbox",
		{ status: "open", inboxId: "parent" },
		[childInbox],
	);
	parentInbox.parentId = "section:shared-inboxes";
	const channel = node("channel:facebook-1", "channel", {
		status: "open",
		channel: "facebook",
	});
	channel.parentId = "channel-group:facebook";
	const channelGroup = node(
		"channel-group:facebook",
		"channel-group",
		{ status: "open", channel: "facebook" },
		[channel],
	);
	channelGroup.parentId = "section:channels";
	const tag = node("tag:vip", "tag", { status: "open", tagId: "vip" });
	tag.parentId = "section:tags";
	const view = node("view:urgent", "saved-view", {
		status: "all",
		q: "urgent",
	});
	view.parentId = "section:saved-views";

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
		sections: [
			node("section:my-work", "section", {}, []),
			node("section:shared-inboxes", "section", { status: "open" }, [
				parentInbox,
			]),
			node("section:channels", "section", { status: "open" }, [channelGroup]),
			node("section:tags", "section", {}, [tag]),
			node("section:saved-views", "section", {}, [view]),
		],
	};
}

describe("adaptSidebarTree", () => {
	test("preserves each normalized node's filter, parent, and flat order", () => {
		const adapted = adaptSidebarTree(tree());
		const inboxes = adapted.sections[0]?.groups[0]?.items ?? [];
		const channels = adapted.sections[2]?.items ?? [];
		const tags = adapted.sections[3]?.items ?? [];
		const views = adapted.sections[4]?.items ?? [];

		expect(inboxes.map((item) => item.id)).toEqual([
			"inbox:parent",
			"inbox:child",
		]);
		expect(inboxes[1]).toMatchObject({
			parentId: "inbox:parent",
			order: 1,
			filter: { status: "open", inboxId: "child" },
		});
		expect(channels.map((item) => item.id)).toEqual([
			"channel-group:facebook",
			"channel:facebook-1",
		]);
		const channel = channels[1];
		const tagItem = tags[0];
		const viewItem = views[0];
		if (!channel || !tagItem || !viewItem) {
			throw new Error("missing flattened sidebar nodes");
		}
		expect(sidebarItemFilters(channel)).toEqual({
			status: "open",
			channel: "facebook",
		});
		expect(sidebarItemFilters(tagItem)).toEqual({
			status: "open",
			tagId: "vip",
		});
		expect(sidebarItemFilters(viewItem)).toEqual({
			status: "all",
			q: "urgent",
		});
		expect(adapted.filtersByNodeId).toMatchObject({
			"section:shared-inboxes": { status: "open" },
			"inbox:parent": { status: "open", inboxId: "parent" },
			"inbox:child": { status: "open", inboxId: "child" },
			"channel:facebook-1": { status: "open", channel: "facebook" },
			"tag:vip": { status: "open", tagId: "vip" },
			"view:urgent": { status: "all", q: "urgent" },
		});
	});
});
