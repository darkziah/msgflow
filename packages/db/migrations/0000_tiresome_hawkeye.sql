CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`canonical_contact_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contacts_channel_external` ON `contacts` (`channel`,`external_id`);--> statement-breakpoint
CREATE TABLE `conversation_reads` (
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_reads` ON `conversation_reads` (`conversation_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `conversation_tags` (
	`conversation_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_tags` ON `conversation_tags` (`conversation_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`contact_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`assignee_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`snoozed_until` text,
	`last_message_preview` text,
	`last_activity_at` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_inbox_status` ON `conversations` (`inbox_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_conversations_assignee` ON `conversations` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_last_activity` ON `conversations` (`last_activity_at`);--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`channel` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`name` text,
	`access_token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_page_id_unique` ON `pages` (`page_id`);--> statement-breakpoint
CREATE TABLE `scheduled_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`text` text NOT NULL,
	`send_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`type` text NOT NULL,
	`owner_id` text
);
