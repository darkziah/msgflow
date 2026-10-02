CREATE TABLE workspace_member_offboardings (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  prior_role TEXT NOT NULL CHECK (prior_role IN ('owner', 'admin', 'member')),
  confirmation_identifier TEXT NOT NULL,
  private_mailboxes_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_workspace_member_offboardings_workspace_time
ON workspace_member_offboardings(workspace_id, created_at);
--> statement-breakpoint
CREATE TRIGGER workspace_member_offboardings_no_update
BEFORE UPDATE ON workspace_member_offboardings
BEGIN SELECT RAISE(ABORT, 'workspace member offboarding audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_member_offboardings_no_delete
BEFORE DELETE ON workspace_member_offboardings
BEGIN SELECT RAISE(ABORT, 'workspace member offboarding audit is immutable'); END;
