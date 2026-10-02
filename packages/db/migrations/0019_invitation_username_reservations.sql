-- Reserved usernames remain on an invitation until verified acceptance. Existing
-- historical invitations retain their prior behavior when reserved_username is NULL.
ALTER TABLE agent_invitations ADD COLUMN reserved_username TEXT;
--> statement-breakpoint
ALTER TABLE agent_invitations ADD COLUMN revoked_at INTEGER;
--> statement-breakpoint
ALTER TABLE agent_invitations ADD COLUMN cooldown_until INTEGER;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_agent_invitations_active_username
ON agent_invitations(reserved_username)
WHERE accepted_at IS NULL AND revoked_at IS NULL AND reserved_username IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_agent_invitations_active_email
ON agent_invitations(email)
WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
DROP TRIGGER agent_invitation_accept_guard;
--> statement-breakpoint
CREATE TRIGGER agent_invitation_accept_guard BEFORE UPDATE OF accepted_at ON agent_invitations
WHEN NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
 OR NEW.expires_at <= NEW.accepted_at OR NEW.reserved_username IS NULL
 OR NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND lower(email) = NEW.email AND email_verified = 1 AND username IS NULL)
 THEN RAISE(ABORT, 'invitation acceptance requires an unexpired invitation, verified matching user, and unassigned username') END;
 UPDATE user SET username = NEW.reserved_username WHERE id = NEW.user_id;
END;
