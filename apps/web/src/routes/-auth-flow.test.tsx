import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	invalidate: vi.fn(),
	signInEmail: vi.fn(),
	signInUsername: vi.fn(),
	resetPassword: vi.fn(),
	requestPasswordReset: vi.fn(),
	setupOwner: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Outlet: () => <div>Channel setup</div>,
	useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate }),
}));
vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { email: mocks.signInEmail, username: mocks.signInUsername },
		resetPassword: mocks.resetPassword,
		requestPasswordReset: mocks.requestPasswordReset,
	},
}));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	api: { setupOwner: mocks.setupOwner },
}));

import { Login } from "./login";
import { Setup } from "./setup";

function mockFetch(data: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({ ok: true, json: async () => data }),
	);
}

describe("auth flow UI contracts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/login");
	});

	it("keeps normal email and username sign-in behavior without a public setup link", async () => {
		mocks.signInEmail.mockResolvedValue({ error: null });
		render(<Login />);
		fireEvent.change(screen.getByLabelText("Email or username"), {
			target: { value: "member@example.com" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "correct horse battery staple" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(mocks.signInEmail).toHaveBeenCalledWith({
			email: "member@example.com",
			password: "correct horse battery staple",
		});
		expect(
			screen.queryByText("Set up the first workspace"),
		).not.toBeInTheDocument();
	});

	it("uses the invitation preview for password-only registration and returns to normal login", async () => {
		window.history.replaceState(
			null,
			"",
			"/login?invite=private-invitation-token",
		);
		mockFetch({
			data: {
				workspaceName: "Acme Support",
				maskedEmail: "a***@example.com",
				expiresAt: 1767225600000,
			},
		});
		render(<Login />);
		expect(await screen.findByText("Acme Support")).toBeInTheDocument();
		expect(screen.getAllByText(/a\*\*\*@example.com/)).not.toHaveLength(0);
		expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Create password"), {
			target: { value: "correct horse battery staple" },
		});
		fireEvent.change(screen.getByLabelText("Confirm password"), {
			target: { value: "correct horse battery staple" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create account" }));
		expect(await vi.mocked(fetch)).toHaveBeenLastCalledWith(
			"/api/invitations/register",
			expect.objectContaining({
				body: JSON.stringify({
					token: "private-invitation-token",
					password: "correct horse battery staple",
					confirmation: "correct horse battery staple",
				}),
			}),
		);
		expect(
			screen.queryByText("private-invitation-token"),
		).not.toBeInTheDocument();
		expect(mocks.signInEmail).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(window.location.pathname).toBe("/login");
			expect(window.location.search).toBe("");
		});
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Account created. Sign in with your email and password.",
		);
	});

	it("requires matching password confirmation during initial setup", () => {
		window.history.replaceState(null, "", "/setup");
		render(<Setup />);
		fireEvent.change(screen.getByLabelText("Recovery email"), {
			target: { value: "owner@example.com" },
		});
		fireEvent.change(screen.getByLabelText("Username"), {
			target: { value: "owner" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "correct horse battery staple" },
		});
		fireEvent.change(screen.getByLabelText("Confirm password"), {
			target: { value: "different password" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Passwords do not match.",
		);
		expect(mocks.setupOwner).not.toHaveBeenCalled();
	});
});
