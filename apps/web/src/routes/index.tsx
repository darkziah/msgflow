import type { WorkspaceSummary } from "@msgflow/contracts";
import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	ConversationList,
	ConversationListSkeleton,
} from "@/components/inbox/ConversationList";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import {
	KeyboardShortcutsProvider,
	useKeyboardShortcut,
} from "@/components/inbox/KeyboardShortcutsProvider";
import { NewEmailDialog } from "@/components/inbox/NewEmailDialog";
import { FirstSignInWalkthrough } from "@/components/onboarding/FirstSignInWalkthrough";
import { SearchBar, type SearchFilters } from "@/components/inbox/SearchBar";
import { AppShell } from "@/components/layout/AppShell";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { type ListFilters, Sidebar } from "@/components/sidebar/Sidebar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, workspaceSocketUrl } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";

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

export function handleWorkspaceConversationSocketEvent(
	queryClient: QueryClient,
	workspaceId: string,
	event: MessageEvent,
): void {
	if (typeof event.data !== "string") return;
	let payload: unknown;
	try {
		payload = JSON.parse(event.data);
	} catch {
		return;
	}
	if (
		typeof payload !== "object" ||
		payload === null ||
		Object.keys(payload).length !== 1 ||
		(payload as { type?: unknown }).type !== "workspace:conversations-changed"
	) {
		return;
	}
	invalidateWorkspaceConversationViews(queryClient, workspaceId);
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

const WORKSPACE_SOCKET_RECONNECT_BASE_MS = 250;
const WORKSPACE_SOCKET_RECONNECT_MAX_MS = 10_000;

interface WorkspaceSocket {
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	close(): void;
}

/** One bounded reconnect loop; its owner must stop it when workspace changes. */
export function createWorkspaceSocketReconnector(
	workspaceId: string,
	onMessage: (event: MessageEvent) => void,
	createSocket: (url: string) => WorkspaceSocket = (url) => new WebSocket(url),
): { start: () => void; stop: () => void } {
	let socket: WorkspaceSocket | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let retry = 0;

	const scheduleReconnect = () => {
		if (stopped || timer) return;
		const delay = Math.min(
			WORKSPACE_SOCKET_RECONNECT_BASE_MS * 2 ** retry,
			WORKSPACE_SOCKET_RECONNECT_MAX_MS,
		);
		retry += 1;
		timer = setTimeout(() => {
			timer = undefined;
			connect();
		}, delay);
	};

	const connect = () => {
		if (stopped || socket) return;
		const next = createSocket(workspaceSocketUrl(workspaceId));
		socket = next;
		next.onopen = () => {
			if (socket === next) retry = 0;
		};
		next.onmessage = onMessage;
		next.onclose = () => {
			if (socket !== next) return;
			socket = undefined;
			scheduleReconnect();
		};
		next.onerror = () => {
			if (socket !== next) return;
			// Browsers normally follow an error with close, but do not rely on it:
			// retire this socket first so the scheduled connect cannot be blocked by
			// an orphan. Its later close sees a stale socket and cannot retry twice.
			socket = undefined;
			next.close();
			scheduleReconnect();
		};
	};

	return {
		start: connect,
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			timer = undefined;
			const current = socket;
			socket = undefined;
			current?.close();
		},
	};
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
	return (
		<KeyboardShortcutsProvider>
			<InboxContent />
		</KeyboardShortcutsProvider>
	);
}

function InboxContent() {
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
	const [newEmailOpen, setNewEmailOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const { data: workspacesData } = useQuery({
		queryKey: ["workspaces"],
		queryFn: () => api.listWorkspaces(),
	});
	const workspaces = workspacesData?.workspaces ?? [];
	const activeWorkspaceId =
		resolveAuthorizedWorkspaceId(requestedWorkspaceId, workspaces) ?? "";
	const walkthrough = useQuery({
		queryKey: ["first-sign-in-walkthrough", session?.user.id],
		queryFn: () => api.getFirstSignInWalkthrough(),
		enabled: Boolean(session && activeWorkspaceId),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const completeWalkthrough = useMutation({
		mutationFn: () => api.completeFirstSignInWalkthrough(),
		onSuccess: () =>
			queryClient.setQueryData(
				["first-sign-in-walkthrough", session?.user.id],
				{ completed: true },
			),
	});
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

	const {
		data,
		isPending,
		isError,
		hasNextPage,
		isFetchingNextPage,
		isFetchNextPageError,
		fetchNextPage,
		refetch,
	} = useInfiniteQuery({
		queryKey: ["conversations", activeWorkspaceId, status, filters],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
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
				channelId: filters.channelId,
				tagId: filters.tagId,
				savedViewId: filters.savedViewId,
				dateFrom: filters.dateFrom,
				dateTo: filters.dateTo,
				cursor: pageParam,
				limit: 50,
			}),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: Boolean(activeWorkspaceId),
	});

	useEffect(() => {
		if (!activeWorkspaceId) return;
		const reconnect = createWorkspaceSocketReconnector(
			activeWorkspaceId,
			(event) =>
				handleWorkspaceConversationSocketEvent(
					queryClient,
					activeWorkspaceId,
					event,
				),
		);
		reconnect.start();
		return reconnect.stop;
	}, [activeWorkspaceId, queryClient]);

	const conversations = data?.pages.flatMap((page) => page.conversations) ?? [];

	useKeyboardShortcut("focus-search", () => {
		const input = searchInputRef.current;
		if (!input) return false;
		input.focus();
		return document.activeElement === input;
	});

	function navigateConversation(direction: -1 | 1): boolean {
		if (conversations.length === 0) return false;

		const selectedIndex = conversations.findIndex(
			(conversation) => conversation.id === conversationId,
		);
		const nextIndex =
			selectedIndex === -1
				? direction === 1
					? 0
					: conversations.length - 1
				: selectedIndex + direction;
		const nextConversation = conversations[nextIndex];
		if (!nextConversation) return false;

		navigate({
			to: "/",
			search: { workspace: activeWorkspaceId, c: nextConversation.id },
		});
		return true;
	}

	useKeyboardShortcut("previous-conversation", () => navigateConversation(-1));
	useKeyboardShortcut("next-conversation", () => navigateConversation(1));

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
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-onboarding-target="conversation-list"
		>
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
						<Badge variant="secondary">{conversations.length}</Badge>
					</div>
				</div>
				<Button size="sm" onClick={() => setNewEmailOpen(true)}>
					New email
				</Button>
			</div>
			<SearchBar
				filters={searchFilters}
				workspaceId={activeWorkspaceId}
				inputRef={searchInputRef}
				onChange={(next) =>
					setFilters((current) =>
						Object.keys(next).length === 0 ? next : { ...current, ...next },
					)
				}
			/>
			<div className="min-h-0 flex-1">
				{isPending ? (
					<ConversationListSkeleton />
				) : isError && conversations.length === 0 ? (
					<Alert className="m-3 w-auto" variant="destructive">
						<AlertTitle>Conversations could not be loaded</AlertTitle>
						<AlertDescription className="flex items-center justify-between gap-3">
							<span>Check your connection and try again.</span>
							<Button size="sm" variant="outline" onClick={() => void refetch()}>
								Retry
							</Button>
						</AlertDescription>
					</Alert>
				) : (
					<ConversationList
						conversations={conversations}
						hasNextPage={hasNextPage}
						isFetchingNextPage={isFetchingNextPage}
						isLoadMoreError={isFetchNextPageError}
						onLoadMore={() => {
							void fetchNextPage();
						}}
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
		<div
			className="flex h-full items-center justify-center text-sm text-muted-foreground"
			data-onboarding-target="conversation-detail"
		>
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
		<>
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
			<NewEmailDialog
				workspaceId={activeWorkspaceId}
				open={newEmailOpen}
				onOpenChange={setNewEmailOpen}
				onSent={(id) => {
					invalidateWorkspaceConversationViews(queryClient, activeWorkspaceId);
					navigate({
						to: "/",
						search: { workspace: activeWorkspaceId, c: id },
					});
				}}
			/>
			{activeWorkspaceId &&
			session &&
			walkthrough.data &&
			!walkthrough.data.completed ? (
				<FirstSignInWalkthrough
					onComplete={() => completeWalkthrough.mutateAsync()}
				/>
			) : null}
		</>
	);
}
