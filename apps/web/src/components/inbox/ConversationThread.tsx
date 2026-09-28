import type {
	Activity,
	Comment,
	ConversationEvent,
	Message,
	PresenceEntry,
} from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ContactAvatar } from "./ContactAvatar";
import { ConversationActions } from "./ConversationActions";
import { TagPicker } from "./TagPicker";

const ACTIVITY_DISPLAY_LIMIT = 50;

export function ConversationThread({
	conversationId,
}: {
	conversationId: string;
}) {
	const queryClient = useQueryClient();
	const [liveMessages, setLiveMessages] = useState<Message[]>([]);
	const [liveComments, setLiveComments] = useState<Comment[]>([]);
	const [liveActivities, setLiveActivities] = useState<Activity[]>([]);
	const [activityOpen, setActivityOpen] = useState(false);
	const [presence, setPresence] = useState<PresenceEntry[]>([]);
	const [expandedEmailIds, setExpandedEmailIds] = useState<Set<string>>(
		() => new Set(),
	);

	const { data: conversation, isPending: conversationPending } = useQuery({
		queryKey: ["conversation", conversationId],
		queryFn: () => api.getConversation(conversationId),
	});

	const { data: timeline, isPending: messagesPending } = useQuery({
		queryKey: ["messages", conversationId],
		queryFn: () => api.getMessages(conversationId),
	});
	const emailContext = useQuery({
		queryKey: ["email-context", conversationId],
		queryFn: () => emailApi.context(conversationId),
		enabled: conversation?.channel === "email",
		refetchInterval: 5000,
	});
	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});

	// Reset per-conversation live state when switching threads — handled by the
	// `key={conversationId}` remount in the parent; nothing to do here.

	// Real-time: WebSocket to the Conversation DO (authenticated via session cookie).
	useEffect(() => {
		const ws = new WebSocket(conversationSocketUrl(conversationId));
		ws.onmessage = (event) => {
			const parsed = JSON.parse(event.data) as ConversationEvent;
			switch (parsed.type) {
				case "message:new":
					setLiveMessages((prev) =>
						prev.some((message) => message.id === parsed.message.id)
							? prev
							: [...prev, parsed.message],
					);
					break;
				case "comment:new":
					setLiveComments((prev) =>
						prev.some((comment) => comment.id === parsed.comment.id)
							? prev
							: [...prev, parsed.comment],
					);
					break;
				case "activity:new":
					setLiveActivities((prev) =>
						prev.some((activity) => activity.id === parsed.activity.id)
							? prev
							: [...prev, parsed.activity],
					);
					break;
				case "conversation-updated":
					queryClient.invalidateQueries({ queryKey: ["conversations"] });
					queryClient.invalidateQueries({
						queryKey: ["conversation", conversationId],
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
	}, [conversationId, queryClient]);

	const timelineItems = useMemo(() => {
		const messages = [...(timeline?.messages ?? [])];
		for (const message of liveMessages) {
			if (!messages.some((item) => item.id === message.id))
				messages.push(message);
		}
		const comments = [...(timeline?.comments ?? [])];
		for (const comment of liveComments) {
			if (!comments.some((item) => item.id === comment.id))
				comments.push(comment);
		}
		return [...messages, ...comments].sort(
			(a, b) =>
				a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
		);
	}, [timeline, liveMessages, liveComments]);
	const activities = useMemo(() => {
		const items = [...(timeline?.activities ?? [])];
		for (const activity of liveActivities) {
			if (!items.some((item) => item.id === activity.id)) items.push(activity);
		}
		return items
			.sort(
				(a, b) =>
					b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
			)
			.slice(0, ACTIVITY_DISPLAY_LIMIT)
			.reverse();
	}, [timeline, liveActivities]);
	const agentNames = useMemo(
		() => new Map((usersData?.users ?? []).map((user) => [user.id, user.name])),
		[usersData],
	);
	const newestEmailId = useMemo(
		() =>
			[...timelineItems]
				.reverse()
				.find((item): item is Message => "kind" in item)?.id,
		[timelineItems],
	);

	// Advance the read cursor to the latest message seq (ADR 0015); comments do
	// not participate in unread counts.
	useEffect(() => {
		const lastMessage = [...timelineItems]
			.reverse()
			.find((item): item is Message => "kind" in item);
		if (!lastMessage || typeof lastMessage.seq !== "number") return;
		api.markRead(conversationId, lastMessage.seq).catch(() => {});
		queryClient.invalidateQueries({ queryKey: ["conversations"] });
	}, [conversationId, timelineItems, queryClient]);

	// Keep the newest timeline item in view whenever the timeline grows.
	const bottomRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (timelineItems.length === 0) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [timelineItems]);

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
					<TagPicker conversationId={conversationId} tags={conversation.tags} />
					<Separator orientation="vertical" className="hidden h-6 sm:block" />
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setActivityOpen(true)}
					>
						Activity
					</Button>
					<ConversationActions conversation={conversation} />
				</div>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
				{messagesPending && timelineItems.length === 0 ? (
					<div
						className="flex flex-col gap-3"
						role="status"
						aria-label="Loading messages"
					>
						<Skeleton className="h-20 w-3/4" />
						<Skeleton className="h-16 w-2/3 self-end" />
					</div>
				) : timelineItems.length === 0 ? (
					<Alert>
						<AlertTitle>No messages yet</AlertTitle>
						<AlertDescription>
							This conversation is waiting for its first message.
						</AlertDescription>
					</Alert>
				) : (
					timelineItems.map((item) =>
						"kind" in item ? (
							<MessageBubble
								key={item.id}
								message={item}
								isEmail={conversation.channel === "email"}
								collapsed={
									conversation.channel === "email" &&
									item.id !== newestEmailId &&
									!expandedEmailIds.has(item.id)
								}
								onCollapsedChange={() =>
									setExpandedEmailIds((current) => {
										const next = new Set(current);
										if (next.has(item.id)) next.delete(item.id);
										else next.add(item.id);
										return next;
									})
								}
							/>
						) : (
							<CommentBubble key={item.id} comment={item} />
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
				<div ref={bottomRef} />
			</div>

			<div className="border-t px-4 py-3">
				<ReplyComposer
					conversationId={conversationId}
					showSubject={conversation.channel === "email"}
					onSent={() =>
						queryClient.invalidateQueries({
							queryKey: ["messages", conversationId],
						})
					}
					onCommentCreated={(comment) =>
						setLiveComments((prev) =>
							prev.some((item) => item.id === comment.id)
								? prev
								: [...prev, comment],
						)
					}
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
	collapsed = false,
	onCollapsedChange,
}: {
	message: Message;
	isEmail: boolean;
	collapsed?: boolean;
	onCollapsedChange?: () => void;
}) {
	const inbound = message.kind === "inbound";
	if (isEmail) {
		return (
			<EmailMessageCard
				message={message}
				inbound={inbound}
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
										? emailApi.attachmentUrl(attachment.id)
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
	collapsed,
	onCollapsedChange,
}: {
	message: Message;
	inbound: boolean;
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
								href={emailApi.attachmentUrl(attachment.id)}
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
	const actor = activity.actorId
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
	if (activity.action === "tag.added") return "added a tag";
	if (activity.action === "tag.removed") return "removed a tag";
	if (activity.action === "snooze.expired") return "revived this conversation";

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
