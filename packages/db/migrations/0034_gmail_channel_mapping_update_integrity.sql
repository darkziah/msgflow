CREATE TRIGGER `gmail_accounts_channel_gmail_insert`
BEFORE INSERT ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
)
BEGIN
	SELECT RAISE(ABORT, 'gmail account channel must be a gmail channel');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_accounts_channel_gmail_update`
BEFORE UPDATE ON `gmail_accounts`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
)
BEGIN
	SELECT RAISE(ABORT, 'gmail account channel must be a gmail channel');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_message_refs_channel_gmail_insert`
BEFORE INSERT ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref channel must be a gmail channel');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_message_refs_channel_gmail_update`
BEFORE UPDATE ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `channels`
	WHERE `id` = NEW.`channel_id`
		AND `type` = 'gmail'
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref channel must be a gmail channel');
END;
--> statement-breakpoint
CREATE TRIGGER `conversations_gmail_message_refs_mapping_update`
BEFORE UPDATE OF `channel_id`, `external_thread_id` ON `conversations`
WHEN EXISTS (
	SELECT 1
	FROM `gmail_message_refs`
	WHERE `conversation_id` = OLD.`id`
		AND NOT (
			`channel_id` IS NEW.`channel_id`
			AND `gmail_thread_id` IS NEW.`external_thread_id`
		)
)
BEGIN
	SELECT RAISE(ABORT, 'conversation update would orphan gmail message refs');
END;
--> statement-breakpoint
CREATE TRIGGER `channels_gmail_mapping_type_update`
BEFORE UPDATE OF `type` ON `channels`
WHEN NEW.`type` <> 'gmail'
	AND (
		EXISTS (SELECT 1 FROM `gmail_accounts` WHERE `channel_id` = OLD.`id`)
		OR EXISTS (SELECT 1 FROM `gmail_message_refs` WHERE `channel_id` = OLD.`id`)
	)
BEGIN
	SELECT RAISE(ABORT, 'channels with gmail data must remain gmail channels');
END;
