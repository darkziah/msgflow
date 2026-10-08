CREATE TRIGGER `gmail_accounts_channel_workspace_insert`
BEFORE INSERT ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
		AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail account channel must be a gmail channel in the same workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_accounts_channel_workspace_update`
BEFORE UPDATE ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
		AND `workspace_id` = NEW.`workspace_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail account channel must be a gmail channel in the same workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_oauth_sessions_tenant_insert`
BEFORE INSERT ON `gmail_oauth_sessions`
WHEN NOT EXISTS (
	SELECT 1 FROM `inboxes`
	WHERE `id` = NEW.`inbox_id` AND `workspace_id` = NEW.`workspace_id`
)
OR (NEW.`team_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `teams`
	WHERE `id` = NEW.`team_id` AND `workspace_id` = NEW.`workspace_id`
))
OR NOT EXISTS (
	SELECT 1 FROM `workspace_members`
	WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`actor_user_id`
)
OR (NEW.`access_mode` = 'private' AND NEW.`team_id` IS NOT NULL)
OR (NEW.`access_mode` = 'shared' AND NEW.`team_id` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'gmail oauth session references must belong to its workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_oauth_sessions_tenant_update`
BEFORE UPDATE ON `gmail_oauth_sessions`
WHEN NOT EXISTS (
	SELECT 1 FROM `inboxes`
	WHERE `id` = NEW.`inbox_id` AND `workspace_id` = NEW.`workspace_id`
)
OR (NEW.`team_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `teams`
	WHERE `id` = NEW.`team_id` AND `workspace_id` = NEW.`workspace_id`
))
OR NOT EXISTS (
	SELECT 1 FROM `workspace_members`
	WHERE `workspace_id` = NEW.`workspace_id` AND `user_id` = NEW.`actor_user_id`
)
OR (NEW.`access_mode` = 'private' AND NEW.`team_id` IS NOT NULL)
OR (NEW.`access_mode` = 'shared' AND NEW.`team_id` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'gmail oauth session references must belong to its workspace');
END;