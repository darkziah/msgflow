CREATE TABLE email_drafts (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 payload_json TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (conversation_id, user_id)
);
--> statement-breakpoint
CREATE INDEX idx_email_drafts_workspace_user ON email_drafts(workspace_id, user_id);
