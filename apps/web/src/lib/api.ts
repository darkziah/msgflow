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
	InboxTreeMoveRequest,
	InboxUpdateRequest,
	MarkReadRequest,
	MetaAppSummary,
	MetaAppWebhookSetup,
	OwnerSetupRequest,
	RuleSummary,
	RuleWriteRequest,
	SavedFilterCreateRequest,
	SavedFilterSummary,
	SendMessageRequest,
	SendMessageResult,
	SidebarPreferences,
	SidebarPreferencesUpdate,
	SidebarTreeResponse,
	TagCreateRequest,
	TagSummary,
	TagUpdateRequest,
	TeamSummary,
	TimelineResponse,
	UserSummary,
	WorkspaceSummary,
} from "@msgflow/contracts";

export interface EmailDomainSummary {
	id: string;
	workspaceId: string;
	canonicalDomain: string;
	inboundState: "pending" | "ready" | "suspended";
	outboundState: "pending" | "ready" | "suspended";
	operatorConfirmedAt: string | null;
}

export interface MailboxSummary {
	id: string;
	workspaceId: string;
	emailDomainId: string;
	localPart: string;
	canonicalAddress: string;
	type: "private" | "shared";
	ownerUserId: string | null;
	inboxId: string | null;
	teamId: string | null;
	isEnabled: boolean;
	isSendEnabled: boolean;
}

// Empty = same origin (Vite dev proxy); override for a separate API origin.
const BASE = import.meta.env.VITE_SERVER_URL ?? "";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		credentials: "include",
		...init,
		headers: {
			...(init?.body instanceof FormData
				? {}
				: { "content-type": "application/json" }),
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

type SidebarRenderKind = "system" | "inbox" | "tag" | "view";
export type SidebarRenderItem = {
	kind: SidebarRenderKind;
	id: string;
	parentId: string | null;
	order: number;
	label: string;
	/** The server-authoritative selection facet for this stable node id. */
	filter: import("@msgflow/contracts").SavedFilterFilters;
	count?: number;
	color?: string | null;
	icon?: string | null;
	inboxId?: string;
	hasOpenAssigned?: boolean;
};
export type SidebarRenderSection = {
	key: "inbox" | "assigned" | "teams" | "tags" | "views";
	nodeId: string;
	label: string;
	filter: import("@msgflow/contracts").SavedFilterFilters;
	items: SidebarRenderItem[];
	groups: { id: string; label: string; items: SidebarRenderItem[] }[];
};
export type SidebarRenderData = {
	workspace: SidebarTreeResponse["workspace"];
	permissions: SidebarTreeResponse["permissions"];
	preferences: SidebarPreferences;
	sections: SidebarRenderSection[];
	/** Includes every normalized node, including non-rendered section nodes. */
	filtersByNodeId: Record<
		string,
		import("@msgflow/contracts").SavedFilterFilters
	>;
};

/** The renderer has not yet adopted tree nodes, so this facade is the only
 * compatibility boundary; API data remains SidebarTreeResponse end-to-end. */
export function adaptSidebarTree(tree: SidebarTreeResponse): SidebarRenderData {
	const flatten = (
		nodes: SidebarTreeResponse["sections"],
	): SidebarTreeResponse["sections"] =>
		nodes.flatMap((node) => [node, ...flatten(node.children)]);
	const filtersByNodeId = Object.fromEntries(
		flatten(tree.sections).map((node) => [node.id, node.filter]),
	);
	const toItem = (
		node: SidebarTreeResponse["sections"][number],
		order: number,
	): SidebarRenderItem => ({
		kind:
			node.type === "inbox"
				? "inbox"
				: node.type === "tag"
					? "tag"
					: node.type === "saved-view"
						? "view"
						: "system",
		id: node.id,
		parentId: node.parentId,
		order,
		label: node.label,
		filter: node.filter,
		inboxId: node.filter.inboxId,
		color: node.color,
		icon: node.icon,
		count: node.count ?? undefined,
		hasOpenAssigned: false,
	});
	const section = (index: number, key: SidebarRenderSection["key"]) => {
		const node = tree.sections[index];
		return {
			key,
			nodeId: node?.id ?? `section:${key}`,
			label: node?.label ?? key,
			filter: node?.filter ?? {},
		};
	};
	const flatItems = (index: number) =>
		flatten(tree.sections[index]?.children ?? []).map(toItem);
	const inboxes = flatItems(1).filter((item) => item.kind === "inbox");
	return {
		workspace: tree.workspace,
		permissions: tree.permissions,
		preferences: tree.preferences,
		filtersByNodeId,
		sections: [
			{
				...section(1, "inbox"),
				items: [],
				groups: [{ id: "legacy:inboxes", label: "Inboxes", items: inboxes }],
			},
			{ ...section(0, "assigned"), items: flatItems(0), groups: [] },
			{ ...section(2, "teams"), items: flatItems(2), groups: [] },
			{ ...section(3, "tags"), items: flatItems(3), groups: [] },
			{ ...section(4, "views"), items: flatItems(4), groups: [] },
		],
	};
}

export function sidebarItemFilters(
	item: SidebarRenderItem,
): import("@msgflow/contracts").SavedFilterFilters {
	return item.filter;
}

export const api = {
	setupOwner(body: OwnerSetupRequest) {
		return request<{
			success: true;
			setup: {
				workspaceId: string;
				teamId: string;
				inboxId: string;
				userId: string;
				verification: "pending_sender_configuration";
			};
		}>("/api/setup/owner", { method: "POST", body: JSON.stringify(body) });
	},
	createFacebookChannel(
		workspaceId: string,
		body: {
			pageId: string;
			displayName?: string;
			accessToken: string;
			inboxId: string;
			metaAppId: string;
		},
	) {
		return request<{ channel: ChannelSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/facebook-channels`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	startMetaOAuth(
		workspaceId: string,
		body: { metaAppId: string; inboxId: string },
	) {
		return request<{ authorizationUrl: string }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/meta-oauth/start`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	listAuthorizedFacebookPages(sessionId: string) {
		return request<{ pages: { id: string; name: string }[] }>(
			`/api/meta-oauth/${encodeURIComponent(sessionId)}/pages`,
		);
	},
	connectAuthorizedFacebookPage(sessionId: string, pageId: string) {
		return request<{ channel: ChannelSummary }>(
			`/api/meta-oauth/${encodeURIComponent(sessionId)}/pages/${encodeURIComponent(pageId)}`,
			{ method: "POST" },
		);
	},
	listConversations(params: {
		mailboxId?: string;
		workspaceId: string;
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
		if (params.mailboxId) qs.set("mailboxId", params.mailboxId);
		qs.set("workspaceId", params.workspaceId);
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
	getConversation(id: string, workspaceId: string) {
		return request<ConversationSummary>(
			`/api/conversations/${id}?workspaceId=${encodeURIComponent(workspaceId)}`,
		);
	},
	getMessages(id: string, workspaceId: string) {
		return request<TimelineResponse>(
			`/api/conversations/${id}/messages?workspaceId=${encodeURIComponent(workspaceId)}`,
		);
	},
	createComment(id: string, body: CreateCommentRequest) {
		return request<CreateCommentResponse>(`/api/conversations/${id}/comments`, {
			method: "POST",
			body: JSON.stringify(body),
		});
	},
	listCommentNotifications(workspaceId: string) {
		return request<CommentNotificationsResponse>(
			`/api/comment-notifications?workspaceId=${encodeURIComponent(workspaceId)}`,
		);
	},
	markCommentNotificationRead(id: string, workspaceId: string) {
		return request<{ success: true }>(
			`/api/comment-notifications/${id}/read?workspaceId=${encodeURIComponent(workspaceId)}`,
			{
				method: "POST",
			},
		);
	},
	sendMessage(
		id: string,
		workspaceId: string,
		body: Omit<SendMessageRequest, "workspaceId">,
	) {
		return request<SendMessageResult>(`/api/conversations/${id}/messages`, {
			method: "POST",
			body: JSON.stringify({ ...body, workspaceId }),
		});
	},
	uploadAttachments(workspaceId: string, files: File[]) {
		const form = new FormData();
		form.append("workspaceId", workspaceId);
		for (const file of files) form.append("files", file);
		return request<{ attachments: Attachment[] }>("/api/attachments", {
			method: "POST",
			body: form,
		});
	},
	markRead(id: string, workspaceId: string, lastReadSeq: number) {
		return request<{ success: true }>(`/api/conversations/${id}/read`, {
			method: "POST",
			body: JSON.stringify({
				workspaceId,
				lastReadSeq,
			} satisfies MarkReadRequest),
		});
	},
	updateConversation(id: string, patch: ConversationUpdateRequest) {
		return request<ConversationUpdateResponse>(`/api/conversations/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		});
	},
	listUsers(workspaceId: string) {
		return request<{ users: UserSummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/users`,
		);
	},
	listChannels(workspaceId: string) {
		return request<{ channels: ChannelSummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/channels`,
		);
	},

	connectChannel(workspaceId: string, id: string, accessToken: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(id)}/token`,
			{ method: "POST", body: JSON.stringify({ accessToken }) },
		);
	},

	disconnectChannel(workspaceId: string, id: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(id)}/disconnect`,
			{ method: "POST" },
		);
	},

	deleteFacebookChannel(workspaceId: string, id: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	},
	listTags(workspaceId: string) {
		return request<{ tags: TagSummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/tags`,
		);
	},
	createTag(workspaceId: string, body: TagCreateRequest) {
		return request<{ tag: TagSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/tags`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	},
	updateTag(workspaceId: string, id: string, body: TagUpdateRequest) {
		return request<{ tag: TagSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/tags/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify(body),
			},
		);
	},
	deleteTag(workspaceId: string, id: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/tags/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	},
	addConversationTag(workspaceId: string, id: string, tagId: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(id)}/tags`,
			{
				method: "POST",
				body: JSON.stringify({ tagId }),
			},
		);
	},
	removeConversationTag(workspaceId: string, id: string, tagId: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(id)}/tags/${encodeURIComponent(tagId)}`,
			{ method: "DELETE" },
		);
	},
	listRules(workspaceId: string) {
		return request<{ rules: RuleSummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`,
		);
	},
	createRule(workspaceId: string, body: RuleWriteRequest) {
		return request<{ rule: RuleSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	},
	updateRule(workspaceId: string, id: string, body: RuleWriteRequest) {
		return request<{ rule: RuleSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify(body),
			},
		);
	},
	deleteRule(workspaceId: string, id: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/rules/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	},
	listCannedReplies(workspaceId: string) {
		return request<{ cannedReplies: CannedReplySummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/canned-replies`,
		);
	},
	createCannedReply(workspaceId: string, body: CannedReplyWriteRequest) {
		return request<{ cannedReply: CannedReplySummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/canned-replies`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	},
	updateCannedReply(
		workspaceId: string,
		id: string,
		body: CannedReplyWriteRequest,
	) {
		return request<{ cannedReply: CannedReplySummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/canned-replies/${encodeURIComponent(id)}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	deleteCannedReply(workspaceId: string, id: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/canned-replies/${encodeURIComponent(id)}`,
			{
				method: "DELETE",
			},
		);
	},

	listWorkspaces() {
		return request<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
	},
	createWorkspace(
		sourceWorkspaceId: string,
		body: {
			workspaceName: string;
			workspaceSlug: string;
			initialTeamName: string;
			initialInboxName: string;
		},
	) {
		return request<{
			workspace: WorkspaceSummary & { teamId: string; inboxId: string };
		}>(
			`/api/workspaces?sourceWorkspaceId=${encodeURIComponent(sourceWorkspaceId)}`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	},
	listMetaApps(workspaceId: string) {
		return request<{ metaApps: MetaAppSummary[] }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/meta-apps`,
		);
	},
	createMetaApp(
		workspaceId: string,
		body: { displayName: string; appId: string; appSecret: string },
	) {
		return request<MetaAppWebhookSetup>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/meta-apps`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	updateMetaApp(
		workspaceId: string,
		metaAppId: string,
		body: { displayName?: string; appSecret?: string },
	) {
		return request<{ metaApp: MetaAppSummary }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/meta-apps/${encodeURIComponent(metaAppId)}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	deleteMetaApp(workspaceId: string, metaAppId: string) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/meta-apps/${encodeURIComponent(metaAppId)}`,
			{ method: "DELETE" },
		);
	},
	listEmailDomains(workspaceId: string) {
		return request<{ emailDomains: EmailDomainSummary[] }>(
			`/api/workspaces/${workspaceId}/email-domains`,
		);
	},
	createEmailDomain(workspaceId: string, canonicalDomain: string) {
		return request<{ emailDomain: EmailDomainSummary }>(
			`/api/workspaces/${workspaceId}/email-domains`,
			{ method: "POST", body: JSON.stringify({ canonicalDomain }) },
		);
	},
	listMailboxes(workspaceId: string) {
		return request<{ mailboxes: MailboxSummary[] }>(
			`/api/workspaces/${workspaceId}/mailboxes`,
		);
	},
	createPrivateMailbox(
		workspaceId: string,
		emailDomainId: string,
		ownerUserId: string,
	) {
		return request<{ mailbox: MailboxSummary }>(
			`/api/workspaces/${workspaceId}/mailboxes/private`,
			{ method: "POST", body: JSON.stringify({ emailDomainId, ownerUserId }) },
		);
	},
	createSharedMailbox(
		workspaceId: string,
		body: {
			emailDomainId: string;
			localPart: string;
			inboxId: string;
			teamId?: string | null;
		},
	) {
		return request<{ mailbox: MailboxSummary }>(
			`/api/workspaces/${workspaceId}/mailboxes/shared`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	getSidebar(workspaceId: string) {
		return request<SidebarTreeResponse>(
			`/api/workspaces/${workspaceId}/sidebar`,
		).then(adaptSidebarTree);
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
	moveInboxInTree(
		workspaceId: string,
		inboxId: string,
		body: InboxTreeMoveRequest,
	) {
		return request<{ success: true }>(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/inboxes/${encodeURIComponent(inboxId)}/move`,
			{ method: "POST", body: JSON.stringify(body) },
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
export function conversationSocketUrl(
	conversationId: string,
	workspaceId: string,
): string {
	const base = import.meta.env.VITE_SERVER_URL;
	if (base) {
		const url = new URL(base);
		const proto = url.protocol === "https:" ? "wss" : "ws";
		return `${proto}://${url.host}/ws?conversationId=${encodeURIComponent(conversationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
	}
	const proto = window.location.protocol === "https:" ? "wss" : "ws";
	return `${proto}://${window.location.host}/ws?conversationId=${encodeURIComponent(conversationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
}
