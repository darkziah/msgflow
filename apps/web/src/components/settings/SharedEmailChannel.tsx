import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

/** Shared-email provisioning form for the Channels add-channel wizard. */
export function SharedEmailChannel({
	workspaceId,
	onComplete,
}: {
	workspaceId?: string;
	onComplete?: () => void;
}) {
	const queryClient = useQueryClient();
	const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
	const domains = useQuery({
		queryKey: ["email-domains", workspaceId],
		queryFn: () => workspaceId ? api.listEmailDomains(workspaceId) : Promise.resolve({ emailDomains: [] }),
		enabled: Boolean(workspaceId),
	});
	const inboxes = useQuery({
		queryKey: ["inboxes", workspaceId],
		queryFn: () => workspaceId ? api.workspaceListInboxes(workspaceId) : Promise.resolve({ inboxes: [] }),
		enabled: Boolean(workspaceId),
	});
	const teams = useQuery({
		queryKey: ["teams", workspaceId],
		queryFn: () => workspaceId ? api.listTeams(workspaceId) : Promise.resolve({ teams: [] }),
		enabled: Boolean(workspaceId),
	});
	const canCreate = workspaces.data?.workspaces.find((workspace) => workspace.id === workspaceId)?.role === "owner";
	const [emailDomainId, setEmailDomainId] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [inboxId, setInboxId] = useState("");
	const [teamId, setTeamId] = useState("");
	const create = useMutation({
		mutationFn: () => {
			if (!workspaceId) throw new Error("Select a workspace first.");
			return api.createSharedMailbox(workspaceId, { emailDomainId, localPart: localPart.trim(), inboxId, teamId: teamId || null });
		},
		onSuccess: () => {
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] }),
				queryClient.invalidateQueries({ queryKey: ["mailboxes", workspaceId] }),
				queryClient.invalidateQueries({ queryKey: ["assigned-mailboxes", workspaceId] }),
				queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] }),
			]);
			onComplete?.();
		},
	});

	if (canCreate === false) {
		return <p className="text-sm text-muted-foreground">Only a Workspace Owner can create shared email channels.</p>;
	}

	return (
		<form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
			<FieldGroup className="grid gap-3 sm:grid-cols-2">
				<Field>
					<FieldLabel>Domain</FieldLabel>
					<Select value={emailDomainId} onValueChange={setEmailDomainId}>
						<SelectTrigger><SelectValue placeholder="Select email domain" /></SelectTrigger>
						<SelectContent>{domains.data?.emailDomains.map((domain) => <SelectItem key={domain.id} value={domain.id}>{domain.canonicalDomain}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Field>
					<FieldLabel htmlFor="email-channel-local-part">Email address</FieldLabel>
					<Input id="email-channel-local-part" value={localPart} onChange={(event) => setLocalPart(event.target.value)} placeholder="info" required />
					<FieldDescription>The local part before @. This does not create a user.</FieldDescription>
				</Field>
				<Field>
					<FieldLabel>Shared inbox</FieldLabel>
					<Select value={inboxId} onValueChange={setInboxId}>
						<SelectTrigger><SelectValue placeholder="Select shared inbox" /></SelectTrigger>
						<SelectContent>{inboxes.data?.inboxes.filter((inbox) => !inbox.isArchived).map((inbox) => <SelectItem key={inbox.id} value={inbox.id}>{inbox.name}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Field>
					<FieldLabel>Team (optional)</FieldLabel>
					<Select value={teamId || "none"} onValueChange={(value) => setTeamId(value === "none" ? "" : value)}>
						<SelectTrigger><SelectValue placeholder="Inbox membership only" /></SelectTrigger>
						<SelectContent><SelectItem value="none">Inbox membership only</SelectItem>{teams.data?.teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
					</Select>
				</Field>
				<Button type="submit" className="w-fit sm:col-span-2" disabled={create.isPending || canCreate !== true || !emailDomainId || !localPart.trim() || !inboxId}>{create.isPending ? "Creating…" : "Create email channel"}</Button>
			</FieldGroup>
			{create.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{create.error.message}</p> : null}
		</form>
	);
}
