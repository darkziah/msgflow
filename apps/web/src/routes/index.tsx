import type { WorkspaceSummary } from "@msgflow/contracts";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import {
	ConversationList,
	ConversationListSkeleton,
} from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { SearchBar, type SearchFilters } from "@/components/inbox/SearchBar";
import { AppShell } from "@/components/layout/AppShell";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { type ListFilters, Sidebar } from "@/components/sidebar/Sidebar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
	validateSearch: (
		search: Record<string, unknown>,
	): { c?: string; workspace?: string } => ({
		c: typeof search.c === "string" ? search.c : undefined,
		workspace:
			typeof search.workspace === "string" ? search.workspace : undefined,
	}),
	component: Inbox,
});

const STATUS_TABS = ["open", "archived", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export function resetFiltersForStatus(
	filters: ListFilters,
	status: StatusTab,
): ListFilters {
	return {
		...filters,
		status,
		mailboxId: undefined,
		inboxId: undefined,
		inboxScope: undefined,
		assigneeId: undefined,
		unassigned: undefined,
		snoozed: undefined,
	};
}

const COMPACT_KEY = "msgflow.sidebarCompact";
export const WORKSPACE_QUERY_ROOTS = [
	"assigned-mailboxes",
	"canned-replies",
	"channels",
	"comment-notifications",
	"conversation",
	"conversations",
	"email-domains",
	"email-members",
	"email-operations",
	"email-context",
	"inboxes",
	"mailbox-delegates",
	"mailboxes",
	"messages",
	"meta-apps",
	"rules",
	"sidebar",
	"tags",
	"teams",
	"users",
	"workspace-inboxes",
	"drafts",
] as const;

const WORKSPACE_QUERY_ROOT_SET = new Set<string>(WORKSPACE_QUERY_ROOTS);

export function clearWorkspaceSensitiveQueries(queryClient: QueryClient): void {
	queryClient.removeQueries({
		predicate: (query) =>
			WORKSPACE_QUERY_ROOT_SET.has(String(query.queryKey[0])),
	});
}

export function resolveAuthorizedWorkspaceId(
	requestedWorkspaceId: string | undefined,
	workspaces: WorkspaceSummary[],
): string | undefined {
	if (
		requestedWorkspaceId &&
		workspaces.some((workspace) => workspace.id === requestedWorkspaceId)
	) {
		return requestedWorkspaceId;
	}
	return workspaces[0]?.id;
}

export function workspaceSearch(workspace: string): { workspace: string } {
	return { workspace };
}

export function reconcileWorkspaceSelection({
	previousWorkspaceId,
	activeWorkspaceId,
	requestedWorkspaceId,
	conversationId,
}: {
	previousWorkspaceId: string;
	activeWorkspaceId: string;
	requestedWorkspaceId: string | undefined;
	conversationId: string | undefined;
}): { clearWorkspaceState: boolean; canonicalSearch?: { workspace: string } } {
	const changedWorkspace = Boolean(
		previousWorkspaceId &&
			activeWorkspaceId &&
			previousWorkspaceId !== activeWorkspaceId,
	);
	if (changedWorkspace) {
		return {
			clearWorkspaceState: true,
			canonicalSearch: conversationId
				? workspaceSearch(activeWorkspaceId)
				: undefined,
		};
	}
	if (activeWorkspaceId && activeWorkspaceId !== requestedWorkspaceId) {
		return {
			clearWorkspaceState: false,
			canonicalSearch: workspaceSearch(activeWorkspaceId),
		};
	}
	return { clearWorkspaceState: false };
}

/** Human-readable identity for the active operational queue. */
export function queueIdentity(filters: ListFilters, status: StatusTab): string {
	if (filters.snoozed) return "Snoozed";
	if (filters.unassigned) return "Unassigned";
	if (filters.assigneeId) return "Assigned";
	if (filters.tagId) return "Tagged";
	if (filters.mailboxId) return "Email mailbox";
	if (filters.inboxId) return "Inbox";
	if (status === "archived") return "Archived";
	if (status === "all") return "All conversations";
	return "Inbox";
}

export function Inbox() {
	const { c: conversationId, workspace: requestedWorkspaceId } =
		Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const [status, setStatus] = useState<StatusTab>("open");
	const [filters, setFilters] = useState<ListFilters>({});
	const [compact, setCompact] = useState(
		() => localStorage.getItem(COMPACT_KEY) === "1",
	);

	const { data: workspacesData } = useQuery({
		queryKey: ["workspaces"],
		queryFn: () => api.listWorkspaces(),
	});
	const workspaces = workspacesData?.workspaces ?? [];
	const activeWorkspaceId =
		resolveAuthorizedWorkspaceId(requestedWorkspaceId, workspaces) ?? "";
	const previousWorkspaceId = useRef(activeWorkspaceId);

	useLayoutEffect(() => {
		const reconciliation = reconcileWorkspaceSelection({
			previousWorkspaceId: previousWorkspaceId.current,
			activeWorkspaceId,
			requestedWorkspaceId,
			conversationId,
		});
		previousWorkspaceId.current = activeWorkspaceId;

		if (reconciliation.clearWorkspaceState) {
			clearWorkspaceSensitiveQueries(queryClient);
			setFilters({});
		}
		if (reconciliation.canonicalSearch) {
			navigate({
				to: "/",
				search: reconciliation.canonicalSearch,
				replace: true,
			});
		}
	}, [
		activeWorkspaceId,
		conversationId,
		navigate,
		queryClient,
		requestedWorkspaceId,
	]);

	function changeWorkspace(next: string) {
		if (next === activeWorkspaceId) return;
		navigate({ to: "/", search: workspaceSearch(next) });
	}

	function toggleCompact() {
		setCompact((value) => {
			localStorage.setItem(COMPACT_KEY, value ? "0" : "1");
			return !value;
		});
	}

	const { data, isPending } = useQuery({
		queryKey: ["conversations", activeWorkspaceId, status, filters],
		queryFn: () =>
			api.listConversations({
				workspaceId: activeWorkspaceId,
				mailboxId: filters.mailboxId,
				status,
				inboxId: filters.inboxId,
				inboxScope: filters.inboxScope,
				q: filters.q,
				assigneeId: filters.assigneeId,
				unassigned: filters.unassigned,
				snoozed: filters.snoozed,
				channel: filters.channel,
				tagId: filters.tagId,
				dateFrom: filters.dateFrom,
				dateTo: filters.dateTo,
			}),
		enabled: Boolean(activeWorkspaceId),
		refetchInterval: 5000,
	});

	const searchFilters: SearchFilters = {
		q: filters.q,
		assigneeId: filters.assigneeId,
		channel: filters.channel,
		tagId: filters.tagId,
		dateFrom: filters.dateFrom,
		dateTo: filters.dateTo,
	};
	const queueLabel = queueIdentity(filters, status);
	const list = (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between gap-2 border-b px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<Tabs
						value={status}
						onValueChange={(value) => {
							const next = value as StatusTab;
							setStatus(next);
							setFilters((current) => resetFiltersForStatus(current, next));
						}}
					>
						<TabsList aria-label="Conversation status">
							{STATUS_TABS.map((tab) => (
								<TabsTrigger key={tab} value={tab} className="capitalize">
									{tab}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					<div
						className="flex min-w-0 items-center gap-1 text-xs whitespace-nowrap"
						aria-live="polite"
					>
						<span>{queueLabel}</span>
						<Badge variant="secondary">{data?.conversations.length ?? 0}</Badge>
					</div>
				</div>
			</div>
			<SearchBar
				filters={searchFilters}
				workspaceId={activeWorkspaceId}
				onChange={(next) =>
					setFilters((current) =>
						Object.keys(next).length === 0 ? next : { ...current, ...next },
					)
				}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{isPending ? (
					<ConversationListSkeleton />
				) : (
					<ConversationList
						conversations={data?.conversations ?? []}
						selectedId={conversationId}
						onSelect={(id) =>
							navigate({
								to: "/",
								search: { workspace: activeWorkspaceId, c: id },
							})
						}
					/>
				)}
			</div>
		</div>
	);
	const detail = conversationId ? (
		<ConversationThread
			key={`${activeWorkspaceId}:${conversationId}`}
			conversationId={conversationId}
			workspaceId={activeWorkspaceId}
		/>
	) : (
		<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
			Select a conversation to open it.
		</div>
	);
	const renderSidebar = (compactMode: boolean) =>
		activeWorkspaceId && session ? (
			<Sidebar
				workspaceId={activeWorkspaceId}
				currentUserId={session.user.id}
				activeFilters={filters}
				onSelect={(next) => {
					setFilters(next);
					if (next.status) setStatus(next.status);
					if (conversationId) {
						navigate({
							to: "/",
							search: workspaceSearch(activeWorkspaceId),
							replace: true,
						});
					}
				}}
				compact={compactMode}
				onToggleCompact={toggleCompact}
			/>
		) : null;

	return (
		<AppShell
			header={
				<AppTopBar
					workspaceId={activeWorkspaceId}
					workspaces={workspaces}
					onChangeWorkspace={changeWorkspace}
				/>
			}
			hasDetail={Boolean(conversationId)}
			onBack={() =>
				navigate({ to: "/", search: workspaceSearch(activeWorkspaceId) })
			}
			list={list}
			detail={detail}
			sidebar={renderSidebar(compact)}
			mobileSidebar={renderSidebar(false)}
		/>
	);
}
