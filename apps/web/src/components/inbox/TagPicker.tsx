import type { TagSummary } from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Tag as TagIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TagChip } from "./TagChip";

/**
 * Tag editor in the thread header: shows the conversation's tags (removable)
 * and a "+ Tag" popover listing the workspace's other tags to add.
 */
export function TagPicker({
	conversationId,
	tags,
}: {
	conversationId: string;
	tags: TagSummary[];
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	const { data: tagsData } = useQuery({
		queryKey: ["tags"],
		queryFn: () => api.listTags(),
	});

	const { mutate: addTag, isPending: adding } = useMutation({
		mutationFn: (tagId: string) =>
			api.addConversationTag(conversationId, tagId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["conversation", conversationId],
			});
			queryClient.invalidateQueries({ queryKey: ["conversations"] });
		},
	});
	const { mutate: removeTag } = useMutation({
		mutationFn: (tagId: string) =>
			api.removeConversationTag(conversationId, tagId),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["conversation", conversationId],
			});
			queryClient.invalidateQueries({ queryKey: ["conversations"] });
		},
	});

	const attached = new Set(tags.map((tag) => tag.id));
	const available = (tagsData?.tags ?? []).filter(
		(tag) => !attached.has(tag.id),
	);

	return (
		<div className="relative">
			<div className="flex items-center gap-1">
				{tags.map((tag) => (
					<TagChip key={tag.id} tag={tag} onRemove={() => removeTag(tag.id)} />
				))}
				<Button
					variant="ghost"
					size="sm"
					disabled={adding}
					onClick={() => setOpen((prev) => !prev)}
					className="gap-1 text-xs text-gray-500"
				>
					<TagIcon className="size-3.5" />
					Tag
				</Button>
			</div>
			{open ? (
				<div className="absolute right-0 z-20 mt-1 w-48 rounded-md border bg-white p-1 shadow-lg">
					{available.length === 0 ? (
						<p className="px-2 py-1.5 text-xs text-gray-400">
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
				</div>
			) : null}
		</div>
	);
}
