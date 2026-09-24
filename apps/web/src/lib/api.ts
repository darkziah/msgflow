import type {
	Attachment,
	CannedReplySummary,
	CannedReplyWriteRequest,
	ChannelSummary,
	CommentNotificationsResponse,
	ConversationSummary,
	ConversationUpdateRequest,
	ConversationUpdateResponse,
	CreateCommentRequest,
	CreateCommentResponse,
	InboxCreateRequest,
	InboxReorderRequest,
	InboxSummary,
	InboxUpdateRequest,
	MarkReadRequest,
	RuleSummary,
	RuleWriteRequest,
	SavedFilterCreateRequest,
	SavedFilterSummary,
	SendMessageRequest,
	SendMessageResult,
	SidebarPreferences,
	SidebarPreferencesUpdate,
	SidebarResponse,
	TagCreateRequest,
	TagSummary,
	TagUpdateRequest,
	TeamSummary,
	TimelineResponse,
	UserSummary,
	WorkspaceSummary,
} from "@msgflow/contracts";

// Empty = same origin (Vite dev proxy); override for a separate API origin.
const BASE = import.meta.env.VITE_SERVER_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: {
			...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
			...init?.headers,
		},
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(body?.error ?? `request failed: ${res.status}`);
	}
	return res.json() as Promise<T>;
}

export const api = {
	listConversations(params?: {
		status?: string;
		inboxId?: string;
		q?: string;
		assigneeId?: string;
		unassigned?: boolean;
		snoozed?: boolean;
		channel?: "facebook" | "email";
		tagId?: string;
		dateFrom?: string;
		dateTo?: string;
	}) {
		const qs = new URLSearchParams();
		if (params?.status) qs.set("status", params.status);
		if (params?.inboxId) qs.set("inboxId", params.inboxId);
		if (params?.q) qs.set("q", params.q);
		if (params?.assigneeId) qs.set("assigneeId", params.assigneeId);
		if (params?.unassigned) qs.set("unassigned", "true");
		if (params?.snoozed) qs.set("snoozed", "true");
		if (params?.channel) qs.set("channel", params.channel);
		if (params?.tagId) qs.set("tagId", params.tagId);
		if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
		if (params?.dateTo) qs.set("dateTo", params.dateTo);
		const query = qs.toString();
		return request<{ conversations: ConversationSummary[] }>(
			`/api/conversations${query ? `?${query}` : ""}`,
		);
	},
	getConversation(id: string) {
		return request<ConversationSummary>(`/api/conversations/${id}`);
	},
	getMessages(id: string) {
		return request<TimelineResponse>(`/api/conversations/${id}/messages`);
	},
	createComment(id: string, body: CreateCommentRequest) {
		return request<CreateCommentResponse>(`/api/conversations/${id}/comments`, {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	listCommentNotifications() { return request<CommentNotificationsResponse>("/api/comment-notifications"); },
	markCommentNotificationRead(id: string) { return request<{ success: true }>(`/api/comment-notifications/${id}/read`, { method: "POST" }); },
	sendMessage(id: string, body: SendMessageRequest) {
		return request<SendMessageResult>(`/api/conversations/${id}/messages`, {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	uploadAttachments(files: File[]) {
		const form = new FormData();
		for (const file of files) form.append("files", file);
		return request<{ attachments: Attachment[] }>("/api/attachments", {
			method: "POST",
			body: form,
		});
	},
	markRead(id: string, lastReadSeq: number) {
		return request<{ success: true }>(`/api/conversations/${id}/read`, {
			method: "POST",
			body: JSON.stringify({ lastReadSeq } satisfies MarkReadRequest),
		});
	},
	updateConversation(id: string, patch: ConversationUpdateRequest) {
		return request<ConversationUpdateResponse>(`/api/conversations/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		});
	},
	listUsers() {
		return request<{ users: UserSummary[] }>("/api/users");
	},
	listChannels() {
		return request<{ channels: ChannelSummary[] }>("/api/channels");
	},
	connectChannel(id: string, accessToken: string) {
		return request<{ success: true }>(`/api/channels/${id}/token`, {
			method: "POST",
			body: JSON.stringify({ accessToken }),
		});
	},
	disconnectChannel(id: string) {
		return request<{ success: true }>(`/api/channels/${id}/disconnect`, {
			method: "POST",
		});
	},
	listTags() {
		return request<{ tags: TagSummary[] }>("/api/tags");
	},
	createTag(body: TagCreateRequest) {
		return request<{ tag: TagSummary }>("/api/tags", {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	updateTag(id: string, body: TagUpdateRequest) {
		return request<{ tag: TagSummary }>(`/api/tags/${id}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	deleteTag(id: string) {
		return request<{ success: true }>(`/api/tags/${id}`, { method: "DELETE" });
	},
	addConversationTag(id: string, tagId: string) {
		return request<{ success: true }>(`/api/conversations/${id}/tags`, {
			method: "POST",
			body: JSON.stringify({ tagId }),
		});
	},
	removeConversationTag(id: string, tagId: string) {
		return request<{ success: true }>(
			`/api/conversations/${id}/tags/${tagId}`,
			{ method: "DELETE" },
		);
	},
	listRules() {
		return request<{ rules: RuleSummary[] }>("/api/rules");
	},
	createRule(body: RuleWriteRequest) {
		return request<{ rule: RuleSummary }>("/api/rules", {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	updateRule(id: string, body: RuleWriteRequest) {
		return request<{ rule: RuleSummary }>(`/api/rules/${id}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	deleteRule(id: string) {
		return request<{ success: true }>(`/api/rules/${id}`, { method: "DELETE" });
	},
	listCannedReplies() {
		return request<{ cannedReplies: CannedReplySummary[] }>(
			"/api/canned-replies",
		);
	},
	createCannedReply(body: CannedReplyWriteRequest) {
		return request<{ cannedReply: CannedReplySummary }>("/api/canned-replies", {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	updateCannedReply(id: string, body: CannedReplyWriteRequest) {
		return request<{ cannedReply: CannedReplySummary }>(
			`/api/canned-replies/${id}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	deleteCannedReply(id: string) {
		return request<{ success: true }>(`/api/canned-replies/${id}`, {
			method: "DELETE",
		});
	},
	listInboxes() {
		return request<{ inboxes: InboxSummary[] }>("/api/inboxes");
	},
	createInbox(body: InboxCreateRequest) {
		return request<{ inbox: InboxSummary }>("/api/inboxes", {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	updateInbox(id: string, body: InboxUpdateRequest) {
		return request<{ inbox: InboxSummary }>(`/api/inboxes/${id}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	deleteInbox(id: string) {
		return request<{ success: true }>(`/api/inboxes/${id}`, {
			method: "DELETE",
		});
	},
	linkChannelToInbox(
		inboxId: string,
		body: { channelId: string; isDefault?: boolean },
	) {
		return request<{ success: true }>(`/api/inboxes/${inboxId}/channels`, {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	unlinkChannelFromInbox(inboxId: string, channelId: string) {
		return request<{ success: true }>(
			`/api/inboxes/${inboxId}/channels/${channelId}`,
			{ method: "DELETE" },
		);
	},
	joinInbox(inboxId: string) {
		return request<{ success: true }>(`/api/inboxes/${inboxId}/members`, {
			method: "POST",
		});
	},
	leaveInbox(inboxId: string) {
		return request<{ success: true }>(`/api/inboxes/${inboxId}/members`, {
			method: "DELETE",
		});
	},
	addInboxMember(inboxId: string, userId: string) {
		return request<{ success: true }>(`/api/inboxes/${inboxId}/members`, {
			method: "POST",
			body: JSON.stringify({ userId }),
		});
	},
	removeInboxMember(inboxId: string, userId: string) {
		return request<{ success: true }>(`/api/inboxes/${inboxId}/members`, {
			method: "DELETE",
			body: JSON.stringify({ userId }),
		});
	},
	listWorkspaces() {
		return request<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
	},
	getSidebar(workspaceId: string) {
		return request<SidebarResponse>(`/api/workspaces/${workspaceId}/sidebar`);
	},
	updateSidebarPreferences(
		workspaceId: string,
		body: SidebarPreferencesUpdate,
	) {
		return request<{ preferences: SidebarPreferences }>(
			`/api/workspaces/${workspaceId}/sidebar-preferences`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	workspaceCreateInbox(workspaceId: string, body: InboxCreateRequest) {
		return request<{ inbox: InboxSummary }>(
			`/api/workspaces/${workspaceId}/inboxes`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	},
	workspaceListInboxes(workspaceId: string) {
		return request<{ inboxes: InboxSummary[] }>(
			`/api/workspaces/${workspaceId}/inboxes`,
		);
	},
	workspaceUpdateInbox(
		workspaceId: string,
		inboxId: string,
		body: InboxUpdateRequest,
	) {
		return request<{ inbox: InboxSummary }>(
			`/api/workspaces/${workspaceId}/inboxes/${inboxId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	archiveInbox(workspaceId: string, inboxId: string) {
		return request<{ inbox: InboxSummary }>(
			`/api/workspaces/${workspaceId}/inboxes/${inboxId}/archive`,
			{ method: "POST" },
		);
	},
	workspaceLinkChannel(
		workspaceId: string,
		inboxId: string,
		body: { channelId: string; isDefault?: boolean },
	) {
		return request<{ success: true }>(
			`/api/workspaces/${workspaceId}/inboxes/${inboxId}/channels`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	workspaceUnlinkChannel(
		workspaceId: string,
		inboxId: string,
		channelId: string,
	) {
		return request<{ success: true }>(
			`/api/workspaces/${workspaceId}/inboxes/${inboxId}/channels/${channelId}`,
			{ method: "DELETE" },
		);
	},
	setDefaultInbox(workspaceId: string, channelId: string, inboxId: string) {
		return request<{ success: true }>(
			`/api/workspaces/${workspaceId}/channels/${channelId}/default-inbox`,
			{ method: "POST", body: JSON.stringify({ inboxId }) },
		);
	},
	reorderInboxes(workspaceId: string, inboxIds: string[]) {
		const body: InboxReorderRequest = { inboxIds };
		return request<{ success: true }>(
			`/api/workspaces/${workspaceId}/inboxes/reorder`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	listTeams(workspaceId: string) {
		return request<{ teams: TeamSummary[] }>(
			`/api/workspaces/${workspaceId}/teams`,
		);
	},
	createView(workspaceId: string, body: SavedFilterCreateRequest) {
		return request<{ view: SavedFilterSummary }>(
			`/api/workspaces/${workspaceId}/views`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	deleteView(workspaceId: string, viewId: string) {
		return request<{ success: true }>(
			`/api/workspaces/${workspaceId}/views/${viewId}`,
			{ method: "DELETE" },
		);
	},
};

/** WebSocket URL for the conversation's realtime channel (authenticated via session cookie). */
export function conversationSocketUrl(conversationId: string): string {
	const base = import.meta.env.VITE_SERVER_URL;
	if (base) {
		const url = new URL(base);
		const proto = url.protocol === "https:" ? "wss" : "ws";
		return `${proto}://${url.host}/ws?conversationId=${encodeURIComponent(conversationId)}`;
	}
	const proto = window.location.protocol === "https:" ? "wss" : "ws";
	return `${proto}://${window.location.host}/ws?conversationId=${encodeURIComponent(conversationId)}`;
}
