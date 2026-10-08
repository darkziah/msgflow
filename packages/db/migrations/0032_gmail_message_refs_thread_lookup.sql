DROP INDEX `idx_gmail_message_refs_thread`;
--> statement-breakpoint
CREATE INDEX `idx_gmail_message_refs_thread` ON `gmail_message_refs` (`channel_id`,`gmail_thread_id`);
