import type {
	ConversationEvent,
	Message,
	PresenceEntry,
} from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, conversationSocketUrl } from "@/lib/api";
import { contactName, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./ContactAvatar";
import { Composer } from "./Composer";
import { ConversationActions } from "./ConversationActions";
import { TagPicker } from "./TagPicker";

export function ConversationThread({
	conversationId,
}: {
	conversationId: string;
}) {
	const queryClient = useQueryClient();
	const [liveMessages, setLiveMessages] = useState<Message[]>([]);
	const [presence, setPresence] = useState<PresenceEntry[]>([]);

	const { data: conversation, isPending: conversationPending } = useQuery({
		queryKey: ["conversation", conversationId],
		queryFn: () => api.getConversation(conversationId),
	});

	const { data: timeline, isPending: messagesPending } = useQuery({
		queryKey: ["messages", conversationId],
		queryFn: () => api.getMessages(conversationId),
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
						prev.some((m) => m.id === parsed.message.id)
							? prev
							: [...prev, parsed.message],
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

	// Initial timeline + anything that arrived over the WS, deduped by id.
	const messages = useMemo(() => {
		const merged = [...(timeline?.messages ?? [])];
		for (const message of liveMessages) {
			if (!merged.some((m) => m.id === message.id)) merged.push(message);
		}
		return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}, [timeline, liveMessages]);

	// Advance the read cursor to the latest seq (ADR 0015); the list refetches
	// so unread counts clear.
	useEffect(() => {
		const last = messages[messages.length - 1];
		if (!last || typeof last.seq !== "number") return;
		api.markRead(conversationId, last.seq).catch(() => {});
		queryClient.invalidateQueries({ queryKey: ["conversations"] });
	}, [conversationId, messages, queryClient]);

	// Keep the newest message in view whenever the timeline grows.
	const bottomRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (messages.length === 0) return;
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

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
					<ConversationActions conversation={conversation} />
				</div>
			</header>

			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
				{messagesPending && messages.length === 0 ? (
					<p className="text-center text-sm text-gray-400">Loading messages…</p>
				) : messages.length === 0 ? (
					<p className="text-center text-sm text-gray-400">
						No messages yet — this conversation is waiting for its first
						message.
					</p>
				) : (
					messages.map((message) => (
						<MessageBubble key={message.id} message={message} />
					))
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
				/>
			</div>
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
				<p className="whitespace-pre-wrap break-words">{message.text}</p>
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
