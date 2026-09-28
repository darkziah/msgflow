import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
	validateSearch: (search: Record<string, unknown>): { c?: string } => ({
		c: typeof search.c === "string" ? search.c : undefined,
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
		queueLabel: undefined,
		status,
		mailboxId: undefined,
		inboxId: undefined,
		assigneeId: undefined,
		unassigned: undefined,
		snoozed: undefined,
	};
}

const WORKSPACE_KEY = "msgflow.workspaceId";
const COMPACT_KEY = "msgflow.sidebarCompact";

/** Human-readable identity for the active operational queue. */
export function queueIdentity(filters: ListFilters, status: StatusTab): string {
	if (filters.queueLabel) return filters.queueLabel;
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
	const { c: conversationId } = Route.useSearch();
	const navigate = useNavigate();
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
	const [workspaceId, setWorkspaceId] = useState<string>(
		() => localStorage.getItem(WORKSPACE_KEY) ?? "",
	);
	const activeWorkspaceId =
		workspaceId && workspaces.some((ws) => ws.id === workspaceId)
			? workspaceId
			: (workspaces[0]?.id ?? "");

	function changeWorkspace(next: string) {
		setWorkspaceId(next);
		localStorage.setItem(WORKSPACE_KEY, next);
		setFilters({});
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
				q: filters.q,
				assigneeId: filters.assigneeId,
				unassigned: filters.unassigned,
				snoozed: filters.snoozed,
				channel: filters.channel,
				tagId: filters.tagId,
				dateFrom: filters.dateFrom,
				dateTo: filters.dateTo,
			}),
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
						onSelect={(id) => navigate({ to: "/", search: { c: id } })}
					/>
				)}
			</div>
		</div>
	);
	const detail = conversationId ? (
		<ConversationThread key={conversationId} conversationId={conversationId} />
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
			onBack={() => navigate({ to: "/", search: {} })}
			list={list}
			detail={detail}
			sidebar={renderSidebar(compact)}
			mobileSidebar={renderSidebar(false)}
		/>
	);
}