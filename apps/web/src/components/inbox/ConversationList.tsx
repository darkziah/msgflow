import type { ConversationSummary } from "@msgflow/contracts";
import { Inbox, Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { contactName, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./ContactAvatar";
import { TagChip } from "./TagChip";

interface Props {
	conversations: ConversationSummary[];
	selectedId?: string;
	onSelect: (id: string) => void;
}

export function ConversationList({
	conversations,
	selectedId,
	onSelect,
}: Props) {
	if (conversations.length === 0) {
		return (
			<Empty className="h-full border-0">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Inbox aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No conversations here yet.</EmptyTitle>
					<EmptyDescription>
						Try a different queue or clear your filters.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<ul className="h-full divide-y overflow-y-auto" aria-label="Conversations">
			{conversations.map((conversation) => {
				const name = contactName(conversation.contact);
				const selected = conversation.id === selectedId;
				const ChannelIcon = conversation.channel === "email" ? Mail : MessageCircle;
				const channelLabel = conversation.channel === "email" ? "Email" : "Facebook";
				return (
					<li key={conversation.id}>
						<button
							type="button"
							onClick={() => onSelect(conversation.id)}
							aria-pressed={selected}
							className={cn(
								"flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
								selected ? "bg-primary/10" : "hover:bg-accent",
							)}
						>
							<ContactAvatar
								name={name}
								avatarUrl={conversation.contact.avatarUrl}
								className="mt-0.5 size-9"
							/>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline justify-between gap-2">
									<span className="truncate text-sm font-semibold">{name}</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										{timeAgo(conversation.lastMessageAt)}
									</span>
								</span>
								{conversation.subject ? (
									<span className="block truncate text-xs text-muted-foreground">
										{conversation.subject}
									</span>
								) : null}
								<span className="mt-0.5 flex items-center gap-2">
									<span className="truncate text-sm text-muted-foreground">
										{conversation.lastMessagePreview ?? "No messages yet"}
									</span>
									{conversation.unreadCount > 0 ? (
										<Badge aria-label={`${conversation.unreadCount} unread`}>
											{conversation.unreadCount}
										</Badge>
									) : null}
								</span>
								{conversation.tags.length > 0 ? (
									<span className="mt-1 flex flex-wrap gap-1">
										{conversation.tags.map((tag) => (
											<TagChip key={tag.id} tag={tag} />
										))}
									</span>
								) : null}
							</span>
							<span className="mt-1 shrink-0 text-muted-foreground" title={channelLabel}>
								<ChannelIcon aria-label={channelLabel} role="img" className="size-3.5" />
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

export function ConversationListSkeleton() {
	return (
		<div
			className="flex flex-col gap-3 p-3"
			role="status"
			aria-label="Loading conversations"
		>
			{["first", "second", "third", "fourth"].map((key) => (
				<div key={key} className="flex items-start gap-3">
					<Skeleton className="size-9 rounded-full" />
					<div className="flex flex-1 flex-col gap-2">
						<Skeleton className="h-3 w-2/5" />
						<Skeleton className="h-3 w-4/5" />
					</div>
				</div>
			))}
		</div>
	);
}
