import type { TagSummary } from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag as TagIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api";
import { invalidateWorkspaceConversationViews } from "@/lib/sidebar-live-update";
import { TagChip } from "./TagChip";

/**
 * Tag editor in the thread header: shows the conversation's tags (removable)
 * and a "+ Tag" popover listing the workspace's other tags to add.
 */
export function TagPicker({
	conversationId,
	workspaceId,
	tags,
	open,
	onOpenChange,
	onOpenRequestChange,
}: {
	conversationId: string;
	workspaceId: string;
	tags: TagSummary[];
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onOpenRequestChange?: (open: (() => boolean) | null) => void;
}) {
	const queryClient = useQueryClient();

	const { data: tagsData } = useQuery({
		queryKey: ["tags", workspaceId],
		queryFn: () => api.listTags(workspaceId),
	});

	const { mutate: addTag, isPending: adding } = useMutation({
		mutationFn: (tagId: string) =>
			api.addConversationTag(workspaceId, conversationId, tagId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["conversation", workspaceId, conversationId],
			});
			invalidateWorkspaceConversationViews(queryClient, workspaceId);
		},
	});
	const { mutate: removeTag } = useMutation({
		mutationFn: (tagId: string) =>
			api.removeConversationTag(workspaceId, conversationId, tagId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["conversation", workspaceId, conversationId],
			});
			invalidateWorkspaceConversationViews(queryClient, workspaceId);
		},
	});

	const attached = new Set(tags.map((tag) => tag.id));
	const available = (tagsData?.tags ?? []).filter(
		(tag) => !attached.has(tag.id),
	);
	const requestOpen = useCallback(() => {
		if (adding) return false;
		onOpenChange?.(true);
		return Boolean(onOpenChange);
	}, [adding, onOpenChange]);
	useEffect(() => {
		onOpenRequestChange?.(requestOpen);
		return () => onOpenRequestChange?.(null);
	}, [onOpenRequestChange, requestOpen]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<div className="flex items-center gap-1">
				{tags.map((tag) => (
					<TagChip key={tag.id} tag={tag} onRemove={() => removeTag(tag.id)} />
				))}
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={adding}
						className="gap-1 text-xs text-muted-foreground"
					>
						<TagIcon className="size-3.5" />
						Tag
					</Button>
				</PopoverTrigger>
			</div>
			<PopoverContent
				aria-label="Add a tag"
				align="end"
				className="w-48 p-1"
			>
				{available.length === 0 ? (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">
						{tags.length === 0
							? "No tags yet — create them in Settings."
							: "All tags are already applied."}
					</p>
				) : (
					available.map((tag) => (
						<button
							key={tag.id}
							type="button"
							disabled={adding}
							onClick={() => addTag(tag.id)}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
						>
							<TagChip tag={tag} />
						</button>
					))
				)}
			</PopoverContent>
		</Popover>
	);
}
