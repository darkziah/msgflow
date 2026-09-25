import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { api } from "@/lib/api";

export const Route = createFileRoute("/setup")({ component: Setup });

const initialForm = {
	email: "",
	password: "",
	username: "",
	workspaceName: "",
	workspaceSlug: "",
	initialTeamName: "Support",
	initialInboxName: "Inbox",
};

function Setup() {
	const router = useRouter();
	const [form, setForm] = useState(initialForm);
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function update(field: keyof typeof form, value: string) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const body = {
				...form,
				email: form.email.trim(),
				username: form.username.trim(),
				workspaceName: form.workspaceName.trim(),
				workspaceSlug: form.workspaceSlug.trim(),
				initialTeamName: form.initialTeamName.trim(),
				initialInboxName: form.initialInboxName.trim(),
			};
			const result = await api.setupOwner(body);
			setCreated(true);
			setForm((current) => ({ ...current, password: "" }));
			setError(
				result.setup.verification === "pending_sender_configuration"
					? "Workspace created; recovery email verification is pending. Ask your operator to configure EMAIL and AUTH_EMAIL_FROM, then use Resend verification on the sign-in page. Invites and private mailbox provisioning require verification."
					: "Workspace created; recovery email verification is pending. Check your email, or use Resend verification on the sign-in page if delivery failed. Invites and private mailbox provisioning require verification.",
			);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to create the workspace.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
			<form
				onSubmit={submit}
				className="w-full max-w-2xl space-y-6 rounded-xl border bg-white p-8 shadow-sm"
			>
				<div>
					<h1 className="text-2xl font-black">Set up your MsgFlow workspace</h1>
					<p className="mt-1 text-sm text-gray-500">
						Create the first Workspace Owner, team, and inbox. This setup can
						only be completed once.
					</p>
				</div>
				<section className="space-y-3">
					<h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
						Workspace Owner
					</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Recovery email">
							<input
								type="email"
								required
								autoComplete="email"
								value={form.email}
								onChange={(event) => update("email", event.target.value)}
								placeholder="owner@company.com"
								className="input"
							/>
						</Field>
						<Field label="Username">
							<input
								required
								minLength={3}
								maxLength={30}
								autoComplete="username"
								value={form.username}
								onChange={(event) => update("username", event.target.value)}
								placeholder="alex"
								className="input"
							/>
						</Field>
						<Field label="Password" className="sm:col-span-2">
							<input
								type="password"
								required
								minLength={8}
								maxLength={128}
								autoComplete="new-password"
								value={form.password}
								onChange={(event) => update("password", event.target.value)}
								placeholder="At least 8 characters"
								className="input"
							/>
						</Field>
					</div>
				</section>
				<section className="space-y-3">
					<h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
						First workspace
					</h2>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field label="Workspace name">
							<input
								required
								value={form.workspaceName}
								onChange={(event) =>
									update("workspaceName", event.target.value)
								}
								placeholder="Acme Support"
								className="input"
							/>
						</Field>
						<Field label="Workspace slug">
							<input
								required
								minLength={3}
								maxLength={63}
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								value={form.workspaceSlug}
								onChange={(event) =>
									update("workspaceSlug", event.target.value)
								}
								placeholder="acme-support"
								className="input"
							/>
						</Field>
						<Field label="First team">
							<input
								required
								value={form.initialTeamName}
								onChange={(event) =>
									update("initialTeamName", event.target.value)
								}
								className="input"
							/>
						</Field>
						<Field label="First inbox">
							<input
								required
								value={form.initialInboxName}
								onChange={(event) =>
									update("initialInboxName", event.target.value)
								}
								className="input"
							/>
						</Field>
					</div>
				</section>
				{error ? (
					<p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
						{error}
					</p>
				) : null}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
					<button
						type="button"
						onClick={() => router.navigate({ to: "/login" })}
						className="text-sm text-gray-500 hover:text-gray-900"
					>
						Already have a workspace? Sign in
					</button>
					<Button type="submit" disabled={busy || created}>
						{busy ? "Creating workspace…" : "Create workspace"}
					</Button>
				</div>
			</form>
		</div>
	);
}

function Field({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
			<span>{label}</span>
			{children}
		</div>
	);
}
