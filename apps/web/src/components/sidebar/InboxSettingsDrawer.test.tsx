// @ts-expect-error jsdom does not bundle declarations in this workspace.
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `bun test` does not load Vitest's jsdom environment. Bootstrap one before
// dynamically importing Testing Library, whose `screen` binds to document.
if (typeof document === "undefined") {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		HTMLElement: dom.window.HTMLElement,
		Node: dom.window.Node,
		Event: dom.window.Event,
		MouseEvent: dom.window.MouseEvent,
		getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
	});
}

vi.mock("@/lib/api", () => ({
	api: {
		getSidebar: vi.fn(),
		workspaceListInboxes: vi.fn(),
		listChannels: vi.fn(),
		listTeams: vi.fn(),
		listRules: vi.fn(),
		moveInboxInTree: vi.fn(),
		workspaceUpdateInbox: vi.fn(),
	},
}));

const { fireEvent, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const { api } = await import("@/lib/api");
const { InboxSettingsDrawer } = await import("./InboxSettingsDrawer");

// Bun's Vitest compatibility layer does not implement vi.hoisted/vi.mocked.
// The module mock above is the runtime API object used by the drawer.
const mocks = api as any;

const inboxes = [
	{
		id: "parent",
		name: "Parent",
		parentInboxId: null,
		visibilityType: "shared",
		treeVersion: 2,
		description: null,
		color: "#64748B",
		icon: null,
		teamId: null,
		teamName: null,
		sortOrder: 0,
		isArchived: false,
		assignmentStrategy: "manual",
		isDefault: false,
		channels: [],
		memberIds: [],
		conversationCount: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAtMs: null,
	},
	{
		id: "child",
		name: "Child",
		parentInboxId: null,
		visibilityType: "shared",
		treeVersion: 7,
		description: null,
		color: "#64748B",
		icon: null,
		teamId: null,
		teamName: null,
		sortOrder: 1,
		isArchived: false,
		assignmentStrategy: "manual",
		isDefault: false,
		channels: [],
		memberIds: [],
		conversationCount: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAtMs: null,
	},
];

function renderDrawer() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	const onChanged = vi.fn();
	const result = render(
		<QueryClientProvider client={queryClient}>
			<InboxSettingsDrawer
				workspaceId="workspace-1"
				inboxId="child"
				onClose={onClose}
				onChanged={onChanged}
			/>
		</QueryClientProvider>,
	);
	return { ...result, onClose, onChanged, queryClient };
}

describe("InboxSettingsDrawer tree moves", () => {
	beforeEach(() => {
		mocks.workspaceListInboxes.mockResolvedValue({ inboxes });
		mocks.listChannels.mockResolvedValue({ channels: [] });
		mocks.listTeams.mockResolvedValue({ teams: [] });
		mocks.listRules.mockResolvedValue({ rules: [] });
		mocks.moveInboxInTree.mockResolvedValue({ success: true });
		mocks.workspaceUpdateInbox.mockResolvedValue({ inbox: inboxes[1] });
		mocks.getSidebar.mockResolvedValue({ permissions: { isAdmin: true } });
	});

	afterEach(() => vi.clearAllMocks());

	it("shows permitted parents and sends the authoritative tree version", async () => {
		renderDrawer();
		const parent = await screen.findByLabelText("Parent");
		expect(
			screen.getByText(
				/navigation only; routing and conversation ownership stay unchanged/i,
			),
		).not.toBeNull();
		fireEvent.change(parent, { target: { value: "parent" } });
		fireEvent.click(screen.getByRole("button", { name: "Move location" }));
		await waitFor(() => {
			expect(mocks.moveInboxInTree).toHaveBeenCalledWith(
				"workspace-1",
				"child",
				{ parentInboxId: "parent", expectedTreeVersion: 7 },
			);
		});
	});

	it("saves a changed parent with metadata and refreshes tree queries", async () => {
		const { onChanged, onClose, queryClient } = renderDrawer();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
		const parent = await screen.findByLabelText("Parent");
		fireEvent.change(parent, { target: { value: "parent" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(mocks.moveInboxInTree).toHaveBeenCalledWith(
				"workspace-1",
				"child",
				{ parentInboxId: "parent", expectedTreeVersion: 7 },
			);
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["sidebar", "workspace-1"],
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["workspace-inboxes", "workspace-1"],
		});
		expect(onChanged).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("keeps the drawer open when saving a changed parent fails", async () => {
		mocks.moveInboxInTree.mockRejectedValue(new Error("inbox tree version is stale"));
		const { onChanged, onClose } = renderDrawer();
		const parent = await screen.findByLabelText("Parent");
		fireEvent.change(parent, { target: { value: "parent" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByRole("button", { name: "Reload" })).not.toBeNull();
		expect(onChanged).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("hides tree move controls for non-admins", async () => {
		mocks.getSidebar.mockResolvedValue({ permissions: { isAdmin: false } });
		renderDrawer();
		await waitFor(() => expect(mocks.workspaceListInboxes).toHaveBeenCalled());
		expect(screen.queryByLabelText("Parent")).toBeNull();
	});

	it("offers Reload after a stale move", async () => {
		mocks.moveInboxInTree.mockRejectedValue(
			new Error("inbox tree version is stale"),
		);
		renderDrawer();
		await screen.findByLabelText("Parent");
		fireEvent.change(screen.getByLabelText("Parent"), {
			target: { value: "parent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Move location" }));
		const reload = await screen.findByRole("button", { name: "Reload" });
		fireEvent.click(reload);
		await waitFor(() => {
			expect(mocks.getSidebar).toHaveBeenCalledTimes(2);
			expect(mocks.workspaceListInboxes).toHaveBeenCalledTimes(2);
		});
	});
});
