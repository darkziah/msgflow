CREATE TABLE `canned_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`external_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` text,
	`webhook_verify_token` text,
	`imap_smtp_config` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channels_workspace_external` ON `channels` (`workspace_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `contact_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`external_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contact_identities_channel_external` ON `contact_identities` (`channel_id`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `inbox_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_channels` ON `inbox_channels` (`inbox_id`,`channel_id`);--> statement-breakpoint
CREATE TABLE `inbox_members` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inbox_members_unique` ON `inbox_members` (`inbox_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `messages_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`seq` integer NOT NULL,
	`direction` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text NOT NULL,
	`preview` text NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_summary_conv` ON `messages_summary` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `rule_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`action_type` text NOT NULL,
	`action_value` text NOT NULL,
	`execution_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rule_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`field` text NOT NULL,
	`operator` text NOT NULL,
	`value` text NOT NULL,
	`match_group` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rule_execution_log` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`executed_at` text NOT NULL,
	`result` text NOT NULL,
	`detail` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text,
	`name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_team_members_unique` ON `team_members` (`team_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_members_unique` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
DROP INDEX `idx_contacts_channel_external`;--> statement-breakpoint
ALTER TABLE `contacts` ADD `workspace_id` text NOT NULL REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `contacts` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `primary_email` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `created_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `updated_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `channel`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `external_id`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `name`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `canonical_contact_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`do_binding_id` text NOT NULL,
	`subject` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`last_message_at` text,
	`last_message_preview` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`snoozed_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "contact_id", "inbox_id", "assignee_id", "status", "snoozed_until", "last_message_preview", "message_count", "created_at") SELECT "id", "contact_id", "inbox_id", "assignee_id", "status", "snoozed_until", "last_message_preview", "message_count", "created_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_conversations_inbox_status` ON `conversations` (`inbox_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_conversations_assignee` ON `conversations` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_contact` ON `conversations` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_conversations_last_activity` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `__new_conversation_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_conversation_tags`("id", "conversation_id", "tag_id", "created_by", "created_at") SELECT "id", "conversation_id", "tag_id", "created_by", "created_at" FROM `conversation_tags`;--> statement-breakpoint
DROP TABLE `conversation_tags`;--> statement-breakpoint
ALTER TABLE `__new_conversation_tags` RENAME TO `conversation_tags`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversation_tags` ON `conversation_tags` (`conversation_id`,`tag_id`);--> statement-breakpoint
ALTER TABLE `inboxes` ADD `workspace_id` text NOT NULL REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `inboxes` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
ALTER TABLE `inboxes` DROP COLUMN `channel`;--> statement-breakpoint
ALTER TABLE `tags` ADD `workspace_id` text NOT NULL REFERENCES workspaces(id);--> statement-breakpoint
ALTER TABLE `tags` ADD `parent_tag_id` text REFERENCES tags(id);--> statement-breakpoint
ALTER TABLE `tags` ADD `visibility` text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` ADD `owner_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `tags` ADD `created_at` text NOT NULL;--> statement-breakpoint
ALTER TABLE `tags` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `tags` DROP COLUMN `owner_id`;