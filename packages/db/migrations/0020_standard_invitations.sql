-- Standard invitations are scoped to a Workspace and no longer reserve usernames.
DROP INDEX idx_agent_invitations_active_username;
--> statement-breakpoint
DROP INDEX idx_agent_invitations_active_email;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_agent_invitations_active_workspace_email
ON agent_invitations(workspace_id, email)
WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
DROP TRIGGER agent_invitation_accept_guard;
--> statement-breakpoint
CREATE TRIGGER agent_invitation_accept_guard BEFORE UPDATE OF accepted_at ON agent_invitations
WHEN NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
 OR NEW.expires_at <= NEW.accepted_at
 OR NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND lower(email) = NEW.email AND email_verified = 1)
 THEN RAISE(ABORT, 'invitation acceptance requires an unexpired verified matching user') END;
END;
