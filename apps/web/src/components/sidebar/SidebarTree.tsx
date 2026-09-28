import type {
	SavedFilterFilters,
	SidebarNode,
	SidebarPreferences,
	SidebarTreeResponse,
} from "@msgflow/contracts";
import {
	ChevronDown,
	ChevronRight,
	Inbox,
	Pencil,
	Plus,
	Search,
} from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isNodeCollapsed, isSectionCollapsed } from "./sidebar-prefs";

export type ConversationListFilter = SavedFilterFilters & {
	mailboxId?: string;
	inboxScope?: "exact" | "descendants";
};

export type SidebarFilters = ConversationListFilter;

/** Converts a server navigation node into the filter used by the conversation list. */
export function nodeFilter(node: SidebarNode): ConversationListFilter {
	return {
		...node.filter,
		...(node.type === "inbox"
			? { inboxScope: node.children.length ? "descendants" : "exact" }
			: {}),
	};
}

export function SidebarTree({
	tree,
	activeFilters,
	compact,
	currentUserId,
	onSelect,
	onPreferencesChange,
	onCreateInbox,
	onEditInbox,
}: {
	tree: SidebarTreeResponse;
	activeFilters: ConversationListFilter;
	compact: boolean;
	currentUserId: string;
	onSelect: (filters: ConversationListFilter) => void;
	onPreferencesChange: (patch: Partial<SidebarPreferences>) => void;
	onCreateInbox: () => void;
	onEditInbox: (inboxId: string) => void;
}) {
	const [search, setSearch] = useState("");
	const treeRef = useRef<HTMLDivElement>(null);
	const focusAfterExpand = useRef<string | null>(null);
	const searching = search.trim().length > 0;
	const expandedNodeCount = useMemo(
		() => countExpanded(tree.sections, tree.preferences),
		[tree],
	);
	const showSearch = expandedNodeCount > 12;
	const visibleSections = useMemo(
		() =>
			orderSections(tree.sections)
				.filter((section) => !section.isHidden)
				.map((section) => filterNode(section, search))
				.filter(Boolean) as SidebarNode[],
		[tree.sections, search],
	);
	const visibleRows = useMemo(
		() => flattenVisible(visibleSections, tree.preferences, searching),
		[visibleSections, tree.preferences, searching],
	);

	useEffect(() => {
		const id = focusAfterExpand.current;
		if (!id) return;
		const row = Array.from(
			treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
		).find((item) => item.dataset.nodeId === id);
		if (row) {
			row.focus();
			focusAfterExpand.current = null;
		}
	});

	useEffect(() => {
		if (
			hasNavigationSelection(activeFilters) &&
			!findSelected(visibleSections, activeFilters)
		)
			onSelect({ status: "open", assigneeId: currentUserId });
	}, [activeFilters, currentUserId, onSelect, visibleSections]);

	function toggleNode(node: SidebarNode) {
		const collapsed = isNodeCollapsed(node, tree.preferences);
		onPreferencesChange({
			collapsedNodeIds: collapsed
				? tree.preferences.collapsedNodeIds.filter((id) => id !== node.id)
				: [...tree.preferences.collapsedNodeIds, node.id],
		});
	}
	function keyDown(event: KeyboardEvent<HTMLDivElement>, row: SidebarNode) {
		const rows = Array.from(
			treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
		);
		const index = rows.indexOf(event.currentTarget);
		const focus = (next: number) => rows[next]?.focus();
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focus(Math.min(rows.length - 1, index + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			focus(Math.max(0, index - 1));
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onSelect(nodeFilter(row));
		} else if (event.key === "ArrowRight" && row.children.length) {
			event.preventDefault();
			if (isNodeCollapsed(row, tree.preferences)) {
				focusAfterExpand.current = row.children[0]?.id ?? null;
				toggleNode(row);
			} else {
				focus(index + 1);
			}
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			if (row.children.length && !isNodeCollapsed(row, tree.preferences)) {
				toggleNode(row);
			} else {
				const parentIndex = visibleRows.findIndex(
					(item) => item.node.id === row.parentId,
				);
				if (parentIndex >= 0) focus(parentIndex);
			}
		}
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
			{showSearch ? (
				<div className="relative mb-2">
					<Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
					<Input
						aria-label="Search sidebar"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="h-8 pl-7 text-xs"
						placeholder="Search"
					/>
				</div>
			) : null}
			<div ref={treeRef} role="tree" aria-label="Inbox navigation">
				{visibleSections.map((section) => (
					<Section
						key={section.id}
						section={section}
						prefs={tree.preferences}
						compact={compact}
						activeFilters={activeFilters}
						firstRowId={visibleRows[0]?.node.id}
						forceExpanded={searching}
						onSelect={(node) => onSelect(nodeFilter(node))}
						onToggleNode={toggleNode}
						onToggleSection={(node) =>
							onPreferencesChange({
								collapsedSections: isSectionCollapsed(node, tree.preferences)
									? tree.preferences.collapsedSections.filter(
											(id) => id !== node.id,
										)
									: [...tree.preferences.collapsedSections, node.id],
							})
						}
						onKeyDown={keyDown}
						onCreateInbox={onCreateInbox}
						onEditInbox={onEditInbox}
						isAdmin={tree.permissions.isAdmin}
					/>
				))}
			</div>
		</div>
	);
}

function Section({
	section,
	prefs,
	compact,
	activeFilters,
	firstRowId,
	forceExpanded,
	onSelect,
	onToggleNode,
	onToggleSection,
	onKeyDown,
	onCreateInbox,
	onEditInbox,
	isAdmin,
}: {
	section: SidebarNode;
	prefs: SidebarPreferences;
	compact: boolean;
	activeFilters: ConversationListFilter;
	firstRowId?: string;
	forceExpanded: boolean;
	onSelect: (node: SidebarNode) => void;
	onToggleNode: (node: SidebarNode) => void;
	onToggleSection: (node: SidebarNode) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: SidebarNode) => void;
	onCreateInbox: () => void;
	onEditInbox: (inboxId: string) => void;
	isAdmin: boolean;
}) {
	const collapsed = !forceExpanded && isSectionCollapsed(section, prefs);
	return (
		<section className="mb-2" aria-label={section.label}>
			<div className="flex items-center">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onToggleSection(section)}
					className="h-7 flex-1 justify-start gap-1 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
					aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.label}`}
				>
					{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
					<span>{section.label}</span>
				</Button>
				{section.label === "Shared Inboxes" && isAdmin ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7"
								onClick={onCreateInbox}
								aria-label="Create inbox"
							>
								<Plus size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Create inbox</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{!collapsed &&
				(section.children.length ? (
					section.children.map((node) => (
						<TreeRow
							key={node.id}
							node={node}
							level={1}
							prefs={prefs}
							compact={compact}
							activeFilters={activeFilters}
							firstRowId={firstRowId}
							forceExpanded={forceExpanded}
							onSelect={onSelect}
							onToggle={onToggleNode}
							onKeyDown={onKeyDown}
							onEditInbox={onEditInbox}
						/>
					))
				) : section.label === "Shared Inboxes" ? (
					<p className="px-2 py-1 text-xs text-muted-foreground">
						No shared inboxes yet.
					</p>
				) : null)}
		</section>
	);
}

function TreeRow({
	node,
	level,
	prefs,
	compact,
	activeFilters,
	firstRowId,
	forceExpanded,
	onSelect,
	onToggle,
	onKeyDown,
	onEditInbox,
}: {
	node: SidebarNode;
	level: number;
	prefs: SidebarPreferences;
	compact: boolean;
	activeFilters: ConversationListFilter;
	firstRowId?: string;
	forceExpanded: boolean;
	onSelect: (node: SidebarNode) => void;
	onToggle: (node: SidebarNode) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>, node: SidebarNode) => void;
	onEditInbox: (inboxId: string) => void;
}) {
	const collapsible = node.isCollapsible && node.children.length > 0;
	const collapsed = !forceExpanded && isNodeCollapsed(node, prefs);
	const active = filtersEqual(activeFilters, nodeFilter(node));
	return (
		<>
			<div className="group flex items-center">
				<div
					role="treeitem"
					data-node-id={node.id}
					tabIndex={node.id === firstRowId ? 0 : -1}
					aria-level={level}
					aria-expanded={collapsible ? !collapsed : undefined}
					aria-selected={active}
					onKeyDown={(event) => onKeyDown(event, node)}
					onClick={() => onSelect(node)}
					className={cn(
						"flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
						active
							? "bg-primary/10 font-semibold text-primary"
							: "hover:bg-accent",
					)}
					style={{ paddingLeft: `${level * 12 + 4}px` }}
				>
					{collapsible ? (
						<span
							aria-hidden="true"
							className="grid size-5 place-items-center rounded hover:bg-accent"
							onClick={(event) => {
								event.stopPropagation();
								onToggle(node);
							}}
						>
							{collapsed ? (
								<ChevronRight size={14} />
							) : (
								<ChevronDown size={14} />
							)}
						</span>
					) : (
						<span aria-hidden="true" className="size-5" />
					)}
					<Inbox
						size={14}
						style={{ color: node.color ?? undefined }}
						className="shrink-0 text-muted-foreground"
					/>
					<span className={cn("min-w-0 flex-1 truncate", compact && "sr-only")}>
						{node.label}
					</span>
					{!compact && node.count != null ? (
						<Badge
							variant="secondary"
							className="shrink-0 px-1.5 text-[10px]"
							aria-label={`${node.count} actionable conversations`}
						>
							{node.count > 999 ? "999+" : node.count}
						</Badge>
					) : null}
				</div>
				{node.type === "inbox" && node.isEditable ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
						aria-label={`Edit ${node.label}`}
						onClick={() =>
							onEditInbox(node.filter.inboxId ?? node.id.slice("inbox:".length))
						}
					>
						<Pencil size={14} />
					</Button>
				) : null}
			</div>
			{collapsible && !collapsed
				? node.children.map((child) => (
						<TreeRow
							key={child.id}
							node={child}
							level={level + 1}
							prefs={prefs}
							compact={compact}
							activeFilters={activeFilters}
							firstRowId={firstRowId}
							forceExpanded={forceExpanded}
							onSelect={onSelect}
							onToggle={onToggle}
							onKeyDown={onKeyDown}
							onEditInbox={onEditInbox}
						/>
					))
				: null}
		</>
	);
}

function orderSections(sections: SidebarNode[]): SidebarNode[] {
	const priority = (section: SidebarNode) =>
		section.label === "My Work"
			? 0
			: section.label === "Shared Inboxes"
				? 1
				: 2;
	return [...sections].sort((left, right) => priority(left) - priority(right));
}
function filterNode(node: SidebarNode, search: string): SidebarNode | null {
	const children = node.children
		.filter((child) => !child.isHidden)
		.map((child) => filterNode(child, search))
		.filter(Boolean) as SidebarNode[];
	return !search ||
		node.label.toLowerCase().includes(search.toLowerCase()) ||
		children.length
		? { ...node, children }
		: null;
}
function flattenVisible(
	sections: SidebarNode[],
	prefs: SidebarPreferences,
	forceExpanded: boolean,
): { node: SidebarNode }[] {
	const rows: { node: SidebarNode }[] = [];
	const visit = (node: SidebarNode) => {
		rows.push({ node });
		if (forceExpanded || !isNodeCollapsed(node, prefs))
			node.children.forEach(visit);
	};
	sections.forEach((section) => {
		if (forceExpanded || !isSectionCollapsed(section, prefs))
			section.children.forEach(visit);
	});
	return rows;
}
function countExpanded(
	nodes: SidebarNode[],
	prefs: SidebarPreferences,
): number {
	return nodes.reduce(
		(total, node) =>
			total +
			node.children.length +
			(isNodeCollapsed(node, prefs) ? 0 : countExpanded(node.children, prefs)),
		0,
	);
}
function findSelected(
	nodes: SidebarNode[],
	filters: ConversationListFilter,
): SidebarNode | undefined {
	for (const node of nodes) {
		if (filtersEqual(filters, nodeFilter(node))) return node;
		const found = findSelected(node.children, filters);
		if (found) return found;
	}
}
function filtersEqual(
	a: ConversationListFilter,
	b: ConversationListFilter,
): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function hasNavigationSelection(filters: ConversationListFilter): boolean {
	return Boolean(
		filters.inboxId ??
			filters.mailboxId ??
			filters.assigneeId ??
			filters.unassigned ??
			filters.snoozed ??
			filters.tagId,
	);
}
