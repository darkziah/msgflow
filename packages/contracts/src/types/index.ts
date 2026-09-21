// Canonical, channel-agnostic domain types shared by the Worker, Durable Objects, and web client.

export type Channel = "facebook" | "email";

export type MessageKind = "inbound" | "outbound";

export interface Attachment {
	id: string;
	type: string;
	url: string;
	name?: string;
}

export interface Message {
	id: string;
	conversationId: string;
	kind: MessageKind;
	channel: Channel;
	providerMessageId: string | null;
	senderId: string;
	text: string;
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

export interface PresenceEntry {
	agentId: string;
	status: "viewing" | "drafting";
	connectedAt: string;
}

export type ConversationEvent =
	| { type: "message:new"; message: Message }
	| { type: "comment:new"; comment: Comment }
	| { type: "conversation-updated"; patch: Record<string, unknown> }
	| { type: "presence"; agents: PresenceEntry[] }
	| { type: "typing"; agentId: string; isTyping: boolean };

export interface ApiResponse {
	message: string;
	success: true;
}

// POST /api/conversations/:id/messages
export interface SendMessageRequest {
	text: string;
	/** Email only: the subject line (Front/Missive composers show it). */
	subject?: string;
	/** ISO timestamp; when set in the future the message is scheduled instead of sent. */
	sendAt?: string;
	/** Client-generated idempotency key; the DO dedups on it. */
	clientMessageId?: string;
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

// GET /api/conversations/:id/messages — full timeline from the Conversation DO.
export interface MessagesResponse {
	messages: Message[];
}

// POST /api/conversations/:id/read
export interface MarkReadRequest {
	lastReadSeq: number;
}

// PATCH /api/conversations/:id — metadata update (status, assignee, snooze).
// ADR 0004: write D1 first, then relay a conversation-updated broadcast
// through the DO so open threads update in real time.
export interface ConversationUpdateRequest {
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
	type: "facebook_page" | "email";
	displayName: string;
	externalId: string;
	status: "active" | "disconnected" | "error";
	hasToken: boolean;
	tokenExpiresAt: string | null;
	createdAt: string;
	updatedAt: string;
}

// POST /api/channels/:id/token
export interface ChannelConnectRequest {
	accessToken: string;
}

// ---------------------------------------------------------------------------
// INBOXES (ADR 0008: every conversation in exactly one inbox; channels link
// to inboxes via inbox_channels; agents join via inbox_members)
// ---------------------------------------------------------------------------

export interface InboxSummary {
	id: string;
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
	/** Agent ids that are members of this inbox. */
	memberIds: string[];
	conversationCount: number;
	createdAt: string;
	/** Unix ms; null for inboxes created before the routing migration. */
	updatedAtMs: number | null;
}

export const INBOX_ICON_KEYS = [
	"inbox",
	"headphones",
	"receipt-text",
	"badge-dollar-sign",
	"briefcase",
] as const;
export type InboxIconKey = (typeof INBOX_ICON_KEYS)[number];

export const INBOX_ASSIGNMENT_STRATEGIES = [
	"manual",
	"round_robin",
	"least_busy",
] as const;
export type InboxAssignmentStrategy =
	(typeof INBOX_ASSIGNMENT_STRATEGIES)[number];

export const INBOX_COLOR_PRESETS = [
	"#3B82F6",
	"#22C55E",
	"#A855F7",
	"#F97316",
	"#EAB308",
	"#EF4444",
	"#14B8A6",
	"#64748B",
] as const;

export interface InboxChannelLink {
	channelId: string;
	channelDisplayName: string;
	channelType: "facebook_page" | "email";
	/** True when this channel's default inbox is this inbox. */
	isDefault: boolean;
}

// POST /api/workspaces/:workspaceId/inboxes
export interface InboxCreateRequest {
	name: string;
	description?: string | null;
	color?: string;
	icon?: InboxIconKey | null;
	teamId?: string | null;
	assignmentStrategy?: InboxAssignmentStrategy;
	/** Optional channel ids to link immediately (first becomes the channel's default). */
	channelIds?: string[];
}

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

// POST /api/inboxes/:id/channels — link a channel to an inbox.
export interface InboxChannelRequest {
	channelId: string;
	/** When true, this becomes the channel's default inbox (un-sets others). */
	isDefault?: boolean;
}

// Conversation ID scheme: fb:{page_id}:{sender_psid} | email:{mailbox}:{thread_key}
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

// Parse a conversation ID into { channel, left, right }:
//   fb:     left = page_id,  right = sender_psid
//   email:  left = mailbox,  right = thread_key (RFC 822 Message-ID, may contain colons)
// Split on the FIRST colon after the channel prefix so colons inside the
// thread key never break parsing.
//
// The canonical facebook prefix is "fb" (facebookConversationId); the longer
// "facebook" form is also accepted for compat with ids minted before the
// scheme was tightened.
export function parseConversationId(
	id: string,
): { channel: Channel; left: string; right: string } | null {
	const sep = id.indexOf(":");
	if (sep === -1) return null;
	const rawChannel = id.slice(0, sep);
	if (
		rawChannel !== "facebook" &&
		rawChannel !== "fb" &&
		rawChannel !== "email"
	) {
		return null;
	}
	const channel: Channel = rawChannel === "fb" ? "facebook" : rawChannel;
	const rest = id.slice(sep + 1);
	const restSep = rest.indexOf(":");
	if (restSep === -1) return null;
	return {
		channel,
		left: rest.slice(0, restSep),
		right: rest.slice(restSep + 1),
	};
}

// ---------------------------------------------------------------------------
// WORKSPACES / SIDEBAR (inbox routing + left navigation)
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
	id: string;
	name: string;
	slug: string;
	role: "owner" | "admin" | "member";
}

export interface TeamSummary {
	id: string;
	name: string;
}

// Stable item identifiers used in sidebar JSON preferences:
//   system:all | system:assigned-to-me | system:unassigned | system:snoozed
//   | system:closed | inbox:<inbox-id> | tag:<tag-id> | view:<saved-filter-id>
export type SidebarItemKind = "system" | "inbox" | "tag" | "view";

export interface SidebarItemBase {
	kind: SidebarItemKind;
	/** Stable id (see above). */
	id: string;
	label: string;
}

export interface SidebarSystemItem extends SidebarItemBase {
	kind: "system";
	count: number;
}

export interface SidebarInboxItem extends SidebarItemBase {
	kind: "inbox";
	inboxId: string;
	color: string;
	icon: string | null;
	teamId: string | null;
	isArchived: boolean;
	/** This inbox is a channel's current default (never hide/archive without checks). */
	isDefault: boolean;
	/** Open conversations in the inbox. */
	count: number;
	/**
	 * The user has an open conversation assigned to them inside this inbox.
	 * Such an inbox must stay visible even if the user hides it (the never-
	 * remove rule) until the work is resolved or reassigned.
	 */
	hasOpenAssigned: boolean;
}

export interface SidebarTagItem extends SidebarItemBase {
	kind: "tag";
	color: string | null;
	count: number;
}

export interface SidebarViewItem extends SidebarItemBase {
	kind: "view";
}

export type SidebarItem =
	| SidebarSystemItem
	| SidebarInboxItem
	| SidebarTagItem
	| SidebarViewItem;

export interface SidebarGroup {
	id: string;
	label: string;
	items: SidebarItem[];
}

export interface SidebarSection {
	key: "inbox" | "assigned" | "teams" | "tags" | "views";
	label: string;
	/** Ungrouped items rendered before the groups (e.g. All Messages). */
	items: SidebarItem[];
	groups: SidebarGroup[];
}

export interface SidebarPreferences {
	collapsedSections: string[];
	pinnedItemIds: string[];
	hiddenItemIds: string[];
	itemOrder: Record<string, number>;
}

export interface SidebarResponse {
	workspace: { id: string; name: string; slug: string };
	permissions: { isAdmin: boolean };
	preferences: SidebarPreferences;
	sections: SidebarSection[];
}

// PATCH /api/workspaces/:workspaceId/sidebar-preferences — personal UI state.
export interface SidebarPreferencesUpdate {
	collapsedSections?: string[];
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
	channel?: "facebook" | "email";
	tagId?: string;
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
