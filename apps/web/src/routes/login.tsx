import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowRight,
	MailCheck,
	MessageCircleMore,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

export function Login() {
	const router = useRouter();
	const search = new URLSearchParams(window.location.search);
	const invitation = search.get("invite");
	const resetToken = search.get("token");
	const next = search.get("next");
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState<string | null>(
		search.has("error")
			? "This link is invalid or expired. Request a new one."
			: null,
	);
	const [busy, setBusy] = useState(false);

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

	async function post(path: string, body: unknown) {
		const response = await fetch(`/api/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const result = await response.json();
		if (!response.ok)
			throw new Error(result.error ?? "Unable to complete request");
		return result.data;
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		await action(async () => {
			if (resetToken) {
				const result = await authClient.resetPassword({
					token: resetToken,
					newPassword: password,
				});
				if (result.error) throw new Error(result.error.message);
				window.history.replaceState(null, "", "/login");
				setPassword("");
				setMessage("Password reset. Sign in with your new password.");
				return;
			}
			const value = identifier.trim();
			const result = value.includes("@")
				? await authClient.signIn.email({ email: value, password })
				: await authClient.signIn.username({ username: value, password });
			if (result.error) throw new Error(result.error.message);
			if (invitation) await post("invitations/accept", { token: invitation });
			await router.invalidate();
			if (next?.startsWith("/setup/channel?")) {
				window.location.assign(next);
				return;
			}
			await router.navigate({ to: "/" });
		});
	}

	const title = resetToken
		? "Reset password"
		: invitation
			? "Join your invited workspace"
			: "Welcome back";
	const description = resetToken
		? "Choose a new password for your MsgFlow account."
		: invitation
			? "Sign in to accept your workspace invitation."
			: "Sign in to continue working conversations with your team.";

	return (
		<main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8 sm:px-6">
			<Card className="w-full max-w-md">
				<CardHeader className="gap-3">
					<div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<MessageCircleMore aria-hidden="true" />
					</div>
					<div className="flex flex-col gap-1">
						<CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
						<CardDescription>{description}</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-6" onSubmit={submit}>
						<FieldGroup>
							{!resetToken ? (
								<Field>
									<FieldLabel htmlFor="identifier">
										Email or username
									</FieldLabel>
									<Input
										id="identifier"
										required
										value={identifier}
										onChange={(event) => setIdentifier(event.target.value)}
										placeholder="you@company.com or alex"
										autoComplete="username"
									/>
								</Field>
							) : null}
							<Field>
								<FieldLabel htmlFor="password">Password</FieldLabel>
								<Input
									id="password"
									type="password"
									required
									minLength={8}
									maxLength={128}
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									placeholder="At least 8 characters"
									autoComplete={
										resetToken ? "new-password" : "current-password"
									}
								/>
								<FieldDescription>
									{resetToken
										? "Use a password with at least 8 characters."
										: "Use your recovery email when requesting verification or recovery."}
								</FieldDescription>
							</Field>
						</FieldGroup>
						<Button className="w-full" disabled={busy} type="submit">
							{resetToken
								? "Reset password"
								: invitation
									? "Sign in and accept invitation"
									: "Sign in"}
							<ArrowRight data-icon="inline-end" />
						</Button>
						{busy ? (
							<Skeleton
								aria-label="Processing sign-in"
								className="h-2 w-full"
							/>
						) : null}
					</form>
				</CardContent>
				{invitation && !resetToken ? (
					<CardContent>
						<Alert>
							<MailCheck />
							<AlertTitle>New to MsgFlow?</AlertTitle>
							<AlertDescription>
								Your immutable username and recovery email are fixed by the
								invitation. Creating credentials does not join the workspace
								until your email is verified.
							</AlertDescription>
						</Alert>
						<div className="mt-4 flex flex-col gap-2">
							<Button
								type="button"
								variant="secondary"
								disabled={busy || password.length < 8}
								onClick={() =>
									action(async () => {
										const data = await post("invitations/register", {
											token: invitation,
											password,
										});
										setPassword("");
										setMessage(
											data.verification === "verification_sent"
												? "Credentials created. Check your recovery email, verify it, then sign in and accept this invitation."
												: "Credentials created; verification pending. Ask the operator to configure EMAIL and AUTH_EMAIL_FROM if needed, then enter your invited email above and resend verification. Keep this invitation link to finish joining.",
										);
									})
								}
							>
								Create invited account
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() =>
									action(async () => {
										await post("invitations/accept", { token: invitation });
										await router.invalidate();
										await router.navigate({ to: "/" });
									})
								}
							>
								Accept with current signed-in account
							</Button>
						</div>
					</CardContent>
				) : null}
				{!resetToken ? (
					<CardFooter className="flex-col items-stretch gap-3 border-t">
						<p className="text-sm text-muted-foreground">
							For verification or recovery, enter your recovery email above—not
							your username.
						</p>
						<div className="flex flex-wrap gap-x-4 gap-y-2">
							<Button
								type="button"
								variant="link"
								size="sm"
								disabled={busy}
								onClick={() =>
									action(async () => {
										if (!identifier.includes("@"))
											throw new Error("Enter your recovery email first.");
										const result = await authClient.sendVerificationEmail({
											email: identifier.trim(),
											callbackURL: invitation
												? `/login?invite=${invitation}`
												: "/login",
										});
										if (result.error)
											throw new Error(
												result.error.message ??
													"Verification sender is not configured",
											);
										setMessage(
											"If this account needs verification, a link was submitted for delivery. Check your email. If no link arrives, ask the operator to check the authentication sender configuration.",
										);
									})
								}
							>
								Resend verification
							</Button>
							<Button
								type="button"
								variant="link"
								size="sm"
								disabled={busy}
								onClick={() =>
									action(async () => {
										if (!identifier.includes("@"))
											throw new Error("Enter your recovery email first.");
										const result = await authClient.requestPasswordReset({
											email: identifier.trim(),
											redirectTo: `${window.location.origin}/login`,
										});
										if (result.error) throw new Error(result.error.message);
										setMessage(
											"If a verified account matches that email, a password-reset link was submitted for delivery. Unverified accounts must verify their recovery email first.",
										);
									})
								}
							>
								Forgot password
							</Button>
							<Button
								type="button"
								variant="link"
								size="sm"
								onClick={() => router.navigate({ to: "/setup" })}
							>
								Set up the first workspace
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Existing accounts can still sign in. Invitations and private
							mailbox provisioning require verified recovery email.
						</p>
					</CardFooter>
				) : null}
				{message ? (
					<CardFooter className="pt-0">
						<Alert
							variant={
								message === "Invalid credentials" ? "destructive" : "default"
							}
						>
							<AlertCircle />
							<AlertTitle>Account update</AlertTitle>
							<AlertDescription>{message}</AlertDescription>
						</Alert>
					</CardFooter>
				) : null}
			</Card>
		</main>
	);
}
