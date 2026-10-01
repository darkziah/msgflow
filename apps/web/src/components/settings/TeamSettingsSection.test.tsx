import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamSettingsSection } from "./TeamSettingsSection";

const team = {
	canManage: true,
	canManageOwners: true,
	members: [
		{
			id: "alex-id",
			name: "Alex",
			username: "alex",
			email: "alex@example.com",
			emailVerified: true,
			role: "member" as const,
			joinedAt: "2026-01-01T00:00:00.000Z",
			teamNames: ["Support"],
			privateMailboxes: [],
			canChangeRole: true,
			canRemove: true,
		},
	],
	invitations: [],
};

vi.mock("@/lib/team-api", () => ({
	teamApi: {
		get: vi.fn(),
		createInvitation: vi.fn(),
		deleteInvitation: vi.fn(),
		resendInvitation: vi.fn(),
		updateMemberRole: vi.fn(),
		offboardMember: vi.fn(),
	},
}));
import { teamApi } from "@/lib/team-api";

function renderTeam(workspaceId = "workspace-a") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<TeamSettingsSection workspaceId={workspaceId} />
		</QueryClientProvider>,
	);
}

describe("TeamSettingsSection", () => {
	beforeEach(() => {
		vi.mocked(teamApi.get).mockResolvedValue({ team });
	});
	afterEach(() => vi.clearAllMocks());

	it("creates email-only invitations and clears the delivery result when closed", async () => {
		vi.mocked(teamApi.createInvitation).mockResolvedValue({
			success: true,
			data: { delivery: "email_sent", expiresAt: 1767225600000 },
		});
		renderTeam();
		await screen.findByRole("button", { name: "Invite teammate" });
		fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "new@example.com" },
		});
		const form = screen.getByLabelText("Email").closest("form");
		if (!form) throw new Error("Invitation form is missing");
		fireEvent.submit(form);
		await waitFor(() =>
			expect(teamApi.createInvitation).toHaveBeenCalledWith(
				"workspace-a",
				"new@example.com",
			),
		);
		expect(await screen.findByRole("status")).toHaveTextContent(
			"Invitation email sent.",
		);
		expect(screen.queryByText(/invitation link/i)).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("Close", { selector: "button" }));
		fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
		expect(
			screen.queryByText("Invitation email sent."),
		).not.toBeInTheDocument();
	});

	it("requires the exact immutable identifier before enabling removal", async () => {
		renderTeam();
		await screen.findByText("Alex");
		fireEvent.pointerDown(screen.getByRole("button", { name: "Manage Alex" }));
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Remove from workspace" }),
		);
		const remove = screen.getByRole("button", {
			name: "Remove Alex from workspace",
		});
		expect(remove).toBeDisabled();
		fireEvent.change(screen.getByLabelText("Type alex to confirm"), {
			target: { value: "alex" },
		});
		expect(remove).toBeEnabled();
	});
});
