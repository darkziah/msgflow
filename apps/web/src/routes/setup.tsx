import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CircleCheck,
	MessageCircleMore,
	ShieldCheck,
	Sparkles,
	UsersRound,
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

const steps = [
	{ label: "Your account", detail: "Owner access", icon: ShieldCheck },
	{ label: "Your workspace", detail: "Team and inbox", icon: UsersRound },
	{ label: "Ready to go", detail: "Review setup", icon: Sparkles },
] as const;

export function Setup() {
	const router = useRouter();
	const [form, setForm] = useState(initialForm);
	const [step, setStep] = useState(0);
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState(false);
	const [createdWorkspace, setCreatedWorkspace] = useState<{
		workspaceId: string;
		inboxId: string;
	} | null>(null);
	const [verification, setVerification] = useState<
		"pending_sender_configuration" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	if (window.location.pathname === "/setup/channel") return <Outlet />;

	function update(field: keyof typeof form, value: string) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	function validateStep(currentStep: number) {
		if (currentStep === 0) {
			if (!form.email.trim() || !form.username.trim() || !form.password)
				return "Enter your recovery email, username, and password to continue.";
			if (!isValidEmail(form.email.trim()))
				return "Enter a valid recovery email to continue.";
			if (form.username.trim().length < 3 || form.username.trim().length > 30)
				return "Use a username between 3 and 30 characters.";
			if (form.password.length < 8)
				return "Use a password with at least 8 characters.";
			if (form.password.length > 128)
				return "Use a password with no more than 128 characters.";
		}
		if (currentStep === 1) {
			if (!form.workspaceName.trim() || !form.workspaceSlug.trim())
				return "Name your workspace and choose its URL slug to continue.";
			if (
				form.workspaceSlug.trim().length < 3 ||
				form.workspaceSlug.trim().length > 63
			)
				return "Use a workspace slug between 3 and 63 characters.";
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.workspaceSlug.trim()))
				return "Use lowercase letters, numbers, and single hyphens in the workspace slug.";
			if (!form.initialTeamName.trim() || !form.initialInboxName.trim())
				return "Choose the first team and shared inbox names to continue.";
		}
		return null;
	}

	function validateSetup() {
		return validateStep(0) ?? validateStep(1);
	}

	function continueSetup() {
		const validationError = validateStep(step);
		if (validationError) {
			setError(validationError);
			return;
		}
		setError(null);
		setStep((current) => Math.min(current + 1, steps.length - 1));
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		const validationError = validateSetup();
		if (validationError) {
			setError(validationError);
			setStep(
				validationError.includes("password") ||
					validationError.includes("email")
					? 0
					: 1,
			);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const result = await api.setupOwner({
				...form,
				email: form.email.trim(),
				username: form.username.trim(),
				workspaceName: form.workspaceName.trim(),
				workspaceSlug: form.workspaceSlug.trim(),
				initialTeamName: form.initialTeamName.trim(),
				initialInboxName: form.initialInboxName.trim(),
			});
			setCreated(true);
			setCreatedWorkspace({
				workspaceId: result.setup.workspaceId,
				inboxId: result.setup.inboxId,
			});
			setVerification(result.setup.verification);
			setForm((current) => ({ ...current, password: "" }));
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Unable to create the workspace.",
			);
		} finally {
			setBusy(false);
		}
	}

	if (created && createdWorkspace) {
		return (
			<SetupComplete
				verification={verification}
				onSignIn={() =>
					router.navigate({
						to: "/login",
						search: {
							next: `/setup/channel?workspaceId=${encodeURIComponent(createdWorkspace.workspaceId)}&inboxId=${encodeURIComponent(createdWorkspace.inboxId)}`,
						},
					})
				}
			/>
		);
	}

	return (
		<main className="min-h-screen bg-muted/30 px-4 py-6 sm:px-6 lg:px-8">
			<Card className="mx-auto grid max-w-5xl gap-0 overflow-hidden py-0 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.25fr)]">
				<SetupAside step={step} />
				<section className="flex min-w-0 flex-col px-6 py-8 sm:px-10 sm:py-10">
					<header className="flex items-center justify-between gap-4">
						<div className="flex items-center gap-2 text-sm font-semibold">
							<MessageCircleMore aria-hidden="true" /> MsgFlow
						</div>
						<Button
							type="button"
							variant="link"
							size="sm"
							onClick={() => router.navigate({ to: "/login" })}
						>
							Already set up? Sign in
						</Button>
					</header>
					<form
						className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-10"
						onSubmit={submit}
					>
						<StepHeading step={step} />
						{step === 0 ? <AccountStep form={form} update={update} /> : null}
						{step === 1 ? <WorkspaceStep form={form} update={update} /> : null}
						{step === 2 ? <ReviewStep form={form} /> : null}
						{error ? (
							<Alert className="mt-6" variant="destructive">
								<AlertTitle>Setup needs attention</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
						{busy ? (
							<Skeleton
								aria-label="Creating workspace"
								className="mt-6 h-2 w-full"
							/>
						) : null}
						<div className="mt-8 flex items-center justify-between gap-4 border-t pt-6">
							{step === 0 ? (
								<span className="text-sm text-muted-foreground">
									Takes about two minutes
								</span>
							) : (
								<Button
									type="button"
									variant="ghost"
									onClick={() => {
										setError(null);
										setStep((current) => current - 1);
									}}
								>
									<ArrowLeft data-icon="inline-start" />
									Back
								</Button>
							)}
							{step < 2 ? (
								<Button type="button" onClick={continueSetup}>
									Continue
									<ArrowRight data-icon="inline-end" />
								</Button>
							) : (
								<Button type="submit" disabled={busy}>
									{busy ? "Creating workspace…" : "Create workspace"}
									<ArrowRight data-icon="inline-end" />
								</Button>
							)}
						</div>
					</form>
				</section>
			</Card>
		</main>
	);
}

function SetupAside({ step }: { step: number }) {
	return (
		<aside className="flex flex-col bg-primary px-6 py-8 text-primary-foreground sm:px-10 lg:px-12 lg:py-12">
			<div className="flex size-10 items-center justify-center rounded-lg border border-primary-foreground/20 bg-primary-foreground/10">
				<MessageCircleMore aria-hidden="true" />
			</div>
			<div className="mt-10 lg:mt-auto">
				<p className="text-sm font-medium text-primary-foreground/80">
					Welcome to MsgFlow
				</p>
				<h1 className="mt-3 text-3xl font-semibold tracking-tight">
					Make the first response feel personal.
				</h1>
				<p className="mt-4 text-sm leading-6 text-primary-foreground/80">
					Set up a focused workspace for your team, then bring in the channels
					your customers already use.
				</p>
			</div>
			<ol className="mt-10 flex flex-col gap-4" aria-label="Setup progress">
				{steps.map((item, index) => {
					const Icon = item.icon;
					const complete = index < step;
					const current = index === step;
					return (
						<li className="flex items-center gap-3" key={item.label}>
							<span className="flex size-8 items-center justify-center rounded-full border border-primary-foreground/30 bg-primary-foreground/10">
								{complete ? (
									<Check aria-label="Complete" />
								) : (
									<Icon aria-hidden="true" />
								)}
							</span>
							<span
								className={
									current || complete ? "" : "text-primary-foreground/60"
								}
							>
								<span className="block text-sm font-semibold">
									{item.label}
								</span>
								<span className="block text-xs text-primary-foreground/70">
									{item.detail}
								</span>
							</span>
						</li>
					);
				})}
			</ol>
		</aside>
	);
}

function StepHeading({ step }: { step: number }) {
	const copy = [
		[
			"Let’s start with you",
			"You’ll be the first workspace owner. This identity controls setup and recovery.",
		],
		[
			"Shape your workspace",
			"Create the shared place your first team will use to work conversations.",
		],
		[
			"Check the essentials",
			"This creates your one MsgFlow workspace, initial team, and first shared inbox.",
		],
	][step];
	return (
		<header className="mb-8">
			<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Step {step + 1} of 3
			</p>
			<h2 className="mt-3 text-3xl font-semibold tracking-tight">{copy[0]}</h2>
			<p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
				{copy[1]}
			</p>
		</header>
	);
}

function AccountStep({
	form,
	update,
}: {
	form: typeof initialForm;
	update: (field: keyof typeof initialForm, value: string) => void;
}) {
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="recovery-email">Recovery email</FieldLabel>
				<Input
					id="recovery-email"
					type="email"
					required
					autoComplete="email"
					value={form.email}
					onChange={(event) => update("email", event.target.value)}
					placeholder="owner@company.com"
				/>
				<FieldDescription>Used to protect owner access.</FieldDescription>
			</Field>
			<div className="grid gap-6 sm:grid-cols-2">
				<Field>
					<FieldLabel htmlFor="username">Username</FieldLabel>
					<Input
						id="username"
						required
						minLength={3}
						maxLength={30}
						autoComplete="username"
						value={form.username}
						onChange={(event) => update("username", event.target.value)}
						placeholder="alex"
					/>
					<FieldDescription>3–30 characters; permanent.</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor="new-password">Password</FieldLabel>
					<Input
						id="new-password"
						type="password"
						required
						minLength={8}
						maxLength={128}
						autoComplete="new-password"
						value={form.password}
						onChange={(event) => update("password", event.target.value)}
						placeholder="Choose a strong password"
					/>
					<FieldDescription>At least 8 characters.</FieldDescription>
				</Field>
			</div>
		</FieldGroup>
	);
}

function WorkspaceStep({
	form,
	update,
}: {
	form: typeof initialForm;
	update: (field: keyof typeof initialForm, value: string) => void;
}) {
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
				<Input
					id="workspace-name"
					required
					value={form.workspaceName}
					onChange={(event) => update("workspaceName", event.target.value)}
					placeholder="Acme Support"
				/>
				<FieldDescription>Visible to your team.</FieldDescription>
			</Field>
			<div className="grid gap-6 sm:grid-cols-2">
				<Field>
					<FieldLabel htmlFor="workspace-slug">Workspace slug</FieldLabel>
					<Input
						id="workspace-slug"
						required
						minLength={3}
						maxLength={63}
						pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
						value={form.workspaceSlug}
						onChange={(event) => update("workspaceSlug", event.target.value)}
						placeholder="acme-support"
					/>
					<FieldDescription>Lowercase URL-safe name.</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor="team-name">First team</FieldLabel>
					<Input
						id="team-name"
						required
						value={form.initialTeamName}
						onChange={(event) => update("initialTeamName", event.target.value)}
					/>
					<FieldDescription>Who works this inbox.</FieldDescription>
				</Field>
			</div>
			<Field>
				<FieldLabel htmlFor="inbox-name">First shared inbox</FieldLabel>
				<Input
					id="inbox-name"
					required
					value={form.initialInboxName}
					onChange={(event) => update("initialInboxName", event.target.value)}
				/>
				<FieldDescription>Where conversations arrive.</FieldDescription>
			</Field>
		</FieldGroup>
	);
}

function ReviewStep({ form }: { form: typeof initialForm }) {
	const rows = [
		["Workspace", form.workspaceName || "Your workspace"],
		[
			"Owner",
			`${form.username || "username"} · ${form.email || "recovery email"}`,
		],
		["Team", form.initialTeamName || "Support"],
		["Shared inbox", form.initialInboxName || "Inbox"],
	];
	return (
		<Card>
			<CardHeader>
				<CardTitle>Workspace summary</CardTitle>
				<CardDescription>
					Review the essentials before creating your workspace.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="flex flex-col gap-4">
					{rows.map(([label, value]) => (
						<div
							className="flex items-center justify-between gap-4"
							key={label}
						>
							<dt className="text-sm text-muted-foreground">{label}</dt>
							<dd className="text-right text-sm font-medium">{value}</dd>
						</div>
					))}
				</dl>
			</CardContent>
			<CardFooter>
				<Alert>
					<AlertTitle>One-time setup</AlertTitle>
					<AlertDescription>
						More teammates, inboxes, channels, and mailboxes are added after you
						sign in.
					</AlertDescription>
				</Alert>
			</CardFooter>
		</Card>
	);
}

function isValidEmail(email: string) {
	const input = document.createElement("input");
	input.type = "email";
	input.value = email;
	return input.checkValidity();
}

function SetupComplete({
	onSignIn,
	verification,
}: {
	onSignIn: () => void;
	verification: "pending_sender_configuration" | null;
}) {
	return (
		<main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
			<Card className="w-full max-w-xl text-center">
				<CardHeader>
					<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
						<CircleCheck aria-hidden="true" />
					</div>
					<CardTitle className="text-2xl">
						Your inbox is ready for its first conversation.
					</CardTitle>
					<CardDescription>
						Sign in to connect a Facebook Page, or skip it and add channels
						later from Settings.
					</CardDescription>
					{verification === "pending_sender_configuration" ? (
						<Alert className="mt-4 text-left">
							<AlertTitle>Recovery email verification is pending</AlertTitle>
							<AlertDescription>
								Workspace created; recovery email verification is pending. Ask your
								operator to configure EMAIL and AUTH_EMAIL_FROM, then use Resend
								verification on the sign-in page. Invites and private mailbox
								provisioning require verification.
							</AlertDescription>
						</Alert>
					) : null}
				</CardHeader>
				<CardFooter className="justify-center">
					<Button onClick={onSignIn}>
						Sign in and connect Facebook
						<ArrowRight data-icon="inline-end" />
					</Button>
				</CardFooter>
			</Card>
		</main>
	);
}
