import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./settings";

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

vi.mock("@/lib/api", () => ({
	api: {
		createTag: vi.fn(),
		listTags: vi.fn(),
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
		vi.mocked(api.listTags).mockResolvedValue({ tags: [] });
		vi.mocked(api.createTag).mockResolvedValue({ tag: {} } as never);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("reaches rule management from settings", () => {
		renderSettings();

		fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
		fireEvent.click(screen.getByRole("button", { name: "Manage rules" }));

		expect(navigate).toHaveBeenCalledWith({ to: "/rules" });
	});

	it("creates a tag with the existing API payload", async () => {
		renderSettings();
		fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
		fireEvent.change(screen.getByLabelText("Tag name"), {
			target: { value: "  Billing  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create tag" }));

		await waitFor(() => {
			expect(api.createTag).toHaveBeenCalledWith({
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
});
