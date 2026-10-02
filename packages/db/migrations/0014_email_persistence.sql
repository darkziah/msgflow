ALTER TABLE outbound_intents ADD COLUMN command_json TEXT;
--> statement-breakpoint
ALTER TABLE email_ingress ADD COLUMN lease_token TEXT;
--> statement-breakpoint
ALTER TABLE email_ingress ADD COLUMN lease_until INTEGER;
--> statement-breakpoint
ALTER TABLE email_ingress ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE email_ingress ADD COLUMN envelope_from TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mailbox_workspace_identity ON mailboxes(id,workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_conversation_workspace_identity ON conversations(id,workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_ingress_scope_identity ON email_ingress(id,workspace_id,mailbox_id);
--> statement-breakpoint
CREATE TABLE email_canonical_messages (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), mailbox_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, ingress_id TEXT UNIQUE, rfc_message_id TEXT,
 message_json TEXT NOT NULL CHECK(json_valid(message_json)), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL,
 routing_done INTEGER NOT NULL DEFAULT 0 CHECK(routing_done IN (0,1)), projected_at TEXT,
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id),
 FOREIGN KEY(ingress_id,workspace_id,mailbox_id) REFERENCES email_ingress(id,workspace_id,mailbox_id)
);
--> statement-breakpoint
CREATE INDEX idx_email_canonical_thread ON email_canonical_messages(mailbox_id,rfc_message_id);
--> statement-breakpoint
CREATE INDEX idx_email_canonical_conversation ON email_canonical_messages(conversation_id,created_at);
--> statement-breakpoint
CREATE TABLE email_private_attachments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), mailbox_id TEXT NOT NULL,
 conversation_id TEXT, ingress_id TEXT, actor_id TEXT REFERENCES user(id), object_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/gif','image/webp','application/pdf')),
 size INTEGER NOT NULL CHECK(size >= 0 AND size <= 5242880), created_at TEXT NOT NULL,
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id),
 FOREIGN KEY(ingress_id,workspace_id,mailbox_id) REFERENCES email_ingress(id,workspace_id,mailbox_id)
);
--> statement-breakpoint
CREATE TABLE email_outbound_metadata (
 intent_id TEXT PRIMARY KEY REFERENCES outbound_intents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 receiving_mailbox_id TEXT NOT NULL, mailbox_id TEXT NOT NULL,
 from_address TEXT NOT NULL, to_address TEXT NOT NULL, in_reply_to TEXT,
 references_json TEXT NOT NULL CHECK(json_valid(references_json)), confirm_private_identity INTEGER NOT NULL DEFAULT 0 CHECK(confirm_private_identity IN (0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(receiving_mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id)
);
--> statement-breakpoint
CREATE TRIGGER email_outbound_metadata_scope BEFORE INSERT ON email_outbound_metadata
WHEN NOT EXISTS (
 SELECT 1 FROM outbound_intents o JOIN conversations c ON c.id=o.conversation_id
 JOIN channels ch ON ch.id=c.channel_id
 JOIN mailboxes receiving ON receiving.id=NEW.receiving_mailbox_id AND receiving.canonical_address=ch.external_id AND receiving.workspace_id=c.workspace_id
 JOIN mailboxes sending ON sending.id=NEW.mailbox_id AND sending.workspace_id=c.workspace_id AND sending.canonical_address=NEW.from_address
 WHERE o.id=NEW.intent_id AND c.workspace_id=NEW.workspace_id AND ch.type='email'
) BEGIN SELECT RAISE(ABORT,'email outbound scope mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER email_outbound_metadata_immutable BEFORE UPDATE ON email_outbound_metadata
BEGIN SELECT RAISE(ABORT,'email outbound metadata is immutable'); END;
--> statement-breakpoint
CREATE TABLE email_routing_commits (message_id TEXT PRIMARY KEY REFERENCES email_canonical_messages(id));
--> statement-breakpoint
CREATE TABLE email_identity_bridges (
 intent_id TEXT PRIMARY KEY REFERENCES outbound_intents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 mailbox_id TEXT NOT NULL, conversation_id TEXT NOT NULL, provider_message_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES user(id), created_at TEXT NOT NULL,
 UNIQUE(mailbox_id,provider_message_id),
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id)
);
