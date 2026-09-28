import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

export function SharedEmailChannel({ workspaceId }: { workspaceId?: string }) {
	const queryClient = useQueryClient();
	const workspaces = useQuery({
		queryKey: ["workspaces"],
		queryFn: api.listWorkspaces,
	});
	const canCreate =
		workspaces.data?.workspaces.find(
			(workspace) => workspace.id === workspaceId,
		)?.role === "owner";
	const domains = useQuery({
		queryKey: ["email-domains", workspaceId],
		queryFn: () =>
			workspaceId
				? api.listEmailDomains(workspaceId)
				: Promise.resolve({ emailDomains: [] }),
		enabled: Boolean(workspaceId),
	});
	const inboxes = useQuery({
		queryKey: ["inboxes", workspaceId],
		queryFn: () =>
			workspaceId
				? api.workspaceListInboxes(workspaceId)
				: Promise.resolve({ inboxes: [] }),
		enabled: Boolean(workspaceId),
	});
	const teams = useQuery({
		queryKey: ["teams", workspaceId],
		queryFn: () =>
			workspaceId ? api.listTeams(workspaceId) : Promise.resolve({ teams: [] }),
		enabled: Boolean(workspaceId),
	});
	const [isOpen, setIsOpen] = useState(false);
	const [emailDomainId, setEmailDomainId] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [inboxId, setInboxId] = useState("");
	const [teamId, setTeamId] = useState("");
	const create = useMutation({
		mutationFn: () => {
			if (!workspaceId) throw new Error("Select a workspace first.");
			return api.createSharedMailbox(workspaceId, {
				emailDomainId,
				localPart: localPart.trim(),
				inboxId,
				teamId: teamId || null,
			});
		},
		onSuccess: () => {
			setIsOpen(false);
			setEmailDomainId("");
			setLocalPart("");
			setInboxId("");
			setTeamId("");
			void queryClient.invalidateQueries({
				queryKey: ["channels", workspaceId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["mailboxes", workspaceId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["assigned-mailboxes", workspaceId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["sidebar", workspaceId],
			});
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Shared email channel</CardTitle>
				<CardDescription>
					Connect an address such as support@domain.tld or info@domain.tld to a
					shared inbox. It is not an Agent account.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{canCreate === false ? (
					<p className="text-sm text-muted-foreground">
						Only a Workspace Owner can create shared email channels.
					</p>
				) : !isOpen ? (
					<Button
						size="sm"
						onClick={() => setIsOpen(true)}
						disabled={!workspaceId || canCreate !== true}
					>
						Add email channel
					</Button>
				) : (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							create.mutate();
						}}
					>
						<FieldGroup className="grid gap-3 sm:grid-cols-2">
							<Field>
								<FieldLabel>Domain</FieldLabel>
								<Select value={emailDomainId} onValueChange={setEmailDomainId}>
									<SelectTrigger>
										<SelectValue placeholder="Select email domain" />
									</SelectTrigger>
									<SelectContent>
										{domains.data?.emailDomains.map((domain) => (
											<SelectItem key={domain.id} value={domain.id}>
												{domain.canonicalDomain}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel htmlFor="email-channel-local-part">
									Email address
								</FieldLabel>
								<Input
									id="email-channel-local-part"
									value={localPart}
									onChange={(event) => setLocalPart(event.target.value)}
									placeholder="info"
									required
								/>
								<FieldDescription>
									The local part before @. This does not create a user.
								</FieldDescription>
							</Field>
							<Field>
								<FieldLabel>Shared inbox</FieldLabel>
								<Select value={inboxId} onValueChange={setInboxId}>
									<SelectTrigger>
										<SelectValue placeholder="Select shared inbox" />
									</SelectTrigger>
									<SelectContent>
										{inboxes.data?.inboxes
											.filter((inbox) => !inbox.isArchived)
											.map((inbox) => (
												<SelectItem key={inbox.id} value={inbox.id}>
													{inbox.name}
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel>Team (optional)</FieldLabel>
								<Select
									value={teamId || "none"}
									onValueChange={(value) =>
										setTeamId(value === "none" ? "" : value)
									}
								>
									<SelectTrigger>
										<SelectValue placeholder="Inbox membership only" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">Inbox membership only</SelectItem>
										{teams.data?.teams.map((team) => (
											<SelectItem key={team.id} value={team.id}>
												{team.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<div className="flex gap-2 sm:col-span-2">
								<Button
									type="submit"
									disabled={
										create.isPending ||
										!emailDomainId ||
										!localPart.trim() ||
										!inboxId
									}
								>
									{create.isPending ? "Creating…" : "Create email channel"}
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => setIsOpen(false)}
								>
									Cancel
								</Button>
							</div>
						</FieldGroup>
						{create.isError ? (
							<p role="alert" className="mt-3 text-sm text-destructive">
								{create.error.message}
							</p>
						) : null}
					</form>
				)}
			</CardContent>
		</Card>
	);
}
