import type {
	Activity,
	Comment,
	ConversationEvent,
	Message,
	PresenceEntry,
} from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, conversationSocketUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { contactName, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./ContactAvatar";
import { Composer } from "./Composer";
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

	const { data: conversation, isPending: conversationPending } = useQuery({
		queryKey: ["conversation", conversationId],
		queryFn: () => api.getConversation(conversationId),
	});

	const { data: timeline, isPending: messagesPending } = useQuery({
		queryKey: ["messages", conversationId],
		queryFn: () => api.getMessages(conversationId),
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
			if (!messages.some((item) => item.id === message.id)) messages.push(message);
		}
		const comments = [...(timeline?.comments ?? [])];
		for (const comment of liveComments) {
			if (!comments.some((item) => item.id === comment.id)) comments.push(comment);
		}
		return [...messages, ...comments].sort(
			(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
		);
	}, [timeline, liveMessages, liveComments]);
	const activities = useMemo(() => {
		const items = [...(timeline?.activities ?? [])];
		for (const activity of liveActivities) {
			if (!items.some((item) => item.id === activity.id)) items.push(activity);
		}
		return items
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
			.slice(0, ACTIVITY_DISPLAY_LIMIT)
			.reverse();
	}, [timeline, liveActivities]);
	const agentNames = useMemo(
		() => new Map((usersData?.users ?? []).map((user) => [user.id, user.name])),
		[usersData],
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
			<div className="flex h-full items-center justify-center text-sm text-gray-400">
				Loading…
			</div>
		);
	}
	if (!conversation) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-gray-400">
				Conversation not found.
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<header className="flex items-center justify-between gap-3 border-b px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<ContactAvatar
						name={contactName(conversation.contact)}
						avatarUrl={conversation.contact.avatarUrl}
						className="size-9"
					/>
					<div className="min-w-0">
						<h2 className="truncate text-base font-bold">
							{contactName(conversation.contact)}
						</h2>
						<p className="truncate text-xs text-gray-500">
							{conversation.channelDisplayName}
							{conversation.subject ? ` · ${conversation.subject}` : ""}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<TagPicker conversationId={conversationId} tags={conversation.tags} />
					{presence.length > 0 ? (
						<span className="text-xs text-gray-400">
							{presence.length} viewing
						</span>
					) : null}
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

			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
				{messagesPending && timelineItems.length === 0 ? (
					<p className="text-center text-sm text-gray-400">Loading messages…</p>
				) : timelineItems.length === 0 ? (
					<p className="text-center text-sm text-gray-400">
						No messages yet — this conversation is waiting for its first
						message.
					</p>
				) : (
					timelineItems.map((item) =>
						"kind" in item ? (
							<MessageBubble key={item.id} message={item} />
						) : (
							<CommentBubble key={item.id} comment={item} />
						),
					)
				)}
				<div ref={bottomRef} />
			</div>

			<div className="border-t px-4 py-3">
				<Composer
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

function MessageBubble({ message }: { message: Message }) {
	const inbound = message.kind === "inbound";
	return (
		<div className={cn("flex", inbound ? "justify-start" : "justify-end")}>
			<div
				className={cn(
					"max-w-[75%] rounded-lg px-3 py-2 text-sm",
					inbound
						? "bg-gray-100 text-gray-900"
						: "bg-primary text-primary-foreground",
				)}
			>
				{message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
				{message.attachments.length > 0 ? (
					<div className="mt-2 grid gap-2">
						{message.attachments.map((attachment) => (
							<a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
								<img src={attachment.url} alt={attachment.name} className="max-h-64 rounded object-contain" loading="lazy" />
							</a>
						))}
					</div>
				) : null}
				<p
					className={cn(
						"mt-1 text-[10px]",
						inbound ? "text-gray-400" : "text-primary-foreground/70",
					)}
				>
					{timeAgo(message.createdAt)}
				</p>
			</div>
		</div>
	);
}

function CommentBubble({ comment }: { comment: Comment }) {
	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
			<div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
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
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		>
			<section
				className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-lg flex-col rounded-lg border bg-background shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="activity-dialog-title"
			>
				<header className="flex items-center justify-between border-b px-5 py-4">
					<div>
						<h3 id="activity-dialog-title" className="text-base font-semibold">
							Activity
						</h3>
						<p className="text-xs text-muted-foreground">
							Latest {ACTIVITY_DISPLAY_LIMIT} changes
						</p>
					</div>
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Close
					</Button>
				</header>
				<div className="overflow-y-auto px-5 py-4">
					{activities.length === 0 ? (
						<p className="text-sm text-muted-foreground">No activity recorded yet.</p>
					) : (
						<ol className="space-y-3 border-l pl-4">
							{activities.map((activity) => (
								<li key={activity.id} className="relative text-sm text-muted-foreground">
									<span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/50" />
									<ActivityLine activity={activity} agentNames={agentNames} />
								</li>
							))}
						</ol>
					)}
				</div>
			</section>
		</div>
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
			<span className="shrink-0 text-[10px]">{timeAgo(activity.createdAt)}</span>
		</div>
	);
}

function activityDescription(activity: Activity): string {
	if (activity.action === "tag.added") return "added a tag";
	if (activity.action === "tag.removed") return "removed a tag";
	if (activity.action === "snooze.expired") return "revived this conversation";

	const changes = activity.details.changes;
	if (!changes || typeof changes !== "object") return "updated this conversation";
	const keys = Object.keys(changes);
	if (keys.includes("status")) return "changed the status";
	if (keys.includes("assigneeId")) return "changed the assignee";
	if (keys.includes("snoozedUntil")) return "updated the snooze";
	if (keys.includes("inboxId")) return "moved this conversation";
	return "updated this conversation";
}
