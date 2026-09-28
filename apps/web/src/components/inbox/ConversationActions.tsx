import type {
	ConversationSummary,
	ConversationUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Archive,
	ArchiveRestore,
	Clock3,
	Inbox,
	UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";

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
			target.setHours(9, 0, 0, 0);
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
			queryClient.setQueryData(
				["conversation", conversation.id],
				result.conversation,
			);
			queryClient.invalidateQueries({ queryKey: ["conversations"] });
			queryClient.invalidateQueries({ queryKey: ["sidebar"] });
		},
	});
	const assigneeName = usersData?.users.find(
		(user) => user.id === conversation.assigneeId,
	)?.name;
	const isSnoozed =
		conversation.snoozedUntil !== null &&
		new Date(conversation.snoozedUntil).getTime() > Date.now();

	return (
		<fieldset
			className="flex shrink-0 items-center gap-1"
			aria-label="Conversation actions"
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={isPending}
						aria-label={
							conversation.status === "open"
								? "Archive conversation"
								: "Reopen conversation"
						}
						onClick={() =>
							update({
								status: conversation.status === "open" ? "archived" : "open",
							})
						}
					>
						{conversation.status === "open" ? <Archive /> : <ArchiveRestore />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{conversation.status === "open"
						? "Archive conversation"
						: "Reopen conversation"}
				</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={isPending}
								aria-label="Assign conversation"
							>
								<UserRound />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>Assign conversation</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" aria-label="Assign conversation">
					<DropdownMenuLabel>{assigneeName ?? "Unassigned"}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem onSelect={() => update({ assigneeId: null })}>
							Unassigned
						</DropdownMenuItem>
						{usersData?.users.map((user) => (
							<DropdownMenuItem
								key={user.id}
								onSelect={() => update({ assigneeId: user.id })}
							>
								{user.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={isPending}
								aria-label="Move conversation"
							>
								<Inbox />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>Move conversation</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" aria-label="Move conversation">
					<DropdownMenuLabel>Move to inbox</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						{inboxesData?.inboxes.map((inbox) => (
							<DropdownMenuItem
								key={inbox.id}
								onSelect={() => update({ inboxId: inbox.id })}
							>
								{inbox.name}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={isPending}
								aria-label="Snooze conversation"
							>
								<Clock3 />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>
						{isSnoozed ? "Reschedule snooze" : "Snooze conversation"}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" aria-label="Snooze conversation">
					<DropdownMenuLabel>
						{isSnoozed ? "Snoozed" : "Snooze until"}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						{SNOOZE_OPTIONS.map((option) => (
							<DropdownMenuItem
								key={option.value}
								onSelect={() =>
									update({ snoozedUntil: snoozeTarget(option.value) })
								}
							>
								{option.label}
							</DropdownMenuItem>
						))}
						{isSnoozed ? (
							<DropdownMenuItem onSelect={() => update({ snoozedUntil: null })}>
								Clear snooze
							</DropdownMenuItem>
						) : null}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</fieldset>
	);
}
