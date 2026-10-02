CREATE TABLE agent_invitations (
 id TEXT PRIMARY KEY NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 invited_by TEXT NOT NULL REFERENCES user(id),
 expires_at INTEGER NOT NULL,
 claimed_at INTEGER,
 user_id TEXT REFERENCES user(id),
 accepted_at INTEGER,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX agent_invitations_workspace ON agent_invitations(workspace_id);
--> statement-breakpoint
CREATE TRIGGER agent_invitation_accept_guard BEFORE UPDATE OF accepted_at ON agent_invitations
WHEN NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.accepted_at IS NOT NULL OR NEW.expires_at <= NEW.accepted_at
 OR NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND lower(email) = NEW.email AND email_verified = 1)
 THEN RAISE(ABORT, 'invitation acceptance requires an unexpired invitation and verified matching user') END;
END;
--> statement-breakpoint
CREATE TRIGGER agent_invitation_accept_membership AFTER UPDATE OF accepted_at ON agent_invitations
WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
BEGIN
 INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
 VALUES (NEW.id, NEW.workspace_id, NEW.user_id, 'member', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
