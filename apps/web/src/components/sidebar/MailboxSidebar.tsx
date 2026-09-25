import { useQuery } from "@tanstack/react-query";
import { emailApi } from "@/lib/email-api";
import { cn } from "@/lib/utils";
export function MailboxSidebar({
	workspaceId,
	userId,
	selected,
	compact,
	onSelect,
}: {
	workspaceId: string;
	userId: string;
	selected?: string;
	compact: boolean;
	onSelect: (id: string) => void;
}) {
	const query = useQuery({
		queryKey: ["assigned-mailboxes", workspaceId, userId],
		queryFn: () => emailApi.assigned(workspaceId),
		refetchInterval: 5000,
	});
	return (
		<section
			aria-label="Assigned email mailboxes"
			className="mb-3 border-b pb-3"
		>
			<h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground">
				{compact ? "Mail" : "Mailboxes"}
			</h3>
			{query.isPending ? <p className="px-2 text-xs">Loading…</p> : null}
			{query.isError ? (
				<p role="alert" className="px-2 text-xs text-red-600">
					Mailboxes unavailable
				</p>
			) : null}
			{query.data?.mailboxes.length === 0 ? (
				<p className="px-2 text-xs text-muted-foreground">
					No assigned mailboxes
				</p>
			) : null}
			{query.data?.mailboxes.map((m) => (
				<button
					key={m.id}
					type="button"
					title={`${m.canonicalAddress} · ${m.type} · ${m.openCount} open / ${m.totalCount} conversations`}
					aria-pressed={selected === m.id}
					onClick={() => onSelect(m.id)}
					className={cn(
						"flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent",
						selected === m.id && "bg-accent",
					)}
				>
					<span aria-hidden="true">{m.type === "private" ? "P" : "S"}</span>
					{!compact ? (
						<span className="min-w-0 flex-1">
							<span className="block truncate">{m.canonicalAddress}</span>
							<span className="text-muted-foreground">
								{m.type} · {m.totalCount} conversations
							</span>
						</span>
					) : null}
					<span title={`${m.openCount} open`} className="font-semibold">
						{m.openCount}
					</span>
				</button>
			))}
		</section>
	);
}
