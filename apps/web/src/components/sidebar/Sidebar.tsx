import type { InboxIconKey, SidebarPreferences } from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	SidebarRenderData,
	SidebarRenderItem,
	SidebarRenderSection,
} from "@/lib/api";
import { api, sidebarItemFilters } from "@/lib/api";
import { cn } from "@/lib/utils";
import { InboxSettingsDrawer } from "./InboxSettingsDrawer";
import { MailboxSidebar } from "./MailboxSidebar";
import { applyPreferences, isSectionCollapsed } from "./sidebar-prefs";

export interface ListFilters {
	/** Client-only label for the currently selected sidebar queue; never sent to the API. */
	queueLabel?: string;
	mailboxId?: string;
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
	currentUserId: string;
	activeFilters: ListFilters;
	onSelect: (filters: ListFilters) => void;
	compact: boolean;
	onToggleCompact: () => void;
}

export function Sidebar({
	workspaceId,
	currentUserId,
	activeFilters,
	onSelect,
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
			collapsedNodeIds: patch.collapsedNodeIds ?? prefs.collapsedNodeIds,
			lastOpenBranchIds: patch.lastOpenBranchIds ?? prefs.lastOpenBranchIds,
			pinnedItemIds: patch.pinnedItemIds ?? prefs.pinnedItemIds,
			hiddenItemIds: patch.hiddenItemIds ?? prefs.hiddenItemIds,
			itemOrder: patch.itemOrder ?? prefs.itemOrder,
		};
		// Optimistic: roll back on failure (the PATCH returns the canonical state).
		queryClient.setQueryData(
			["sidebar", workspaceId],
			(old: SidebarRenderData | undefined) =>
				old ? { ...old, preferences: next } : old,
		);
		api
			.updateSidebarPreferences(workspaceId, next)
			.then(({ preferences }) => {
				queryClient.setQueryData(
					["sidebar", workspaceId],
					(old: SidebarRenderData | undefined) =>
						old ? { ...old, preferences } : old,
				);
			})
			.catch(() => {
				queryClient.invalidateQueries({ queryKey: ["sidebar", workspaceId] });
			});
	};

	const toggleSection = (section: SidebarRenderSection) => {
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
					compact ? "w-14" : "w-[232px]",
				)}
			>
				<div className="space-y-3 p-4">
					<Skeleton className="h-5 w-28" />
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-4/5" />
				</div>
			</aside>
		);
	}

	return (
		<aside
			className={cn(
				"flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width]",
				compact ? "w-14" : "w-[232px]",
			)}
		>
			{/* Sections */}
			<nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				<MailboxSidebar
					workspaceId={workspaceId}
					userId={currentUserId}
					selected={activeFilters.mailboxId}
					compact={compact}
					onSelect={(mailbox) =>
						onSelect({
							mailboxId: mailbox.id,
							queueLabel: mailbox.label,
							status: "open",
						})
					}
				/>
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
			<Separator />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						onClick={onToggleCompact}
						className="flex w-full items-center justify-center gap-2 py-2 text-xs text-gray-500"
						aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
					>
						{compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
						{!compact ? <span>Collapse</span> : null}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{compact ? "Expand sidebar" : "Collapse sidebar"}
				</TooltipContent>
			</Tooltip>

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
		collapsedNodeIds: [],
		lastOpenBranchIds: [],
		pinnedItemIds: [],
		hiddenItemIds: [],
		itemOrder: {},
	};
}

interface SectionProps {
	section: SidebarRenderSection;
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
			<div className="flex items-center">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={props.onToggle}
					className="h-7 flex-1 justify-start gap-1 px-2 text-[11px] font-bold uppercase tracking-wide text-gray-500"
					aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.label}`}
				>
					{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
					<span className="flex-1">{section.label}</span>
				</Button>
				{section.key === "inbox" && props.isAdmin ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7"
								onClick={props.onCreateInbox}
								aria-label="Create inbox"
							>
								<Plus size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Create inbox</TooltipContent>
					</Tooltip>
				) : null}
			</div>
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

function ItemRow(props: SectionProps & { item: SidebarRenderItem }) {
	const { item, compact, isAdmin, activeFilters } = props;

	const filters = itemFilters(item);
	const active = filtersEqual(activeFilters, filters);

	const icon = itemIcon(item);
	const count = item.kind === "view" ? null : item.count;

	return (
		<div className="group flex items-center">
			<Button
				type="button"
				variant="ghost"
				size="sm"
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
					"h-8 min-w-0 flex-1 justify-start gap-2 rounded px-2 text-left text-[13px] transition-colors",
					active
						? "bg-primary/10 font-semibold text-primary"
						: "hover:bg-accent",
				)}
				aria-label={compact ? item.label : undefined}
			>
				<span className="flex w-4 shrink-0 items-center justify-center text-gray-500">
					{icon}
				</span>
				{!compact ? (
					<>
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{count != null && count > 0 ? (
							<Badge
								variant="secondary"
								className="shrink-0 px-1.5 text-[10px]"
							>
								{count}
							</Badge>
						) : null}
					</>
				) : null}
			</Button>
			{!compact ? (
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
									aria-label={`${item.label} menu`}
								>
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>{item.label} menu</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{item.label}</DropdownMenuLabel>
						<DropdownMenuItem onSelect={() => props.onTogglePin(item.id)}>
							{prefsPinned(props.prefs, item.id) ? "Unpin" : "Pin"}
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => props.onHide(item.id)}>
							Hide
						</DropdownMenuItem>
						{item.kind === "inbox" && isAdmin ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onSelect={() =>
										props.onEditInbox(
											item.inboxId ?? item.id.slice("inbox:".length),
										)
									}
								>
									Edit inbox
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={props.onCreateRule}>
									Create rule
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}

function prefsPinned(prefs: SidebarPreferences, itemId: string): boolean {
	return prefs.pinnedItemIds.includes(itemId);
}

function itemIcon(item: SidebarRenderItem) {
	switch (item.kind) {
		case "system": {
			const Icon = SYSTEM_ICONS[item.id] ?? InboxIcon;
			return <Icon size={14} />;
		}
		case "inbox": {
			if (item.icon) {
				const Icon = INBOX_ICONS[item.icon as InboxIconKey] ?? InboxIcon;
				return <Icon size={14} style={{ color: item.color ?? undefined }} />;
			}
			return (
				<span
					className="block h-3 w-3 rounded-full"
					style={{ backgroundColor: item.color ?? undefined }}
				/>
			);
		}
		case "tag":
			return <TagIcon size={14} style={{ color: item.color ?? undefined }} />;
		case "view":
			return <Zap size={14} />;
	}
}

function itemFilters(item: SidebarRenderItem): ListFilters {
	return { ...sidebarItemFilters(item), queueLabel: item.label };
}

/** Cheap structural equality for highlighting the active sidebar row. */
function filtersEqual(a: ListFilters, b: ListFilters): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
