import type {
	ConversationSummary,
	ConversationUpdateRequest,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
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
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";

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
	workspaceId,
	onArchiveChange,
	onAssignChange,
	onMoveChange,
	onSnoozeChange,
	assignOpen,
	onAssignOpenChange,
	moveOpen,
	onMoveOpenChange,
	snoozeOpen,
	onSnoozeOpenChange,
}: {
	conversation: ConversationSummary;
	workspaceId: string;
	onArchiveChange?: (archive: (() => boolean) | null) => void;
	onAssignChange?: (open: (() => boolean) | null) => void;
	onMoveChange?: (open: (() => boolean) | null) => void;
	onSnoozeChange?: (open: (() => boolean) | null) => void;
	assignOpen?: boolean;
	onAssignOpenChange?: (open: boolean) => void;
	moveOpen?: boolean;
	onMoveOpenChange?: (open: boolean) => void;
	snoozeOpen?: boolean;
	onSnoozeOpenChange?: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const [uncontrolledAssignOpen, setUncontrolledAssignOpen] = useState(false);
	const [uncontrolledMoveOpen, setUncontrolledMoveOpen] = useState(false);
	const [uncontrolledSnoozeOpen, setUncontrolledSnoozeOpen] = useState(false);
	const { data: usersData } = useQuery({
		queryKey: ["users", workspaceId],
		queryFn: () => api.listUsers(workspaceId),
	});
	const { data: inboxesData } = useQuery({
		queryKey: ["inboxes", workspaceId],
		queryFn: () => api.workspaceListInboxes(workspaceId),
	});
	const { mutate: update, isPending } = useMutation({
		mutationFn: (patch: Omit<ConversationUpdateRequest, "workspaceId">) =>
			api.updateConversation(conversation.id, { ...patch, workspaceId }),
		onSuccess: (result) => {
			queryClient.setQueryData(
				["conversation", workspaceId, conversation.id],
				result.conversation,
			);
			invalidateWorkspaceConversationViews(queryClient, workspaceId);
		},
	});
	const assigneeName = usersData?.users.find(
		(user) => user.id === conversation.assigneeId,
	)?.name;
	const isSnoozed =
		conversation.snoozedUntil !== null &&
		new Date(conversation.snoozedUntil).getTime() > Date.now();
	const archive = useCallback(() => {
		if (isPending) return false;
		update({ status: conversation.status === "open" ? "archived" : "open" });
		return true;
	}, [conversation.status, isPending, update]);
	const resolvedAssignOpen = assignOpen ?? uncontrolledAssignOpen;
	const resolvedMoveOpen = moveOpen ?? uncontrolledMoveOpen;
	const resolvedSnoozeOpen = snoozeOpen ?? uncontrolledSnoozeOpen;
	const setAssignOpen = onAssignOpenChange ?? setUncontrolledAssignOpen;
	const setMoveOpen = onMoveOpenChange ?? setUncontrolledMoveOpen;
	const setSnoozeOpen = onSnoozeOpenChange ?? setUncontrolledSnoozeOpen;
	const openAssign = useCallback(() => {
		if (isPending) return false;
		setAssignOpen(true);
		return true;
	}, [isPending, setAssignOpen]);
	const openMove = useCallback(() => {
		if (isPending) return false;
		setMoveOpen(true);
		return true;
	}, [isPending, setMoveOpen]);
	const openSnooze = useCallback(() => {
		if (isPending) return false;
		setSnoozeOpen(true);
		return true;
	}, [isPending, setSnoozeOpen]);
	useEffect(() => {
		onArchiveChange?.(archive);
		onAssignChange?.(openAssign);
		onMoveChange?.(openMove);
		onSnoozeChange?.(openSnooze);
		return () => {
			onArchiveChange?.(null);
			onAssignChange?.(null);
			onMoveChange?.(null);
			onSnoozeChange?.(null);
		};
	}, [
		archive,
		onArchiveChange,
		onAssignChange,
		onMoveChange,
		onSnoozeChange,
		openAssign,
		openMove,
		openSnooze,
	]);

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
						onClick={archive}
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
			<DropdownMenu open={resolvedAssignOpen} onOpenChange={setAssignOpen}>
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
			<DropdownMenu open={resolvedMoveOpen} onOpenChange={setMoveOpen}>
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
			<DropdownMenu open={resolvedSnoozeOpen} onOpenChange={setSnoozeOpen}>
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
