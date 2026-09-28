import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamSettingsSection } from "./TeamSettingsSection";

const team = {
	canManage: true,
	canManageOwners: true,
	members: [{ id: "alex-id", name: "Alex", username: "alex", email: "alex@example.com", emailVerified: true, role: "member" as const, joinedAt: "2026-01-01T00:00:00.000Z", teamNames: ["Support"], privateMailboxes: [], canChangeRole: true, canRemove: true }],
	invitations: [],
};

vi.mock("@/lib/team-api", () => ({
	teamApi: { get: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(), updateMemberRole: vi.fn(), offboardMember: vi.fn() },
}));
import { teamApi } from "@/lib/team-api";

function renderTeam(workspaceId = "workspace-a") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={client}><TeamSettingsSection workspaceId={workspaceId} /></QueryClientProvider>);
}

describe("TeamSettingsSection", () => {
	beforeEach(() => { vi.mocked(teamApi.get).mockResolvedValue({ team }); });
	afterEach(() => vi.clearAllMocks());

	it("uses an explicit workspace query and clears the sensitive invitation result when closed", async () => {
		vi.mocked(teamApi.createInvitation).mockResolvedValue({ success: true, data: { delivery: "copy_link", expiresAt: 1767225600000, invitationUrl: "https://example.test/login?invite=secret" } });
		renderTeam();
		await screen.findByRole("button", { name: "Invite teammate" });
		fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
		fireEvent.change(screen.getByLabelText("Recovery email"), { target: { value: "new@example.com" } });
		fireEvent.change(screen.getByLabelText("Reserved immutable username"), { target: { value: "new-agent" } });
		fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
		await screen.findByDisplayValue("https://example.test/login?invite=secret");
		expect(teamApi.createInvitation).toHaveBeenCalledWith("workspace-a", "new@example.com", "new-agent");
		fireEvent.click(screen.getByText("Close", { selector: "button" }));
		fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
		expect(screen.queryByDisplayValue("https://example.test/login?invite=secret")).not.toBeInTheDocument();
	});

	it("requires the exact immutable identifier before enabling removal", async () => {
		renderTeam();
		await screen.findByText("Alex");
		fireEvent.pointerDown(screen.getByRole("button", { name: "Manage Alex" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from workspace" }));
		const remove = screen.getByRole("button", { name: "Remove Alex from workspace" });
		expect(remove).toBeDisabled();
		fireEvent.change(screen.getByLabelText("Type alex to confirm"), { target: { value: "alex" } });
		expect(remove).toBeEnabled();
	});
});
