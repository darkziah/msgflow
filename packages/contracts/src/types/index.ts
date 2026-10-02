// Canonical, channel-agnostic domain types shared by the Worker, Durable Objects, and web client.

import type { InboxAssignmentStrategy, InboxIconKey } from "../inbox-schema";

export type Channel = "facebook" | "email" | "whatsapp";

export type MessageKind = "inbound" | "outbound";

export interface Attachment {
	id: string;
	/** Immutable R2 object key. */
	key: string;
	/** Messenger images or private email images/PDFs. */
	type:
		| "image/jpeg"
		| "image/png"
		| "image/gif"
		| "image/webp"
		| "application/pdf";
	url: string;
	name: string;
	size: number;
	/** MIME disposition from an email part; omitted for existing channels. */
	disposition?: "attachment" | "inline";
	/** Normalized MIME Content-ID for an inline email image. */
	contentId?: string;
}

export interface Message {
	id: string;
	conversationId: string;
	kind: MessageKind;
	channel: Channel;
	providerMessageId: string | null;
	senderId: string;
	text: string;
	/** Server-sanitized inbound email HTML. Never present for chat channels. */
	html?: string;
	payload: unknown;
	attachments: Attachment[];
	createdAt: string;
	/**
	 * Timeline position (assigned by the Conversation DO). Drives per-agent
	 * unread (ADR 0015): unread = conversations.message_count − last_read_seq.
	 * Present on messages served by the DO (GET /messages, WS broadcasts).
	 */
	seq?: number;
}

export interface Comment {
	id: string;
	conversationId: string;
	authorId: string;
	text: string;
	mentions: string[];
	createdAt: string;
}

export type GenericActivityAction =
	| "conversation.updated"
	| "tag.added"
	| "tag.removed"
	| "snooze.expired";

export type CallActivityAction =
	| "call.received"
	| "call.ringing"
	| "call.offered"
	| "call.accepted"
	| "call.rejected"
	| "call.terminated"
	| "call.timed_out"
	| "call.no_agent_reply"
	| "call.failed"
	| "call.media_updated"
	| "call.quality_reported";

/** Aggregate-only call audit data. Raw signaling and media stay server-side. */
export interface CallActivityDetails {
	reason?: string;
	status?: string;
	durationSeconds?: number;
	packetLossPercent?: number;
	jitterMilliseconds?: number;
}

interface ActivityBase {
	id: string;
	conversationId: string;
	/** Authenticated agent responsible for the change; null for system work. */
	actorId: string | null;
	createdAt: string;
}

/** A system-generated audit record for a non-call Conversation metadata change. */
export interface GenericActivity extends ActivityBase {
	action: GenericActivityAction;
	/** Immutable action-specific data (for example changed values or a tag id). */
	details: Record<string, unknown>;
}

/** A client-visible call audit record with only allow-listed aggregate details. */
export interface CallActivity {
	id: string;
	conversationId: string;
	action: CallActivityAction;
	details: CallActivityDetails;
	createdAt: string;
}

export type Activity = GenericActivity | CallActivity;

// POST /api/conversations/:id/comments — author and timestamp are assigned
// from the authenticated Worker session, never accepted from the client.
export interface CreateCommentRequest {
	/** Explicit workspace scope, validated against the authenticated membership. */
	workspaceId: string;
	text: string;
	mentions?: string[];
}

export interface CreateCommentResponse {
	comment: Comment;
}

/** A personal D1 projection created when another agent mentions the recipient. */
export interface CommentNotification {
	id: string;
	conversationId: string;
	commentId: string;
	authorId: string;
	commentText: string;
	createdAt: string;
	readAt: string | null;
}

export interface CommentNotificationsResponse {
	notifications: CommentNotification[];
	unreadCount: number;
}

export interface PresenceEntry {
	agentId: string;
	status: "viewing" | "drafting";
	connectedAt: string;
}

export type ConversationEvent =
	| { type: "message:new"; message: Message }
	| { type: "comment:new"; comment: Comment }
	| { type: "activity:new"; activity: Activity }
	| { type: "conversation-updated"; patch: Record<string, unknown> }
	| { type: "presence"; agents: PresenceEntry[] }
	| { type: "typing"; agentId: string; isTyping: boolean };

export interface ApiResponse {
	message: string;
	success: true;
}

// POST /api/conversations/:id/messages
export interface SendMessageRequest {
	/** Explicit workspace scope, validated against the authenticated membership. */
	workspaceId: string;
	/** Server draft CAS revision; omitted means a new draft. */
	draftRevision?: number;
	text: string;
	/** Uploaded image metadata returned by POST /api/attachments. */
	attachments?: Attachment[];
	/** Email only: the subject line (Front/Missive composers show it). */
	subject?: string;
	/** ISO timestamp; when set in the future the message is scheduled instead of sent. */
	sendAt?: string;
	/** Client-generated idempotency key; the DO dedups on it. */
	clientMessageId?: string;
	/** Authorized email Reply Identity, defaulting to the receiving mailbox. */
	mailboxId?: string;
	confirmPrivateIdentity?: boolean;
}

export type SendMessageResult =
	| { success: true; sent: true; message: Message }
	| { success: true; sent: false; scheduledAt: string }
	| { success: false; error: string };

// GET /api/conversations — one row per conversation for the inbox list,
// with contact identity and the requesting agent's unread count (ADR 0015).
export interface ConversationSummary {
	id: string;
	channel: Channel;
	channelId: string;
	channelDisplayName: string;
	inboxId: string;
	subject: string | null;
	status: "open" | "archived";
	assigneeId: string | null;
	contact: {
		id: string;
		displayName: string | null;
		primaryEmail: string | null;
		avatarUrl: string | null;
	};
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
	messageCount: number;
	unreadCount: number;
	snoozedUntil: string | null;
	createdAt: string;
	updatedAt: string;
	tags: TagSummary[];
}

// ---------------------------------------------------------------------------
// TAGS (ADR 0010)
// ---------------------------------------------------------------------------

export interface TagSummary {
	id: string;
	name: string;
	color: string | null;
	visibility: "company" | "shared" | "private";
	parentTagId: string | null;
	ownerUserId: string | null;
	createdAt: string;
}

// POST /api/tags
export interface TagCreateRequest {
	name: string;
	color?: string | null;
	visibility?: "shared" | "private";
	parentTagId?: string | null;
}

// PATCH /api/tags/:id
export interface TagUpdateRequest {
	name?: string;
	color?: string | null;
	visibility?: "shared" | "private";
	parentTagId?: string | null;
}

// POST /api/conversations/:id/tags — attach a tag to a conversation.
export interface ConversationTagRequest {
	tagId: string;
}

// ---------------------------------------------------------------------------
// RULES (ADR 0009) — CRUD surface for the management UI
// ---------------------------------------------------------------------------

export interface RuleConditionInput {
	field: string;
	operator: string;
	value: string;
	matchGroup: number;
}

export interface RuleActionInput {
	actionType: string;
	actionValue: string;
	executionOrder: number;
}

export interface RuleSummary {
	id: string;
	name: string;
	triggerType:
		| "message_received"
		| "conversation_created"
		| "tag_added"
		| "manual";
	isActive: boolean;
	priority: number;
	/** Stop further rule evaluation after this rule matches. */
	stopProcessing: boolean;
	inboxId: string | null;
	createdAt: string;
	updatedAt: string;
	conditions: RuleConditionInput[];
	actions: RuleActionInput[];
}

// POST /api/rules (create) and PATCH /api/rules/:id (update) share this shape.
export interface RuleWriteRequest {
	name: string;
	triggerType: RuleSummary["triggerType"];
	isActive: boolean;
	priority: number;
	stopProcessing?: boolean;
	inboxId?: string | null;
	conditions: RuleConditionInput[];
	actions: RuleActionInput[];
}

// ---------------------------------------------------------------------------
// CANNED REPLIES (referenced by rule action 'send_canned_reply')
// ---------------------------------------------------------------------------

export interface CannedReplySummary {
	id: string;
	name: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface CannedReplyWriteRequest {
	name: string;
	body: string;
}

export interface PageInfo {
	nextCursor: string | null;
}

// GET /api/conversations — cursor page for the inbox list.
export interface ConversationListResponse extends PageInfo {
	conversations: ConversationSummary[];
}

export type TimelineItem =
	| { type: "message"; item: Message }
	| { type: "comment"; item: Comment }
	| { type: "activity"; item: Activity };

// GET /api/conversations/:id/messages — cursor page for a mixed timeline.
export interface TimelinePageResponse extends PageInfo {
	items: TimelineItem[];
}

// Legacy internal Conversation DO responses. These endpoints remain available
// for non-browser consumers; the browser API is TimelinePageResponse.
export interface TimelineResponse {
	messages: Message[];
	comments: Comment[];
	activities: Activity[];
}

/** @deprecated Browser callers should use TimelinePageResponse. */
export type MessagesResponse = TimelineResponse;

// POST /api/conversations/:id/read
export interface MarkReadRequest {
	/** Explicit workspace scope, validated against the authenticated membership. */
	workspaceId: string;
	lastReadSeq: number;
}

// PATCH /api/conversations/:id — metadata update (status, assignee, snooze).
// ADR 0004: write D1 first, then relay a conversation-updated broadcast
// through the DO so open threads update in real time.
export interface ConversationUpdateRequest {
	/** Explicit workspace scope, validated against the authenticated membership. */
	workspaceId: string;
	status?: "open" | "archived";
	/** User id, or null to unassign. */
	assigneeId?: string | null;
	/** ISO timestamp until which the conversation is snoozed, or null to clear. */
	snoozedUntil?: string | null;
	/** Move the conversation to another inbox (shared-inbox routing, ADR 0008). */
	inboxId?: string;
}

export interface ConversationUpdateResponse {
	success: true;
	conversation: ConversationSummary;
}

// GET /api/users — agents for assignee pickers.
export interface UserSummary {
	id: string;
	name: string;
	email: string;
}

// GET /api/channels — channel instances (Pages/mailboxes) with connection
// state. Access tokens never leave the Worker; only hasToken is exposed.
export interface ChannelSummary {
	id: string;
	type: "facebook_page" | "email" | "whatsapp_phone";
	displayName: string;
	externalId: string;
	status: "active" | "disconnected" | "error" | "deleted";
	hasToken: boolean;
	tokenExpiresAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Installation-level Meta App metadata. The App secret never leaves the Worker. */
export interface MetaAppSummary {
	id: string;
	displayName: string;
	appId: string;
	hasSecret: boolean;
	createdAt: string;
	updatedAt: string;
}

/** Returned only when an App is created or its webhook token is rotated. */
export interface MetaAppWebhookSetup {
	metaApp: MetaAppSummary;
	webhookVerifyToken: string;
}

// POST /api/channels/:id/token is defined by ChannelConnectRequestSchema.
export type { ChannelConnectRequest } from "../channel-schema";

// ---------------------------------------------------------------------------
// INBOXES (ADR 0008: every conversation in exactly one inbox; channels link
// to inboxes via inbox_channels; agents join via inbox_members)
// ---------------------------------------------------------------------------

export interface InboxSummary {
	id: string;
	/** Navigation parent; changing it never reroutes conversations. */
	parentInboxId?: string | null;
	/** System inboxes are not valid move sources or destinations. */
	visibilityType?: "shared" | "private" | "team" | "system";
	/** Optimistic version required by the navigation move endpoint. */
	treeVersion?: number;
	name: string;
	description: string | null;
	/** Validated hex color (#RRGGBB); sidebar dot when no icon is set. */
	color: string;
	/** Controlled icon-library key (see INBOX_ICON_KEYS) or null. */
	icon: string | null;
	teamId: string | null;
	teamName: string | null;
	/** Workspace-level default order (admins reorder shared inboxes). */
	sortOrder: number;
	isArchived: boolean;
	assignmentStrategy: InboxAssignmentStrategy;
	/** True when a linked channel of this inbox treats it as its default. */
	isDefault: boolean;
	/** Channel instances feeding this inbox. */
	channels: InboxChannelLink[];
	/** Present only when the caller can read this inbox. */
	memberIds?: string[];
	/** Present only when the caller can read this inbox. */
	conversationCount?: number;
	createdAt: string;
	/** Unix ms; null for inboxes created before the routing migration. */
	updatedAtMs: number | null;
}

export interface InboxChannelLink {
	channelId: string;
	channelDisplayName: string;
	channelType: "facebook_page" | "email" | "whatsapp_phone";
	/** True when this channel's default inbox is this inbox. */
	isDefault: boolean;
}

// POST /api/workspaces/:workspaceId/inboxes is defined by InboxCreateRequestSchema.
// Re-export its inferred type here to preserve the existing contracts surface.
export type {
	InboxAssignmentStrategy,
	InboxCreateRequest,
	InboxIconKey,
} from "../inbox-schema";

// PATCH /api/workspaces/:workspaceId/inboxes/:inboxId
export interface InboxUpdateRequest {
	name?: string;
	description?: string | null;
	color?: string;
	icon?: InboxIconKey | null;
	teamId?: string | null;
	assignmentStrategy?: InboxAssignmentStrategy;
	/** Un-archive via PATCH; archiving goes through POST /archive (dependency-checked). */
	isArchived?: boolean;
}

// POST /api/workspaces/:workspaceId/channels/:channelId/default-inbox
export interface SetDefaultInboxRequest {
	inboxId: string;
}

// PATCH /api/workspaces/:workspaceId/inboxes/reorder — shared admin ordering.
export interface InboxReorderRequest {
	/** Complete ordered list of workspace inbox ids; sort_order is rewritten 0..n. */
	inboxIds: string[];
}

export interface InboxTreeMoveRequest {
	parentInboxId: string | null;
	beforeInboxId?: string;
	expectedTreeVersion: number;
}

// POST /api/inboxes/:id/channels — link a channel to an inbox.
export interface InboxChannelRequest {
	channelId: string;
	/** When true, this becomes the channel's default inbox (un-sets others). */
	isDefault?: boolean;
}

// Conversation ID scheme: fb:{page_id}:{sender_psid} | email:{mailbox}:{thread_key}
// | wa:{phone_number_id}:{customer_whatsapp_id}
export function facebookConversationId(
	pageId: string,
	senderPsid: string,
): string {
	return `fb:${pageId}:${senderPsid}`;
}

export function emailConversationId(
	mailbox: string,
	threadKey: string,
): string {
	return `email:${mailbox}:${threadKey}`;
}

/** Canonical WhatsApp conversation identity: receiving number plus customer wa_id. */
export function whatsappConversationId(
	phoneNumberId: string,
	waId: string,
): string {
	return `wa:${phoneNumberId}:${waId}`;
}

// Parse a conversation ID into { channel, left, right }:
//   fb:     left = page_id,  right = sender_psid
//   email:  left = mailbox,  right = thread_key (RFC 822 Message-ID, may contain colons)
//   wa:     left = phone_number_id, right = customer WhatsApp ID
// Split on the FIRST colon after the channel prefix so colons inside the
// thread key never break parsing.
//
// The canonical prefixes are "fb" and "wa". The longer "facebook" form
// remains accepted for IDs minted before the scheme was tightened.
export function parseConversationId(
	id: string,
): { channel: Channel; left: string; right: string } | null {
	const sep = id.indexOf(":");
	if (sep === -1) return null;
	const rawChannel = id.slice(0, sep);
	if (
		rawChannel !== "facebook" &&
		rawChannel !== "fb" &&
		rawChannel !== "email" &&
		rawChannel !== "wa"
	) {
		return null;
	}
	const channel: Channel =
		rawChannel === "fb"
			? "facebook"
			: rawChannel === "wa"
				? "whatsapp"
				: rawChannel;
	const rest = id.slice(sep + 1);
	const restSep = rest.indexOf(":");
	if (restSep === -1) return null;
	const left = rest.slice(0, restSep);
	const right = rest.slice(restSep + 1);
	if (!left || !right) return null;
	return { channel, left, right };
}

// ---------------------------------------------------------------------------
// WORKSPACES / SIDEBAR (inbox routing + left navigation)
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
	id: string;
	name: string;
	slug: string;
	role: "owner" | "admin" | "member";
	createdAt: string;
}

export interface TeamSummary {
	id: string;
	name: string;
}

/** Authoritative normalized navigation node returned by the sidebar endpoint. */
export type SidebarNodeType =
	| "section"
	| "smart-view"
	| "inbox"
	| "channel-group"
	| "channel"
	| "tag"
	| "saved-view";

export interface SidebarNode {
	id: string;
	type: SidebarNodeType;
	parentId: string | null;
	label: string;
	icon: string | null;
	color: string | null;
	count: number | null;
	unread?: number | null;
	unassigned?: number | null;
	children: SidebarNode[];
	isCollapsible: boolean;
	isEditable: boolean;
	isHidden: boolean;
	permissionState: "allowed" | "readonly";
	filter: SavedFilterFilters;
}

/** New server-authoritative sidebar response. */
export interface SidebarTreeResponse {
	workspace: { id: string; name: string; slug: string };
	permissions: { isAdmin: boolean };
	preferences: SidebarPreferences;
	sections: SidebarNode[];
}

/** Persisted visibility classification for an inbox tree node. */
export type InboxVisibilityType = "shared" | "team" | "private" | "system";

/** Additive per-user tree state stored with sidebar preferences. */
export interface SidebarTreePreferences {
	collapsedNodeIds: string[];
	lastOpenBranchIds: string[];
}

export interface SidebarPreferences {
	collapsedSections: string[];
	collapsedNodeIds: string[];
	lastOpenBranchIds: string[];
	pinnedItemIds: string[];
	hiddenItemIds: string[];
	itemOrder: Record<string, number>;
}

// PATCH /api/workspaces/:workspaceId/sidebar-preferences — personal UI state.
export interface SidebarPreferencesUpdate {
	collapsedSections?: string[];
	collapsedNodeIds?: string[];
	lastOpenBranchIds?: string[];
	pinnedItemIds?: string[];
	hiddenItemIds?: string[];
	itemOrder?: Record<string, number>;
}

// Saved filter facets — mirrors the conversation list options.
export interface SavedFilterFilters {
	status?: "open" | "archived" | "all";
	inboxId?: string;
	q?: string;
	assigneeId?: string;
	unassigned?: boolean;
	snoozed?: boolean;
	channel?: "facebook" | "email" | "whatsapp";
	/** Exact authorized channel selection from a sidebar leaf. */
	channelId?: string;
	tagId?: string;
	/** Saved view identity; the Worker resolves its stored filters per request. */
	savedViewId?: string;
	dateFrom?: string;
	dateTo?: string;
}

export interface SavedFilterSummary {
	id: string;
	name: string;
	filters: SavedFilterFilters;
	createdAt: string;
	updatedAt: string;
}

// POST /api/workspaces/:workspaceId/views
export interface SavedFilterCreateRequest {
	name: string;
	filters: SavedFilterFilters;
}
