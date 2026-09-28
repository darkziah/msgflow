import type { TeamInvitationSummary, TeamMemberSummary } from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { teamApi, type InvitationCreateResponse, type TeamResponse } from "@/lib/team-api";
import { api } from "@/lib/api";
import { emailAdminApi } from "@/lib/email-admin-api";

const teamKey = (workspaceId: string) => ["team-management", workspaceId] as const;
type TeamPanel = "active" | "invitations";

export function TeamSettingsSection({ workspaceId }: { workspaceId: string }) {
	const query = useQuery({
		queryKey: teamKey(workspaceId),
		queryFn: () => teamApi.get(workspaceId),
		enabled: Boolean(workspaceId),
	});
	const [panel, setPanel] = useState<TeamPanel>("active");
	const team = query.data?.team;

	if (query.isPending) return <TeamLoading />;
	if (query.isError) return <TeamError message={query.error.message} />;
	if (!team) return null;

	return (
		<div className="space-y-4">
			<header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="text-sm text-muted-foreground">Manage people, invitations, and workspace access. Private mailbox access stays explicit.</p>
					<p className="mt-2 text-sm font-medium" role="status">{team.members.length} active · {team.invitations.filter((invitation) => activeInvitation(invitation)).length} pending</p>
				</div>
				{team.canManage ? <InviteTeammateDialog workspaceId={workspaceId} /> : null}
			</header>
			<Tabs value={panel} onValueChange={(value) => setPanel(value as TeamPanel)}>
				<TabsList aria-label="Team roster">
					<TabsTrigger value="active">Active ({team.members.length})</TabsTrigger>
					<TabsTrigger value="invitations">Invitations ({team.invitations.length})</TabsTrigger>
				</TabsList>
			</Tabs>
			{panel === "active" ? <TeamMembersPanel workspaceId={workspaceId} members={team.members} canManage={team.canManage} canManageOwners={team.canManageOwners} /> : <TeamInvitationsPanel workspaceId={workspaceId} invitations={team.invitations} />}
		</div>
	);
}

function TeamMembersPanel({ workspaceId, members, canManage, canManageOwners }: { workspaceId: string; members: TeamMemberSummary[]; canManage: boolean; canManageOwners: boolean }) {
	if (!members.length) return <Empty><EmptyHeader><EmptyTitle>No active teammates</EmptyTitle><EmptyDescription>Invite a teammate to start building the workspace roster.</EmptyDescription></EmptyHeader></Empty>;
	return <div className="space-y-3">{members.map((member) => <TeamMemberRow key={member.id} workspaceId={workspaceId} member={member} canManage={canManage} canManageOwners={canManageOwners} />)}</div>;
}

function TeamMemberRow({ workspaceId, member, canManage, canManageOwners }: { workspaceId: string; member: TeamMemberSummary; canManage: boolean; canManageOwners: boolean }) {
	const displayName = member.name || member.username || member.email;
	const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
	const hasMemberActions = canManage || member.canChangeRole || member.canRemove;
	return <Card>
		<CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-start">
			<Avatar size="lg"><AvatarFallback>{initials}</AvatarFallback></Avatar>
			<div className="min-w-0 flex-1 space-y-2">
				<div className="flex flex-wrap items-center gap-2"><p className="font-medium">{displayName}</p><Badge variant="secondary">{member.role}</Badge><Badge variant={member.emailVerified ? "outline" : "secondary"}>{member.emailVerified ? "Verified" : "Unverified"}</Badge></div>
				<p className="break-all text-sm text-muted-foreground">{member.email}</p>
				<div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3"><span>Joined {formatDate(member.joinedAt)}</span><span>{member.privateMailboxes.length ? member.privateMailboxes.map((mailbox) => mailbox.canonicalAddress).join(", ") : "No private mailbox"}</span><span>{member.teamNames.length ? member.teamNames.join(", ") : "No teams"}</span></div>
			</div>
			{hasMemberActions ? <MemberActions workspaceId={workspaceId} member={member} canManage={canManage} canManageOwners={canManageOwners} /> : null}
		</CardContent>
	</Card>;
}

function MemberActions({ workspaceId, member, canManage, canManageOwners }: { workspaceId: string; member: TeamMemberSummary; canManage: boolean; canManageOwners: boolean }) {
	const [roleOpen, setRoleOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [emailOpen, setEmailOpen] = useState(false);
	return <>
		<DropdownMenu>
			<DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Manage ${member.name || member.username || member.email}`}><MoreHorizontal /><span className="sr-only">Manage {member.name || member.username || member.email}</span></Button></DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{canManage && member.username && member.privateMailboxes.length === 0 ? <DropdownMenuItem onSelect={() => setEmailOpen(true)}>Set up email</DropdownMenuItem> : null}
				{member.canChangeRole ? <DropdownMenuItem onSelect={() => setRoleOpen(true)}>Change role</DropdownMenuItem> : null}
				{member.canRemove ? <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>Remove from workspace</DropdownMenuItem> : null}
			</DropdownMenuContent>
		</DropdownMenu>
		<ChangeRoleDialog workspaceId={workspaceId} member={member} canManageOwners={canManageOwners} open={roleOpen} onOpenChange={setRoleOpen} />
		<RemoveMemberDialog workspaceId={workspaceId} member={member} open={removeOpen} onOpenChange={setRemoveOpen} />
		<SetupMemberEmailDialog workspaceId={workspaceId} member={member} open={emailOpen} onOpenChange={setEmailOpen} />
	</>;
}

function ChangeRoleDialog({ workspaceId, member, canManageOwners, open, onOpenChange }: { workspaceId: string; member: TeamMemberSummary; canManageOwners: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
	const cache = useQueryClient();
	const [role, setRole] = useState(member.role);
	const mutation = useMutation({ mutationFn: () => teamApi.updateMemberRole(workspaceId, member.id, { role }), onSuccess: () => { onOpenChange(false); void cache.invalidateQueries({ queryKey: teamKey(workspaceId) }); } });
	return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Change {member.name || member.username || member.email}'s role</DialogTitle><DialogDescription>Member works assigned conversations. Admin manages workspace configuration but does not gain private-mailbox access. Owner controls ownership.</DialogDescription></DialogHeader><Field><FieldLabel htmlFor={`role-${member.id}`}>Workspace role</FieldLabel><select id={`role-${member.id}`} value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="h-9 rounded-md border bg-transparent px-3 text-sm"><option value="member">Member</option><option value="admin">Admin</option>{canManageOwners ? <option value="owner">Owner</option> : null}</select></Field>{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}<DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button onClick={() => mutation.mutate()} disabled={mutation.isPending || role === member.role}>Save role</Button></DialogFooter></DialogContent></Dialog>;
}

function RemoveMemberDialog({ workspaceId, member, open, onOpenChange }: { workspaceId: string; member: TeamMemberSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
	const cache = useQueryClient();
	const [confirmation, setConfirmation] = useState("");
	const label = member.name || member.username || member.email;
	const required = member.username ?? member.email.toLowerCase();
	const close = (next: boolean) => { if (!next) setConfirmation(""); onOpenChange(next); };
	const mutation = useMutation({ mutationFn: () => teamApi.offboardMember(workspaceId, member.id, { confirmation }), onSuccess: () => { close(false); void cache.invalidateQueries({ queryKey: teamKey(workspaceId) }); } });
	return <Dialog open={open} onOpenChange={close}><DialogContent><DialogHeader><DialogTitle>Remove {label} from workspace</DialogTitle><DialogDescription>They lose authorization in this workspace on their next request, are removed from this workspace’s teams and inboxes, and their private mailbox inbound and sending are disabled. History is retained and other Workspace memberships are unaffected.</DialogDescription></DialogHeader><Field><FieldLabel htmlFor={`confirmation-${member.id}`}>Type {required} to confirm</FieldLabel><Input id={`confirmation-${member.id}`} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field>{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}<DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending || confirmation !== required}>Remove {label} from workspace</Button></DialogFooter></DialogContent></Dialog>;
}

function SetupMemberEmailDialog({ workspaceId, member, open, onOpenChange }: { workspaceId: string; member: TeamMemberSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
	const cache = useQueryClient();
	const [domainId, setDomainId] = useState("");
	const domains = useQuery({
		queryKey: ["email-domains", workspaceId],
		queryFn: () => emailAdminApi.domains(workspaceId),
		enabled: open,
	});
	const mutation = useMutation({
		mutationFn: () => api.createPrivateMailbox(workspaceId, domainId, member.id),
		onSuccess: async () => {
			await Promise.all([
				cache.invalidateQueries({ queryKey: teamKey(workspaceId) }),
				cache.invalidateQueries({ queryKey: ["mailboxes", workspaceId] }),
				cache.invalidateQueries({ queryKey: ["sidebar", workspaceId] }),
			]);
			setDomainId("");
			onOpenChange(false);
		},
	});
	const close = (next: boolean) => {
		if (!next) {
			setDomainId("");
			mutation.reset();
		}
		onOpenChange(next);
	};
	const label = member.name || member.username || member.email;
	return <Dialog open={open} onOpenChange={close}><DialogContent><DialogHeader><DialogTitle>Set up email for {label}</DialogTitle><DialogDescription>This creates the private address derived from their immutable username. Receiving and sending remain disabled until Email Admin completes domain readiness and activation.</DialogDescription></DialogHeader>{domains.isPending ? <Skeleton className="h-9 w-full" /> : null}{domains.data?.emailDomains.length === 0 ? <Alert><AlertTitle>No email domain is available</AlertTitle><AlertDescription>Configure and verify a workspace domain in Email Admin before assigning a private address.</AlertDescription></Alert> : null}{domains.data?.emailDomains.length ? <Field><FieldLabel htmlFor={`email-domain-${member.id}`}>Workspace email domain</FieldLabel><Select value={domainId} onValueChange={setDomainId}><SelectTrigger id={`email-domain-${member.id}`}><SelectValue placeholder="Choose a domain" /></SelectTrigger><SelectContent>{domains.data.emailDomains.map((domain) => <SelectItem key={domain.id} value={domain.id}>{domain.canonicalDomain}</SelectItem>)}</SelectContent></Select>{member.username ? <FieldDescription>Address: {member.username}@{domains.data.emailDomains.find((domain) => domain.id === domainId)?.canonicalDomain ?? "…"}</FieldDescription> : null}</Field> : null}{mutation.isError ? <Alert variant="destructive"><AlertTitle>Unable to set up email</AlertTitle><AlertDescription>{mutation.error.message}</AlertDescription></Alert> : null}<DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button onClick={() => mutation.mutate()} disabled={!domainId || mutation.isPending}>{mutation.isPending ? "Creating…" : "Create disabled mailbox"}</Button></DialogFooter></DialogContent></Dialog>;
}

function TeamInvitationsPanel({ workspaceId, invitations }: { workspaceId: string; invitations: TeamInvitationSummary[] }) {
	if (!invitations.length) return <Empty><EmptyHeader><EmptyTitle>No invitations</EmptyTitle><EmptyDescription>Pending invitations will appear here without exposing their activation links.</EmptyDescription></EmptyHeader></Empty>;
	return <div className="space-y-3">{invitations.map((invitation) => <InvitationRow key={invitation.id} workspaceId={workspaceId} invitation={invitation} />)}</div>;
}

function InvitationRow({ workspaceId, invitation }: { workspaceId: string; invitation: TeamInvitationSummary }) {
	const cache = useQueryClient();
	const [open, setOpen] = useState(false);
	const mutation = useMutation({ mutationFn: () => teamApi.revokeInvitation(workspaceId, invitation.id), onSuccess: () => { cache.setQueryData<TeamResponse>(teamKey(workspaceId), (current) => current ? { ...current, team: { ...current.team, invitations: current.team.invitations.map((item) => item.id === invitation.id ? { ...item, lifecycle: "revoked", canRevoke: false } : item) } } : current); void cache.invalidateQueries({ queryKey: teamKey(workspaceId) }); setOpen(false); } });
	return <Card><CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-start sm:justify-between"><div className="space-y-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{invitation.email}</p><Badge variant={invitation.lifecycle === "revoked" || invitation.lifecycle === "expired" ? "secondary" : "outline"}>{invitationStatus(invitation.lifecycle)}</Badge></div><p className="text-sm text-muted-foreground">Reserved username: {invitation.username ?? "Not available"} · Invited by {invitation.invitedByName}</p><p className="text-xs text-muted-foreground">Created {formatDate(invitation.createdAt)} · Expires {formatDate(invitation.expiresAt)}</p></div>{invitation.canRevoke && activeInvitation(invitation) ? <Button variant="outline" onClick={() => setOpen(true)}>Revoke invitation</Button> : null}</CardContent><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Revoke invitation</DialogTitle><DialogDescription>This invalidates the activation link. The reserved username enters a one-day cooldown.</DialogDescription></DialogHeader>{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}<DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Revoke invitation</Button></DialogFooter></DialogContent></Dialog></Card>;
}

function InviteTeammateDialog({ workspaceId }: { workspaceId: string }) {
	const cache = useQueryClient();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [username, setUsername] = useState("");
	const [result, setResult] = useState<InvitationCreateResponse["data"] | null>(null);
	const [copied, setCopied] = useState(false);
	const close = (next: boolean) => { if (!next) { setEmail(""); setUsername(""); setResult(null); setCopied(false); mutation.reset(); } setOpen(next); };
	const mutation = useMutation({ mutationFn: () => teamApi.createInvitation(workspaceId, email.trim(), username.trim()), onSuccess: (response) => { setResult(response.data); void cache.invalidateQueries({ queryKey: teamKey(workspaceId) }); } });
	const copy = async () => { if (!result) return; try { await navigator.clipboard.writeText(result.invitationUrl); setCopied(true); } catch { document.getElementById("invitation-link")?.focus(); } };
	return <Dialog open={open} onOpenChange={close}><Button onClick={() => setOpen(true)}>Invite teammate</Button><DialogContent><DialogHeader><DialogTitle>Invite teammate</DialogTitle><DialogDescription>Recovery email and reserved username are immutable. The recipient receives an activation link; membership and private mailbox access are not granted until verification and acceptance.</DialogDescription></DialogHeader>{result ? <InviteSuccess result={result} copied={copied} onCopy={copy} /> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><FieldGroup><Field><FieldLabel htmlFor="invite-email">Recovery email</FieldLabel><Input id="invite-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field><Field><FieldLabel htmlFor="invite-username">Reserved immutable username</FieldLabel><Input id="invite-username" minLength={3} maxLength={30} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} required /><FieldDescription>This username cannot be changed later.</FieldDescription></Field></FieldGroup>{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}<DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={mutation.isPending || !email.trim() || !username.trim()}>{mutation.isPending ? "Creating…" : "Create invitation"}</Button></DialogFooter></form>} {result ? <DialogFooter><Button variant="outline" onClick={() => close(false)}>Close</Button></DialogFooter> : null}</DialogContent></Dialog>;
}

function InviteSuccess({ result, copied, onCopy }: { result: InvitationCreateResponse["data"]; copied: boolean; onCopy: () => void }) {
	const message = result.delivery === "email_sent" ? "Invitation submitted for delivery." : result.delivery === "copy_link" ? "Email delivery is not configured. Share this link securely;" : "Email delivery failed. Share this link securely;";
	return <div className="space-y-3" role="status"><p className="text-sm">{message} It expires {formatDate(result.expiresAt)}.</p><Field><FieldLabel htmlFor="invitation-link">Invitation link (sensitive)</FieldLabel><Input id="invitation-link" readOnly value={result.invitationUrl} onFocus={(event) => event.currentTarget.select()} /></Field><Button type="button" variant="outline" onClick={onCopy}>Copy invitation link</Button>{copied ? <p className="text-sm" role="status">Copied</p> : null}</div>;
}

function TeamLoading() { return <Card aria-label="Loading team"><CardContent className="space-y-3 pt-6"><Skeleton className="h-6 w-40" /><Skeleton className="h-24 w-full" /></CardContent></Card>; }
function TeamError({ message }: { message: string }) { return <Alert variant="destructive"><AlertTitle>Unable to load team</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>; }
function activeInvitation(invitation: TeamInvitationSummary) { return invitation.lifecycle === "awaiting_activation" || invitation.lifecycle === "awaiting_email_verification"; }
function invitationStatus(lifecycle: TeamInvitationSummary["lifecycle"]) { return { awaiting_activation: "Awaiting activation", awaiting_email_verification: "Account created — verify email", expired: "Expired", revoked: "Revoked" }[lifecycle]; }
function formatDate(value: string | number) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleDateString(); }
