CREATE TABLE `email_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`canonical_domain` text NOT NULL UNIQUE,
	`inbound_state` text NOT NULL DEFAULT 'pending' CHECK (`inbound_state` IN ('pending','ready','suspended')),
	`outbound_state` text NOT NULL DEFAULT 'pending' CHECK (`outbound_state` IN ('pending','ready','suspended')),
	`dns_status_json` text NOT NULL DEFAULT '{}',
	`operator_confirmed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_email_domains_workspace` ON `email_domains` (`workspace_id`);
--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`email_domain_id` text NOT NULL REFERENCES `email_domains`(`id`) ON DELETE RESTRICT,
	`local_part` text NOT NULL,
	`canonical_address` text NOT NULL UNIQUE,
	`type` text NOT NULL CHECK (`type` IN ('private','shared')),
	`owner_user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`inbox_id` text REFERENCES `inboxes`(`id`) ON DELETE RESTRICT,
	`team_id` text REFERENCES `teams`(`id`) ON DELETE RESTRICT,
	`is_enabled` integer NOT NULL DEFAULT 0,
	`is_send_enabled` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CHECK ((`type` = 'private' AND `owner_user_id` IS NOT NULL AND `inbox_id` IS NULL AND `team_id` IS NULL) OR (`type` = 'shared' AND `owner_user_id` IS NULL AND `inbox_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mailboxes_domain_local_part` ON `mailboxes` (`email_domain_id`,`local_part`);
--> statement-breakpoint
CREATE INDEX `idx_mailboxes_workspace_owner` ON `mailboxes` (`workspace_id`,`owner_user_id`);
--> statement-breakpoint
CREATE TABLE `mailbox_delegates` (
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`created_by` text NOT NULL REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`created_at` text NOT NULL,
	PRIMARY KEY (`mailbox_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `email_ingress` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE RESTRICT,
	`dedupe_key` text NOT NULL,
	`raw_object_key` text NOT NULL,
	`state` text NOT NULL DEFAULT 'stored' CHECK (`state` IN ('stored','processing','quarantined','processed','failed')),
	`error` text,
	`received_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_ingress_mailbox_dedupe` ON `email_ingress` (`mailbox_id`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `idx_email_ingress_state` ON `email_ingress` (`state`,`received_at`);
