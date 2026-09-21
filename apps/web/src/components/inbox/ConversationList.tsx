import type { ConversationSummary } from "@msgflow/contracts";
import { Mail, MessageCircle } from "lucide-react";
import { contactName, initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
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
			<div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
				No conversations here yet.
			</div>
		);
	}

	return (
		<ul className="h-full divide-y overflow-y-auto">
			{conversations.map((conversation) => {
				const name = contactName(conversation.contact);
				const selected = conversation.id === selectedId;
				return (
					<li key={conversation.id}>
						<button
							type="button"
							onClick={() => onSelect(conversation.id)}
							className={cn(
								"flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
								selected ? "bg-primary/10" : "hover:bg-accent",
							)}
						>
							<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
								{initials(name)}
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline justify-between gap-2">
									<span className="truncate text-sm font-semibold">{name}</span>
									<span className="shrink-0 text-xs text-gray-400">
										{timeAgo(conversation.lastMessageAt)}
									</span>
								</span>
								{conversation.subject ? (
									<span className="block truncate text-xs text-gray-500">
										{conversation.subject}
									</span>
								) : null}
								<span className="mt-0.5 flex items-center justify-between gap-2">
									<span className="truncate text-sm text-gray-500">
										{conversation.lastMessagePreview ?? "No messages yet"}
									</span>
									{conversation.unreadCount > 0 ? (
										<span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
											{conversation.unreadCount}
										</span>
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
							{conversation.channel === "email" ? (
								<Mail className="mt-1 size-3.5 shrink-0 text-gray-400" />
							) : (
								<MessageCircle className="mt-1 size-3.5 shrink-0 text-gray-400" />
							)}
						</button>
					</li>
				);
			})}
		</ul>
	);
}
