import type {
	ChannelSummary,
	InboxSummary,
	TagSummary,
	TagUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EmailAdmin } from "@/components/email-admin";
import { TAG_COLOR_OPTIONS, TagChip } from "@/components/inbox/TagChip";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
	const navigate = useNavigate();
	const [tab, setTab] = useState<SettingsTab>("email");
	const tabs: { id: SettingsTab; label: string; detail: string }[] = [
		{
			id: "email",
			label: "Email pilot",
			detail: "Domains, mailboxes, DNS readiness and operations",
		},
		{
			id: "inboxes",
			label: "Inboxes",
			detail: "Shared queues, channel links and default routing",
		},
		{
			id: "channels",
			label: "Channels",
			detail: "Facebook Page connection state and access tokens",
		},
		{
			id: "tags",
			label: "Tags",
			detail: "Conversation labels and filtering",
		},
	];
	return (
		<div className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[1px]">
			<button
				type="button"
				aria-label="Close settings"
				className="absolute inset-0 cursor-default"
				onClick={() => navigate({ to: "/" })}
			/>
			<aside
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-title"
				className="absolute inset-y-0 right-0 flex w-full max-w-6xl flex-col border-l bg-background shadow-2xl"
			>
				<header className="flex shrink-0 items-start justify-between gap-6 border-b px-6 py-5">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							Workspace control room
						</p>
						<h1 id="settings-title" className="mt-1 text-2xl font-black">
							Settings
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Changes are server-authorized. Email DNS and Cloudflare actions
							stay operator-controlled.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => navigate({ to: "/" })}
					>
						Close settings
					</Button>
				</header>
				<div className="flex min-h-0 flex-1">
					<div
						aria-label="Settings sections"
						className="w-64 shrink-0 border-r bg-muted/20 p-3"
						role="tablist"
						aria-orientation="vertical"
					>
						{tabs.map((item) => (
							<button
								key={item.id}
								id={`settings-tab-${item.id}`}
								type="button"
								role="tab"
								aria-selected={tab === item.id}
								aria-controls={`settings-panel-${item.id}`}
								onClick={() => setTab(item.id)}
								className={cn(
									"mb-1 w-full rounded-lg px-3 py-3 text-left transition-colors",
									tab === item.id
										? "bg-background shadow-sm ring-1 ring-border"
										: "text-muted-foreground hover:bg-background/70 hover:text-foreground",
								)}
							>
								<span className="block text-sm font-semibold">
									{item.label}
								</span>
								<span className="mt-1 block text-xs leading-4">
									{item.detail}
								</span>
							</button>
						))}
					</div>
					<main className="min-w-0 flex-1 overflow-y-auto px-6 py-7 sm:px-8">
						<div
							id={`settings-panel-${tab}`}
							role="tabpanel"
							aria-labelledby={`settings-tab-${tab}`}
							className="mx-auto max-w-4xl"
						>
							{tab === "email" ? <EmailAdmin /> : null}
							{tab === "inboxes" ? <InboxesSection /> : null}
							{tab === "channels" ? <ChannelsSection /> : null}
							{tab === "tags" ? <TagsSection /> : null}
						</div>
					</main>
				</div>
			</aside>
		</div>
	);
}

type SettingsTab = "email" | "inboxes" | "channels" | "tags";

function InboxesSection() {
	const queryClient = useQueryClient();
	const { data, isPending } = useQuery({
		queryKey: ["inboxes"],
		queryFn: () => api.listInboxes(),
	});
	const { data: channelsData } = useQuery({
		queryKey: ["channels"],
		queryFn: () => api.listChannels(),
	});
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	const { mutate: create, isPending: creating } = useMutation({
		mutationFn: () => api.createInbox({ name: name.trim() }),
		onSuccess: () => {
			setName("");
			queryClient.invalidateQueries({ queryKey: ["inboxes"] });
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to create inbox.");
		},
	});

	return (
		<section>
			<h2 className="text-lg font-bold">Inboxes</h2>
			<p className="mt-1 text-sm text-gray-500">
				Shared queues that hold conversations. Every conversation sits in
				exactly one inbox; channels feed their default inbox unless a rule
				routes elsewhere.
			</p>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (name.trim()) create();
				}}
				className="mt-4 flex gap-2"
			>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="New inbox name (e.g. Sales)"
					className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
				<Button type="submit" size="sm" disabled={creating || !name.trim()}>
					{creating ? "Creating…" : "Create inbox"}
				</Button>
			</form>
			{error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

			<div className="mt-4 space-y-3">
				{isPending ? <p className="text-sm text-gray-400">Loading…</p> : null}
				{data && data.inboxes.length === 0 ? (
					<p className="text-sm text-gray-400">
						No inboxes yet — create one above.
					</p>
				) : null}
				{data?.inboxes.map((inbox) => (
					<InboxRow
						key={inbox.id}
						inbox={inbox}
						channels={channelsData?.channels ?? []}
						onChanged={() => {
							queryClient.invalidateQueries({ queryKey: ["inboxes"] });
							queryClient.invalidateQueries({ queryKey: ["channels"] });
						}}
					/>
				))}
			</div>
		</section>
	);
}

function InboxRow({
	inbox,
	channels,
	onChanged,
}: {
	inbox: InboxSummary;
	channels: ChannelSummary[];
	onChanged: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(inbox.name);
	const [linkChannelId, setLinkChannelId] = useState("");

	const { mutate: rename, isPending: renaming } = useMutation({
		mutationFn: () => api.updateInbox(inbox.id, { name: name.trim() }),
		onSuccess: () => {
			setEditing(false);
			onChanged();
		},
	});
	const { mutate: remove, isPending: removing } = useMutation({
		mutationFn: () => api.deleteInbox(inbox.id),
		onSuccess: onChanged,
	});
	const { mutate: link, isPending: linking } = useMutation({
		mutationFn: (channelId: string) =>
			api.linkChannelToInbox(inbox.id, { channelId, isDefault: true }),
		onSuccess: () => {
			setLinkChannelId("");
			onChanged();
		},
	});
	const { mutate: unlink } = useMutation({
		mutationFn: (channelId: string) =>
			api.unlinkChannelFromInbox(inbox.id, channelId),
		onSuccess: onChanged,
	});

	const unlinkedChannels = channels.filter(
		(channel) => !inbox.channels.some((link) => link.channelId === channel.id),
	);

	return (
		<div className="rounded-lg border p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					{editing ? (
						<div className="flex items-center gap-2">
							<input
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
							/>
							<Button
								size="sm"
								disabled={renaming || !name.trim()}
								onClick={() => rename()}
							>
								Save
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setEditing(false)}
							>
								Cancel
							</Button>
						</div>
					) : (
						<p className="font-semibold">{inbox.name}</p>
					)}
					<p className="text-xs text-gray-500">
						{inbox.conversationCount} conversation
						{inbox.conversationCount === 1 ? "" : "s"} · {inbox.channels.length}{" "}
						channel
						{inbox.channels.length === 1 ? "" : "s"} · {inbox.memberIds.length}{" "}
						member
						{inbox.memberIds.length === 1 ? "" : "s"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setName(inbox.name);
							setEditing(true);
						}}
					>
						Rename
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={removing}
						onClick={() => {
							if (
								confirm(
									`Delete inbox "${inbox.name}"? Its conversations move to another inbox.`,
								)
							) {
								remove();
							}
						}}
					>
						Delete
					</Button>
				</div>
			</div>

			{inbox.channels.length > 0 ? (
				<div className="mt-3 flex flex-wrap gap-2">
					{inbox.channels.map((link) => (
						<span
							key={link.channelId}
							className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
						>
							{link.channelDisplayName}
							{link.isDefault ? (
								<span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">
									default
								</span>
							) : null}
							<button
								type="button"
								onClick={() => unlink(link.channelId)}
								className="leading-none text-gray-400 hover:text-gray-600"
								aria-label={`Unlink ${link.channelDisplayName}`}
							>
								×
							</button>
						</span>
					))}
				</div>
			) : null}

			{unlinkedChannels.length > 0 ? (
				<div className="mt-3 flex gap-2">
					<select
						value={linkChannelId}
						onChange={(event) => setLinkChannelId(event.target.value)}
						className="flex-1 rounded-md border px-2 py-1.5 text-sm"
					>
						<option value="">Link a channel…</option>
						{unlinkedChannels.map((channel) => (
							<option key={channel.id} value={channel.id}>
								{channel.displayName}
							</option>
						))}
					</select>
					<Button
						size="sm"
						variant="outline"
						disabled={linking || !linkChannelId}
						onClick={() => link(linkChannelId)}
					>
						Link
					</Button>
				</div>
			) : null}
		</div>
	);
}

function ChannelsSection() {
	const queryClient = useQueryClient();
	const { data, isPending } = useQuery({
		queryKey: ["channels"],
		queryFn: () => api.listChannels(),
	});
	const { data: inboxesData } = useQuery({
		queryKey: ["inboxes"],
		queryFn: () => api.listInboxes(),
	});
	const { data: workspacesData } = useQuery({
		queryKey: ["workspaces"],
		queryFn: () => api.listWorkspaces(),
	});
	const workspaceId = workspacesData?.workspaces[0]?.id;
	const { data: metaAppsData } = useQuery({
		queryKey: ["meta-apps", workspaceId],
		queryFn: () => (workspaceId ? api.listMetaApps(workspaceId) : Promise.resolve({ metaApps: [] })),
		enabled: Boolean(workspaceId),
	});
	const [adding, setAdding] = useState(false);
	const [pageId, setPageId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [accessToken, setAccessToken] = useState("");
	const [inboxId, setInboxId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [metaAppId, setMetaAppId] = useState("");
	const [addingMetaApp, setAddingMetaApp] = useState(false);
	const [metaAppName, setMetaAppName] = useState("");
	const [metaAppPublicId, setMetaAppPublicId] = useState("");
	const [metaAppSecret, setMetaAppSecret] = useState("");
	const { mutate: createMetaApp, isPending: creatingMetaApp } = useMutation({
		mutationFn: () => {
			if (!workspaceId) throw new Error("Workspace not found.");
			return api.createMetaApp(workspaceId, { displayName: metaAppName.trim(), appId: metaAppPublicId.trim(), appSecret: metaAppSecret.trim() });
		},
		onSuccess: (result) => {
			setAddingMetaApp(false);
			setMetaAppName("");
			setMetaAppPublicId("");
			setMetaAppSecret("");
			setMetaAppId(result.metaApp.id);
			queryClient.invalidateQueries({ queryKey: ["meta-apps"] });
		},
		onError: (err) => setError(err instanceof Error ? err.message : "Unable to add Meta App."),
	});
	const { mutate: createPage, isPending: creating } = useMutation({
		mutationFn: () => {
			if (!workspaceId) throw new Error("Workspace not found.");
			return api.createFacebookChannel(workspaceId, {
				pageId: pageId.trim(),
				displayName: displayName.trim(),
				accessToken: accessToken.trim(),
				inboxId,
				metaAppId,
			});
		},
		onSuccess: () => {
			setAdding(false);
			setPageId("");
			setDisplayName("");
			setAccessToken("");
			setInboxId("");
			setError(null);
			queryClient.invalidateQueries({ queryKey: ["channels"] });
		},
		onError: (err) =>
			setError(err instanceof Error ? err.message : "Unable to add Page."),
	});

	return (
		<section>
			<h2 className="text-lg font-bold">Channels</h2>
			<p className="mt-1 text-sm text-gray-500">
				Each Facebook Page is an explicit Channel with one default shared Inbox.
				Email addresses are provisioned separately through Email pilot.
			</p>
			<div className="mt-4 rounded-xl border bg-muted/20 p-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-semibold">Meta Apps</p>
						<p className="text-sm text-muted-foreground">Add each Meta App once. Developers/testers of a development-mode App can connect its Pages without App Review.</p>
					</div>
					<Button type="button" size="sm" variant="outline" onClick={() => setAddingMetaApp((current) => !current)}>{addingMetaApp ? "Cancel" : "Add Meta App"}</Button>
				</div>
				{addingMetaApp ? (
					<form onSubmit={(event) => { event.preventDefault(); createMetaApp(); }} className="mt-4 grid gap-3 sm:grid-cols-3">
						<input required value={metaAppName} onChange={(event) => setMetaAppName(event.target.value)} placeholder="App display name" className="rounded-md border bg-background px-3 py-2 text-sm" />
						<input required value={metaAppPublicId} onChange={(event) => setMetaAppPublicId(event.target.value)} placeholder="Meta App ID" className="rounded-md border bg-background px-3 py-2 text-sm" />
						<input required type="password" value={metaAppSecret} onChange={(event) => setMetaAppSecret(event.target.value)} placeholder="Meta App secret" className="rounded-md border bg-background px-3 py-2 text-sm" />
						<div className="sm:col-span-3 flex justify-end"><Button type="submit" size="sm" disabled={creatingMetaApp || !workspaceId || !metaAppName.trim() || !metaAppPublicId.trim() || !metaAppSecret.trim()}>{creatingMetaApp ? "Saving…" : "Save Meta App"}</Button></div>
					</form>
				) : null}
			</div>
			<div className="mt-4 rounded-xl border bg-muted/20 p-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-semibold">Facebook Messenger Page</p>
						<p className="text-sm text-muted-foreground">
							The Page token is encrypted and never shown again.
						</p>
					</div>
					<Button
						type="button"
						size="sm"
						onClick={() => setAdding((current) => !current)}
					>
						{adding ? "Cancel" : "Add Page channel"}
					</Button>
				</div>
				{adding ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							createPage();
						}}
						className="mt-4 grid gap-3 sm:grid-cols-2"
					>
						<input
							required
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder="Page display name"
							className="rounded-md border bg-background px-3 py-2 text-sm"
						/>
						<input
							required
							value={pageId}
							onChange={(event) => setPageId(event.target.value)}
							placeholder="Meta Page ID"
							className="rounded-md border bg-background px-3 py-2 text-sm"
						/>
						<select
							required
							value={metaAppId}
							onChange={(event) => setMetaAppId(event.target.value)}
							className="rounded-md border bg-background px-3 py-2 text-sm"
						>
							<option value="">Select Meta App</option>
							{metaAppsData?.metaApps.map((app) => (
								<option key={app.id} value={app.id}>{app.displayName} · {app.appId}</option>
							))}
						</select>
						<select
							required
							value={inboxId}
							onChange={(event) => setInboxId(event.target.value)}
							className="rounded-md border bg-background px-3 py-2 text-sm"
						>
							<option value="">Select shared Inbox</option>
							{inboxesData?.inboxes
								.filter((inbox) => !inbox.isArchived)
								.map((inbox) => (
									<option key={inbox.id} value={inbox.id}>
										{inbox.name}
									</option>
								))}
						</select>
						<input
							required
							type="password"
							value={accessToken}
							onChange={(event) => setAccessToken(event.target.value)}
							placeholder="Page access token"
							className="rounded-md border bg-background px-3 py-2 text-sm"
						/>
						<div className="sm:col-span-2 flex items-center justify-between gap-3">
							<p className="text-xs text-muted-foreground">
								Disconnecting retains history but stops new traffic and replies.
							</p>
							<Button
								type="submit"
								size="sm"
								disabled={
									creating ||
									!workspaceId ||
									!metaAppId ||
									!inboxId ||
									!pageId.trim() ||
									!displayName.trim() ||
									!accessToken.trim()
								}
							>
								{creating ? "Connecting…" : "Connect Page"}
							</Button>
						</div>
					</form>
				) : null}
				{error ? (
					<p className="mt-3 text-sm text-destructive">{error}</p>
				) : null}
			</div>
			<div className="mt-4 space-y-4">
				{isPending ? <p className="text-sm text-gray-400">Loading…</p> : null}
				{data?.channels.map((channel) => (
					<ChannelRow
						key={channel.id}
						channel={channel}
						onChanged={() =>
							queryClient.invalidateQueries({ queryKey: ["channels"] })
						}
					/>
				))}
				{data && data.channels.length === 0 ? (
					<p className="text-sm text-gray-400">
						No channels yet — add a Facebook Page above or provision an email
						Mailbox.
					</p>
				) : null}
			</div>
		</section>
	);
}

function ChannelRow({
	channel,
	onChanged,
}: {
	channel: ChannelSummary;
	onChanged: () => void;
}) {
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);

	const { mutate: connect, isPending: connecting } = useMutation({
		mutationFn: () => api.connectChannel(channel.id, token.trim()),
		onSuccess: () => {
			setToken("");
			setError(null);
			onChanged();
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Connection failed.");
		},
	});
	const { mutate: disconnect, isPending: disconnecting } = useMutation({
		mutationFn: () => api.disconnectChannel(channel.id),
		onSuccess: onChanged,
	});

	const canConnect = channel.type === "facebook_page";

	return (
		<div className="rounded-lg border p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-semibold">{channel.displayName}</p>
					<p className="truncate text-xs text-gray-500">
						{channel.type === "facebook_page" ? "Facebook Page" : "Email"} ·{" "}
						{channel.externalId}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span
						className={cn(
							"rounded-full px-2 py-0.5 text-[11px] font-semibold",
							channel.hasToken
								? "bg-green-100 text-green-700"
								: "bg-gray-100 text-gray-500",
						)}
					>
						{channel.hasToken
							? "Connected"
							: channel.status === "disconnected"
								? "Disconnected"
								: "Not connected"}
					</span>
					{channel.hasToken ? (
						<Button
							variant="outline"
							size="sm"
							disabled={disconnecting}
							onClick={() => disconnect()}
						>
							Disconnect
						</Button>
					) : null}
				</div>
			</div>
			{canConnect ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						connect();
					}}
					className="mt-3 flex gap-2"
				>
					<input
						value={token}
						onChange={(event) => setToken(event.target.value)}
						placeholder={
							channel.hasToken
								? "Paste a replacement Page access token"
								: "Paste a Page access token"
						}
						className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
					/>
					<Button
						type="submit"
						size="sm"
						disabled={connecting || !token.trim()}
					>
						{connecting
							? "Saving…"
							: channel.hasToken
								? "Rotate token"
								: "Connect"}
					</Button>
				</form>
			) : null}
			{error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
		</div>
	);
}

function TagsSection() {
	const queryClient = useQueryClient();
	const { data, isPending } = useQuery({
		queryKey: ["tags"],
		queryFn: () => api.listTags(),
	});
	const [name, setName] = useState("");
	const [color, setColor] = useState("blue");

	const { mutate: create, isPending: creating } = useMutation({
		mutationFn: () => api.createTag({ name: name.trim(), color }),
		onSuccess: () => {
			setName("");
			setColor("blue");
			queryClient.invalidateQueries({ queryKey: ["tags"] });
		},
		onError: (err) => {
			alert(err instanceof Error ? err.message : "Failed to create tag.");
		},
	});

	return (
		<section>
			<h2 className="text-lg font-bold">Tags</h2>
			<p className="mt-1 text-sm text-gray-500">
				Labels you can attach to conversations and use as search filters.
			</p>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (name.trim()) create();
				}}
				className="mt-4 flex flex-wrap items-center gap-2"
			>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="New tag name"
					className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
				<select
					value={color}
					onChange={(event) => setColor(event.target.value)}
					className="rounded-md border px-2 py-1.5 text-sm"
				>
					{TAG_COLOR_OPTIONS.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
				<Button type="submit" size="sm" disabled={creating || !name.trim()}>
					{creating ? "Creating…" : "Create tag"}
				</Button>
			</form>

			<div className="mt-4 space-y-2">
				{isPending ? <p className="text-sm text-gray-400">Loading…</p> : null}
				{data && data.tags.length === 0 ? (
					<p className="text-sm text-gray-400">
						No tags yet — create one above.
					</p>
				) : null}
				{data?.tags.map((tag) => (
					<TagRow
						key={tag.id}
						tag={tag}
						onChanged={() =>
							queryClient.invalidateQueries({ queryKey: ["tags"] })
						}
					/>
				))}
			</div>
		</section>
	);
}

function TagRow({
	tag,
	onChanged,
}: {
	tag: TagSummary;
	onChanged: () => void;
}) {
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(tag.name);
	const [color, setColor] = useState(tag.color ?? "gray");

	const { mutate: update, isPending: updating } = useMutation({
		mutationFn: () =>
			api.updateTag(tag.id, {
				name: name.trim(),
				color,
			} satisfies TagUpdateRequest),
		onSuccess: () => {
			setEditing(false);
			queryClient.invalidateQueries({ queryKey: ["tags"] });
			onChanged();
		},
		onError: (err) => {
			alert(err instanceof Error ? err.message : "Failed to update tag.");
		},
	});
	const { mutate: remove, isPending: removing } = useMutation({
		mutationFn: () => api.deleteTag(tag.id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["tags"] });
			onChanged();
		},
	});

	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
			{editing ? (
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
						className="flex-1 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/50"
					/>
					<select
						value={color}
						onChange={(event) => setColor(event.target.value)}
						className="rounded-md border px-2 py-1 text-sm"
					>
						{TAG_COLOR_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
					<Button
						size="sm"
						disabled={updating || !name.trim()}
						onClick={() => update()}
					>
						Save
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
						Cancel
					</Button>
				</div>
			) : (
				<TagChip tag={{ ...tag, name: tag.name, color }} />
			)}
			<div className="flex shrink-0 items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setName(tag.name);
						setColor(tag.color ?? "gray");
						setEditing(true);
					}}
				>
					Edit
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={removing}
					onClick={() => {
						if (confirm(`Delete tag "${tag.name}"?`)) remove();
					}}
				>
					Delete
				</Button>
			</div>
		</div>
	);
}
