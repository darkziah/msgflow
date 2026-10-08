CREATE TRIGGER `gmail_accounts_workspace_integrity_insert`
BEFORE INSERT ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1 FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
		AND `workspace_id` = NEW.`workspace_id`
)
OR NOT EXISTS (
	SELECT 1 FROM `workspace_members`
	WHERE `workspace_id` = NEW.`workspace_id`
		AND `user_id` = NEW.`owner_user_id`
)
OR (NEW.`team_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `teams`
	WHERE `id` = NEW.`team_id`
		AND `workspace_id` = NEW.`workspace_id`
))
OR (NEW.`access_mode` = 'private' AND NEW.`team_id` IS NOT NULL)
OR (NEW.`access_mode` = 'shared' AND NEW.`team_id` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'gmail account references must belong to its workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_accounts_workspace_integrity_update`
BEFORE UPDATE ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1 FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
		AND `workspace_id` = NEW.`workspace_id`
)
OR NOT EXISTS (
	SELECT 1 FROM `workspace_members`
	WHERE `workspace_id` = NEW.`workspace_id`
		AND `user_id` = NEW.`owner_user_id`
)
OR (NEW.`team_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `teams`
	WHERE `id` = NEW.`team_id`
		AND `workspace_id` = NEW.`workspace_id`
))
OR (NEW.`access_mode` = 'private' AND NEW.`team_id` IS NOT NULL)
OR (NEW.`access_mode` = 'shared' AND NEW.`team_id` IS NULL)
BEGIN
	SELECT RAISE(ABORT, 'gmail account references must belong to its workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_account_delegates_workspace_insert`
BEFORE INSERT ON `gmail_account_delegates`
WHEN NOT EXISTS (
	SELECT 1
	FROM `gmail_accounts` AS `account`
	JOIN `workspace_members` AS `member`
		ON `member`.`workspace_id` = `account`.`workspace_id`
		AND `member`.`user_id` = NEW.`user_id`
	WHERE `account`.`id` = NEW.`account_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail delegate must belong to the account workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_account_delegates_workspace_update`
BEFORE UPDATE ON `gmail_account_delegates`
WHEN NOT EXISTS (
	SELECT 1
	FROM `gmail_accounts` AS `account`
	JOIN `workspace_members` AS `member`
		ON `member`.`workspace_id` = `account`.`workspace_id`
		AND `member`.`user_id` = NEW.`user_id`
	WHERE `account`.`id` = NEW.`account_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail delegate must belong to the account workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_message_refs_workspace_insert`
BEFORE INSERT ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `conversations` AS `conversation`
	JOIN `channels` AS `channel` ON `channel`.`id` = NEW.`channel_id`
	WHERE `conversation`.`id` = NEW.`conversation_id`
		AND `conversation`.`workspace_id` = `channel`.`workspace_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref conversation must belong to the channel workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_message_refs_workspace_update`
BEFORE UPDATE ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `conversations` AS `conversation`
	JOIN `channels` AS `channel` ON `channel`.`id` = NEW.`channel_id`
	WHERE `conversation`.`id` = NEW.`conversation_id`
		AND `conversation`.`workspace_id` = `channel`.`workspace_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref conversation must belong to the channel workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `conversations_gmail_refs_workspace_update`
BEFORE UPDATE OF `workspace_id` ON `conversations`
WHEN EXISTS (
	SELECT 1
	FROM `gmail_message_refs` AS `ref`
	JOIN `channels` AS `channel` ON `channel`.`id` = `ref`.`channel_id`
	WHERE `ref`.`conversation_id` = OLD.`id`
		AND `channel`.`workspace_id` <> NEW.`workspace_id`
)
BEGIN
	SELECT RAISE(ABORT, 'conversation update would orphan gmail workspace mapping');
END;
--> statement-breakpoint
CREATE TRIGGER `channels_gmail_workspace_update`
BEFORE UPDATE OF `workspace_id` ON `channels`
WHEN EXISTS (SELECT 1 FROM `gmail_accounts` WHERE `channel_id` = OLD.`id`)
OR EXISTS (SELECT 1 FROM `gmail_message_refs` WHERE `channel_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'channels with gmail data cannot change workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `inboxes_gmail_oauth_workspace_update`
BEFORE UPDATE OF `workspace_id` ON `inboxes`
WHEN EXISTS (SELECT 1 FROM `gmail_oauth_sessions` WHERE `inbox_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'inboxes referenced by gmail oauth sessions cannot change workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `teams_gmail_workspace_update`
BEFORE UPDATE OF `workspace_id` ON `teams`
WHEN EXISTS (SELECT 1 FROM `gmail_accounts` WHERE `team_id` = OLD.`id`)
OR EXISTS (SELECT 1 FROM `gmail_oauth_sessions` WHERE `team_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'teams referenced by gmail data cannot change workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `workspace_members_gmail_references_delete`
BEFORE DELETE ON `workspace_members`
WHEN EXISTS (
	SELECT 1 FROM `gmail_accounts`
	WHERE `workspace_id` = OLD.`workspace_id`
		AND `owner_user_id` = OLD.`user_id`
)
OR EXISTS (
	SELECT 1 FROM `gmail_oauth_sessions`
	WHERE `workspace_id` = OLD.`workspace_id`
		AND `actor_user_id` = OLD.`user_id`
)
OR EXISTS (
	SELECT 1
	FROM `gmail_account_delegates` AS `delegate`
	JOIN `gmail_accounts` AS `account` ON `account`.`id` = `delegate`.`account_id`
	WHERE `account`.`workspace_id` = OLD.`workspace_id`
		AND `delegate`.`user_id` = OLD.`user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'workspace membership is referenced by gmail data');
END;