import type {
	ConversationSummary,
	ConversationUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

// Snooze presets (ADR 0008: snoozing is orthogonal to open/archived status —
// it only sets snoozed_until; the conversation stays "open").
const SNOOZE_OPTIONS = [
	{ label: "1 hour", value: "1h" },
	{ label: "4 hours", value: "4h" },
	{ label: "Tomorrow", value: "1d" },
	{ label: "Next week", value: "7d" },
] as const;

function snoozeTarget(kind: string): string {
	const now = new Date();
	switch (kind) {
		case "1h":
			return new Date(now.getTime() + 3600e3).toISOString();
		case "4h":
			return new Date(now.getTime() + 4 * 3600e3).toISOString();
		default: {
			const days = kind === "7d" ? 7 : 1;
			const target = new Date(now);
			target.setDate(target.getDate() + days);
			target.setHours(9, 0, 0, 0); // 9am local, like Front's "tomorrow"
			return target.toISOString();
		}
	}
}

export function ConversationActions({
	conversation,
}: {
	conversation: ConversationSummary;
}) {
	const queryClient = useQueryClient();

	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});
	const { data: inboxesData } = useQuery({
		queryKey: ["inboxes"],
		queryFn: () => api.listInboxes(),
	});

	const { mutate: update, isPending } = useMutation({
		mutationFn: (patch: ConversationUpdateRequest) =>
			api.updateConversation(conversation.id, patch),
		onSuccess: (result) => {
			// Conversation metadata drives both the list and sidebar queue/count
			// queries. Invalidate both immediately rather than waiting for the
			// sidebar's 15-second polling interval.
			queryClient.setQueryData(
				["conversation", conversation.id],
				result.conversation,
			);
			queryClient.invalidateQueries({ queryKey: ["conversations"] });
			queryClient.invalidateQueries({ queryKey: ["sidebar"] });
		},
	});

	const assigneeName = usersData?.users.find(
		(u) => u.id === conversation.assigneeId,
	)?.name;
	const isSnoozed =
		conversation.snoozedUntil !== null &&
		new Date(conversation.snoozedUntil).getTime() > Date.now();

	return (
		<div className="flex items-center gap-2">
			{conversation.status === "open" ? (
				<Button
					variant="outline"
					size="sm"
					disabled={isPending}
					onClick={() => update({ status: "archived" })}
				>
					<Archive />
					Archive
				</Button>
			) : (
				<Button
					variant="outline"
					size="sm"
					disabled={isPending}
					onClick={() => update({ status: "open" })}
				>
					<ArchiveRestore />
					Reopen
				</Button>
			)}

			<select
				value={conversation.assigneeId ?? ""}
				onChange={(event) => update({ assigneeId: event.target.value || null })}
				title={assigneeName ? `Assigned to ${assigneeName}` : "Unassigned"}
				className="max-w-44 rounded-md border px-2 py-1.5 text-sm"
			>
				<option value="">Unassigned</option>
				{usersData?.users.map((u) => (
					<option key={u.id} value={u.id}>
						{u.name}
					</option>
				))}
			</select>

			<select
				value={conversation.inboxId}
				onChange={(event) => update({ inboxId: event.target.value })}
				title="Move to inbox"
				className="max-w-44 rounded-md border px-2 py-1.5 text-sm"
			>
				{inboxesData?.inboxes.map((inbox) => (
					<option key={inbox.id} value={inbox.id}>
						{inbox.name}
					</option>
				))}
			</select>

			<select
				value=""
				onChange={(event) => {
					const value = event.target.value;
					if (value === "clear") update({ snoozedUntil: null });
					else if (value) update({ snoozedUntil: snoozeTarget(value) });
				}}
				title={
					isSnoozed
						? "Snoozed — pick an option to reschedule or clear"
						: "Snooze"
				}
				className="rounded-md border px-2 py-1.5 text-sm"
			>
				{/* The first option is the status label; the value stays "" so the
				    select always shows it (React needs a matching option). */}
				<option value="">{isSnoozed ? "Snoozed" : "Snooze…"}</option>
				{SNOOZE_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
				<option value="clear">Clear snooze</option>
			</select>
		</div>
	);
}
