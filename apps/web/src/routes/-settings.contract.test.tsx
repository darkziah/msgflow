import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Settings } from "./settings";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: null }),
}));

vi.mock("@/components/email-admin", () => ({
	EmailAdmin: () => <div>Email administration</div>,
}));

vi.mock("@/components/settings/TeamSettingsSection", () => ({
	TeamSettingsSection: ({ workspaceId }: { workspaceId: string }) => <div>Team roster for {workspaceId}</div>,
}));

vi.mock("@/lib/api", () => ({
	api: {
		createTag: vi.fn(),
		createSharedMailbox: vi.fn(),
		listEmailDomains: vi.fn(),
		listTeams: vi.fn(),
		listWorkspaces: vi.fn(),
		listTags: vi.fn(),
		listMetaApps: vi.fn(),
		listChannels: vi.fn(),
		workspaceListInboxes: vi.fn(),
	},
}));

import { api } from "@/lib/api";

function renderSettings() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<Settings />
		</QueryClientProvider>,
	);
}

describe("settings UI contracts", () => {
	beforeEach(() => {
		vi.spyOn(Route, "useSearch").mockReturnValue({ workspace: "workspace-1" });
		vi.mocked(api.listTags).mockResolvedValue({ tags: [] });
		vi.mocked(api.createTag).mockResolvedValue({ tag: {} } as never);
		vi.mocked(api.listEmailDomains).mockResolvedValue({ emailDomains: [] });
		vi.mocked(api.listTeams).mockResolvedValue({ teams: [] });
		vi.mocked(api.listWorkspaces).mockResolvedValue({
			workspaces: [{ id: "workspace-1", role: "owner" }],
		} as never);
		vi.mocked(api.listMetaApps).mockResolvedValue({ metaApps: [] });
		vi.mocked(api.listChannels).mockResolvedValue({ channels: [] });
		vi.mocked(api.workspaceListInboxes).mockResolvedValue({ inboxes: [] });
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("reaches rule management from settings", () => {
		renderSettings();

		fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
		fireEvent.click(screen.getByRole("button", { name: "Manage rules" }));

		expect(navigate).toHaveBeenCalledWith({
			to: "/rules",
			search: { workspace: "workspace-1" },
		});
	});

	it("creates a tag with the existing API payload", async () => {
		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
		fireEvent.change(screen.getByLabelText("Tag name"), {
			target: { value: "  Billing  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create tag" }));

		await waitFor(() => {
			expect(api.createTag).toHaveBeenCalledWith("workspace-1", {
			name: "Billing",
			color: "blue",
		});
		});
	});

	it("uses shadcn loading, empty, and error surfaces for tags", async () => {
		vi.mocked(api.listTags).mockImplementationOnce(() => new Promise(() => {}));
		const { unmount } = renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
		expect(screen.getByLabelText("Loading tags")).toBeInTheDocument();
		unmount();

		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
		expect(await screen.findByText("No tags yet")).toBeInTheDocument();
		expect(document.querySelector('[data-slot="empty"]')).toBeInTheDocument();
	});

	it("shows the API error in an alert", async () => {
		vi.mocked(api.listTags).mockRejectedValueOnce(new Error("Tags are unavailable"));
		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Tags" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Tags are unavailable");
	});

	it("loads the Team section from a direct workspace-scoped URL", () => {
		vi.spyOn(Route, "useSearch").mockReturnValue({ workspace: "workspace-1", section: "team" });

		renderSettings();

		expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
		expect(screen.getByText("Team roster for workspace-1")).toBeInTheDocument();
	});

	it("updates the section URL while preserving the explicit workspace", () => {
		renderSettings();

		fireEvent.click(screen.getByRole("tab", { name: "Team" }));

		expect(navigate).toHaveBeenCalledWith({
			to: "/settings",
			search: { workspace: "workspace-1", section: "team" },
		});
	});

	it("loads Page-channel configuration from the selected workspace", async () => {
		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Channels" }));

		await waitFor(() => {
			expect(api.listChannels).toHaveBeenCalledWith("workspace-1");
			expect(api.workspaceListInboxes).toHaveBeenCalledWith("workspace-1");
			expect(api.listMetaApps).toHaveBeenCalledWith("workspace-1");
		});
	});

	it("offers shared email creation from Channels, not Mailboxes", async () => {
		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Channels" }));

		expect(await screen.findByRole("button", { name: "Add email channel" })).toBeEnabled();
	});
});
