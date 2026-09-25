import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type MailboxSummary } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import {
	type Domain,
	emailAdminApi as emailApi,
	evidenceFor,
	type PreviewRow,
} from "@/lib/email-admin-api";

const field = "rounded-md border px-3 py-1.5 text-sm";
export function EmailAdmin() {
	const { data: session } = useSession();
	const workspaces = useQuery({
		queryKey: ["workspaces"],
		queryFn: api.listWorkspaces,
	});
	const [selected, setSelected] = useState("");
	const workspace =
		workspaces.data?.workspaces.find((w) => w.id === selected) ??
		workspaces.data?.workspaces[0];
	return (
		<section className="border-t pt-8 space-y-4">
			<h2 className="text-lg font-bold">Email domains and mailboxes</h2>
			<p className="text-sm text-muted-foreground">
				Pending records do not change DNS. Owners manage lifecycle; admins can
				inspect readiness. Neither role grants access to private messages.
			</p>
			<select
				aria-label="Email workspace"
				value={workspace?.id ?? ""}
				onChange={(e) => setSelected(e.target.value)}
				className={field}
			>
				{workspaces.data?.workspaces.map((w) => (
					<option key={w.id} value={w.id}>
						{w.name}
					</option>
				))}
			</select>
			{workspaces.isError ? (
				<p role="alert">{workspaces.error.message}</p>
			) : null}
			{workspace && session ? (
				<WorkspaceEmail
					key={workspace.id}
					workspaceId={workspace.id}
					owner={workspace.role === "owner"}
					operator={workspace.role === "owner" || workspace.role === "admin"}
					userId={session.user.id}
				/>
			) : null}
		</section>
	);
}
function WorkspaceEmail({
	workspaceId,
	owner,
	operator,
	userId,
}: {
	workspaceId: string;
	owner: boolean;
	operator: boolean;
	userId: string;
}) {
	const cache = useQueryClient();
	const domains = useQuery({
		queryKey: ["email-domains", workspaceId],
		queryFn: () => emailApi.domains(workspaceId),
	});
	const mailboxes = useQuery({
		queryKey: ["mailboxes", workspaceId],
		queryFn: () => api.listMailboxes(workspaceId),
	});
	const defaultUsers = useQuery({
		queryKey: ["users"],
		queryFn: api.listUsers,
	});
	const members = useQuery({
		queryKey: ["email-members", workspaceId, domains.data?.emailDomains[0]?.id],
		enabled: owner && !!domains.data?.emailDomains.length,
		queryFn: () =>
			emailApi.preview(workspaceId, {
				emailDomainId: domains.data?.emailDomains[0]?.id ?? "",
				userIds: [],
				excludeUserIds: [],
			}),
	});
	// Preview is the available workspace-scoped Agent directory. Never assign from the default-workspace list.
	const users = {
		data: {
			users: (members.data?.preview ?? []).map((m) => ({
				id: m.userId,
				name: m.username ?? m.userId,
				email:
					defaultUsers.data?.users.find((u) => u.id === m.userId)?.email ?? "",
			})),
		},
	};
	const inboxes = useQuery({
		queryKey: ["inboxes", workspaceId],
		queryFn: () => api.workspaceListInboxes(workspaceId),
	});
	const teams = useQuery({
		queryKey: ["teams", workspaceId],
		queryFn: () => api.listTeams(workspaceId),
	});
	const [domain, setDomain] = useState("");
	const [domainId, setDomainId] = useState("");
	const [ownerId, setOwnerId] = useState("");
	const [localPart, setLocalPart] = useState("support");
	const [inboxId, setInboxId] = useState("");
	const [teamId, setTeamId] = useState("");
	const refresh = async () => {
		await Promise.all([
			cache.invalidateQueries({ queryKey: ["email-domains", workspaceId] }),
			cache.invalidateQueries({ queryKey: ["mailboxes", workspaceId] }),
			cache.invalidateQueries({
				queryKey: ["assigned-mailboxes", workspaceId],
			}),
			cache.invalidateQueries({ queryKey: ["email-operations", workspaceId] }),
			cache.invalidateQueries({ queryKey: ["email-members", workspaceId] }),
			cache.invalidateQueries({ queryKey: ["sidebar", workspaceId] }),
		]);
	};
	const mutation = useMutation({
		mutationFn: (action: () => Promise<unknown>) => action(),
		onSuccess: refresh,
	});
	return (
		<div className="space-y-5">
			{domains.isError || mailboxes.isError ? (
				<p role="alert" className="text-red-600">
					{domains.error?.message ?? mailboxes.error?.message}
				</p>
			) : null}
			{mutation.isError ? (
				<p role="alert" className="text-red-600">
					{mutation.error.message}
				</p>
			) : null}
			{members.isError ? (
				<p role="alert">
					Cannot load workspace Agents: {members.error.message}
				</p>
			) : null}
			{owner ? <Invitation workspaceId={workspaceId} /> : null}
			{owner ? (
				<form
					className="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						mutation.mutate(() =>
							api.createEmailDomain(workspaceId, domain.trim()),
						);
					}}
				>
					<input
						aria-label="Pilot subdomain"
						placeholder="pilot.example.com"
						value={domain}
						onChange={(e) => setDomain(e.target.value)}
						className={field}
						required
					/>
					<Button size="sm" disabled={mutation.isPending || !domain.trim()}>
						Add pending domain
					</Button>
				</form>
			) : null}
			{domains.isPending ? (
				<p>Loading domains…</p>
			) : domains.data?.emailDomains.length === 0 ? (
				<p className="text-sm text-muted-foreground">No domains configured.</p>
			) : null}
			{domains.data?.emailDomains.map((d) => (
				<DomainControls
					key={d.id}
					domain={d}
					owner={owner}
					workspaceId={workspaceId}
					refresh={refresh}
				/>
			))}
			{owner ? (
				<div className="rounded-lg border p-4 space-y-3">
					<h3 className="font-semibold">Explicit mailbox assignment</h3>
					<p className="text-xs text-muted-foreground">
						Creating an address leaves receiving and sending disabled. A private
						address uses the selected member’s immutable username.
					</p>
					<select
						aria-label="Assignment domain"
						className={field}
						value={domainId}
						onChange={(e) => setDomainId(e.target.value)}
					>
						<option value="">Choose domain…</option>
						{domains.data?.emailDomains.map((d) => (
							<option key={d.id} value={d.id}>
								{d.canonicalDomain}
							</option>
						))}
					</select>
					<div className="flex flex-wrap gap-2">
						<select
							aria-label="Private mailbox owner"
							className={field}
							value={ownerId}
							onChange={(e) => setOwnerId(e.target.value)}
						>
							<option value="">Choose private owner…</option>
							{users.data?.users.map((u) => (
								<option key={u.id} value={u.id}>
									{u.name} · {u.email}
								</option>
							))}
						</select>
						<Button
							size="sm"
							disabled={mutation.isPending || !domainId || !ownerId}
							onClick={() =>
								mutation.mutate(() =>
									api.createPrivateMailbox(workspaceId, domainId, ownerId),
								)
							}
						>
							Assign private mailbox
						</Button>
					</div>
					<div className="flex flex-wrap gap-2">
						<input
							aria-label="Shared local part"
							className={field}
							value={localPart}
							onChange={(e) => setLocalPart(e.target.value)}
						/>
						<select
							aria-label="Shared inbox"
							className={field}
							value={inboxId}
							onChange={(e) => setInboxId(e.target.value)}
						>
							<option value="">Shared inbox…</option>
							{inboxes.data?.inboxes.map((i) => (
								<option key={i.id} value={i.id}>
									{i.name}
								</option>
							))}
						</select>
						<select
							aria-label="Shared team"
							className={field}
							value={teamId}
							onChange={(e) => setTeamId(e.target.value)}
						>
							<option value="">Inbox membership only</option>
							{teams.data?.teams.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
						<Button
							size="sm"
							disabled={
								mutation.isPending || !domainId || !inboxId || !localPart.trim()
							}
							onClick={() =>
								mutation.mutate(() =>
									api.createSharedMailbox(workspaceId, {
										emailDomainId: domainId,
										localPart: localPart.trim(),
										inboxId,
										teamId: teamId || null,
									}),
								)
							}
						>
							Create shared mailbox
						</Button>
					</div>
				</div>
			) : null}
			{mailboxes.data?.mailboxes.map((m) => (
				<MailboxControls
					key={m.id}
					mailbox={m}
					owner={owner}
					currentUserId={userId}
					users={
						users.data?.users.length
							? users.data.users
							: (defaultUsers.data?.users ?? [])
					}
					workspaceId={workspaceId}
					refresh={refresh}
				/>
			))}
			{owner ? (
				<BulkProvision
					workspaceId={workspaceId}
					domains={domains.data?.emailDomains ?? []}
					refresh={refresh}
				/>
			) : null}
			{operator ? <Operations workspaceId={workspaceId} owner={owner} /> : null}
		</div>
	);
}

function DomainControls({
	domain,
	owner,
	workspaceId,
	refresh,
}: {
	domain: Domain;
	owner: boolean;
	workspaceId: string;
	refresh: () => Promise<void>;
}) {
	const evidence = evidenceFor(domain);
	const [routing, setRouting] = useState(evidence.routingConfirmed ?? false);
	const [sending, setSending] = useState(evidence.sendingConfirmed ?? false);
	const [selector, setSelector] = useState(
		evidence.dkimSelector ?? "cf-bounce",
	);
	const mutation = useMutation({
		mutationFn: (fn: () => Promise<unknown>) => fn(),
		onSuccess: refresh,
	});
	const unchanged =
		routing === !!evidence.routingConfirmed &&
		sending === !!evidence.sendingConfirmed &&
		selector === evidence.dkimSelector;
	const fresh =
		!!evidence.checkedAt &&
		Date.now() - Date.parse(evidence.checkedAt) < 15 * 60_000;
	return (
		<article className="rounded-lg border p-4 space-y-3">
			<h3 className="font-semibold">{domain.canonicalDomain}</h3>
			<p className="text-sm">
				Receiving: {domain.inboundState} · Sending: {domain.outboundState}
			</p>
			<details className="text-sm">
				<summary>Operator checklist and expected DNS</summary>
				<ol className="list-decimal pl-5 mt-2 space-y-2">
					<li>
						Select only {domain.canonicalDomain} in the intended Cloudflare
						account’s Email Routing dashboard. Review its exact MX/TXT preview;
						leave apex mail records untouched.
					</li>
					<li>
						Routing: MX at {domain.canonicalDomain} must target Cloudflare
						route1/2/3.mx.cloudflare.net; one SPF TXT must include
						_spf.mx.cloudflare.net. Copy the dashboard DKIM public key to
						cf2024-1._domainkey.{domain.canonicalDomain}.
					</li>
					<li>
						Route explicit recipients to this Worker. Do not enable a catch-all
						without proving its domain scope.
					</li>
					<li>
						Onboard {domain.canonicalDomain} separately in Email Sending. Review
						MX and SPF at cf-bounce.{domain.canonicalDomain}, the
						provider-selected DKIM selector, and DMARC at _dmarc.
						{domain.canonicalDomain}. Copy exact values from the provider, not a
						guessed public key.
					</li>
					<li>
						Review routing destination, sending approval and lifecycle
						subscriptions in the dashboard. DNS is evidence, not proof of
						dashboard configuration.
					</li>
				</ol>
			</details>
			{owner ? (
				<>
					<label className="flex gap-2 text-sm">
						<input
							type="checkbox"
							checked={routing}
							onChange={(e) => setRouting(e.target.checked)}
						/>
						I confirmed Routing and this Worker destination in the dashboard
					</label>
					<label className="flex gap-2 text-sm">
						<input
							type="checkbox"
							checked={sending}
							onChange={(e) => setSending(e.target.checked)}
						/>
						I confirmed Email Sending for this exact domain in the dashboard
					</label>
					<label className="block text-sm">
						Sending DKIM selector{" "}
						<input
							className={field}
							value={selector}
							onChange={(e) => setSelector(e.target.value)}
						/>
					</label>
					<Button
						size="sm"
						variant="outline"
						disabled={mutation.isPending || !selector}
						onClick={() =>
							mutation.mutate(() =>
								emailApi.verify(workspaceId, domain.id, {
									routingConfirmed: routing,
									sendingConfirmed: sending,
									dkimSelector: selector,
								}),
							)
						}
					>
						Check DNS and save confirmations
					</Button>
					<p className="text-xs text-muted-foreground">
						Verification never activates a domain. Failed evidence can return an
						active domain to pending. Activation requires evidence checked
						within 15 minutes.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={
								mutation.isPending ||
								!unchanged ||
								!fresh ||
								!evidence.routingDns ||
								!routing ||
								domain.inboundState === "ready"
							}
							onClick={() => {
								if (
									confirm(
										`Activate receiving for ${domain.canonicalDomain}? Mailboxes remain separately controlled.`,
									)
								)
									mutation.mutate(() =>
										emailApi.domainState(workspaceId, domain.id, {
											inboundState: "ready",
										}),
									);
							}}
						>
							Activate receiving
						</Button>
						<Button
							size="sm"
							disabled={
								mutation.isPending ||
								!unchanged ||
								!fresh ||
								!evidence.sendingDns ||
								!sending ||
								domain.outboundState === "ready"
							}
							onClick={() => {
								if (confirm(`Activate sending for ${domain.canonicalDomain}?`))
									mutation.mutate(() =>
										emailApi.domainState(workspaceId, domain.id, {
											outboundState: "ready",
										}),
									);
							}}
						>
							Activate sending
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={mutation.isPending}
							onClick={() => {
								if (
									confirm(
										`Suspend ${domain.canonicalDomain}? Receiving and sending capabilities on all its mailboxes will be disabled.`,
									)
								)
									mutation.mutate(() =>
										emailApi.domainState(workspaceId, domain.id, {
											inboundState: "suspended",
											outboundState: "suspended",
										}),
									);
							}}
						>
							Suspend domain
						</Button>
					</div>
				</>
			) : (
				<p className="text-xs text-muted-foreground">
					Read-only readiness. Only a Workspace Owner can verify or change
					lifecycle.
				</p>
			)}
			<div className="text-xs space-y-2 break-words">
				<p>
					Last observed: {evidence.checkedAt ?? "Not checked"} · Routing DNS:{" "}
					{evidence.routingDns ? "passed" : "not verified"} · Sending DNS:{" "}
					{evidence.sendingDns ? "passed" : "not verified"}
				</p>
				<p>
					Saved dashboard confirmations: Routing{" "}
					{evidence.routingConfirmed ? "yes" : "no"} · Sending{" "}
					{evidence.sendingConfirmed ? "yes" : "no"}
				</p>
				{Object.entries(evidence.records ?? {}).map(([key, values]) => (
					<div key={key}>
						<strong>{key}</strong>
						<p className="font-mono break-all">
							{values.join("; ") ||
								"No records observed (missing or lookup failed)"}
						</p>
					</div>
				))}
			</div>
			{mutation.isError ? (
				<p role="alert" className="text-sm text-red-600">
					{mutation.error.message}
				</p>
			) : null}
		</article>
	);
}
function MailboxControls({
	mailbox: m,
	owner,
	currentUserId,
	users,
	workspaceId,
	refresh,
}: {
	mailbox: MailboxSummary;
	owner: boolean;
	currentUserId: string;
	users: { id: string; name: string }[];
	workspaceId: string;
	refresh: () => Promise<void>;
}) {
	const [delegate, setDelegate] = useState("");
	const canDelegate = m.type === "private" && m.ownerUserId === currentUserId;
	const mutation = useMutation({
		mutationFn: (fn: () => Promise<unknown>) => fn(),
		onSuccess: refresh,
	});
	return (
		<article className="rounded-lg border p-3 space-y-2 text-sm">
			<h4 className="font-semibold">
				{m.canonicalAddress} · {m.type}
			</h4>
			<p>
				Receiving {m.isEnabled ? "enabled" : "disabled"} · Sending{" "}
				{m.isSendEnabled ? "enabled" : "disabled"}
			</p>
			<p className="text-xs text-muted-foreground">
				{m.type === "private"
					? `Owner: ${users.find((u) => u.id === m.ownerUserId)?.name ?? m.ownerUserId}`
					: `Inbox: ${m.inboxId} · Team: ${m.teamId ?? "inbox membership"}`}
			</p>
			{owner ? (
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate(() =>
								emailApi.mailboxState(workspaceId, m.id, {
									isEnabled: !m.isEnabled,
								}),
							)
						}
					>
						{m.isEnabled ? "Disable receiving" : "Enable receiving"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate(() =>
								emailApi.mailboxState(workspaceId, m.id, {
									isSendEnabled: !m.isSendEnabled,
								}),
							)
						}
					>
						{m.isSendEnabled ? "Disable sending" : "Enable sending"}
					</Button>
				</div>
			) : null}
			{canDelegate ? (
				<div className="space-y-2">
					<p>Private mailbox owner delegation</p>
					<p className="text-xs text-muted-foreground">
						Grants read and send-as. The API does not expose a current-grants
						list; select an Agent to explicitly grant or revoke. Workspace role
						alone grants no private access.
					</p>
					<select
						aria-label={`Delegate for ${m.canonicalAddress}`}
						className={field}
						value={delegate}
						onChange={(e) => setDelegate(e.target.value)}
					>
						<option value="">Choose Agent…</option>
						{users
							.filter((u) => u.id !== currentUserId)
							.map((u) => (
								<option key={u.id} value={u.id}>
									{u.name}
								</option>
							))}
					</select>
					<Button
						size="sm"
						variant="outline"
						disabled={!delegate || mutation.isPending}
						onClick={() => {
							if (
								confirm(
									`Grant read and send-as on ${m.canonicalAddress} to the selected Agent?`,
								)
							)
								mutation.mutate(() =>
									emailApi.grant(workspaceId, m.id, delegate),
								);
						}}
					>
						Grant access
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!delegate || mutation.isPending}
						onClick={() => {
							if (
								confirm(
									`Revoke the selected Agent’s access to ${m.canonicalAddress}?`,
								)
							)
								mutation.mutate(() =>
									emailApi.revoke(workspaceId, m.id, delegate),
								);
						}}
					>
						Revoke access
					</Button>
				</div>
			) : null}
			{mutation.isSuccess ? (
				<p role="status">Request completed. Configuration refreshed.</p>
			) : null}
			{mutation.isError ? (
				<p role="alert" className="text-red-600">
					{mutation.error.message}
				</p>
			) : null}
		</article>
	);
}
function BulkProvision({
	workspaceId,
	domains,
	refresh,
}: {
	workspaceId: string;
	domains: Domain[];
	refresh: () => Promise<void>;
}) {
	const [domain, setDomain] = useState("");
	const [rows, setRows] = useState<PreviewRow[] | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [reviewed, setReviewed] = useState(false);
	const [assigned, setAssigned] = useState<string[]>([]);
	const preview = useMutation({
		mutationFn: () =>
			emailApi.preview(workspaceId, {
				emailDomainId: domain,
				userIds: [],
				excludeUserIds: [],
			}),
		onSuccess: (result) => {
			setRows(result.preview);
			setSelected([]);
			setReviewed(false);
			setAssigned([]);
		},
	});
	const commit = useMutation({
		mutationFn: () =>
			emailApi.provision(workspaceId, {
				emailDomainId: domain,
				userIds: selected,
				excludeUserIds: (rows ?? [])
					.filter((r) => !selected.includes(r.userId))
					.map((r) => r.userId),
			}),
		onSuccess: async (result) => {
			setAssigned(result.mailboxes.map((m) => m.canonicalAddress));
			setRows(null);
			setSelected([]);
			setReviewed(false);
			await refresh();
		},
		onError: () => {
			setRows(null);
			setReviewed(false);
		},
	});
	return (
		<details className="rounded-lg border p-4">
			<summary className="font-semibold">Bulk private assignment</summary>
			<div className="mt-3 space-y-3 text-sm">
				<p>
					Preview workspace Agents and collisions. Only checked eligible rows
					will be created; all other rows are explicit exclusions. Nothing is
					automatically enabled.
				</p>
				<select
					className={field}
					aria-label="Bulk domain"
					value={domain}
					onChange={(e) => {
						setDomain(e.target.value);
						setRows(null);
						setReviewed(false);
						setSelected([]);
						setAssigned([]);
					}}
					disabled={preview.isPending || commit.isPending}
				>
					<option value="">Choose domain…</option>
					{domains.map((d) => (
						<option key={d.id} value={d.id}>
							{d.canonicalDomain}
						</option>
					))}
				</select>
				<Button
					size="sm"
					variant="outline"
					disabled={!domain || preview.isPending || commit.isPending}
					onClick={() => preview.mutate()}
				>
					Preview assignments
				</Button>
				{rows?.map((r) => (
					<div key={r.userId} className="border-b py-2">
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								disabled={!r.eligible || commit.isPending}
								checked={selected.includes(r.userId)}
								onChange={(e) => {
									setSelected(
										e.target.checked
											? [...selected, r.userId]
											: selected.filter((id) => id !== r.userId),
									);
									setReviewed(false);
								}}
							/>
							<span>
								{r.username ?? r.userId} → {r.canonicalAddress ?? "No address"}{" "}
								·{" "}
								{r.eligible
									? selected.includes(r.userId)
										? "will create"
										: "excluded"
									: r.reason}
							</span>
						</label>
						{r.reason === "username missing or invalid" ? (
							<LegacyUsername
								workspaceId={workspaceId}
								userId={r.userId}
								onChanged={() => {
									setRows(null);
									setReviewed(false);
									void refresh();
								}}
							/>
						) : null}
					</div>
				))}
				{rows ? (
					<>
						<label className="flex gap-2">
							<input
								type="checkbox"
								checked={reviewed}
								disabled={commit.isPending}
								onChange={(e) => setReviewed(e.target.checked)}
							/>
							I reviewed these exact selections and exclusions.
						</label>
						<Button
							size="sm"
							disabled={
								!reviewed ||
								!selected.length ||
								selected.length > 100 ||
								commit.isPending ||
								preview.isPending
							}
							onClick={() => {
								if (
									confirm(
										`Create ${selected.length} private mailboxes? Every unchecked or colliding account is excluded. The server rechecks eligibility atomically.`,
									)
								)
									commit.mutate();
							}}
						>
							Commit reviewed assignments ({selected.length}/100)
						</Button>
					</>
				) : null}
				{assigned.length ? (
					<div role="status">
						Created disabled mailboxes:
						<ul>
							{assigned.map((address) => (
								<li key={address}>{address}</li>
							))}
						</ul>
					</div>
				) : null}
				{preview.isError || commit.isError ? (
					<p role="alert" className="text-red-600">
						{preview.error?.message ?? commit.error?.message} Preview again
						before retrying.
					</p>
				) : null}
			</div>
		</details>
	);
}
function LegacyUsername({
	workspaceId,
	userId,
	onChanged,
}: {
	workspaceId: string;
	userId: string;
	onChanged: () => void;
}) {
	const [username, setUsername] = useState("");
	const mutation = useMutation({
		mutationFn: () => emailApi.username(workspaceId, userId, username),
		onSuccess: onChanged,
	});
	return (
		<div className="mt-2 flex flex-wrap gap-2">
			<input
				className={field}
				aria-label={`Immutable username for ${userId}`}
				placeholder="Immutable username"
				value={username}
				onChange={(e) => setUsername(e.target.value)}
			/>
			<Button
				size="sm"
				variant="outline"
				disabled={!username || mutation.isPending}
				onClick={() => {
					if (
						confirm(
							`Permanently assign username ${username}? It cannot be changed later.`,
						)
					)
						mutation.mutate();
				}}
			>
				Assign username
			</Button>
			{mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
		</div>
	);
}
function Operations({
	workspaceId,
	owner,
}: {
	workspaceId: string;
	owner: boolean;
}) {
	const operations = useQuery({
		queryKey: ["email-operations", workspaceId],
		queryFn: () => emailApi.operations(workspaceId),
		refetchInterval: 15000,
	});
	const replay = useMutation({
		mutationFn: (id: string) => emailApi.replay(workspaceId, id),
		onSuccess: async () => {
			await operations.refetch();
		},
	});
	return (
		<details className="rounded-lg border p-4">
			<summary className="font-semibold">
				Email operations · quarantine and audit
			</summary>
			<div className="mt-3 space-y-3 text-sm">
				<p>
					Only authorized mailbox metadata is returned. Quarantined records are
					not replayable. Replay resumes eligible durable inbound records, not
					outbound sends.
				</p>
				<Button
					size="sm"
					variant="outline"
					onClick={() => void operations.refetch()}
				>
					Refresh operations
				</Button>
				{operations.isPending ? <p>Loading…</p> : null}
				{operations.isError ? (
					<p role="alert">{operations.error.message}</p>
				) : null}
				{operations.data ? (
					<>
						<p>
							{Object.entries(operations.data.counts)
								.map(([state, count]) => `${state}: ${count}`)
								.join(" · ")}{" "}
							(returned window)
						</p>
						<p>
							Message limit: {operations.data.limits.messageBytes} bytes.{" "}
							{operations.data.limits.providerQuota}
						</p>
						<h4 className="font-semibold">Inbound / quarantine</h4>
						{!operations.data.ingress.length ? (
							<p>No outstanding ingress visible to you.</p>
						) : null}
						{operations.data.ingress.map((i) => (
							<div key={i.id} className="rounded border p-2 break-words">
								<p>
									{i.address} · {i.state} · attempts {i.attempts}
								</p>
								<p className="text-xs">
									{i.id} · {i.receivedAt} · {i.error ?? "No error recorded"}
								</p>
								{owner &&
								["stored", "failed", "processing"].includes(i.state) ? (
									<Button
										size="sm"
										variant="outline"
										disabled={replay.isPending}
										onClick={() => {
											if (
												confirm(
													`Replay inbound ${i.id} after correcting its cause? Active leases may produce no attempt.`,
												)
											)
												replay.mutate(i.id);
										}}
									>
										Replay ingress
									</Button>
								) : null}
							</div>
						))}
						<h4 className="font-semibold">Audit (latest visible events)</h4>
						{!operations.data.audit.length ? (
							<p>No audit events visible.</p>
						) : null}
						{operations.data.audit.map((a) => (
							<p className="text-xs break-words" key={a.id}>
								{a.createdAt} · {a.action} · actor {a.actorUserId ?? "system"} ·{" "}
								{a.targetId}
							</p>
						))}
					</>
				) : null}
				{replay.data ? (
					<p role="status">
						Replay attempted {replay.data.attempted}; processed{" "}
						{replay.data.processed}.{" "}
						{replay.data.attempted === 0
							? "No eligible record was available; check state or active lease."
							: "Operational state refreshed."}
					</p>
				) : null}
				{replay.isError ? (
					<p role="alert" className="text-red-600">
						{replay.error.message}
					</p>
				) : null}
			</div>
		</details>
	);
}
function Invitation({ workspaceId }: { workspaceId: string }) {
	const [email, setEmail] = useState("");
	const invite = useMutation({
		mutationFn: () => emailApi.invite(workspaceId, email.trim()),
	});
	return (
		<details className="rounded-lg border p-4">
			<summary className="font-semibold">Invite an Agent</summary>
			<form
				className="mt-3 space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					invite.mutate();
				}}
			>
				<p className="text-sm">
					A verified Workspace Owner can invite a recovery email. The Agent
					chooses an immutable username; membership does not automatically
					provision a mailbox.
				</p>
				<label className="block text-sm">
					Recovery email{" "}
					<input
						type="email"
						required
						className={field}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</label>
				<Button size="sm" disabled={invite.isPending || !email.trim()}>
					Create invitation
				</Button>
			</form>
			{invite.data ? (
				<div role="status" className="mt-3 space-y-2 text-sm">
					<p>
						{invite.data.data.delivery === "email_sent"
							? "Invitation email sent."
							: invite.data.data.delivery === "email_delivery_failed"
								? "Email delivery failed. Share the link securely instead."
								: "Email not sent. Share this link securely."}{" "}
						Expires {new Date(invite.data.data.expiresAt).toLocaleString()}.
					</p>
					<label className="block">
						Invitation link (sensitive)
						<input
							readOnly
							className={`${field} w-full`}
							value={invite.data.data.invitationUrl}
							onFocus={(e) => e.target.select()}
						/>
					</label>
				</div>
			) : null}
			{invite.isError ? (
				<p role="alert" className="text-red-600">
					{invite.error.message}
				</p>
			) : null}
		</details>
	);
}
