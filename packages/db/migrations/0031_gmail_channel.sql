CREATE TABLE `gmail_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`access_mode` text NOT NULL CHECK (`access_mode` IN ('private', 'shared')),
	`team_id` text,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`token_key_version` integer NOT NULL,
	`history_id` text,
	`watch_expiration_at` text,
	`sync_state` text NOT NULL DEFAULT 'idle' CHECK (`sync_state` IN ('idle', 'syncing', 'error', 'reconnect_required')),
	`last_synced_at` text,
	`backfill_days` integer NOT NULL DEFAULT 30 CHECK (`backfill_days` BETWEEN 1 AND 90),
	`scopes_json` text NOT NULL,
	`archive_removes_inbox_label` integer NOT NULL DEFAULT 0,
	`sync_claim_token` text,
	`sync_claimed_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gmail_accounts_channel` ON `gmail_accounts` (`channel_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gmail_accounts_google_sub` ON `gmail_accounts` (`google_sub`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gmail_accounts_workspace_email` ON `gmail_accounts` (`workspace_id`,`email`);
--> statement-breakpoint
CREATE TABLE `gmail_account_delegates` (
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`account_id`, `user_id`),
	FOREIGN KEY (`account_id`) REFERENCES `gmail_accounts`(`id`) ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gmail_message_refs` (
	`channel_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL CHECK (`direction` IN ('inbound', 'outbound')),
	`rfc_message_id` text,
	`in_reply_to` text,
	`references_json` text,
	`label_ids_json` text,
	`raw_object_key` text,
	`processed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gmail_message_refs_message` ON `gmail_message_refs` (`channel_id`,`gmail_message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gmail_message_refs_thread` ON `gmail_message_refs` (`channel_id`,`gmail_thread_id`);
--> statement-breakpoint
CREATE TABLE `gmail_oauth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`access_mode` text NOT NULL CHECK (`access_mode` IN ('private', 'shared')),
	`team_id` text,
	`backfill_days` integer NOT NULL CHECK (`backfill_days` BETWEEN 1 AND 90),
	`encrypted_state` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `external_thread_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_channel_external_thread` ON `conversations` (`channel_id`,`external_thread_id`) WHERE `external_thread_id` IS NOT NULL;
