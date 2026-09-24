ALTER TABLE `scheduled_messages` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `scheduled_messages` ADD `claimed_at` text;--> statement-breakpoint
CREATE TABLE `outbound_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`text` text NOT NULL,
	`subject` text,
	`sender_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`provider_message_id` text,
	`scheduled_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`provider_sent_at` text,
	`delivered_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_outbound_intents_scheduled_message` ON `outbound_intents` (`scheduled_message_id`);--> statement-breakpoint
CREATE INDEX `idx_outbound_intents_status` ON `outbound_intents` (`status`,`updated_at`);