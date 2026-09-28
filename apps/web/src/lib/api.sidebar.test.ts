import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./api";

describe("sidebar tree API", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("returns the authoritative tree response without a flat adapter", async () => {
		const response = {
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
			sections: [],
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify(response), { status: 200 }),
				),
		);
		expect(await api.getSidebar("workspace")).toEqual(response);
	});

	test("passes a descendant inbox scope through to the conversation endpoint", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetch);
		await api.listConversations({
			workspaceId: "workspace",
			inboxId: "parent",
			inboxScope: "descendants",
		});
		expect(fetch.mock.calls[0]?.[0]).toContain("inboxScope=descendants");
	});
});
