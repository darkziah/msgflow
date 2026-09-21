import type {
	ChannelSummary,
	InboxSummary,
	TagSummary,
	TagUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TAG_COLOR_OPTIONS, TagChip } from "@/components/inbox/TagChip";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
	return (
		<div className="mx-auto max-w-2xl px-6 py-8">
			<h1 className="text-2xl font-black">Settings</h1>
			<div className="mt-6 space-y-10">
				<InboxesSection />
				<ChannelsSection />
				<TagsSection />
			</div>
		</div>
	);
}

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

	return (
		<section>
			<h2 className="text-lg font-bold">Channels</h2>
			<p className="mt-1 text-sm text-gray-500">
				Connect a Facebook Page so replies can be sent. Email channels are
				routed through Cloudflare Email Service and need no token. Channels are
				created automatically when the first message arrives.
			</p>
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
						No channels yet — they appear here when the first message arrives.
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

	const canConnect = channel.type === "facebook_page" && !channel.hasToken;

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
						placeholder="Paste a Page access token"
						className="flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
					/>
					<Button
						type="submit"
						size="sm"
						disabled={connecting || !token.trim()}
					>
						{connecting ? "Saving…" : "Connect"}
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
