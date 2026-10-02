CREATE TRIGGER workspace_members_retain_owner_on_role_change
BEFORE UPDATE OF role ON workspace_members
WHEN OLD.role = 'owner' AND NEW.role != 'owner'
AND NOT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND user_id != OLD.user_id
)
BEGIN SELECT RAISE(ABORT, 'a workspace must retain at least one owner'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_members_retain_owner_on_removal
BEFORE DELETE ON workspace_members
WHEN OLD.role = 'owner'
AND NOT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND user_id != OLD.user_id
)
BEGIN SELECT RAISE(ABORT, 'a workspace must retain at least one owner'); END;
