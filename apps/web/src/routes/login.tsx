import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
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
	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
			<form
				onSubmit={submit}
				className="w-full max-w-md space-y-4 rounded-xl border bg-white p-8 shadow-sm"
			>
				<h1 className="text-2xl font-black">
					{resetToken
						? "Reset password"
						: invitation
							? "Join your invited workspace"
							: "MsgFlow"}
				</h1>
				{!resetToken && (
					<input
						aria-label="Email or username"
						required
						value={identifier}
						onChange={(e) => setIdentifier(e.target.value)}
						placeholder="Email or username"
						autoComplete="username"
						className="input w-full"
					/>
				)}
				<input
					aria-label="Password"
					type="password"
					required
					minLength={8}
					maxLength={128}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password (at least 8 characters)"
					autoComplete={resetToken ? "new-password" : "current-password"}
					className="input w-full"
				/>
				<Button disabled={busy} type="submit" className="w-full">
					{resetToken
						? "Reset password"
						: invitation
							? "Sign in and accept invitation"
							: "Sign in"}
				</Button>
				{invitation && !resetToken && (
					<section className="space-y-3 border-t pt-4">
						<p className="text-sm">
							New account? Your immutable username and recovery email are fixed
							by the invitation. Creating credentials does not join the
							workspace until your email is verified.
						</p>
						<Button
							type="button"
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
					</section>
				)}
				{!resetToken && (
					<div className="space-y-2 border-t pt-4 text-sm">
						<p>
							For verification or recovery, enter your recovery email above (not
							your username).
						</p>
						<button
							type="button"
							disabled={busy}
							className="block text-primary"
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
						</button>
						<button
							type="button"
							disabled={busy}
							className="block text-primary"
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
						</button>
						<p>
							Existing accounts can still sign in. Invitations and private
							mailbox provisioning require verified recovery email.
						</p>
						<button
							type="button"
							className="text-primary"
							onClick={() => router.navigate({ to: "/setup" })}
						>
							Set up the first workspace
						</button>
					</div>
				)}
				{message && (
					<p role="status" className="rounded border p-3 text-sm">
						{message}
					</p>
				)}
			</form>
		</div>
	);
}
