import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// D1 is the cross-conversation store: workspaces/teams, channels (Pages +
// mailboxes), contacts and their channel identities, conversation metadata
// (status, assignee, inbox, snooze, tags), the rules engine, read cursors, and
// scheduled sends. The live message timeline is NOT here — it lives in the
// Conversation DO, which mirrors a lightweight summary per message (ADR 0004).
//
// Timestamps are ISO-8601 TEXT (the project convention); Better-auth's own
// tables (user/session/account/verification) use integer timestamp_ms and live
// in auth-schema.ts untouched.

// ---------------------------------------------------------------------------
// 1. ORGANIZATION (workspaces / teams)
// ---------------------------------------------------------------------------

export const workspaces = sqliteTable("workspaces", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const workspaceMembers = sqliteTable(
	"workspace_members",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_workspace_members_unique").on(
			table.workspaceId,
			table.userId,
		),
	],
);

export const teams = sqliteTable("teams", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	createdAt: text("created_at").notNull(),
});

export const teamMembers = sqliteTable(
	"team_members",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["admin", "member"] })
			.notNull()
			.default("member"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_team_members_unique").on(table.teamId, table.userId),
	],
);

// ---------------------------------------------------------------------------
// 2. CHANNELS (Facebook Pages + email mailboxes)
// ---------------------------------------------------------------------------

export const channels = sqliteTable(
	"channels",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		type: text("type", { enum: ["facebook_page", "email"] }).notNull(),
		displayName: text("display_name").notNull(),
		// Facebook: Page ID. Email: the mailbox address (From/To), e.g. support@yehey.com.
		externalId: text("external_id").notNull(),
		// Encrypted at rest; only the Worker/channel layer reads these.
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		tokenExpiresAt: text("token_expires_at"),
		webhookVerifyToken: text("webhook_verify_token"),
		// Reserved for a future self-hosted mailbox; unused with Cloudflare Email
		// Service (ADR 0014) — outbound goes through the send_email binding.
		imapSmtpConfig: text("imap_smtp_config"),
		status: text("status", { enum: ["active", "disconnected", "error"] })
			.notNull()
			.default("active"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_channels_workspace_external").on(
			table.workspaceId,
			table.externalId,
		),
	],
);

// ---------------------------------------------------------------------------
// 3. INBOXES (team/queue grouping of conversations)
// ---------------------------------------------------------------------------

export const inboxes = sqliteTable("inboxes", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
	name: text("name").notNull(),
	description: text("description"),
	// Validated hex color (#RRGGBB); the sidebar dot falls back to it when no icon.
	color: text("color").notNull().default("#64748B"),
	// Controlled icon-library key (inbox, headphones, receipt-text, badge-dollar-sign, briefcase).
	icon: text("icon"),
	// Workspace-level default order for shared inboxes (admin drag-and-drop).
	sortOrder: integer("sort_order").notNull().default(0),
	isArchived: integer("is_archived", { mode: "boolean" })
		.notNull()
		.default(false),
	// Queue assignment strategy; round-robin/least-busy are hooks for a later phase.
	assignmentStrategy: text("assignment_strategy", {
		enum: ["manual", "round_robin", "least_busy"],
	})
		.notNull()
		.default("manual"),
	createdAt: text("created_at").notNull(),
	// Unix milliseconds (deliberate: the inbox-routing spec's new columns use ms,
	// unlike the older ISO-8601 TEXT columns in this table).
	updatedAt: integer("updated_at"),
});

// A channel can feed several inboxes; exactly one link per channel must be the
// default (ADR 0008: "each Channel has a default Inbox, overridable by rules").
export const inboxChannels = sqliteTable(
	"inbox_channels",
	{
		id: text("id").primaryKey(),
		inboxId: text("inbox_id")
			.notNull()
			.references(() => inboxes.id, { onDelete: "cascade" }),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		isDefault: integer("is_default", { mode: "boolean" })
			.notNull()
			.default(false),
	},
	(table) => [
		uniqueIndex("idx_inbox_channels").on(table.inboxId, table.channelId),
	],
);

export const inboxMembers = sqliteTable(
	"inbox_members",
	{
		id: text("id").primaryKey(),
		inboxId: text("inbox_id")
			.notNull()
			.references(() => inboxes.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("idx_inbox_members_unique").on(table.inboxId, table.userId),
	],
);

// ---------------------------------------------------------------------------
// 4. CONTACTS (cross-channel identity resolution)
// ---------------------------------------------------------------------------

// A Contact is the person; each channel identity (Facebook PSID, email address)
// links to it via contact_identities. No automatic merging in Phase 1 — each
// channel identity resolves to its own Contact unless explicitly linked later
// (ADR 0016).
export const contacts = sqliteTable("contacts", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	displayName: text("display_name"),
	primaryEmail: text("primary_email"),
	avatarUrl: text("avatar_url"),
	notes: text("notes"),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

// One Contact may hold an FB PSID + one or more emails. The unique key is per
// channel instance (PSIDs are Page-scoped — the same PSID number on two Pages
// can be two different people), not just per channel type.
export const contactIdentities = sqliteTable(
	"contact_identities",
	{
		id: text("id").primaryKey(),
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		channelType: text("channel_type", {
			enum: ["facebook_page", "email"],
		}).notNull(),
		// Facebook: PSID. Email: the sender's address.
		externalUserId: text("external_user_id").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_contact_identities_channel_external").on(
			table.channelId,
			table.externalUserId,
		),
	],
);

// ---------------------------------------------------------------------------
// 5. CONVERSATIONS
// D1 holds metadata/index; the Durable Object (keyed by do_binding_id) holds
// the live, realtime message log for the conversation.
// ---------------------------------------------------------------------------

export const conversations = sqliteTable(
	"conversations",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		// Exactly one inbox per conversation (ADR 0008). Deleting an inbox must
		// re-route its conversations, never null them out.
		inboxId: text("inbox_id")
			.notNull()
			.references(() => inboxes.id),
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		// Durable Object instance name; derived as the conversation id itself.
		doBindingId: text("do_binding_id").notNull(),
		subject: text("subject"), // email subject, null for Facebook
		// open | archived only — snoozing is orthogonal (snoozed_until) (ADR 0008).
		status: text("status", { enum: ["open", "archived"] })
			.notNull()
			.default("open"),
		assigneeId: text("assignee_id").references(() => user.id, {
			onDelete: "set null",
		}),
		lastMessageAt: text("last_message_at"),
		lastMessagePreview: text("last_message_preview"),
		// Latest timeline seq — drives per-agent unread (ADR 0015).
		messageCount: integer("message_count").notNull().default(0),
		snoozedUntil: text("snoozed_until"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		index("idx_conversations_inbox_status").on(table.inboxId, table.status),
		index("idx_conversations_assignee").on(table.assigneeId),
		index("idx_conversations_contact").on(table.contactId),
		index("idx_conversations_last_activity").on(table.lastMessageAt),
	],
);

// Lightweight per-message mirror for list rendering + search (ADR 0013).
// Full message bodies/attachments live in Durable Object storage. The DO
// inserts a row per append with its local monotonic seq (ADR 0004/0015).
export const messagesSummary = sqliteTable(
	"messages_summary",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
		// contact = customer-facing inbound, user = agent outbound. System events
		// are Activities, never Messages (CONTEXT.md).
		senderType: text("sender_type", { enum: ["contact", "user"] }).notNull(),
		senderId: text("sender_id").notNull(),
		preview: text("preview").notNull(), // truncated text for list/search
		hasAttachments: integer("has_attachments", { mode: "boolean" })
			.notNull()
			.default(false),
		sentAt: text("sent_at").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		index("idx_messages_summary_conv").on(table.conversationId, table.sentAt),
	],
);

// Per-agent unread cursor (ADR 0015): unread = conversations.message_count - last_read_seq.
export const conversationReads = sqliteTable(
	"conversation_reads",
	{
		conversationId: text("conversation_id").notNull(),
		agentId: text("agent_id").notNull(),
		lastReadSeq: integer("last_read_seq").notNull().default(0),
	},
	(table) => [
		uniqueIndex("idx_conversation_reads").on(
			table.conversationId,
			table.agentId,
		),
	],
);

// ---------------------------------------------------------------------------
// 6. TAGS (shared / private / company, nested hierarchy)
// ---------------------------------------------------------------------------

export const tags = sqliteTable("tags", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	parentTagId: text("parent_tag_id").references(
		(): AnySQLiteColumn => tags.id,
		{
			onDelete: "cascade",
		},
	),
	name: text("name").notNull(),
	color: text("color"),
	visibility: text("visibility", { enum: ["company", "shared", "private"] })
		.notNull()
		.default("shared"),
	// Set when visibility = private.
	ownerUserId: text("owner_user_id").references(() => user.id, {
		onDelete: "cascade",
	}),
	createdAt: text("created_at").notNull(),
});

export const conversationTags = sqliteTable(
	"conversation_tags",
	{
		id: text("id").primaryKey(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("idx_conversation_tags").on(table.conversationId, table.tagId),
	],
);

// ---------------------------------------------------------------------------
// 7. RULES ENGINE (trigger -> condition -> action)
// ---------------------------------------------------------------------------

export const rules = sqliteTable("rules", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	inboxId: text("inbox_id").references(() => inboxes.id, {
		onDelete: "cascade",
	}), // null = workspace-wide
	name: text("name").notNull(),
	triggerType: text("trigger_type", {
		enum: ["message_received", "conversation_created", "tag_added", "manual"],
	}).notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	priority: integer("priority").notNull().default(0), // lower runs first
	// When true, evaluation stops after this rule matches (admins can short-circuit).
	stopProcessing: integer("stop_processing", { mode: "boolean" })
		.notNull()
		.default(false),
	createdBy: text("created_by").references(() => user.id, {
		onDelete: "set null",
	}),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const ruleConditions = sqliteTable("rule_conditions", {
	id: text("id").primaryKey(),
	ruleId: text("rule_id")
		.notNull()
		.references(() => rules.id, { onDelete: "cascade" }),
	// e.g. 'sender.email', 'channel.type', 'message.body', 'subject', 'status', 'inbox.id'
	field: text("field").notNull(),
	operator: text("operator", {
		enum: [
			"equals",
			"not_equals",
			"contains",
			"not_contains",
			"starts_with",
			"ends_with",
			"regex",
		],
	}).notNull(),
	value: text("value").notNull(),
	// Conditions in the same group are OR'd; groups are AND'd.
	matchGroup: integer("match_group").notNull().default(0),
	createdAt: text("created_at").notNull(),
});

export const ruleActions = sqliteTable("rule_actions", {
	id: text("id").primaryKey(),
	ruleId: text("rule_id")
		.notNull()
		.references(() => rules.id, { onDelete: "cascade" }),
	// assign_team / move_inbox are routing (first-match-wins); the rest are
	// additive (all apply) per ADR 0009.
	actionType: text("action_type", {
		enum: [
			"assign_user",
			"assign_team",
			"move_inbox",
			"add_tag",
			"remove_tag",
			"set_status",
			"send_canned_reply",
		],
	}).notNull(),
	// Target id or literal value, interpreted by action_type.
	actionValue: text("action_value").notNull(),
	executionOrder: integer("execution_order").notNull().default(0),
	createdAt: text("created_at").notNull(),
});

export const ruleExecutionLog = sqliteTable("rule_execution_log", {
	id: text("id").primaryKey(),
	ruleId: text("rule_id")
		.notNull()
		.references(() => rules.id, { onDelete: "cascade" }),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	executedAt: text("executed_at").notNull(),
	result: text("result", { enum: ["matched", "skipped", "error"] }).notNull(),
	detail: text("detail"),
});

export type Rule = typeof rules.$inferSelect;
export type RuleCondition = typeof ruleConditions.$inferSelect;
export type RuleAction = typeof ruleActions.$inferSelect;

// Bodies referenced by rule_actions 'send_canned_reply' (action_value = reply id).
export const cannedReplies = sqliteTable("canned_replies", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	body: text("body").notNull(),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// 8. SEND-LATER
// ---------------------------------------------------------------------------

export const scheduledMessages = sqliteTable("scheduled_messages", {
	id: text("id").primaryKey(),
	conversationId: text("conversation_id").notNull(),
	text: text("text").notNull(),
	sendAt: text("send_at").notNull(),
	createdBy: text("created_by"),
	// Delivery attempts; the cron tick deletes the row after MAX_ATTEMPTS failures
	// so a permanently failing message (e.g. revoked Page token) stops retrying.
	attempts: integer("attempts").notNull().default(0),
});

// 5 attempts (≈5 minutes) before a scheduled message is dropped with an error log.
export const SCHEDULED_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// 9. SIDEBAR PERSONALIZATION + SAVED FILTERS + WEBHOOK IDEMPOTENCY
// ---------------------------------------------------------------------------

// Per-user, per-workspace sidebar UI state. This is personal preference state
// only — it must never change shared routing, membership, names, colors, or
// permissions. JSON columns hold stable item ids (system:*, inbox:*, tag:*,
// view:*) so they survive renames; the sidebar shape is rendered by the
// worker, the client applies these on top.
export const userSidebarPreferences = sqliteTable(
	"user_sidebar_preferences",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		collapsedSectionsJson: text("collapsed_sections_json")
			.notNull()
			.default("[]"),
		pinnedItemIdsJson: text("pinned_item_ids_json").notNull().default("[]"),
		hiddenItemIdsJson: text("hidden_item_ids_json").notNull().default("[]"),
		// Map of item id -> local order (0 = first). Never touches inboxes.sort_order.
		itemOrderJson: text("item_order_json").notNull().default("{}"),
		updatedAt: integer("updated_at").notNull(), // Unix ms
	},
	(table) => [
		uniqueIndex("idx_user_sidebar_preferences_unique").on(
			table.userId,
			table.workspaceId,
		),
	],
);

// Saved filter ("Views" sidebar section): a named snapshot of the conversation
// list facets. filters_json mirrors ConversationListOptions.
export const savedFilters = sqliteTable("saved_filters", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	filtersJson: text("filters_json").notNull(),
	createdBy: text("created_by").references(() => user.id, {
		onDelete: "set null",
	}),
	createdAt: text("created_at").notNull(),
	updatedAt: text("updated_at").notNull(),
});

// Ingest-side webhook idempotency. The Conversation DO dedups message appends
// by providerMessageId, but rules run BEFORE the append — so a replayed webhook
// could re-run rule side effects (duplicate canned replies, re-tags). This row
// is inserted with onConflictDoNothing before rule evaluation; a conflict means
// the event was already processed and rules are skipped entirely. The primary
// key is (conversation_id, provider_message_id); a synthetic deterministic key
// is used when the provider event has no message id.
export const processedMessages = sqliteTable(
	"processed_messages",
	{
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		providerMessageId: text("provider_message_id").notNull(),
		messageId: text("message_id").notNull(),
		processedAt: integer("processed_at").notNull(), // Unix ms
	},
	(table) => [
		primaryKey({
			columns: [table.conversationId, table.providerMessageId],
		}),
	],
);
