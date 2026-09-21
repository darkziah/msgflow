import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
	BadgeDollarSign,
	Briefcase,
	Headphones,
	Inbox as InboxIcon,
	ReceiptText,
	X,
} from "lucide-react";
import {
	INBOX_ASSIGNMENT_STRATEGIES,
	INBOX_COLOR_PRESETS,
	INBOX_ICON_KEYS,
	type InboxCreateRequest,
	type InboxIconKey,
} from "@msgflow/contracts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const ICON_COMPONENTS: Record<InboxIconKey, typeof InboxIcon> = {
	inbox: InboxIcon,
	headphones: Headphones,
	"receipt-text": ReceiptText,
	"badge-dollar-sign": BadgeDollarSign,
	briefcase: Briefcase,
};

export interface InboxSettingsDrawerProps {
	workspaceId: string;
	/** null = create mode. */
	inboxId: string | null;
	onClose: () => void;
	onChanged: () => void;
}

export function InboxSettingsDrawer({
	workspaceId,
	inboxId,
	onClose,
	onChanged,
}: InboxSettingsDrawerProps) {
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const { data: inboxesData } = useQuery({
		queryKey: ["workspace-inboxes", workspaceId],
		queryFn: () => api.workspaceListInboxes(workspaceId),
	});
	// The drawer works off the workspace-scoped list; fall back to legacy list.
	const inbox = useMemo(
		() => inboxesData?.inboxes.find((row) => row.id === inboxId) ?? null,
		[inboxesData, inboxId],
	);

	const { data: channelsData } = useQuery({
		queryKey: ["channels"],
		queryFn: () => api.listChannels(),
	});
	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});
	const { data: teamsData } = useQuery({
		queryKey: ["teams", workspaceId],
		queryFn: () => api.listTeams(workspaceId),
	});
	const { data: rulesData } = useQuery({
		queryKey: ["rules"],
		queryFn: () => api.listRules(),
	});

	// Form state (create defaults; edit hydrates from the fetched inbox).
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [color, setColor] = useState("#64748B");
	const [customColor, setCustomColor] = useState("#64748B");
	const [icon, setIcon] = useState<InboxIconKey | null>(null);
	const [iconSearch, setIconSearch] = useState("");
	const [teamId, setTeamId] = useState<string>("");
	const [strategy, setStrategy] = useState<string>("manual");
	const [memberToAdd, setMemberToAdd] = useState("");
	const [channelToLink, setChannelToLink] = useState("");

	useEffect(() => {
		if (!inbox) return;
		setName(inbox.name);
		setDescription(inbox.description ?? "");
		setColor(inbox.color);
		setCustomColor(inbox.color);
		setIcon(inbox.icon as InboxIconKey | null);
		setTeamId(inbox.teamId ?? "");
		setStrategy(inbox.assignmentStrategy);
	}, [inbox]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const effectiveColor = HEX_COLOR.test(customColor) ? customColor : color;

	async function save() {
		setSaving(true);
		setError(null);
		try {
			const body: InboxCreateRequest = {
				name: name.trim(),
				description: description.trim() || null,
				color: effectiveColor,
				icon,
				teamId: teamId || null,
				assignmentStrategy:
					strategy as InboxCreateRequest["assignmentStrategy"],
			};
			if (inbox) {
				await api.workspaceUpdateInbox(workspaceId, inbox.id, body);
			} else {
				await api.workspaceCreateInbox(workspaceId, body);
			}
			onChanged();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Save failed.");
		} finally {
			setSaving(false);
		}
	}

	async function archive() {
		if (!inbox) return;
		if (
			!confirm(
				`Archive inbox "${inbox.name}"? Its conversations stay in it until reassigned.`,
			)
		)
			return;
		setError(null);
		try {
			await api.archiveInbox(workspaceId, inbox.id);
			onChanged();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Archive failed.");
		}
	}

	async function addMember(userId: string) {
		if (!inbox || !userId) return;
		setError(null);
		try {
			await api.addInboxMember(inbox.id, userId);
			setMemberToAdd("");
			onChanged();
			queryClient.invalidateQueries({
				queryKey: ["workspace-inboxes", workspaceId],
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Add member failed.");
		}
	}

	async function removeMember(userId: string) {
		if (!inbox) return;
		setError(null);
		try {
			await api.removeInboxMember(inbox.id, userId);
			onChanged();
			queryClient.invalidateQueries({
				queryKey: ["workspace-inboxes", workspaceId],
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Remove member failed.");
		}
	}

	async function linkChannel(channelId: string) {
		if (!inbox || !channelId) return;
		setError(null);
		try {
			await api.workspaceLinkChannel(workspaceId, inbox.id, { channelId });
			setChannelToLink("");
			onChanged();
			queryClient.invalidateQueries({
				queryKey: ["workspace-inboxes", workspaceId],
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Link failed.");
		}
	}

	async function unlinkChannel(channelId: string) {
		if (!inbox) return;
		setError(null);
		try {
			await api.workspaceUnlinkChannel(workspaceId, inbox.id, channelId);
			onChanged();
			queryClient.invalidateQueries({
				queryKey: ["workspace-inboxes", workspaceId],
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unlink failed.");
		}
	}

	async function makeDefault(channelId: string) {
		if (!inbox) return;
		setError(null);
		try {
			await api.setDefaultInbox(workspaceId, channelId, inbox.id);
			onChanged();
			queryClient.invalidateQueries({
				queryKey: ["workspace-inboxes", workspaceId],
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Make default failed.");
		}
	}

	const memberIds = new Set(inbox?.memberIds ?? []);
	const linkedChannelIds = new Set(
		inbox?.channels.map((link) => link.channelId) ?? [],
	);
	const linkedChannels = inbox?.channels ?? [];
	const unlinkedChannels =
		channelsData?.channels.filter(
			(channel) => !linkedChannelIds.has(channel.id),
		) ?? [];
	const memberOptions =
		usersData?.users.filter((user) => !memberIds.has(user.id)) ?? [];
	const filteredIcons = INBOX_ICON_KEYS.filter((key) =>
		key.replace(/-/g, " ").includes(iconSearch.trim().toLowerCase()),
	);
	const affectingRules =
		rulesData?.rules.filter((rule) => rule.inboxId === inbox?.id) ?? [];

	return (
		<div className="fixed inset-0 z-50">
			<button
				type="button"
				aria-label="Close inbox settings"
				onClick={onClose}
				className="absolute inset-0 h-full w-full cursor-default bg-black/30"
			/>
			<div
				className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-background p-5 shadow-xl"
				role="dialog"
				aria-modal="true"
			>
				<div className="flex items-center justify-between">
					<h2 className="text-lg font-bold">
						{inbox ? `Edit ${inbox.name}` : "New inbox"}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-gray-400 hover:bg-accent"
						aria-label="Close"
					>
						<X size={18} />
					</button>
				</div>

				{error ? (
					<p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
						{error}
					</p>
				) : null}

				<div className="mt-4 space-y-6">
					{/* Name + description */}
					<section>
						<label
							htmlFor="inbox-name"
							className="text-xs font-bold uppercase tracking-wide text-gray-500"
						>
							Name *
						</label>
						<input
							id="inbox-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. Sales Leads"
							className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
						/>
						<label
							htmlFor="inbox-description"
							className="mt-3 block text-xs font-bold uppercase tracking-wide text-gray-500"
						>
							Description
						</label>
						<textarea
							id="inbox-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="What lands here?"
							rows={2}
							className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
						/>
					</section>

					{/* Color */}
					<section>
						<label
							htmlFor="inbox-color"
							className="text-xs font-bold uppercase tracking-wide text-gray-500"
						>
							Color
						</label>
						<div className="mt-1 flex flex-wrap items-center gap-2">
							{INBOX_COLOR_PRESETS.map((preset) => (
								<button
									key={preset}
									type="button"
									onClick={() => {
										setColor(preset);
										setCustomColor(preset);
									}}
									className={cn(
										"h-6 w-6 rounded-full border-2 border-transparent",
										effectiveColor === preset && "border-gray-800",
									)}
									style={{ backgroundColor: preset }}
									aria-label={preset}
								/>
							))}
							<input
								id="inbox-color"
								value={customColor}
								onChange={(event) => setCustomColor(event.target.value)}
								placeholder="#RRGGBB"
								className={cn(
									"w-24 rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/50",
									!HEX_COLOR.test(customColor) && "border-red-400",
								)}
							/>
						</div>
					</section>

					{/* Icon */}
					<section>
						<label
							htmlFor="inbox-icon-search"
							className="text-xs font-bold uppercase tracking-wide text-gray-500"
						>
							Icon
						</label>
						<input
							id="inbox-icon-search"
							value={iconSearch}
							onChange={(event) => setIconSearch(event.target.value)}
							placeholder="Search icons…"
							className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
						/>
						<div className="mt-2 flex flex-wrap gap-2">
							{filteredIcons.map((key) => {
								const IconComponent = ICON_COMPONENTS[key];
								return (
									<button
										key={key}
										type="button"
										onClick={() => setIcon(key)}
										className={cn(
											"flex h-9 w-9 items-center justify-center rounded-md border",
											icon === key
												? "border-primary bg-primary/10 text-primary"
												: "text-gray-500 hover:bg-accent",
										)}
										title={key}
									>
										<IconComponent size={16} />
									</button>
								);
							})}
							<button
								type="button"
								onClick={() => setIcon(null)}
								className={cn(
									"flex h-9 items-center rounded-md border px-2 text-xs",
									icon === null
										? "border-primary bg-primary/10 text-primary"
										: "text-gray-500 hover:bg-accent",
								)}
							>
								Dot only
							</button>
						</div>
					</section>

					{/* Team + assignment strategy */}
					<section className="grid grid-cols-2 gap-3">
						<div>
							<label
								htmlFor="inbox-team"
								className="text-xs font-bold uppercase tracking-wide text-gray-500"
							>
								Team
							</label>
							<select
								id="inbox-team"
								value={teamId}
								onChange={(event) => setTeamId(event.target.value)}
								className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
							>
								<option value="">None</option>
								{teamsData?.teams.map((team) => (
									<option key={team.id} value={team.id}>
										{team.name}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor="inbox-strategy"
								className="text-xs font-bold uppercase tracking-wide text-gray-500"
							>
								Assignment
							</label>
							<select
								id="inbox-strategy"
								value={strategy}
								onChange={(event) => setStrategy(event.target.value)}
								className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
							>
								{INBOX_ASSIGNMENT_STRATEGIES.map((option) => (
									<option key={option} value={option}>
										{option.replace(/_/g, " ")}
									</option>
								))}
							</select>
						</div>
					</section>

					{/* Members */}
					{inbox ? (
						<section>
							<label
								htmlFor="inbox-member-add"
								className="text-xs font-bold uppercase tracking-wide text-gray-500"
							>
								Members
							</label>
							<div className="mt-1 flex gap-2">
								<select
									id="inbox-member-add"
									value={memberToAdd}
									onChange={(event) => setMemberToAdd(event.target.value)}
									className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
								>
									<option value="">Add a member…</option>
									{memberOptions.map((user) => (
										<option key={user.id} value={user.id}>
											{user.name || user.email}
										</option>
									))}
								</select>
								<Button
									size="sm"
									variant="outline"
									disabled={!memberToAdd}
									onClick={() => addMember(memberToAdd)}
								>
									Add
								</Button>
							</div>
							<ul className="mt-2 space-y-1">
								{usersData?.users
									.filter((user) => memberIds.has(user.id))
									.map((user) => (
										<li
											key={user.id}
											className="flex items-center justify-between rounded border px-2 py-1 text-sm"
										>
											<span className="truncate">
												{user.name || user.email}
											</span>
											<button
												type="button"
												onClick={() => removeMember(user.id)}
												className="text-xs text-gray-400 hover:text-red-500"
											>
												Remove
											</button>
										</li>
									))}
							</ul>
						</section>
					) : null}

					{/* Channels */}
					{inbox ? (
						<section>
							<label
								htmlFor="inbox-channel-link"
								className="text-xs font-bold uppercase tracking-wide text-gray-500"
							>
								Connected channels
							</label>
							<ul className="mt-1 space-y-1">
								{linkedChannels.map((link) => (
									<li
										key={link.channelId}
										className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
									>
										<span className="min-w-0 flex-1 truncate">
											{link.channelDisplayName}
										</span>
										{link.isDefault ? (
											<span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
												default
											</span>
										) : (
											<button
												type="button"
												onClick={() => makeDefault(link.channelId)}
												className="shrink-0 text-xs text-gray-400 hover:text-primary"
												title="Make this the channel's default inbox"
											>
												Make default
											</button>
										)}
										<button
											type="button"
											onClick={() => unlinkChannel(link.channelId)}
											className="shrink-0 text-xs text-gray-400 hover:text-red-500"
										>
											Unlink
										</button>
									</li>
								))}
							</ul>
							<div className="mt-2 flex gap-2">
								<select
									id="inbox-channel-link"
									value={channelToLink}
									onChange={(event) => setChannelToLink(event.target.value)}
									className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
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
									disabled={!channelToLink}
									onClick={() => linkChannel(channelToLink)}
								>
									Link
								</Button>
							</div>
							<p className="mt-2 text-[11px] text-gray-400">
								Unlinking a channel's only default inbox is rejected until a new
								default is chosen.
							</p>
						</section>
					) : null}

					{/* Routing rules */}
					{inbox ? (
						<section>
							<p className="text-xs font-bold uppercase tracking-wide text-gray-500">
								Routing rules for this inbox
							</p>
							{affectingRules.length === 0 ? (
								<p className="mt-1 text-sm text-gray-400">
									No rules target this inbox as their destination.
								</p>
							) : (
								<ul className="mt-1 space-y-1">
									{affectingRules.map((rule) => (
										<li
											key={rule.id}
											className="flex items-center justify-between rounded border px-2 py-1 text-sm"
										>
											<span className="truncate">{rule.name}</span>
											<span className="shrink-0 text-xs text-gray-400">
												priority {rule.priority}
											</span>
										</li>
									))}
								</ul>
							)}
							<Button
								className="mt-2"
								size="sm"
								variant="outline"
								onClick={() => {
									window.location.href = "/rules";
								}}
							>
								Manage rules
							</Button>
						</section>
					) : null}
				</div>

				<div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
					{inbox ? (
						<Button
							variant="outline"
							size="sm"
							className="text-red-600"
							onClick={archive}
						>
							Archive inbox
						</Button>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={onClose}>
							Cancel
						</Button>
						<Button size="sm" disabled={saving || !name.trim()} onClick={save}>
							{saving ? "Saving…" : inbox ? "Save changes" : "Create inbox"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
