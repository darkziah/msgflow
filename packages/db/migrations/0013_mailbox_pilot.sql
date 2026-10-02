CREATE TABLE email_audit (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL,
 actor_user_id TEXT,
 action TEXT NOT NULL,
 target_id TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_email_audit_workspace_time ON email_audit(workspace_id, created_at);
--> statement-breakpoint
CREATE TRIGGER email_audit_no_update BEFORE UPDATE ON email_audit BEGIN SELECT RAISE(ABORT, 'email audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER email_audit_no_delete BEFORE DELETE ON email_audit BEGIN SELECT RAISE(ABORT, 'email audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER mailbox_transport_provision AFTER INSERT ON mailboxes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM email_domains WHERE id = NEW.email_domain_id AND workspace_id = NEW.workspace_id) THEN RAISE(ABORT, 'mailbox domain workspace mismatch') END;
 SELECT CASE WHEN NEW.type = 'shared' AND NOT EXISTS(SELECT 1 FROM inboxes WHERE id = NEW.inbox_id AND workspace_id = NEW.workspace_id AND is_archived = 0) THEN RAISE(ABORT, 'mailbox inbox unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM channels c JOIN inbox_channels ic ON ic.channel_id = c.id WHERE c.workspace_id = NEW.workspace_id AND c.external_id = NEW.canonical_address AND ic.is_default = 1 AND ic.inbox_id != CASE WHEN NEW.type = 'private' THEN 'mailbox-inbox:' || NEW.id ELSE NEW.inbox_id END) THEN RAISE(ABORT, 'mailbox default inbox collision') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM channels WHERE workspace_id = NEW.workspace_id AND external_id = NEW.canonical_address AND type != 'email') THEN RAISE(ABORT, 'mailbox channel collision') END;
 INSERT OR IGNORE INTO channels(id, workspace_id, type, display_name, external_id, status, created_at, updated_at)
 VALUES ('mailbox-channel:' || NEW.id, NEW.workspace_id, 'email', NEW.canonical_address, NEW.canonical_address, 'active', NEW.created_at, NEW.updated_at);
 INSERT OR IGNORE INTO inboxes(id, workspace_id, name, created_at)
 SELECT 'mailbox-inbox:' || NEW.id, NEW.workspace_id, NEW.canonical_address, NEW.created_at WHERE NEW.type = 'private';
 INSERT OR IGNORE INTO inbox_channels(id, inbox_id, channel_id, is_default)
 SELECT 'mailbox-link:' || NEW.id, CASE WHEN NEW.type = 'private' THEN 'mailbox-inbox:' || NEW.id ELSE NEW.inbox_id END, id, 1 FROM channels
 WHERE workspace_id = NEW.workspace_id AND external_id = NEW.canonical_address
 AND NOT EXISTS (SELECT 1 FROM inbox_channels ic WHERE ic.channel_id = channels.id AND ic.is_default = 1);
END;