import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	BadgeDollarSign,
	Briefcase,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	Headphones,
	Inbox as InboxIcon,
	MoreHorizontal,
	Plus,
	ReceiptText,
	Tag as TagIcon,
	User,
	Users,
	Zap,
} from "lucide-react";
import type {
	InboxIconKey,
	SidebarInboxItem,
	SidebarItem,
	SidebarPreferences,
	SidebarResponse,
	SidebarSection,
	WorkspaceSummary,
} from "@msgflow/contracts";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { applyPreferences, isSectionCollapsed } from "./sidebar-prefs";
import { InboxSettingsDrawer } from "./InboxSettingsDrawer";

export interface ListFilters {
	status?: "open" | "archived" | "all";
	inboxId?: string;
	q?: string;
	assigneeId?: string;
	unassigned?: boolean;
	snoozed?: boolean;
	channel?: "facebook" | "email";
	tagId?: string;
	dateFrom?: string;
	dateTo?: string;
}

const SYSTEM_ICONS: Record<string, typeof InboxIcon> = {
	"system:all": InboxIcon,
	"system:assigned-to-me": User,
	"system:unassigned": Users,
	"system:snoozed": Clock,
	"system:closed": CheckCircle2,
};

const INBOX_ICONS: Record<InboxIconKey, typeof InboxIcon> = {
	inbox: InboxIcon,
	headphones: Headphones,
	"receipt-text": ReceiptText,
	"badge-dollar-sign": BadgeDollarSign,
	briefcase: Briefcase,
};

export interface SidebarProps {
	workspaceId: string;
	workspaces: WorkspaceSummary[];
	currentUserId: string;
	activeFilters: ListFilters;
	onSelect: (filters: ListFilters) => void;
	onChangeWorkspace: (workspaceId: string) => void;
	compact: boolean;
	onToggleCompact: () => void;
}

export function Sidebar({
	workspaceId,
	workspaces,
	currentUserId,
	activeFilters,
	onSelect,
	onChangeWorkspace,
	compact,
	onToggleCompact,
}: SidebarProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [drawer, setDrawer] = useState<
		{ mode: "create" } | { mode: "edit"; inboxId: string } | null
	>(null);
	const [dragId, setDragId] = useState<string | null>(null);

	const { data: sidebar } = useQuery({
		queryKey: ["sidebar", workspaceId],
		queryFn: () => api.getSidebar(workspaceId),
		refetchInterval: 15000,
	});

	const prefs = sidebar?.preferences ?? emptyPrefs();

	const patchPrefs = (patch: Partial<SidebarPreferences>) => {
		const next: SidebarPreferences = {
			collapsedSections: patch.collapsedSections ?? prefs.collapsedSections,
			pinnedItemIds: patch.pinnedItemIds ?? prefs.pinnedItemIds,
			hiddenItemIds: patch.hiddenItemIds ?? prefs.hiddenItemIds,
			itemOrder: patch.itemOrder ?? prefs.itemOrder,
		};
		// Optimistic: roll back on failure (the PATCH returns the canonical state).
		queryClient.setQueryData(
			["sidebar", workspaceId],
			(old: SidebarResponse | undefined) =>
				old ? { ...old, preferences: next } : old,
		);
		api
			.updateSidebarPreferences(workspaceId, next)
			.then(({ preferences }) => {
				queryClient.setQueryData(
					["sidebar", workspaceId],
					(old: SidebarResponse | undefined) =>
						old ? { ...old, preferences } : old,
				);
			})
			.catch(() => {
				queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] });
			});
	};

	const toggleSection = (section: SidebarSection) => {
		const collapsed = isSectionCollapsed(section, prefs);
		const next = collapsed
			? prefs.collapsedSections.filter((key) => key !== section.key)
			: [...prefs.collapsedSections, section.key];
		patchPrefs({ collapsedSections: next });
	};

	const togglePin = (itemId: string) => {
		const pinned = prefs.pinnedItemIds.includes(itemId);
		const next = pinned
			? prefs.pinnedItemIds.filter((id) => id !== itemId)
			: [...prefs.pinnedItemIds, itemId];
		patchPrefs({ pinnedItemIds: next });
	};

	const hideItem = (itemId: string) => {
		patchPrefs({ hiddenItemIds: [...prefs.hiddenItemIds, itemId] });
	};

	const onDrop = (targetId: string) => {
		const dragged = dragId;
		setDragId(null);
		if (!dragged || dragged === targetId) return;
		// Server order of every inbox row (pre-pin/pref, so shared ordering is
		// never polluted by personal prefs). Swap dragged ↔ target.
		const ordered = (sidebar?.sections ?? [])
			.flatMap((section) => [
				...section.items,
				...section.groups.flatMap((group) => group.items),
			])
			.filter((item) => item.kind === "inbox")
			.map((item) => item.id);
		const from = ordered.indexOf(dragged);
		const to = ordered.indexOf(targetId);
		if (from === -1 || to === -1) return;
		[ordered[from], ordered[to]] = [ordered[to], ordered[from]];

		if (sidebar?.permissions.isAdmin) {
			// Shared ordering (inboxes.sort_order).
			api
				.reorderInboxes(workspaceId, ordered)
				.then(() =>
					queryClient.invalidateQueries({
						queryKey: ["sidebar", workspaceId],
					}),
				)
				.catch(() => {
					queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] });
				});
		} else {
			// Personal ordering only — never touches shared state.
			const itemOrder: Record<string, number> = {};
			ordered.forEach((id, index) => {
				itemOrder[id] = index;
			});
			patchPrefs({ itemOrder });
		}
	};

	if (!sidebar) {
		return (
			<aside
				className={cn(
					"flex h-full shrink-0 flex-col border-r bg-muted/30",
					compact ? "w-14" : "w-60",
				)}
			>
				<div className="p-4 text-xs text-gray-400">Loading…</div>
			</aside>
		);
	}

	return (
		<aside
			className={cn(
				"flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width]",
				compact ? "w-14" : "w-60",
			)}
		>
			{/* Header: logo + workspace switcher */}
			<div className="flex items-center gap-2 border-b px-3 py-2">
				{!compact ? (
					<>
						<h1 className="text-sm font-black">MsgFlow</h1>
						<select
							value={workspaceId}
							onChange={(event) => onChangeWorkspace(event.target.value)}
							className="min-w-0 flex-1 rounded border bg-transparent px-1 py-0.5 text-xs outline-none"
							title="Switch workspace"
						>
							{workspaces.map((workspace) => (
								<option key={workspace.id} value={workspace.id}>
									{workspace.name}
								</option>
							))}
						</select>
					</>
				) : (
					<h1 className="mx-auto text-sm font-black" title="MsgFlow">
						M
					</h1>
				)}
			</div>

			{/* Sections */}
			<nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{sidebar.sections.map((section) => (
					<SidebarSectionView
						key={section.key}
						section={section}
						prefs={prefs}
						compact={compact}
						isAdmin={sidebar.permissions.isAdmin}
						activeFilters={activeFilters}
						currentUserId={currentUserId}
						onSelect={onSelect}
						onToggle={() => toggleSection(section)}
						onTogglePin={togglePin}
						onHide={hideItem}
						onCreateInbox={() => setDrawer({ mode: "create" })}
						onEditInbox={(inboxId) => setDrawer({ mode: "edit", inboxId })}
						onCreateRule={() => navigate({ to: "/rules" })}
						onDragStart={setDragId}
						onDrop={onDrop}
					/>
				))}
			</nav>

			{/* Footer: compact toggle */}
			<button
				type="button"
				onClick={onToggleCompact}
				className="flex items-center justify-center gap-2 border-t py-2 text-xs text-gray-500 hover:bg-accent"
				title={compact ? "Expand sidebar" : "Collapse sidebar"}
			>
				{compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
				{!compact ? <span>Collapse</span> : null}
			</button>

			{drawer ? (
				<InboxSettingsDrawer
					workspaceId={workspaceId}
					inboxId={drawer.mode === "edit" ? drawer.inboxId : null}
					onClose={() => setDrawer(null)}
					onChanged={() =>
						queryClient.invalidateQueries({
							queryKey: ["sidebar", workspaceId],
						})
					}
				/>
			) : null}
		</aside>
	);
}

function emptyPrefs(): SidebarPreferences {
	return {
		collapsedSections: [],
		pinnedItemIds: [],
		hiddenItemIds: [],
		itemOrder: {},
	};
}

interface SectionProps {
	section: SidebarSection;
	prefs: SidebarPreferences;
	compact: boolean;
	isAdmin: boolean;
	activeFilters: ListFilters;
	currentUserId: string;
	onSelect: (filters: ListFilters) => void;
	onToggle: () => void;
	onTogglePin: (itemId: string) => void;
	onHide: (itemId: string) => void;
	onCreateInbox: () => void;
	onEditInbox: (inboxId: string) => void;
	onCreateRule: () => void;
	onDragStart: (itemId: string | null) => void;
	onDrop: (targetId: string) => void;
}

function SidebarSectionView(props: SectionProps) {
	const { section, compact, prefs } = props;
	const collapsed = isSectionCollapsed(section, prefs);

	if (compact) {
		return (
			<div className="mb-2">
				{section.items.map((item) => (
					<ItemRow key={item.id} {...props} item={item} />
				))}
				{section.groups.flatMap((group) =>
					group.items.map((item) => (
						<ItemRow key={item.id} {...props} item={item} />
					)),
				)}
			</div>
		);
	}

	return (
		<div className="mb-1">
			<button
				type="button"
				onClick={props.onToggle}
				className="group flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 hover:bg-accent"
				title={collapsed ? "Expand section" : "Collapse section"}
			>
				{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
				<span className="flex-1">{section.label}</span>
				{section.key === "inbox" && props.isAdmin ? (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							props.onCreateInbox();
						}}
						className="rounded p-0.5 text-gray-400 hover:bg-accent hover:text-gray-600"
						title="Create inbox"
					>
						<Plus size={14} />
					</button>
				) : null}
			</button>
			{collapsed ? null : (
				<div className="mt-0.5">
					{section.items.map((item) => (
						<ItemRow key={item.id} {...props} item={item} />
					))}
					{section.groups.map((group) => (
						<div key={group.id} className="mb-1">
							<p className="px-2 py-0.5 text-[11px] font-semibold text-gray-400">
								{group.label}
							</p>
							{applyPreferences(group.items, prefs).map((item) => (
								<ItemRow key={item.id} {...props} item={item} />
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function ItemRow(props: SectionProps & { item: SidebarItem }) {
	const { item, compact, isAdmin, activeFilters } = props;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	const filters = itemFilters(item, props.currentUserId);
	const active = filtersEqual(activeFilters, filters);

	const icon = itemIcon(item);
	const count = item.kind === "view" ? null : item.count;

	return (
		<div ref={menuRef} className="group relative">
			<button
				type="button"
				onClick={() => props.onSelect(filters)}
				draggable={item.kind === "inbox"}
				onDragStart={(event) => {
					event.dataTransfer.effectAllowed = "move";
					props.onDragStart(item.id);
				}}
				onDragEnd={() => props.onDragStart(null)}
				onDragOver={(event) => {
					if (item.kind === "inbox") event.preventDefault();
				}}
				onDrop={(event) => {
					event.preventDefault();
					props.onDrop(item.id);
				}}
				className={cn(
					"flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] transition-colors",
					active
						? "bg-primary/10 font-semibold text-primary"
						: "hover:bg-accent",
				)}
				title={compact ? item.label : undefined}
			>
				<span className="flex w-4 shrink-0 items-center justify-center text-gray-500">
					{icon}
				</span>
				{!compact ? (
					<>
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{count !== null && count > 0 ? (
							<span className="shrink-0 rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold text-gray-600">
								{count}
							</span>
						) : null}
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								setMenuOpen((open) => !open);
							}}
							className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 hover:bg-accent hover:text-gray-600 group-hover:opacity-100"
							aria-label={`${item.label} menu`}
						>
							<MoreHorizontal size={14} />
						</button>
					</>
				) : null}
			</button>

			{menuOpen && !compact ? (
				<div className="absolute right-0 top-full z-50 w-48 rounded-md border bg-background p-1 shadow-lg">
					<MenuButton
						label={prefsPinned(props.prefs, item.id) ? "Unpin" : "Pin"}
						onClick={() => {
							props.onTogglePin(item.id);
							setMenuOpen(false);
						}}
					/>
					<MenuButton
						label="Hide"
						onClick={() => {
							props.onHide(item.id);
							setMenuOpen(false);
						}}
					/>
					{item.kind === "inbox" && isAdmin ? (
						<>
							<div className="my-1 border-t" />
							<MenuButton
								label="Edit inbox"
								onClick={() => {
									props.onEditInbox(item.inboxId);
									setMenuOpen(false);
								}}
							/>
							<MenuButton
								label="Create rule"
								onClick={() => {
									props.onCreateRule();
									setMenuOpen(false);
								}}
							/>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function prefsPinned(prefs: SidebarPreferences, itemId: string): boolean {
	return prefs.pinnedItemIds.includes(itemId);
}

function MenuButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
		>
			{label}
		</button>
	);
}

function itemIcon(item: SidebarItem) {
	switch (item.kind) {
		case "system": {
			const Icon = SYSTEM_ICONS[item.id] ?? InboxIcon;
			return <Icon size={14} />;
		}
		case "inbox": {
			if (item.icon) {
				const Icon = INBOX_ICONS[item.icon as InboxIconKey] ?? InboxIcon;
				return <Icon size={14} style={{ color: item.color }} />;
			}
			return (
				<span
					className="block h-3 w-3 rounded-full"
					style={{ backgroundColor: item.color }}
				/>
			);
		}
		case "tag":
			return <TagIcon size={14} style={{ color: item.color ?? undefined }} />;
		case "view":
			return <Zap size={14} />;
	}
}

function itemFilters(item: SidebarItem, currentUserId: string): ListFilters {
	switch (item.id) {
		case "system:all":
			return { status: "all" };
		case "system:assigned-to-me":
			return { status: "open", assigneeId: currentUserId };
		case "system:unassigned":
			return { status: "open", unassigned: true };
		case "system:snoozed":
			return { status: "open", snoozed: true };
		case "system:closed":
			return { status: "archived" };
		default:
			if (item.kind === "inbox") {
				return { status: "open", inboxId: item.inboxId };
			}
			if (item.kind === "tag") {
				return { status: "open", tagId: item.id.replace("tag:", "") };
			}
			return { status: "open" };
	}
}

/** Cheap structural equality for highlighting the active sidebar row. */
function filtersEqual(a: ListFilters, b: ListFilters): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export type { SidebarInboxItem };
