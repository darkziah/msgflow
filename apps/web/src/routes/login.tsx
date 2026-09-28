import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, MailCheck } from "lucide-react";
import { useState } from "react";
import { AccountFlowShell } from "@/components/auth/AccountFlowShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

type Mode = "sign-in" | "activation" | "verification-pending" | "recovery" | "reset";

function initialMode(resetToken: string | null, invitation: string | null): Mode {
	if (resetToken) return "reset";
	if (invitation) return "activation";
	return "sign-in";
}

export function Login() {
	const router = useRouter();
	const search = new URLSearchParams(window.location.search);
	const invitation = search.get("invite");
	const resetToken = search.get("token");
	const next = search.get("next");
	const [mode, setMode] = useState(() => initialMode(resetToken, invitation));
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [message, setMessage] = useState<string | null>(
		search.has("error") ? "This link is invalid or expired. Request a new one." : null,
	);
	const [busy, setBusy] = useState(false);

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
			setMessage(err instanceof Error ? err.message : "Unable to complete request");
		} finally {
			setBusy(false);
		}
	}

	async function post(path: string, body: unknown) {
		const response = await fetch(`/api/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error ?? "Unable to complete request");
		return result.data;
	}

	async function submitSignIn(event: React.FormEvent) {
		event.preventDefault();
		await action(async () => {
			const value = identifier.trim();
			const result = value.includes("@")
				? await authClient.signIn.email({ email: value, password })
				: await authClient.signIn.username({ username: value, password });
			if (result.error) throw new Error(result.error.message);
			if (invitation) await post("invitations/accept", { token: invitation });
			setPassword("");
			await router.invalidate();
			if (next?.startsWith("/setup/channel?")) {
				window.location.assign(next);
				return;
			}
			await router.navigate({ to: "/" });
		});
	}

	async function submitActivation(event: React.FormEvent) {
		event.preventDefault();
		if (!invitation) return;
		await action(async () => {
			await post("invitations/register", { token: invitation, password });
			setPassword("");
			setMode("verification-pending");
		});
	}

	async function submitRecovery(event: React.FormEvent) {
		event.preventDefault();
		await action(async () => {
			await authClient.requestPasswordReset({
				email: identifier.trim(),
				redirectTo: `${window.location.origin}/login`,
			});
			setMessage("If an account matches that recovery email, a password-reset link was requested. Check your email for next steps.");
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
			const result = await authClient.resetPassword({ token: resetToken, newPassword: password });
			if (result.error) throw new Error(result.error.message);
			window.history.replaceState(null, "", "/login");
			setPassword("");
			setConfirmation("");
			setMode("sign-in");
			setMessage("Password reset. Sign in with your new password.");
		});
	}

	async function resendVerification() {
		if (!identifier.includes("@")) {
			setMessage("Enter your recovery email first.");
			return;
		}
		await action(async () => {
			const result = await authClient.sendVerificationEmail({
				email: identifier.trim(),
				callbackURL: invitation ? `/login?invite=${invitation}` : "/login",
			});
			if (result.error)
				throw new Error(result.error.message ?? "Verification sender is not configured");
			setMessage("If this account needs verification, a link was requested. Check your email.");
		});
	}

	const isSignIn = mode === "sign-in";
	const copy = {
		"sign-in": {
			eyebrow: invitation ? "Workspace invitation" : "MsgFlow account",
			title: invitation ? "Sign in to join" : "Welcome back",
			description: invitation
				? "Sign in with your existing account to join the invited workspace."
				: "Sign in to continue working conversations with your team.",
		},
		activation: {
			eyebrow: "Workspace invitation",
			title: "Activate your account",
			description: "Create a password for the account associated with this invitation.",
		},
		"verification-pending": {
			eyebrow: "Account activation",
			title: "Check your recovery email",
			description: "Verify your email, then return here to sign in and join the workspace.",
		},
		recovery: {
			eyebrow: "Account recovery",
			title: "Reset your password",
			description: "Enter your recovery email to request a password-reset link.",
		},
		reset: {
			eyebrow: "Account recovery",
			title: "Choose a new password",
			description: "Create a new password for your MsgFlow account.",
		},
	}[mode];

	return (
		<AccountFlowShell {...copy}>
			<CardContent>
				{isSignIn ? (
					<form className="flex flex-col gap-6" onSubmit={submitSignIn}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="identifier">Email or username</FieldLabel>
								<Input id="identifier" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="you@company.com or alex" autoComplete="username" />
							</Field>
							<PasswordField value={password} onChange={setPassword} autoComplete="current-password" label="Password" />
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">{invitation ? "Sign in and join workspace" : "Sign in"}<ArrowRight data-icon="inline-end" /></Button>
					</form>
				) : null}
				{mode === "activation" ? (
					<form className="flex flex-col gap-6" onSubmit={submitActivation}>
						<FieldGroup><PasswordField value={password} onChange={setPassword} autoComplete="new-password" label="Create password" /></FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">Create password<ArrowRight data-icon="inline-end" /></Button>
						<Button type="button" variant="link" disabled={busy} onClick={() => changeMode("sign-in")}>Already have an account? Sign in to join</Button>
					</form>
				) : null}
				{mode === "verification-pending" ? <Alert><MailCheck /><AlertTitle>Verification required</AlertTitle><AlertDescription>Check your recovery email for a verification link. After verification, sign in to join the workspace.</AlertDescription></Alert> : null}
				{mode === "recovery" ? (
					<form className="flex flex-col gap-6" onSubmit={submitRecovery}>
						<FieldGroup><Field><FieldLabel htmlFor="recovery-email">Recovery email</FieldLabel><Input id="recovery-email" type="email" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="email" /></Field></FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">Request reset link<ArrowRight data-icon="inline-end" /></Button>
					</form>
				) : null}
				{mode === "reset" ? (
					<form className="flex flex-col gap-6" onSubmit={submitReset}>
						<FieldGroup><PasswordField value={password} onChange={setPassword} autoComplete="new-password" label="New password" /><PasswordField value={confirmation} onChange={setConfirmation} autoComplete="new-password" label="Confirm new password" id="confirmation" /></FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">Reset password<ArrowRight data-icon="inline-end" /></Button>
					</form>
				) : null}
				{busy ? <Skeleton aria-label="Processing account request" className="mt-4 h-2 w-full" /> : null}
			</CardContent>
			{mode === "verification-pending" ? <CardFooter><Button className="w-full" type="button" onClick={() => changeMode("sign-in")}>Sign in to join</Button></CardFooter> : null}
			{isSignIn ? <CardFooter className="flex-col items-stretch gap-3 border-t"><Button type="button" variant="link" size="sm" disabled={busy} onClick={resendVerification}>Resend verification</Button>{!invitation ? <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => changeMode("recovery")}>Forgot password</Button> : null}<Button type="button" variant="link" size="sm" onClick={() => router.navigate({ to: "/setup" })}>Set up the first workspace</Button></CardFooter> : null}
			{mode === "recovery" ? <CardFooter><Button type="button" variant="link" size="sm" onClick={() => changeMode("sign-in")}>Back to sign in</Button></CardFooter> : null}
			{message ? <CardFooter className="pt-0"><Alert variant={message === "Invalid credentials" ? "destructive" : "default"}><AlertCircle /><AlertTitle>Account update</AlertTitle><AlertDescription>{message}</AlertDescription></Alert></CardFooter> : null}
		</AccountFlowShell>
	);
}

function PasswordField({ value, onChange, autoComplete, label, id = "password" }: { value: string; onChange: (value: string) => void; autoComplete: "current-password" | "new-password"; label: string; id?: string }) {
	return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type="password" required minLength={8} maxLength={128} value={value} onChange={(event) => onChange(event.target.value)} placeholder="At least 8 characters" autoComplete={autoComplete} /><FieldDescription>Use a password with at least 8 characters.</FieldDescription></Field>;
}
