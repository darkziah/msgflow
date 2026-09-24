CREATE TABLE `comment_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	`conversation_id` text NOT NULL REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	`comment_id` text NOT NULL,
	`author_id` text NOT NULL REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	`comment_text` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_comment_notifications_comment_user` ON `comment_notifications` (`comment_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_comment_notifications_user_unread` ON `comment_notifications` (`user_id`,`read_at`,`created_at`);
