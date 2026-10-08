import type {
	Activity,
	Comment,
	ConversationEvent,
	Message,
	PresenceEntry,
	TimelineItem,
} from "@msgflow/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, conversationSocketUrl } from "@/lib/api";
import { emailApi } from "@/lib/email-api";
import { contactName, timeAgo } from "@/lib/format";
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";
import { cn } from "@/lib/utils";
import { Composer, type ComposerShortcutHandler } from "./Composer";
import { ContactAvatar } from "./ContactAvatar";
import { ConversationActions } from "./ConversationActions";
import { useKeyboardShortcut } from "./KeyboardShortcutsProvider";
import { TagPicker } from "./TagPicker";

const ACTIVITY_DISPLAY_LIMIT = 50;

export function ConversationThread({
	conversationId,
	workspaceId,
}: {
	conversationId: string;
	workspaceId: string;
}) {
	const queryClient = useQueryClient();
	const [liveMessages, setLiveMessages] = useState<Message[]>([]);
	const [liveComments, setLiveComments] = useState<Comment[]>([]);
	const [liveActivities, setLiveActivities] = useState<Activity[]>([]);
	const [activityOpen, setActivityOpen] = useState(false);
	const [presence, setPresence] = useState<PresenceEntry[]>([]);
	const [tagOpen, setTagOpen] = useState(false);
	const [assignOpen, setAssignOpen] = useState(false);
	const [moveOpen, setMoveOpen] = useState(false);
	const [snoozeOpen, setSnoozeOpen] = useState(false);
	const archiveRef = useRef<(() => boolean) | null>(null);
	const assignRef = useRef<(() => boolean) | null>(null);
	const moveRef = useRef<(() => boolean) | null>(null);
	const snoozeRef = useRef<(() => boolean) | null>(null);
	const tagRef = useRef<(() => boolean) | null>(null);
	const composerShortcutRef = useRef<ComposerShortcutHandler | null>(null);
	const [expandedEmailIds, setExpandedEmailIds] = useState<Set<string>>(
		() => new Set(),
	);
	const timelineScrollerRef = useRef<HTMLDivElement | null>(null);
	const prependAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(
		null,
	);
	const shouldAutoScrollRef = useRef(false);
	const didInitialScrollRef = useRef(false);
	const maxMarkedReadSeqRef = useRef(0);
	const isNearTimelineBottom = useCallback(() => {
		const scroller = timelineScrollerRef.current;
		return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 48;
	}, []);

	const { data: conversation, isPending: conversationPending } = useQuery({
		queryKey: ["conversation", workspaceId, conversationId],
		queryFn: () => api.getConversation(conversationId, workspaceId),
	});

	const {
		data: timeline,
		isPending: messagesPending,
		isError: messagesError,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isFetchNextPageError,
		refetch: refetchTimeline,
	} = useInfiniteQuery({
		queryKey: ["messages", workspaceId, conversationId],
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			api.getMessages(conversationId, workspaceId, {
				cursor: pageParam,
				limit: 50,
			}),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const emailContext = useQuery({
		queryKey: ["email-context", workspaceId, conversationId],
		queryFn: () => emailApi.context(conversationId, workspaceId),
		enabled: conversation?.channel === "email",
		refetchInterval: 5000,
	});
	const { data: usersData } = useQuery({
		queryKey: ["users", workspaceId],
		queryFn: () => api.listUsers(workspaceId),
	});
	const onArchiveChange = useCallback((archive: (() => boolean) | null) => {
		archiveRef.current = archive;
	}, []);
	const onAssignChange = useCallback((open: (() => boolean) | null) => {
		assignRef.current = open;
	}, []);
	const onMoveChange = useCallback((open: (() => boolean) | null) => {
		moveRef.current = open;
	}, []);
	const onSnoozeChange = useCallback((open: (() => boolean) | null) => {
		snoozeRef.current = open;
	}, []);
	const onTagOpenRequestChange = useCallback(
		(open: (() => boolean) | null) => {
			tagRef.current = open;
		},
		[],
	);
	const onComposerShortcutRequestChange = useCallback(
		(handler: ComposerShortcutHandler | null) => {
			composerShortcutRef.current = handler;
		},
		[],
	);

	useKeyboardShortcut("archive", () => {
		if (tagOpen || assignOpen || moveOpen || snoozeOpen) return false;
		return archiveRef.current?.() ?? false;
	});
	useKeyboardShortcut("tag", () => {
		if (tagOpen) return false;
		return tagRef.current?.() ?? false;
	});
	useKeyboardShortcut("assign", () => {
		if (assignOpen) return false;
		return assignRef.current?.() ?? false;
	});
	useKeyboardShortcut("move", () => {
		if (moveOpen) return false;
		return moveRef.current?.() ?? false;
	});
	useKeyboardShortcut("snooze", () => {
		if (snoozeOpen) return false;
		return snoozeRef.current?.() ?? false;
	});
	useKeyboardShortcut("focus-reply", () =>
		composerShortcutRef.current?.("focus-reply") ?? false,
	);
	useKeyboardShortcut("focus-comment", () =>
		composerShortcutRef.current?.("focus-comment") ?? false,
	);
	useKeyboardShortcut("saved-replies", () =>
		composerShortcutRef.current?.("saved-replies") ?? false,
	);
	useKeyboardShortcut("submit-composer", () =>
		composerShortcutRef.current?.("submit-composer") ?? false,
	);

	// Reset per-conversation live state when switching threads — handled by the
	// `key={conversationId}` remount in the parent; nothing to do here.

	// Real-time: WebSocket to the Conversation DO (authenticated via session cookie).
	useEffect(() => {
		const ws = new WebSocket(conversationSocketUrl(conversationId, workspaceId));
		// A successful socket subscription is also the hand-off from the initial
		// HTTP page to live state. Refetch the exact timeline so events appended
		// between the initial request and the subscription are not missed.
		ws.onopen = () => {
			queryClient.resetQueries({
				queryKey: ["messages", workspaceId, conversationId],
				exact: true,
			});
		};
		ws.onmessage = (event) => {
			const parsed = JSON.parse(event.data) as ConversationEvent;
			switch (parsed.type) {
				case "message:new":
					shouldAutoScrollRef.current ||= isNearTimelineBottom();
					setLiveMessages((prev) =>
						prev.some((message) => message.id === parsed.message.id)
							? prev
							: [...prev, parsed.message],
					);
					break;
				case "comment:new":
					shouldAutoScrollRef.current ||= isNearTimelineBottom();
					setLiveComments((prev) =>
						prev.some((comment) => comment.id === parsed.comment.id)
							? prev
							: [...prev, parsed.comment],
					);
					break;
				case "activity:new":
					shouldAutoScrollRef.current ||= isNearTimelineBottom();
					setLiveActivities((prev) =>
						prev.some((activity) => activity.id === parsed.activity.id)
							? prev
							: [...prev, parsed.activity],
					);
					break;
				case "conversation-updated":
					invalidateWorkspaceConversationViews(queryClient, workspaceId);
					queryClient.invalidateQueries({
						queryKey: ["conversation", workspaceId, conversationId],
					});
					break;
				case "presence":
					setPresence(parsed.agents);
					break;
				default:
					break;
			}
		};
		return () => ws.close();
	}, [conversationId, isNearTimelineBottom, queryClient, workspaceId]);

	const timelineItems = useMemo(() => {
		const items = new Map<string, TimelineItem>();
		for (const page of timeline?.pages ?? []) {
			for (const item of page.items) items.set(`${item.type}:${item.item.id}`, item);
		}
		for (const message of liveMessages)
			items.set(`message:${message.id}`, { type: "message", item: message });
		for (const comment of liveComments)
			items.set(`comment:${comment.id}`, { type: "comment", item: comment });
		for (const activity of liveActivities)
			items.set(`activity:${activity.id}`, { type: "activity", item: activity });
		return [...items.values()].sort(
			(a, b) =>
				a.item.createdAt.localeCompare(b.item.createdAt) ||
				a.item.id.localeCompare(b.item.id),
		);
	}, [timeline, liveMessages, liveComments, liveActivities]);
	const messageAndCommentItems = useMemo(
		() => timelineItems.filter((item) => item.type !== "activity"),
		[timelineItems],
	);
	const activities = useMemo(
		() =>
			timelineItems
				.filter((item): item is Extract<TimelineItem, { type: "activity" }> =>
					item.type === "activity",
				)
				.map((item) => item.item)
				.sort(
					(a, b) =>
						b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
				)
				.slice(0, ACTIVITY_DISPLAY_LIMIT)
				.reverse(),
		[timelineItems],
	);
	const agentNames = useMemo(
		() => new Map((usersData?.users ?? []).map((user) => [user.id, user.name])),
		[usersData],
	);
	const newestEmailId = useMemo(
		() =>
			[...timelineItems]
				.reverse()
				.find((item): item is Extract<TimelineItem, { type: "message" }> =>
					item.type === "message",
				)?.item.id,
		[timelineItems],
	);

	// Advance monotonically to the maximum fetched or live message seq; comments
	// and older pages must never move the server cursor backwards.
	useEffect(() => {
		const maxSeq = Math.max(
			0,
			...timelineItems
				.filter((item): item is Extract<TimelineItem, { type: "message" }> =>
					item.type === "message",
				)
				.map((item) => item.item.seq ?? 0),
		);
		if (maxSeq <= maxMarkedReadSeqRef.current) return;
		maxMarkedReadSeqRef.current = maxSeq;
		api
			.markRead(conversationId, workspaceId, maxSeq)
			.then(() =>
				invalidateWorkspaceConversationViews(queryClient, workspaceId),
			)
			.catch(() => {});
	}, [conversationId, timelineItems, queryClient, workspaceId]);


	useEffect(() => {
		const scroller = timelineScrollerRef.current;
		if (!scroller || timelineItems.length === 0) return;
		if (!didInitialScrollRef.current) {
			didInitialScrollRef.current = true;
			scroller.scrollTop = scroller.scrollHeight;
			return;
		}
		if (shouldAutoScrollRef.current) {
			shouldAutoScrollRef.current = false;
			scroller.scrollTop = scroller.scrollHeight;
		}
	}, [timelineItems]);

	const loadOlderHistory = useCallback(() => {
		const scroller = timelineScrollerRef.current;
		if (!hasNextPage || isFetchingNextPage) return;
		if (scroller) {
			prependAnchorRef.current = {
				scrollTop: scroller.scrollTop,
				scrollHeight: scroller.scrollHeight,
			};
		}
		void fetchNextPage().then(() => {
			requestAnimationFrame(() => {
				const anchor = prependAnchorRef.current;
				const updatedScroller = timelineScrollerRef.current;
				if (!anchor || !updatedScroller) return;
				updatedScroller.scrollTop =
					anchor.scrollTop + (updatedScroller.scrollHeight - anchor.scrollHeight);
				prependAnchorRef.current = null;
			});
		});
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	const handleTimelineScroll = useCallback(() => {
		const scroller = timelineScrollerRef.current;
		if (!scroller || scroller.scrollTop > 24) return;
		loadOlderHistory();
	}, [loadOlderHistory]);

	if (conversationPending) {
		return (
			<div
				className="flex h-full flex-col gap-4 p-5"
				role="status"
				aria-label="Loading conversation"
			>
				<Skeleton className="h-14 w-full" />
				<Skeleton className="h-24 w-3/4" />
				<Skeleton className="h-20 w-2/3 self-end" />
			</div>
		);
	}
	if (!conversation) {
		return (
			<Alert className="m-4 w-auto" variant="destructive">
				<AlertTitle>Conversation not found</AlertTitle>
				<AlertDescription>
					This conversation may have been removed or is no longer available.
				</AlertDescription>
			</Alert>
		);
	}

	const ReplyComposer = Composer;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex flex-col gap-3 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<ContactAvatar
						name={contactName(conversation.contact)}
						avatarUrl={conversation.contact.avatarUrl}
						className="size-10"
					/>
					<div className="min-w-0">
						<h2 className="truncate text-base font-semibold">
							{contactName(conversation.contact)}
						</h2>
						<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							<Badge variant="secondary">
								{conversation.channelDisplayName}
							</Badge>
							{conversation.subject ? (
								<span className="truncate">{conversation.subject}</span>
							) : null}
							{presence.length > 0 ? (
								<span>{presence.length} viewing</span>
							) : null}
						</div>
					</div>
				</div>
				<div className="flex min-w-0 items-center justify-between gap-1 sm:justify-end">
						<TagPicker
							conversationId={conversationId}
							workspaceId={workspaceId}
							tags={conversation.tags}
							open={tagOpen}
							onOpenChange={setTagOpen}
							onOpenRequestChange={onTagOpenRequestChange}
						/>
					<Separator orientation="vertical" className="hidden h-6 sm:block" />
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setActivityOpen(true)}
					>
						Activity
					</Button>
					<ConversationActions
						conversation={conversation}
						workspaceId={workspaceId}
						onArchiveChange={onArchiveChange}
						onAssignChange={onAssignChange}
						onMoveChange={onMoveChange}
						onSnoozeChange={onSnoozeChange}
						assignOpen={assignOpen}
						onAssignOpenChange={setAssignOpen}
						moveOpen={moveOpen}
						onMoveOpenChange={setMoveOpen}
						snoozeOpen={snoozeOpen}
						onSnoozeOpenChange={setSnoozeOpen}
					/>
				</div>
			</header>

			<section
				ref={timelineScrollerRef}
				onScroll={handleTimelineScroll}
				aria-label="Conversation timeline"
				className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
			>
				{hasNextPage ? (
					<Button
						type="button"
						variant="outline"
						className="shrink-0 self-center"
						disabled={isFetchingNextPage}
						onClick={loadOlderHistory}
					>
						{isFetchingNextPage
							? "Loading older history…"
							: isFetchNextPageError
								? "Retry loading older history"
								: "Load older history"}
					</Button>
				) : null}
				{messagesError && messageAndCommentItems.length === 0 ? (
					<Alert variant="destructive">
						<AlertTitle>Messages could not be loaded</AlertTitle>
						<AlertDescription className="flex items-center justify-between gap-3">
							<span>Check your connection and try again.</span>
							<Button size="sm" variant="outline" onClick={() => void refetchTimeline()}>
								Retry
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{messagesPending && messageAndCommentItems.length === 0 ? (
					<div
						className="flex flex-col gap-3"
						role="status"
						aria-label="Loading messages"
					>
						<Skeleton className="h-20 w-3/4" />
						<Skeleton className="h-16 w-2/3 self-end" />
					</div>
				) : !messagesError && messageAndCommentItems.length === 0 ? (
					<Alert>
						<AlertTitle>No messages yet</AlertTitle>
						<AlertDescription>
							This conversation is waiting for its first message.
						</AlertDescription>
					</Alert>
				) : (
					messageAndCommentItems.map((item) =>
						item.type === "message" ? (
							<MessageBubble
								key={item.item.id}
								message={item.item}
								isEmail={conversation.channel === "email"}
								workspaceId={workspaceId}
								collapsed={
									conversation.channel === "email" &&
									item.item.id !== newestEmailId &&
									!expandedEmailIds.has(item.item.id)
								}
								onCollapsedChange={() =>
									setExpandedEmailIds((current) => {
										const next = new Set(current);
										if (next.has(item.item.id)) next.delete(item.item.id);
										else next.add(item.item.id);
										return next;
									})
								}
							/>
						) : (
							<CommentBubble key={item.item.id} comment={item.item} />
						),
					)
				)}
				{conversation.channel === "email" ? (
					<section
						aria-label="Email delivery attempts"
						className="shrink-0 rounded border p-3 text-xs text-muted-foreground"
					>
						<div className="flex items-center justify-between">
							<h3 className="font-medium">Email delivery attempts</h3>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => void emailContext.refetch()}
							>
								Refresh status
							</Button>
						</div>
						{emailContext.isError ? (
							<p role="alert">Delivery status unavailable.</p>
						) : null}
						<ul className="flex flex-col gap-2">
							{emailContext.data?.deliveryStates.map((d) => (
								<li key={d.id}>
									<span className="font-medium">
										{d.state === "accepted"
											? "Accepted by provider — delivery not confirmed"
											: d.state === "uncertain"
												? "Uncertain — do not resend; operator reconciliation required"
												: d.state === "failed"
													? "Failed"
													: d.state}
									</span>
									{d.fromAddress ? ` · From: ${d.fromAddress}` : ""}
									<span className="block">
										{d.id}
										{d.error ? ` · ${d.error}` : ""}
									</span>
								</li>
							))}
						</ul>
					</section>
				) : null}
			</section>

			<div className="border-t px-4 py-3">
				<ReplyComposer
					conversationId={conversationId}
					workspaceId={workspaceId}
					showSubject={conversation.channel === "email"}
					attachmentUnavailable={conversation.channel === "whatsapp"}
					onSent={() => {
						shouldAutoScrollRef.current ||= isNearTimelineBottom();
						queryClient.resetQueries({
							queryKey: ["messages", workspaceId, conversationId],
						});
					}}
					onCommentCreated={(comment) => {
						shouldAutoScrollRef.current ||= isNearTimelineBottom();
						setLiveComments((prev) =>
							prev.some((item) => item.id === comment.id)
								? prev
								: [...prev, comment],
						);
					}}
					onShortcutRequestChange={onComposerShortcutRequestChange}
				/>
			</div>
			{activityOpen ? (
				<ActivityModal
					activities={activities}
					agentNames={agentNames}
					onClose={() => setActivityOpen(false)}
				/>
			) : null}
		</div>
	);
}

function MessageBubble({
	message,
	isEmail,
	workspaceId,
	collapsed = false,
	onCollapsedChange,
}: {
	message: Message;
	isEmail: boolean;
	workspaceId: string;
	collapsed?: boolean;
	onCollapsedChange?: () => void;
}) {
	const inbound = message.kind === "inbound";
	if (isEmail) {
		return (
			<EmailMessageCard
				message={message}
				inbound={inbound}
				workspaceId={workspaceId}
				collapsed={collapsed}
				onCollapsedChange={onCollapsedChange}
			/>
		);
	}
	return (
		<div
			className={cn("flex shrink-0", inbound ? "justify-start" : "justify-end")}
			data-channel-presentation="messenger"
		>
			<div
				className={cn(
					"max-w-[75%] rounded-lg px-3 py-2 text-sm",
					inbound
						? "bg-muted text-foreground"
						: "bg-primary text-primary-foreground",
				)}
			>
				{message.text ? (
					<p className="whitespace-pre-wrap break-words">{message.text}</p>
				) : null}
				{message.attachments.length > 0 ? (
					<div className="mt-2 grid gap-2">
						{message.attachments.map((attachment) => (
							<a
								key={attachment.id}
								href={
									isEmail
										? emailApi.attachmentUrl(attachment.id, workspaceId)
										: attachment.url
								}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								{isEmail ? (
									`Download ${attachment.name}`
								) : (
									<img
										src={attachment.url}
										alt={attachment.name}
										className="max-h-64 rounded object-contain"
										loading="lazy"
									/>
								)}
							</a>
						))}
					</div>
				) : null}
				<p
					className={cn(
						"mt-1 text-[10px]",
						inbound ? "text-muted-foreground" : "text-primary-foreground/70",
					)}
				>
					{timeAgo(message.createdAt)}
				</p>
			</div>
		</div>
	);
}

function EmailMessageCard({
	message,
	inbound,
	workspaceId,
	collapsed,
	onCollapsedChange,
}: {
	message: Message;
	inbound: boolean;
	workspaceId: string;
	collapsed: boolean;
	onCollapsedChange?: () => void;
}) {
	return (
		<article
			className={cn(
				"shrink-0 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs",
				inbound ? "mr-10" : "ml-10 border-primary/25",
			)}
			data-channel-presentation="email"
			data-email-direction={inbound ? "received" : "sent"}
		>
			<div
				className={cn(
					"flex items-center justify-between gap-3 px-4 py-2.5",
					inbound ? "bg-muted/40" : "bg-secondary/60",
				)}
			>
				<div className="min-w-0">
					<p className="text-sm font-medium">
						{inbound ? "Incoming email" : "Sent email"}
					</p>
					<p className="truncate text-xs text-muted-foreground">
						{inbound ? "From contact" : "From your team"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<time className="text-xs text-muted-foreground">
						{timeAgo(message.createdAt)}
					</time>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="size-7"
								aria-expanded={!collapsed}
								aria-label={collapsed ? "Show email" : "Hide email"}
								onClick={onCollapsedChange}
							>
								{collapsed ? <ChevronDown /> : <ChevronUp />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{collapsed ? "Show email" : "Hide email"}
						</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<div
				className={cn(
					"flex flex-col gap-3 border-t px-4 py-4 text-sm",
				)}
				hidden={collapsed}
			>
				{message.html ? (
					<div
						className="email-html break-words leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded"
						// Sanitized and CID-rewritten on the Worker; raw MIME HTML never reaches the client.
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Worker sanitization removes executable content and remote resources before persistence.
						dangerouslySetInnerHTML={{ __html: message.html }}
					/>
				) : message.text ? (
					<p className="whitespace-pre-wrap break-words leading-relaxed">
						{message.text}
					</p>
				) : null}
				{message.attachments.some((attachment) => attachment.disposition !== "inline") ? (
					<div className="flex flex-col gap-2 border-t pt-3">
						<p className="text-xs font-medium text-muted-foreground">
							Attachments
						</p>
						{message.attachments
							.filter((attachment) => attachment.disposition !== "inline")
							.map((attachment) => (
							<a
								key={attachment.id}
								href={emailApi.attachmentUrl(attachment.id, workspaceId)}
								target="_blank"
								rel="noreferrer"
								className="w-fit text-primary underline underline-offset-4"
							>
								Download {attachment.name}
							</a>
						))}
					</div>
				) : null}
			</div>
		</article>
	);
}

function CommentBubble({ comment }: { comment: Comment }) {
	return (
		<div className="shrink-0 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground">
			<div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				<span>Comment</span>
				<span className="normal-case font-normal tracking-normal">
					{timeAgo(comment.createdAt)}
				</span>
			</div>
			<p className="whitespace-pre-wrap break-words">{comment.text}</p>
		</div>
	);
}

function ActivityModal({
	activities,
	agentNames,
	onClose,
}: {
	activities: Activity[];
	agentNames: Map<string, string>;
	onClose: () => void;
}) {
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex max-h-[min(42rem,calc(100vh-2rem))] max-w-lg flex-col">
				<DialogHeader>
					<DialogTitle>Activity</DialogTitle>
					<DialogDescription>
						Latest {ACTIVITY_DISPLAY_LIMIT} changes
					</DialogDescription>
				</DialogHeader>
				<div className="overflow-y-auto">
					{activities.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No activity recorded yet.
						</p>
					) : (
						<ol className="flex flex-col gap-3 border-l pl-4">
							{activities.map((activity) => (
								<li
									key={activity.id}
									className="relative text-sm text-muted-foreground"
								>
									<span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/50" />
									<ActivityLine activity={activity} agentNames={agentNames} />
								</li>
							))}
						</ol>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ActivityLine({
	activity,
	agentNames,
}: {
	activity: Activity;
	agentNames: Map<string, string>;
}) {
	const actor = "actorId" in activity && activity.actorId
		? (agentNames.get(activity.actorId) ?? "An agent")
		: "System";
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span>
				<strong className="font-medium text-foreground">{actor}</strong>{" "}
				{activityDescription(activity)}
			</span>
			<span className="shrink-0 text-[10px]">
				{timeAgo(activity.createdAt)}
			</span>
		</div>
	);
}

function activityDescription(activity: Activity): string {
	if (activity.action.startsWith("call.")) {
		switch (activity.action) {
			case "call.received":
				return "received an incoming call";
			case "call.ringing":
				return "is ringing agents";
			case "call.offered":
				return "offered a call to an agent";
			case "call.accepted":
				return "connected a call";
			case "call.rejected":
				return "declined a call";
			case "call.terminated":
				return "ended a call";
			case "call.timed_out":
				return "timed out a call";
			case "call.no_agent_reply":
				return "had no agent answer a call";
			case "call.failed":
				return "could not complete a call";
			case "call.media_updated":
				return "updated call media";
			case "call.quality_reported":
				return "recorded call quality";
		}
	}
	if (activity.action === "tag.added") return "added a tag";
	if (activity.action === "tag.removed") return "removed a tag";
	if (activity.action === "snooze.expired") return "revived this conversation";

	if (!("changes" in activity.details)) return "updated this conversation";
	const changes = activity.details.changes;
	if (!changes || typeof changes !== "object")
		return "updated this conversation";
	const keys = Object.keys(changes);
	if (keys.includes("status")) return "changed the status";
	if (keys.includes("assigneeId")) return "changed the assignee";
	if (keys.includes("snoozedUntil")) return "updated the snooze";
	if (keys.includes("inboxId")) return "moved this conversation";
	return "updated this conversation";
}
