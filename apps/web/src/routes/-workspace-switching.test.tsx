import type { WorkspaceSummary } from "@msgflow/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshWorkspacesThenSelect } from "@/components/layout/AppTopBar";
import { api } from "@/lib/api";
import {
	clearWorkspaceSensitiveQueries,
	reconcileWorkspaceSelection,
	resolveAuthorizedWorkspaceId,
	WORKSPACE_QUERY_ROOTS,
	workspaceSearch,
} from "./index";

const workspaces: WorkspaceSummary[] = [
	{
		id: "workspace-a",
		name: "Alpha",
		slug: "alpha",
		role: "owner",
		createdAt: "2026-09-28T00:00:00.000Z",
	},
	{
		id: "workspace-b",
		name: "Beta",
		slug: "beta",
		role: "member",
		createdAt: "2026-09-28T00:00:00.000Z",
	},
];

describe("workspace URL authority", () => {
	it("uses only an authorized workspace from the URL and falls back deterministically", () => {
		expect(resolveAuthorizedWorkspaceId("workspace-b", workspaces)).toBe("workspace-b");
		expect(resolveAuthorizedWorkspaceId("stale-workspace", workspaces)).toBe(
			"workspace-a",
		);
		expect(resolveAuthorizedWorkspaceId(undefined, workspaces)).toBe("workspace-a");
		expect(resolveAuthorizedWorkspaceId("workspace-a", [])).toBeUndefined();
	});

	it("changes workspace URLs without retaining a selected conversation", () => {
		expect(workspaceSearch("workspace-b")).toEqual({ workspace: "workspace-b" });
	});

	it("clears every workspace-sensitive cache root on a direct URL workspace change", () => {
		const queryClient = new QueryClient();
		for (const root of ["conversations", "users", "email-context", "mailbox-delegates", "drafts"]) {
			queryClient.setQueryData([root, "workspace-a"], { workspace: "workspace-a" });
		}
		queryClient.setQueryData(["workspaces"], { workspaces });

		clearWorkspaceSensitiveQueries(queryClient);

		for (const root of ["conversations", "users", "email-context", "mailbox-delegates", "drafts"]) {
			expect(queryClient.getQueryData([root, "workspace-a"])).toBeUndefined();
		}
		expect(queryClient.getQueryData(["workspaces"])).toEqual({ workspaces });
		expect(WORKSPACE_QUERY_ROOTS).toEqual(
			expect.arrayContaining(["users", "email-context", "mailbox-delegates", "drafts"]),
		);
	});

	it("clears selection and filters for direct URL workspace transitions", () => {
		expect(
			reconcileWorkspaceSelection({
				previousWorkspaceId: "workspace-a",
				activeWorkspaceId: "workspace-b",
				requestedWorkspaceId: "workspace-b",
				conversationId: "conversation-from-a",
			}),
		).toEqual({ clearWorkspaceState: true, canonicalSearch: { workspace: "workspace-b" } });
	});

	it("canonical stale URLs drop the selected conversation", () => {
		expect(
			reconcileWorkspaceSelection({
				previousWorkspaceId: "workspace-a",
				activeWorkspaceId: "workspace-a",
				requestedWorkspaceId: "stale-workspace",
				conversationId: "conversation-from-stale-workspace",
			}),
		).toEqual({ clearWorkspaceState: false, canonicalSearch: { workspace: "workspace-a" } });
	});
});

describe("workspace creation selection", () => {
	it("refreshes authoritative workspace membership before selecting the created workspace", async () => {
		const events: string[] = [];
		await refreshWorkspacesThenSelect(
			async () => {
				events.push("refetch:start");
				await Promise.resolve();
				events.push("refetch:done");
			},
			"workspace-b",
			(workspaceId) => events.push(`select:${workspaceId}`),
		);

		expect(events).toEqual(["refetch:start", "refetch:done", "select:workspace-b"]);
	});
});

describe("workspace creation API", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("posts to the collection endpoint with the source workspace query", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					workspace: { ...workspaces[1], teamId: "team-b", inboxId: "inbox-b" },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await api.createWorkspace("workspace-a", {
			workspaceName: "Beta",
			workspaceSlug: "beta",
			initialTeamName: "Operations",
			initialInboxName: "Support",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/workspaces?sourceWorkspaceId=workspace-a",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
