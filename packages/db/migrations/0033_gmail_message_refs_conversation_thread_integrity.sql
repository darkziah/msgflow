CREATE TRIGGER `gmail_message_refs_conversation_thread_insert`
BEFORE INSERT ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `conversations`
	WHERE `id` = NEW.`conversation_id`
		AND `channel_id` = NEW.`channel_id`
		AND `external_thread_id` = NEW.`gmail_thread_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref conversation must match channel and thread');
END;
--> statement-breakpoint
CREATE TRIGGER `gmail_message_refs_conversation_thread_update`
BEFORE UPDATE OF `channel_id`, `gmail_thread_id`, `conversation_id` ON `gmail_message_refs`
WHEN NOT EXISTS (
	SELECT 1
	FROM `conversations`
	WHERE `id` = NEW.`conversation_id`
		AND `channel_id` = NEW.`channel_id`
		AND `external_thread_id` = NEW.`gmail_thread_id`
)
BEGIN
	SELECT RAISE(ABORT, 'gmail message ref conversation must match channel and thread');
END;
