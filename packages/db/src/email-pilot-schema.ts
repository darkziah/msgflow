import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
import {
	conversations,
	emailIngress,
	mailboxes,
	outboundIntents,
	workspaces,
} from "./schema";

// Mirrors migrations 0014 and 0016. Trigger-based scope/immutability guards
// remain in SQL; Drizzle declarations do not replace those migrations.
export const emailCanonicalMessages = sqliteTable(
	"email_canonical_messages",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id),
		mailboxId: text("mailbox_id").notNull(),
		conversationId: text("conversation_id").notNull(),
		ingressId: text("ingress_id").unique(),
		rfcMessageId: text("rfc_message_id"),
		messageJson: text("message_json").notNull(),
		metadataJson: text("metadata_json").notNull(),
		createdAt: text("created_at").notNull(),
		routingDone: integer("routing_done", { mode: "boolean" })
			.notNull()
			.default(false),
		projectedAt: text("projected_at"),
	},
	(t) => [
		foreignKey({
			columns: [t.mailboxId, t.workspaceId],
			foreignColumns: [mailboxes.id, mailboxes.workspaceId],
		}),
		foreignKey({
			columns: [t.conversationId, t.workspaceId],
			foreignColumns: [conversations.id, conversations.workspaceId],
		}),
		foreignKey({
			columns: [t.ingressId, t.workspaceId, t.mailboxId],
			foreignColumns: [
				emailIngress.id,
				emailIngress.workspaceId,
				emailIngress.mailboxId,
			],
		}),
		check("email_canonical_message_json", sql`json_valid(${t.messageJson})`),
		check("email_canonical_metadata_json", sql`json_valid(${t.metadataJson})`),
		check("email_canonical_routing_done", sql`${t.routingDone} IN (0,1)`),
		index("idx_email_canonical_thread").on(t.mailboxId, t.rfcMessageId),
		index("idx_email_canonical_conversation").on(t.conversationId, t.createdAt),
	],
);

export const emailPrivateAttachments = sqliteTable(
	"email_private_attachments",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id),
		mailboxId: text("mailbox_id").notNull(),
		conversationId: text("conversation_id"),
		ingressId: text("ingress_id"),
		actorId: text("actor_id").references(() => user.id),
		objectKey: text("object_key").notNull().unique(),
		name: text("name").notNull(),
		mimeType: text("mime_type").notNull(),
		size: integer("size").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(t) => [
		foreignKey({
			columns: [t.mailboxId, t.workspaceId],
			foreignColumns: [mailboxes.id, mailboxes.workspaceId],
		}),
		foreignKey({
			columns: [t.conversationId, t.workspaceId],
			foreignColumns: [conversations.id, conversations.workspaceId],
		}),
		foreignKey({
			columns: [t.ingressId, t.workspaceId, t.mailboxId],
			foreignColumns: [
				emailIngress.id,
				emailIngress.workspaceId,
				emailIngress.mailboxId,
			],
		}),
		check(
			"email_attachment_mime_type",
			sql`${t.mimeType} IN ('image/png','image/jpeg','image/gif','image/webp','application/pdf')`,
		),
		check(
			"email_attachment_size",
			sql`${t.size} >= 0 AND ${t.size} <= 5242880`,
		),
	],
);

export const emailOutboundMetadata = sqliteTable(
	"email_outbound_metadata",
	{
		intentId: text("intent_id")
			.primaryKey()
			.references(() => outboundIntents.id),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id),
		receivingMailboxId: text("receiving_mailbox_id").notNull(),
		mailboxId: text("mailbox_id").notNull(),
		fromAddress: text("from_address").notNull(),
		toAddress: text("to_address").notNull(),
		inReplyTo: text("in_reply_to"),
		referencesJson: text("references_json").notNull(),
		confirmPrivateIdentity: integer("confirm_private_identity", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		createdAt: text("created_at").notNull(),
	},
	(t) => [
		foreignKey({
			columns: [t.receivingMailboxId, t.workspaceId],
			foreignColumns: [mailboxes.id, mailboxes.workspaceId],
		}),
		foreignKey({
			columns: [t.mailboxId, t.workspaceId],
			foreignColumns: [mailboxes.id, mailboxes.workspaceId],
		}),
		check(
			"email_outbound_references_json",
			sql`json_valid(${t.referencesJson})`,
		),
		check(
			"email_outbound_confirm_private_identity",
			sql`${t.confirmPrivateIdentity} IN (0,1)`,
		),
	],
);

export const emailRoutingCommits = sqliteTable("email_routing_commits", {
	messageId: text("message_id")
		.primaryKey()
		.references(() => emailCanonicalMessages.id),
});

export const emailIdentityBridges = sqliteTable(
	"email_identity_bridges",
	{
		intentId: text("intent_id")
			.primaryKey()
			.references(() => outboundIntents.id),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id),
		mailboxId: text("mailbox_id").notNull(),
		conversationId: text("conversation_id").notNull(),
		providerMessageId: text("provider_message_id").notNull(),
		actorId: text("actor_id")
			.notNull()
			.references(() => user.id),
		createdAt: text("created_at").notNull(),
	},
	(t) => [
		unique().on(t.mailboxId, t.providerMessageId),
		foreignKey({
			columns: [t.mailboxId, t.workspaceId],
			foreignColumns: [mailboxes.id, mailboxes.workspaceId],
		}),
		foreignKey({
			columns: [t.conversationId, t.workspaceId],
			foreignColumns: [conversations.id, conversations.workspaceId],
		}),
	],
);

export const emailDrafts = sqliteTable(
	"email_drafts",
	{
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "restrict" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "restrict" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		payloadJson: text("payload_json").notNull(),
		revision: integer("revision").notNull().default(0),
		updatedAt: text("updated_at").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.conversationId, t.userId] }),
		index("idx_email_drafts_workspace_user").on(t.workspaceId, t.userId),
	],
);
