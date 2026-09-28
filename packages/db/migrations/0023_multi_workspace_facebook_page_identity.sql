-- Keep the existing workspace fence until active Page ownership is checked.
-- A failed preflight stays installed, making retries safe after an operator
-- resolves ownership without silently changing Page identities or tokens.
CREATE TRIGGER IF NOT EXISTS migration_0023_facebook_page_identity_preflight
BEFORE UPDATE ON channels
WHEN EXISTS (
  SELECT 1 FROM channels
  WHERE type = 'facebook_page' AND status <> 'deleted'
  GROUP BY external_id
  HAVING count(DISTINCT workspace_id) > 1
)
BEGIN
  SELECT RAISE(ABORT, 'migration 0023 blocked: active Facebook Page IDs are configured in multiple workspaces; resolve Page ownership manually without changing credentials, then retry');
END;
--> statement-breakpoint
UPDATE channels SET external_id = external_id
WHERE rowid = (SELECT rowid FROM channels LIMIT 1);
--> statement-breakpoint
DROP TRIGGER migration_0023_facebook_page_identity_preflight;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_channels_facebook_page_identity
ON channels(external_id)
WHERE type = 'facebook_page' AND status <> 'deleted';
