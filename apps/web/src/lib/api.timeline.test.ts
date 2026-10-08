import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./api";

describe("timeline API", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("serializes workspace, cursor, and limit and returns the cursor page", async () => {
		const page = { items: [], nextCursor: "next-cursor" };
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
		vi.stubGlobal("fetch", fetch);

		expect(
			await api.getMessages("conversation/id", "workspace id", {
				cursor: "prior/cursor",
				limit: 50,
			}),
		).toEqual(page);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			"/api/conversations/conversation%2Fid/messages?workspaceId=workspace+id&cursor=prior%2Fcursor&limit=50",
		);
	});
});
