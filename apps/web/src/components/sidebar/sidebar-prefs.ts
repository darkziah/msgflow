import type { SidebarNode, SidebarPreferences } from "@msgflow/contracts";

export function emptySidebarPreferences(): SidebarPreferences {
	return {
		collapsedSections: [],
		collapsedNodeIds: [],
		lastOpenBranchIds: [],
		pinnedItemIds: [],
		hiddenItemIds: [],
		itemOrder: {},
	};
}

export function isSectionCollapsed(
	section: SidebarNode,
	prefs: SidebarPreferences,
): boolean {
	return prefs.collapsedSections.includes(section.id);
}

export function isNodeCollapsed(
	node: SidebarNode,
	prefs: SidebarPreferences,
): boolean {
	return prefs.collapsedNodeIds.includes(node.id);
}
