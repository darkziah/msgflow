import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
	const router = useRouter();
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const result =
				mode === "signin"
					? await authClient.signIn.email({ email, password })
					: await authClient.signUp.email({
							email,
							password,
							name: email.split("@")[0] || "Agent",
						});
			if (result.error) {
				setError(result.error.message ?? "Something went wrong.");
				return;
			}
			await router.invalidate();
			await router.navigate({ to: "/" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50">
			<form
				onSubmit={submit}
				className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-8 shadow-sm"
			>
				<div>
					<h1 className="text-2xl font-black">MsgFlow</h1>
					<p className="mt-1 text-sm text-gray-500">
						Unified inbox for your business conversations.
					</p>
				</div>
				<div className="space-y-2">
					<input
						type="email"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="Email"
						autoComplete="email"
						className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
					/>
					<input
						type="password"
						required
						minLength={8}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="Password (min 8 chars)"
						autoComplete={
							mode === "signin" ? "current-password" : "new-password"
						}
						className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
					/>
				</div>
				{error ? <p className="text-sm text-red-600">{error}</p> : null}
				<Button
					type="submit"
					disabled={busy || !email || !password}
					className="w-full"
				>
					{busy
						? "Please wait…"
						: mode === "signin"
							? "Sign in"
							: "Create account"}
				</Button>
				<button
					type="button"
					onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
					className="w-full text-center text-sm text-gray-500 underline-offset-2 hover:underline"
				>
					{mode === "signin"
						? "No account? Create one"
						: "Have an account? Sign in"}
				</button>
			</form>
		</div>
	);
}
