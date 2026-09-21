CREATE TABLE `processed_messages` (
	`conversation_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`message_id` text NOT NULL,
	`processed_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `provider_message_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`filters_json` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_sidebar_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`collapsed_sections_json` text DEFAULT '[]' NOT NULL,
	`pinned_item_ids_json` text DEFAULT '[]' NOT NULL,
	`hidden_item_ids_json` text DEFAULT '[]' NOT NULL,
	`item_order_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_sidebar_preferences_unique` ON `user_sidebar_preferences` (`user_id`,`workspace_id`);--> statement-breakpoint
ALTER TABLE `inboxes` ADD `description` text;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `color` text DEFAULT '#64748B' NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `is_archived` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `assignment_strategy` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `inboxes` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `rules` ADD `stop_processing` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- One default inbox per channel. inbox_channels.is_default already exists
-- (migration 0003); collapse any legacy duplicate defaults (keep the earliest
-- link per channel) before enforcing the partial unique index. The EXISTS
-- guard is deliberate: `NOT IN (SELECT MIN(...))` would wipe every default on
-- a clean database.
UPDATE `inbox_channels` SET `is_default` = 0
WHERE `is_default` = 1
  AND EXISTS (
    SELECT 1 FROM `inbox_channels` AS `other`
    WHERE `other`.`channel_id` = `inbox_channels`.`channel_id`
      AND `other`.`is_default` = 1
      AND `other`.`id` < `inbox_channels`.`id`
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_inbox_channels_one_default_per_channel`
ON `inbox_channels` (`channel_id`) WHERE `is_default` = 1;