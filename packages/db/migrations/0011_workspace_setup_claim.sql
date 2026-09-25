-- A singleton claim serializes explicit first-use setup. It is deliberately
-- retained after completion so no later request can become an owner implicitly.
CREATE TABLE `workspace_setup_claim` (
	`id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
	`email` text NOT NULL,
	`user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`claimed_at` text NOT NULL,
	`completed_at` text
);
