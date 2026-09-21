import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Shared-inbox switcher (ADR 0008): tabs for each inbox the agent is a member
 * of, plus "All". Selecting one filters the conversation list by inboxId.
 */
export function InboxSwitcher({
	inboxId,
	onChange,
}: {
	inboxId?: string;
	onChange: (inboxId: string | undefined) => void;
}) {
	const { data } = useQuery({
		queryKey: ["inboxes"],
		queryFn: () => api.listInboxes(),
	});

	// Single-tenant bootstrap: every agent sees every inbox. When membership
	// enforcement lands (workspace RBAC), filter to inbox.memberIds.includes
	// the agent id here.
	const myInboxes = data?.inboxes ?? [];

	return (
		<nav className="flex gap-1">
			<button
				type="button"
				onClick={() => onChange(undefined)}
				className={cn(
					"rounded-md px-3 py-1 text-sm transition-colors",
					!inboxId
						? "bg-primary text-primary-foreground"
						: "text-gray-500 hover:bg-accent",
				)}
			>
				All
			</button>
			{myInboxes.map((inbox) => (
				<button
					key={inbox.id}
					type="button"
					onClick={() => onChange(inbox.id)}
					title={`${inbox.conversationCount} conversations · ${inbox.channels.length} channel${inbox.channels.length === 1 ? "" : "s"}`}
					className={cn(
						"rounded-md px-3 py-1 text-sm transition-colors",
						inboxId === inbox.id
							? "bg-primary text-primary-foreground"
							: "text-gray-500 hover:bg-accent",
					)}
				>
					{inbox.name}
				</button>
			))}
		</nav>
	);
}
