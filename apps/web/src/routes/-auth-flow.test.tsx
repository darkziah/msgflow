import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	invalidate: vi.fn(),
	signInEmail: vi.fn(),
	signInUsername: vi.fn(),
	resetPassword: vi.fn(),
	sendVerificationEmail: vi.fn(),
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
		sendVerificationEmail: mocks.sendVerificationEmail,
		requestPasswordReset: mocks.requestPasswordReset,
	},
}));

vi.mock("@/lib/api", () => ({
	api: { setupOwner: mocks.setupOwner },
}));

import { Login } from "./login";
import { Setup } from "./setup";

describe("auth flow UI contracts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/login");
	});

	it("renders the semantic sign-in form and surfaces authentication failures", async () => {
		mocks.signInEmail.mockResolvedValue({
			error: { message: "Invalid credentials" },
		});
		render(<Login />);

		expect(document.querySelector('[data-slot="card"]')).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Email or username"), {
			target: { value: "owner@example.com" },
		});
		fireEvent.change(screen.getByLabelText("Password"), {
			target: { value: "not-the-password" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Invalid credentials",
		);
	});

	it("keeps setup on the account step until owner credentials are valid", () => {
		window.history.replaceState(null, "", "/setup");
		render(<Setup />);

		expect(document.querySelector('[data-slot="card"]')).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Enter your recovery email, username, and password to continue.",
		);
		expect(screen.getByLabelText("Recovery email")).toHaveAttribute(
			"data-slot",
			"input",
		);
	});

	it("preserves native setup constraints and blocks an invalid submitted form", () => {
		window.history.replaceState(null, "", "/setup");
		render(<Setup />);

		const email = screen.getByLabelText("Recovery email");
		const username = screen.getByLabelText("Username");
		const password = screen.getByLabelText("Password");
		expect(email).toHaveAttribute("type", "email");
		expect(email).toBeRequired();
		expect(username).toHaveAttribute("minlength", "3");
		expect(username).toHaveAttribute("maxlength", "30");
		expect(username).toBeRequired();
		expect(password).toHaveAttribute("minlength", "8");
		expect(password).toHaveAttribute("maxlength", "128");
		expect(password).toBeRequired();

		fireEvent.change(email, { target: { value: "not-an-email" } });
		fireEvent.change(username, { target: { value: "owner" } });
		fireEvent.change(password, { target: { value: "correct horse battery staple" } });
		const form = email.closest("form");
		expect(form).not.toBeNull();
		if (!form) throw new Error("Setup form is missing");
		fireEvent.submit(form);

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Enter a valid recovery email to continue.",
		);
		expect(mocks.setupOwner).not.toHaveBeenCalled();

		fireEvent.change(email, { target: { value: "owner@example.com" } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		const slug = screen.getByLabelText("Workspace slug");
		expect(slug).toHaveAttribute("minlength", "3");
		expect(slug).toHaveAttribute("maxlength", "63");
		expect(slug).toHaveAttribute("pattern", "[a-z0-9]+(?:-[a-z0-9]+)*");
		expect(slug).toBeRequired();
		expect(screen.getByLabelText("Workspace name")).toBeRequired();
		expect(screen.getByLabelText("First team")).toBeRequired();
		expect(screen.getByLabelText("First shared inbox")).toBeRequired();
	});

	it("shows sender-configuration guidance after setup completes", async () => {
		window.history.replaceState(null, "", "/setup");
		mocks.setupOwner.mockResolvedValue({
			setup: {
				workspaceId: "workspace-1",
				inboxId: "inbox-1",
				verification: "pending_sender_configuration",
			},
		});
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
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.change(screen.getByLabelText("Workspace name"), {
			target: { value: "Acme Support" },
		});
		fireEvent.change(screen.getByLabelText("Workspace slug"), {
			target: { value: "acme-support" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		const verificationAlert = (await screen.findByText(
			"Recovery email verification is pending",
		)).closest('[role="alert"]');
		expect(verificationAlert).toHaveTextContent(
			"Ask your operator to configure EMAIL and AUTH_EMAIL_FROM, then use Resend verification on the sign-in page. Invites and private mailbox provisioning require verification.",
		);
	});

	it("shows activation before sign-in without exposing the invitation token", () => {
		window.history.replaceState(null, "", "/login?invite=private-invitation-token");
		render(<Login />);

		expect(screen.getByRole("heading", { name: "Activate your account" })).toBeInTheDocument();
		expect(screen.getByLabelText("Create password")).toBeInTheDocument();
		expect(screen.queryByText("private-invitation-token")).not.toBeInTheDocument();
	});

	it("moves account creation to verification pending without claiming membership", async () => {
		window.history.replaceState(null, "", "/login?invite=private-invitation-token");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { verification: "verification_sent" } }) }));
		render(<Login />);
		fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "correct horse battery staple" } });
		fireEvent.click(screen.getByRole("button", { name: "Create password" }));

		expect(await screen.findByRole("heading", { name: "Check your recovery email" })).toBeInTheDocument();
		expect(screen.getByText(/sign in to join the workspace/i)).toBeInTheDocument();
		expect(screen.queryByText(/membership has already been granted/i)).not.toBeInTheDocument();
	});

	it("requests recovery generically, including user-not-found-equivalent responses", async () => {
		mocks.requestPasswordReset.mockResolvedValue({ error: { message: "User not found" } });
		render(<Login />);
		fireEvent.click(screen.getByRole("button", { name: "Forgot password" }));
		fireEvent.change(screen.getByLabelText("Recovery email"), { target: { value: "missing@example.com" } });
		fireEvent.click(screen.getByRole("button", { name: "Request reset link" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("If an account matches that recovery email");
		expect(mocks.requestPasswordReset).toHaveBeenCalledWith({ email: "missing@example.com", redirectTo: `${window.location.origin}/login` });
	});

	it("blocks reset mismatches and submits matching password with the original token", async () => {
		window.history.replaceState(null, "", "/login?token=original-reset-token");
		mocks.resetPassword.mockResolvedValue({ error: null });
		render(<Login />);
		fireEvent.change(screen.getByLabelText("New password"), { target: { value: "correct horse battery staple" } });
		fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different password value" } });
		fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
		expect(screen.getByRole("alert")).toHaveTextContent("New passwords do not match.");
		expect(mocks.resetPassword).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "correct horse battery staple" } });
		fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
		expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "original-reset-token", newPassword: "correct horse battery staple" });
	});

	it("preserves the invitation callback when resending verification", async () => {
		window.history.replaceState(null, "", "/login?invite=private-invitation-token");
		mocks.sendVerificationEmail.mockResolvedValue({ error: null });
		render(<Login />);
		fireEvent.click(screen.getByRole("button", { name: /sign in to join/i }));
		fireEvent.change(screen.getByLabelText("Email or username"), { target: { value: "invitee@example.com" } });
		fireEvent.click(screen.getByRole("button", { name: "Resend verification" }));

		expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({ email: "invitee@example.com", callbackURL: "/login?invite=private-invitation-token" });
	});

	it("keeps normal email and username sign-in behavior", async () => {
		mocks.signInEmail.mockResolvedValue({ error: null });
		mocks.signInUsername.mockResolvedValue({ error: null });
		render(<Login />);
		fireEvent.change(screen.getByLabelText("Email or username"), { target: { value: "member@example.com" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(mocks.signInEmail).toHaveBeenCalledWith({ email: "member@example.com", password: "correct horse battery staple" });
	});

	it("signs in with a username when the identifier is not an email", async () => {
		mocks.signInUsername.mockResolvedValue({ error: null });
		render(<Login />);
		fireEvent.change(screen.getByLabelText("Email or username"), { target: { value: "member" } });
		fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery staple" } });
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(mocks.signInUsername).toHaveBeenCalledWith({ username: "member", password: "correct horse battery staple" });
	});
});
