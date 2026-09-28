import type { WorkspaceSummary } from "@msgflow/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
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
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Theme = "light" | "dark";

export async function refreshWorkspacesThenSelect(
	refetchWorkspaces: () => Promise<unknown>,
	workspaceId: string,
	onChangeWorkspace: (workspaceId: string) => void,
): Promise<void> {
	await refetchWorkspaces();
	onChangeWorkspace(workspaceId);
}

function readTheme(): Theme {
	return localStorage.getItem("msgflow.theme") === "dark" ? "dark" : "light";
}

export function AppTopBar({
	workspaceId,
	workspaces,
	onChangeWorkspace,
}: {
	workspaceId: string;
	workspaces: WorkspaceSummary[];
	onChangeWorkspace: (workspaceId: string) => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [theme, setTheme] = useState<Theme>(readTheme);
	const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
	const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
	const { data: notifications } = useQuery({
		queryKey: ["comment-notifications", workspaceId],
		queryFn: () => api.listCommentNotifications(workspaceId),
		enabled: Boolean(workspaceId),
		refetchInterval: 15000,
	});

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		localStorage.setItem("msgflow.theme", theme);
	}, [theme]);

	function openNotification(notification: NonNullable<typeof notifications>["notifications"][number]) {
		api
			.markCommentNotificationRead(notification.id, workspaceId)
			.finally(() => queryClient.invalidateQueries({ queryKey: ["comment-notifications", workspaceId] }));
		navigate({ to: "/", search: { workspace: workspaceId, c: notification.conversationId } });
	}

	async function signOut() {
		await authClient.signOut();
		navigate({ to: "/login" });
	}

	async function workspaceCreated(workspace: WorkspaceSummary) {
		await refreshWorkspacesThenSelect(
			() => queryClient.refetchQueries({ queryKey: ["workspaces"] }),
			workspace.id,
			onChangeWorkspace,
		);
		setWorkspacePickerOpen(false);
	}

	return (
		<header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-4">
			<span className="text-sm font-bold tracking-tight">MsgFlow</span>
			<Dialog open={workspacePickerOpen} onOpenChange={setWorkspacePickerOpen}>
				<DialogTrigger asChild>
					<Button type="button" variant="outline" size="sm" className="max-w-[min(12rem,38vw)] truncate" aria-label="Choose workspace">
						{activeWorkspace?.name ?? "Choose workspace"}
					</Button>
				</DialogTrigger>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Choose a workspace</DialogTitle>
						<DialogDescription>Switch the inbox, people, rules, and settings context for your current membership.</DialogDescription>
					</DialogHeader>
					<div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
						{workspaces.map((workspace) => {
							const active = workspace.id === workspaceId;
							return (
								<Card key={workspace.id} className={active ? "border-primary" : undefined}>
									<CardHeader className="gap-1">
										<CardTitle className="text-base">{workspace.name}</CardTitle>
										<CardDescription>/{workspace.slug}</CardDescription>
									</CardHeader>
									<CardContent className="flex items-center justify-between gap-3">
										<Badge variant={workspace.role === "owner" ? "default" : "secondary"} className="capitalize">{workspace.role}</Badge>
										<Button type="button" size="sm" variant={active ? "secondary" : "default"} disabled={active} onClick={() => { onChangeWorkspace(workspace.id); setWorkspacePickerOpen(false); }}>
											{active ? "Current workspace" : "Switch"}
										</Button>
									</CardContent>
								</Card>
							);
						})}
					</div>
					{activeWorkspace?.role === "owner" ? (
						<div className="flex justify-end border-t pt-3">
							<CreateWorkspaceDialog
								sourceWorkspaceId={activeWorkspace.id}
								onCreated={workspaceCreated}
							/>
						</div>
					) : null}
				</DialogContent>
			</Dialog>
			<div className="ml-auto flex items-center gap-1">
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button type="button" variant="ghost" size="icon" className="relative" aria-label="Comment mentions">
									<Bell />
									{notifications?.unreadCount ? <Badge className="absolute -right-1 -top-1 min-w-4 px-1 text-[10px]">{notifications.unreadCount}</Badge> : null}
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>Comment mentions</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="w-80">
						<DropdownMenuLabel>Mentions</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							{notifications?.notifications.length ? notifications.notifications.map((notification) => (
								<DropdownMenuItem key={notification.id} onSelect={() => openNotification(notification)} className={notification.readAt ? "text-muted-foreground" : "font-semibold"}>
									{notification.commentText}
								</DropdownMenuItem>
							)) : <DropdownMenuItem disabled>No mentions yet.</DropdownMenuItem>}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button type="button" variant="ghost" size="icon" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}>
							{theme === "dark" ? <Sun /> : <Moon />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{theme === "dark" ? "Use light theme" : "Use dark theme"}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button type="button" variant="ghost" size="icon" onClick={() => navigate({ to: "/settings", search: { workspace: workspaceId } })} aria-label="Settings"><Settings /></Button>
					</TooltipTrigger>
					<TooltipContent>Settings</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button type="button" variant="ghost" size="icon" onClick={signOut} aria-label="Sign out"><LogOut /></Button>
					</TooltipTrigger>
					<TooltipContent>Sign out</TooltipContent>
				</Tooltip>
			</div>
		</header>
	);
}
