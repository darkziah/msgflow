import type { SidebarPreferences } from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { InboxSettingsDrawer } from "./InboxSettingsDrawer";
import { type SidebarFilters, SidebarTree } from "./SidebarTree";

export type ListFilters = SidebarFilters;
export interface SidebarProps {
	workspaceId: string;
	currentUserId: string;
	activeFilters: ListFilters;
	onSelect: (filters: ListFilters) => void;
	compact: boolean;
	onToggleCompact: () => void;
}

export function Sidebar({
	workspaceId,
	currentUserId,
	activeFilters,
	onSelect,
	compact,
	onToggleCompact,
}: SidebarProps) {
	const queryClient = useQueryClient();
	const [drawer, setDrawer] = useState<
		{ mode: "create" } | { mode: "edit"; inboxId: string } | null
	>(null);
	const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
	const { data: tree } = useQuery({
		queryKey: ["sidebar", workspaceId],
		queryFn: () => api.getSidebar(workspaceId),
	});

	function patchPreferences(patch: Partial<SidebarPreferences>) {
		if (!tree) return;
		const previous = tree.preferences;
		const next = { ...previous, ...patch };
		queryClient.setQueryData(["sidebar", workspaceId], {
			...tree,
			preferences: next,
		});
		if (debounce.current) clearTimeout(debounce.current);
		debounce.current = setTimeout(
			() =>
				api
					.updateSidebarPreferences(workspaceId, patch)
					.then(({ preferences }) =>
						queryClient.setQueryData(
							["sidebar", workspaceId],
							(old: typeof tree | undefined) =>
								old ? { ...old, preferences } : old,
						),
					)
					.catch(() =>
						queryClient.setQueryData(["sidebar", workspaceId], {
							...tree,
							preferences: previous,
						}),
					),
			250,
		);
	}
	return (
		<aside
			className={cn(
				"flex h-full shrink-0 flex-col border-r bg-muted/30 transition-[width]",
				compact ? "w-14" : "w-[232px]",
			)}
			data-onboarding-target="sidebar"
		>
			{tree ? (
				<SidebarTree
					tree={tree}
					activeFilters={activeFilters}
					compact={compact}
					currentUserId={currentUserId}
					onSelect={onSelect}
					onPreferencesChange={patchPreferences}
					onCreateInbox={() => setDrawer({ mode: "create" })}
					onEditInbox={(inboxId) => setDrawer({ mode: "edit", inboxId })}
				/>
			) : (
				<div className="flex-1" />
			)}
			<Separator />
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						onClick={onToggleCompact}
						className="flex w-full items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
						aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
					>
						{compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
						{!compact ? <span>Collapse</span> : null}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{compact ? "Expand sidebar" : "Collapse sidebar"}
				</TooltipContent>
			</Tooltip>
			{drawer ? (
				<InboxSettingsDrawer
					workspaceId={workspaceId}
					inboxId={drawer.mode === "edit" ? drawer.inboxId : null}
					onClose={() => setDrawer(null)}
					onChanged={() =>
						queryClient.invalidateQueries({
							queryKey: ["sidebar", workspaceId],
						})
					}
				/>
			) : null}
		</aside>
	);
}
