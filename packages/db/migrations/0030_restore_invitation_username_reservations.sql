-- The invitation issuer reserves the immutable username. Registration creates
-- the account with that username before acceptance, so acceptance must verify
-- equality rather than attempt a second immutable username assignment.
CREATE UNIQUE INDEX idx_agent_invitations_active_username
ON agent_invitations(reserved_username)
WHERE accepted_at IS NULL AND revoked_at IS NULL AND reserved_username IS NOT NULL;
--> statement-breakpoint
DROP TRIGGER agent_invitation_accept_guard;
--> statement-breakpoint
CREATE TRIGGER agent_invitation_accept_guard BEFORE UPDATE OF accepted_at ON agent_invitations
WHEN NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
 OR NEW.expires_at <= NEW.accepted_at OR NEW.reserved_username IS NULL
 OR NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND lower(email) = NEW.email
  AND email_verified = 1 AND username = NEW.reserved_username)
 THEN RAISE(ABORT, 'invitation acceptance requires an unexpired verified matching user with the reserved username') END;
END;