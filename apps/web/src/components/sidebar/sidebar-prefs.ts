import type {
	SidebarItem,
	SidebarPreferences,
	SidebarSection,
} from "@msgflow/contracts";

/**
 * Filters a sidebar item list by the user's personal preferences (hidden /
 * pinned / local order), preserving the server order otherwise. Pinned items
 * float to the top; hidden items are dropped — except inboxes with open
 * conversations assigned to the user, which the never-remove rule keeps
 * visible until the work is resolved.
 */
export function applyPreferences(
	items: SidebarItem[],
	prefs: SidebarPreferences,
): SidebarItem[] {
	const pinned = new Set(prefs.pinnedItemIds);
	const hidden = new Set(prefs.hiddenItemIds);
	const visible = items.filter((item) => {
		if (!hidden.has(item.id)) return true;
		return item.kind === "inbox" && item.hasOpenAssigned;
	});
	const ordered = [...visible].sort((a, b) => {
		const pa = pinned.has(a.id) ? 0 : 1;
		const pb = pinned.has(b.id) ? 0 : 1;
		if (pa !== pb) return pa - pb;
		const oa = prefs.itemOrder[a.id];
		const ob = prefs.itemOrder[b.id];
		if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
		if (oa !== undefined) return -1;
		if (ob !== undefined) return 1;
		return 0;
	});
	return ordered;
}

export function isSectionCollapsed(
	section: SidebarSection,
	prefs: SidebarPreferences,
): boolean {
	return prefs.collapsedSections.includes(section.key);
}
