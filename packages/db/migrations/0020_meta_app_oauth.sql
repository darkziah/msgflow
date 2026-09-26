CREATE TABLE meta_apps (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_meta_apps_workspace_app_id ON meta_apps(workspace_id, app_id);
--> statement-breakpoint
ALTER TABLE channels ADD COLUMN meta_app_id TEXT REFERENCES meta_apps(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX idx_channels_meta_app ON channels(meta_app_id);
--> statement-breakpoint
CREATE TABLE meta_oauth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meta_app_id TEXT NOT NULL REFERENCES meta_apps(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  callback_origin TEXT NOT NULL,
  state_nonce TEXT NOT NULL UNIQUE,
  encrypted_pages TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_meta_oauth_sessions_actor ON meta_oauth_sessions(actor_user_id, expires_at);
