CREATE TABLE `gmail_sync_requests` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`requested_history_id` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `gmail_accounts`(`channel_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gmail_sync_requests_requested_at` ON `gmail_sync_requests` (`requested_at`);