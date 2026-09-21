import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { SearchBar, type SearchFilters } from "@/components/inbox/SearchBar";
import { Sidebar, type ListFilters } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/button";
import { authClient, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): { c?: string } => ({
		c: typeof search.c === "string" ? search.c : undefined,
	}),
	component: Inbox,
});

const STATUS_TABS = ["open", "archived", "all"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const WORKSPACE_KEY = "msgflow.workspaceId";
const COMPACT_KEY = "msgflow.sidebarCompact";

function Inbox() {
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
	const [workspaceId, setWorkspaceId] = useState<string>(() => {
		const saved = localStorage.getItem(WORKSPACE_KEY);
		return saved ?? "";
	});
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
		queryKey: ["conversations", status, filters],
		queryFn: () =>
			api.listConversations({
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

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center justify-between border-b px-4 py-2">
				<nav className="flex gap-1">
					{STATUS_TABS.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => {
								setStatus(tab);
								setFilters((current) => ({
									...current,
									status: tab,
									inboxId: undefined,
									assigneeId: undefined,
									unassigned: undefined,
									snoozed: undefined,
								}));
							}}
							className={cn(
								"rounded-md px-3 py-1 text-sm capitalize transition-colors",
								status === tab
									? "bg-primary text-primary-foreground"
									: "text-gray-500 hover:bg-accent",
							)}
						>
							{tab}
						</button>
					))}
				</nav>
				<HeaderUser />
			</header>
			<div className="flex min-h-0 flex-1">
				{activeWorkspaceId && session ? (
					<Sidebar
						workspaceId={activeWorkspaceId}
						workspaces={workspaces}
						currentUserId={session.user.id}
						activeFilters={filters}
						onSelect={(next) => {
							setFilters(next);
							if (next.status) {
								setStatus(next.status);
							}
						}}
						onChangeWorkspace={changeWorkspace}
						compact={compact}
						onToggleCompact={toggleCompact}
					/>
				) : null}
				<div className="flex min-w-0 flex-1 flex-col">
					<SearchBar
						filters={searchFilters}
						onChange={(next) =>
							setFilters((current) => ({ ...current, ...next }))
						}
					/>
					<div className="flex min-h-0 flex-1">
						<aside className="w-[360px] shrink-0 border-r">
							{isPending ? (
								<div className="p-4 text-sm text-gray-400">Loading…</div>
							) : (
								<ConversationList
									conversations={data?.conversations ?? []}
									selectedId={conversationId}
									onSelect={(id) => navigate({ to: "/", search: { c: id } })}
								/>
							)}
						</aside>
						<main className="min-w-0 flex-1">
							{conversationId ? (
								<ConversationThread
									key={conversationId}
									conversationId={conversationId}
								/>
							) : (
								<div className="flex h-full items-center justify-center text-sm text-gray-400">
									Select a conversation to open it.
								</div>
							)}
						</main>
					</div>
				</div>
			</div>
		</div>
	);
}

function HeaderUser() {
	const { data: session } = useSession();
	const navigate = useNavigate();

	async function signOut() {
		await authClient.signOut();
		navigate({ to: "/login" });
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-sm text-gray-500">{session?.user.email}</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => navigate({ to: "/rules" })}
			>
				Rules
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => navigate({ to: "/settings" })}
			>
				Settings
			</Button>
			<Button variant="outline" size="sm" onClick={signOut}>
				Sign out
			</Button>
		</div>
	);
}
