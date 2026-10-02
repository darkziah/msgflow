-- Keep the old workspace fence until credentials have been checked. The
-- preflight trigger deliberately remains after a failed run, so retrying after
-- a manual ownership resolution repeats the safety check before index changes.
CREATE TRIGGER IF NOT EXISTS migration_0022_meta_app_identity_preflight
BEFORE UPDATE ON meta_apps
WHEN EXISTS (
  SELECT 1 FROM meta_apps GROUP BY app_id HAVING count(*) > 1
)
BEGIN
  SELECT RAISE(ABORT, 'migration 0022 blocked: duplicate Meta app_id values exist across workspaces; resolve ownership manually without changing credentials, then retry');
END;
--> statement-breakpoint
UPDATE meta_apps SET app_id = app_id
WHERE rowid = (SELECT rowid FROM meta_apps LIMIT 1);
--> statement-breakpoint
DROP TRIGGER migration_0022_meta_app_identity_preflight;
--> statement-breakpoint
DROP INDEX idx_meta_apps_workspace_app_id;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_meta_apps_app_id ON meta_apps(app_id);
