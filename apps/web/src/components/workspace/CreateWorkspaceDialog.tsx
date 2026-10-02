import type { WorkspaceSummary } from "@msgflow/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

interface CreateWorkspaceDialogProps {
	sourceWorkspaceId: string;
	onCreated: (workspace: WorkspaceSummary) => void;
}

const INITIAL_FORM = {
	workspaceName: "",
	workspaceSlug: "",
	initialTeamName: "Operations",
	initialInboxName: "Support",
};

export function CreateWorkspaceDialog({
	sourceWorkspaceId,
	onCreated,
}: CreateWorkspaceDialogProps) {
	const [open, setOpen] = useState(false);
	const [form, setForm] = useState(INITIAL_FORM);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	function update(field: keyof typeof form, value: string) {
		setForm((current) => ({ ...current, [field]: value }));
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			const { workspace } = await api.createWorkspace(sourceWorkspaceId, form);
			setOpen(false);
			setForm(INITIAL_FORM);
			onCreated(workspace);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Unable to create workspace");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" size="sm">
					Create workspace
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create workspace</DialogTitle>
					<DialogDescription>
						Creates an independent Team and Shared Inbox. Existing channels, people,
						and conversations are not copied.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<div className="grid gap-2">
						<Label htmlFor="workspace-name">Workspace name</Label>
						<Input id="workspace-name" required maxLength={120} value={form.workspaceName} onChange={(event) => update("workspaceName", event.target.value)} />
					</div>
					<div className="grid gap-2">
						<Label htmlFor="workspace-slug">Workspace slug</Label>
						<Input id="workspace-slug" required minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]" value={form.workspaceSlug} onChange={(event) => update("workspaceSlug", event.target.value)} />
						<p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="initial-team-name">Initial Team</Label>
						<Input id="initial-team-name" required maxLength={120} value={form.initialTeamName} onChange={(event) => update("initialTeamName", event.target.value)} />
					</div>
					<div className="grid gap-2">
						<Label htmlFor="initial-inbox-name">Initial Shared Inbox</Label>
						<Input id="initial-inbox-name" required maxLength={120} value={form.initialInboxName} onChange={(event) => update("initialInboxName", event.target.value)} />
					</div>
					{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
					<div className="flex justify-end gap-2">
						<Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create workspace"}</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
