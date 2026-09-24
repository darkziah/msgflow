ALTER TABLE `outbound_intents` ADD `attachments_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `scheduled_messages` ADD `attachments_json` text DEFAULT '[]' NOT NULL;