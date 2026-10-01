import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountFlowShell } from "@/components/auth/AccountFlowShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { request } from "@/lib/api";

export const Route = createFileRoute("/login")({ component: Login });

type Mode =
	| "sign-in"
	| "invitation-new"
	| "invitation-existing"
	| "invitation-confirm"
	| "recovery"
	| "reset";
type InvitationPreview = {
	workspaceName: string;
	maskedEmail: string;
	expiresAt: string | number;
	existingAccount: boolean;
	email?: string;
};

function initialMode(
	resetToken: string | null,
	invitation: string | null,
): Mode {
	if (resetToken) return "reset";
	if (invitation) return "invitation-new";
	return "sign-in";
}

function previewInvitation(raw: Record<string, unknown>): InvitationPreview {
	return {
		workspaceName: String(raw.workspaceName ?? "this workspace"),
		maskedEmail: String(
			raw.maskedEmail ?? raw.emailMasked ?? raw.email ?? "your invited email",
		),
		expiresAt: (raw.expiresAt ?? raw.expiry ?? "") as string | number,
		existingAccount: Boolean(
			raw.existingAccount ?? raw.accountExists ?? raw.state === "existing_account",
		),
		email:
			typeof raw.authEmail === "string"
				? raw.authEmail
				: typeof raw.invitedEmail === "string"
					? raw.invitedEmail
					: undefined,
	};
}

export function Login() {
	const router = useRouter();
	const search = new URLSearchParams(window.location.search);
	const invitation = search.get("invite");
	const resetToken = search.get("token");
	const next = search.get("next");
	const [mode, setMode] = useState(() => initialMode(resetToken, invitation));
	const [identifier, setIdentifier] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [preview, setPreview] = useState<InvitationPreview | null>(null);
	const [message, setMessage] = useState<string | null>(
		search.has("error")
			? "This link is invalid or expired. Request a new one."
			: null,
	);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!invitation) return;
		let cancelled = false;
		void request<{ success: true; data: Record<string, unknown> }>(
			`/api/invitations/preview?token=${encodeURIComponent(invitation)}`,
		)
			.then((response) => {
				if (cancelled) return;
				const nextPreview = previewInvitation(response.data);
				setPreview(nextPreview);
				setMode(
					nextPreview.existingAccount
						? "invitation-existing"
						: "invitation-new",
				);
			})
			.catch((error: unknown) => {
				if (!cancelled)
					setMessage(
						error instanceof Error
							? error.message
							: "This invitation is invalid or expired.",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [invitation]);

	function changeMode(nextMode: Mode) {
		setPassword("");
		setConfirmation("");
		setMessage(null);
		setMode(nextMode);
	}

	async function action(run: () => Promise<void>) {
		setBusy(true);
		setMessage(null);
		try {
			await run();
		} catch (err) {
			setMessage(
				err instanceof Error ? err.message : "Unable to complete request",
			);
		} finally {
			setBusy(false);
		}
	}

	async function redirectToWorkspace(workspaceId?: string) {
		await router.invalidate();
		if (workspaceId) {
			await router.navigate({ to: "/", search: { workspace: workspaceId } });
			return;
		}
		if (next?.startsWith("/setup/channel?")) {
			window.location.assign(next);
			return;
		}
		await router.navigate({ to: "/" });
	}

	async function submitSignIn(event: React.FormEvent) {
		event.preventDefault();
		await action(async () => {
			const value = identifier.trim();
			const result = value.includes("@")
				? await authClient.signIn.email({ email: value, password })
				: await authClient.signIn.username({ username: value, password });
			if (result.error) throw new Error(result.error.message);
			setPassword("");
			await redirectToWorkspace();
		});
	}

	async function submitExistingInvitation(event: React.FormEvent) {
		event.preventDefault();
		const invitedEmail = preview?.email;
		if (!invitedEmail) {
			setMessage(
				"The invited account could not be identified. Request a new invitation.",
			);
			return;
		}
		await action(async () => {
			const result = await authClient.signIn.email({
				email: invitedEmail,
				password,
			});
			if (result.error) throw new Error(result.error.message);
			setPassword("");
			setMode("invitation-confirm");
		});
	}

	async function acceptInvitation() {
		if (!invitation) return;
		await action(async () => {
			const response = await request<{
				success: true;
				data: { workspaceId: string };
			}>("/api/invitations/accept", {
				method: "POST",
				body: JSON.stringify({ token: invitation }),
			});
			await redirectToWorkspace(response.data.workspaceId);
		});
	}

	async function submitInvitationRegistration(event: React.FormEvent) {
		event.preventDefault();
		if (!invitation) return;
		if (password !== confirmation) {
			setMessage("Passwords do not match.");
			return;
		}
		await action(async () => {
			const response = await request<{
				success: true;
				data: { workspaceId: string };
			}>("/api/invitations/register", {
				method: "POST",
				body: JSON.stringify({
					token: invitation,
					username: username.trim(),
					password,
					confirmation,
				}),
			});
			if (!preview?.email)
				throw new Error(
					"Account created. Sign in with your invited email to join the workspace.",
				);
			const signIn = await authClient.signIn.email({
				email: preview.email,
				password,
			});
			if (signIn.error) throw new Error(signIn.error.message);
			await redirectToWorkspace(response.data.workspaceId);
		});
	}

	async function submitRecovery(event: React.FormEvent) {
		event.preventDefault();
		await action(async () => {
			await authClient.requestPasswordReset({
				email: identifier.trim(),
				redirectTo: `${window.location.origin}/login`,
			});
			setMessage(
				"If an account matches that recovery email, a password-reset link was requested. Check your email for next steps.",
			);
		});
	}

	async function submitReset(event: React.FormEvent) {
		event.preventDefault();
		if (password !== confirmation) {
			setMessage("New passwords do not match.");
			return;
		}
		if (!resetToken) return;
		await action(async () => {
			const result = await authClient.resetPassword({
				token: resetToken,
				newPassword: password,
			});
			if (result.error) throw new Error(result.error.message);
			window.history.replaceState(null, "", "/login");
			changeMode("sign-in");
			setMessage("Password reset. Sign in with your new password.");
		});
	}

	const copy =
		mode === "invitation-new" ||
		mode === "invitation-existing" ||
		mode === "invitation-confirm"
			? {
					eyebrow: "Workspace invitation",
					title:
						mode === "invitation-confirm"
							? "Join workspace"
							: mode === "invitation-existing"
								? "Sign in to join"
								: "Create your account",
					description: preview
						? `${preview.workspaceName} invited ${preview.maskedEmail}. Invitation expires ${formatDate(preview.expiresAt)}.`
						: "Checking your invitation…",
				}
			: ({
					"sign-in": {
						eyebrow: "MsgFlow account",
						title: "Welcome back",
						description:
							"Sign in to continue working conversations with your team.",
					},
					recovery: {
						eyebrow: "Account recovery",
						title: "Reset your password",
						description:
							"Enter your recovery email to request a password-reset link.",
					},
					reset: {
						eyebrow: "Account recovery",
						title: "Choose a new password",
						description: "Create a new password for your MsgFlow account.",
					},
				}[mode] as { eyebrow: string; title: string; description: string });

	return (
		<AccountFlowShell {...copy}>
			<CardContent>
				{invitation && !preview && !message ? (
					<Skeleton aria-label="Checking invitation" className="h-20 w-full" />
				) : null}
				{mode === "sign-in" ? (
					<form className="flex flex-col gap-6" onSubmit={submitSignIn}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="identifier">Email or username</FieldLabel>
								<Input
									id="identifier"
									required
									value={identifier}
									onChange={(event) => setIdentifier(event.target.value)}
									placeholder="you@company.com or alex"
									autoComplete="username"
								/>
							</Field>
							<PasswordField
								value={password}
								onChange={setPassword}
								autoComplete="current-password"
								label="Password"
							/>
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">
							Sign in
							<ArrowRight data-icon="inline-end" />
						</Button>
					</form>
				) : null}
				{mode === "invitation-new" && preview ? (
					<form
						className="flex flex-col gap-6"
						onSubmit={submitInvitationRegistration}
					>
						<InvitationDetails preview={preview} />
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="username">Username</FieldLabel>
								<Input
									id="username"
									required
									minLength={3}
									maxLength={30}
									value={username}
									onChange={(event) => setUsername(event.target.value)}
									autoComplete="username"
								/>
							</Field>
							<PasswordField
								value={password}
								onChange={setPassword}
								autoComplete="new-password"
								label="Create password"
							/>
							<PasswordField
								value={confirmation}
								onChange={setConfirmation}
								autoComplete="new-password"
								label="Confirm password"
								id="confirmation"
							/>
						</FieldGroup>
						<Button
							className="w-full"
							disabled={busy || !username.trim()}
							type="submit"
						>
							Create account and join
							<ArrowRight data-icon="inline-end" />
						</Button>
					</form>
				) : null}
				{mode === "invitation-existing" && preview ? (
					<form
						className="flex flex-col gap-6"
						onSubmit={submitExistingInvitation}
					>
						<InvitationDetails preview={preview} />
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="invited-email">Invited email</FieldLabel>
								<Input
									id="invited-email"
									value={preview.maskedEmail}
									readOnly
									disabled
									aria-describedby="invited-email-description"
								/>
								<FieldDescription id="invited-email-description">
									Use the account invited to this workspace.
								</FieldDescription>
							</Field>
							<PasswordField
								value={password}
								onChange={setPassword}
								autoComplete="current-password"
								label="Password"
							/>
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">
							Sign in
							<ArrowRight data-icon="inline-end" />
						</Button>
					</form>
				) : null}
				{mode === "invitation-confirm" && preview ? (
					<div className="flex flex-col gap-6">
						<InvitationDetails preview={preview} />
						<Alert>
							<MailCheck />
							<AlertTitle>Ready to join</AlertTitle>
							<AlertDescription>
								Confirm to add your account to this workspace.
							</AlertDescription>
						</Alert>
						<Button
							className="w-full"
							disabled={busy}
							onClick={acceptInvitation}
						>
							Join {preview.workspaceName}
							<ArrowRight data-icon="inline-end" />
						</Button>
					</div>
				) : null}
				{mode === "recovery" ? (
					<form className="flex flex-col gap-6" onSubmit={submitRecovery}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="recovery-email">Recovery email</FieldLabel>
								<Input
									id="recovery-email"
									type="email"
									required
									value={identifier}
									onChange={(event) => setIdentifier(event.target.value)}
									autoComplete="email"
								/>
							</Field>
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">
							Request reset link
							<ArrowRight data-icon="inline-end" />
						</Button>
					</form>
				) : null}
				{mode === "reset" ? (
					<form className="flex flex-col gap-6" onSubmit={submitReset}>
						<FieldGroup>
							<PasswordField
								value={password}
								onChange={setPassword}
								autoComplete="new-password"
								label="New password"
							/>
							<PasswordField
								value={confirmation}
								onChange={setConfirmation}
								autoComplete="new-password"
								label="Confirm new password"
								id="confirmation"
							/>
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">
							Reset password
							<ArrowRight data-icon="inline-end" />
						</Button>
					</form>
				) : null}
				{busy ? (
					<Skeleton
						aria-label="Processing account request"
						className="mt-4 h-2 w-full"
					/>
				) : null}
			</CardContent>
			{mode === "sign-in" ? (
				<CardFooter className="flex-col items-stretch gap-3 border-t">
					<Button
						type="button"
						variant="link"
						size="sm"
						disabled={busy}
						onClick={() => changeMode("recovery")}
					>
						Forgot password
					</Button>
				</CardFooter>
			) : null}
			{mode === "recovery" ? (
				<CardFooter>
					<Button
						type="button"
						variant="link"
						size="sm"
						onClick={() => changeMode("sign-in")}
					>
						Back to sign in
					</Button>
				</CardFooter>
			) : null}
			{message ? (
				<CardFooter className="pt-0">
					<Alert variant="destructive">
						<AlertCircle />
						<AlertTitle>Account update</AlertTitle>
						<AlertDescription>{message}</AlertDescription>
					</Alert>
				</CardFooter>
			) : null}
		</AccountFlowShell>
	);
}

function InvitationDetails({ preview }: { preview: InvitationPreview }) {
	return (
		<Alert>
			<MailCheck />
			<AlertTitle>{preview.workspaceName}</AlertTitle>
			<AlertDescription>
				Invited email: {preview.maskedEmail}. Expires{" "}
				{formatDate(preview.expiresAt)}.
			</AlertDescription>
		</Alert>
	);
}

function PasswordField({
	value,
	onChange,
	autoComplete,
	label,
	id = "password",
}: {
	value: string;
	onChange: (value: string) => void;
	autoComplete: "current-password" | "new-password";
	label: string;
	id?: string;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				id={id}
				type="password"
				required
				minLength={8}
				maxLength={128}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder="At least 8 characters"
				autoComplete={autoComplete}
			/>
			<FieldDescription>
				Use a password with at least 8 characters.
			</FieldDescription>
		</Field>
	);
}

function formatDate(value: string | number) {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? "the invitation expiry"
		: date.toLocaleDateString();
}
