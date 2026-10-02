import { afterEach, describe, expect, it, vi } from "vitest";
import { teamApi } from "./team-api";

describe("teamApi", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("uses explicit encoded workspace paths and the GET team envelope", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ team: {} }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await teamApi.get("workspace / one");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/workspaces/workspace%20%2F%20one/team",
			expect.objectContaining({ credentials: "include" }),
		);
	});

	it("uses the PATCH member-role envelope and encoded workspace/member path", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { member: {} } }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await teamApi.updateMemberRole("workspace / one", "user / one", { role: "admin" });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/workspaces/workspace%20%2F%20one/members/user%20%2F%20one/role",
			expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
		);
	});

	it("uses the DELETE offboarding envelope and confirmation payload", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { success: true } }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await teamApi.offboardMember("workspace-1", "user-1", { confirmation: "REMOVE" });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/workspaces/workspace-1/members/user-1",
			expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmation: "REMOVE" }) }),
		);
	});
});
