CREATE TABLE `ring_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`strategy` text NOT NULL CHECK (`strategy` IN ('simultaneous', 'round_robin')),
	`next_member_cursor` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_ring_groups_workspace_team` ON `ring_groups` (`workspace_id`,`team_id`);
--> statement-breakpoint
CREATE TABLE `ring_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`ring_group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ring_group_id`) REFERENCES `ring_groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ring_group_members_group_user` ON `ring_group_members` (`ring_group_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `call_queues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`is_enabled` integer NOT NULL DEFAULT 0,
	`provisioning_lease_token` text,
	`no_agent_reply_text` text NOT NULL,
	`timezone_id` text NOT NULL,
	`weekly_operating_hours_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_call_queues_workspace_team` ON `call_queues` (`workspace_id`,`team_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_queues_enabled_channel` ON `call_queues` (`channel_id`) WHERE `is_enabled` = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_queues_provisioning_channel` ON `call_queues` (`channel_id`) WHERE `provisioning_lease_token` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `call_queue_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_id` text NOT NULL,
	`ring_group_id` text NOT NULL,
	`stage_order` integer NOT NULL,
	`ring_duration_seconds` integer NOT NULL CHECK (`ring_duration_seconds` BETWEEN 1 AND 50),
	`created_at` text NOT NULL,
	FOREIGN KEY (`queue_id`) REFERENCES `call_queues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ring_group_id`) REFERENCES `ring_groups`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_queue_stages_queue_order` ON `call_queue_stages` (`queue_id`,`stage_order`);
--> statement-breakpoint
CREATE TABLE `agent_call_presence` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'offline' CHECK (`status` IN ('available', 'away', 'offline')),
	`socket_connected_at` text,
	`heartbeat_expires_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `call_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`conversation_id` text,
	`queue_id` text,
	`provider_call_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`direction` text NOT NULL CHECK (`direction` IN ('consumer_to_business')),
	`state` text NOT NULL CHECK (`state` IN ('ringing', 'accepted', 'rejected', 'timed_out', 'terminated', 'failed')),
	`accepted_by_user_id` text,
	`terminal_reason` text,
	`quality_summary_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`queue_id`) REFERENCES `call_queues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_call_presence_eligible` ON `agent_call_presence` (`workspace_id`,`status`,`heartbeat_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_events_provider_event` ON `call_events` (`channel_id`,`provider_event_id`);
--> statement-breakpoint
CREATE TRIGGER `ring_groups_team_workspace_insert`
BEFORE INSERT ON `ring_groups`
FOR EACH ROW WHEN (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT RAISE(ABORT, 'ring group team must belong to its workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `ring_groups_team_workspace_update`
BEFORE UPDATE OF workspace_id, team_id ON `ring_groups`
FOR EACH ROW WHEN (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT RAISE(ABORT, 'ring group team must belong to its workspace');
END;
--> statement-breakpoint
CREATE TRIGGER `ring_group_members_team_insert`
BEFORE INSERT ON `ring_group_members`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM ring_groups AS rg
	INNER JOIN team_members AS tm ON tm.team_id = rg.team_id AND tm.user_id = NEW.user_id
	WHERE rg.id = NEW.ring_group_id
)
BEGIN
	SELECT RAISE(ABORT, 'ring group member must be an active member of the group team');
END;
--> statement-breakpoint
CREATE TRIGGER `ring_group_members_team_update`
BEFORE UPDATE OF ring_group_id, user_id ON `ring_group_members`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM ring_groups AS rg
	INNER JOIN team_members AS tm ON tm.team_id = rg.team_id AND tm.user_id = NEW.user_id
	WHERE rg.id = NEW.ring_group_id
)
BEGIN
	SELECT RAISE(ABORT, 'ring group member must be an active member of the group team');
END;
--> statement-breakpoint
CREATE TRIGGER `call_queues_scope_insert`
BEFORE INSERT ON `call_queues`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active')
		THEN RAISE(ABORT, 'call queue channel must be an active Facebook Page in its workspace')
		ELSE RAISE(ABORT, 'call queue team must belong to its workspace') END;
END;
--> statement-breakpoint
CREATE TRIGGER `call_queues_scope_update`
BEFORE UPDATE OF workspace_id, channel_id, team_id ON `call_queues`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active')
		THEN RAISE(ABORT, 'call queue channel must be an active Facebook Page in its workspace')
		ELSE RAISE(ABORT, 'call queue team must belong to its workspace') END;
END;
--> statement-breakpoint
CREATE TRIGGER `call_queue_stages_scope_insert`
BEFORE INSERT ON `call_queue_stages`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM call_queues AS cq
	INNER JOIN ring_groups AS rg ON rg.id = NEW.ring_group_id AND rg.workspace_id = cq.workspace_id AND rg.team_id = cq.team_id
	WHERE cq.id = NEW.queue_id
)
BEGIN
	SELECT RAISE(ABORT, 'call queue stage ring group must belong to the queue workspace and team');
END;
--> statement-breakpoint
CREATE TRIGGER `call_queue_stages_scope_update`
BEFORE UPDATE OF queue_id, ring_group_id ON `call_queue_stages`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM call_queues AS cq
	INNER JOIN ring_groups AS rg ON rg.id = NEW.ring_group_id AND rg.workspace_id = cq.workspace_id AND rg.team_id = cq.team_id
	WHERE cq.id = NEW.queue_id
)
BEGIN
	SELECT RAISE(ABORT, 'call queue stage ring group must belong to the queue workspace and team');
END;
--> statement-breakpoint
CREATE TRIGGER `call_queue_stages_total_insert`
BEFORE INSERT ON `call_queue_stages`
FOR EACH ROW WHEN COALESCE((SELECT SUM(ring_duration_seconds) FROM call_queue_stages WHERE queue_id = NEW.queue_id), 0) + NEW.ring_duration_seconds > 50
BEGIN
	SELECT RAISE(ABORT, 'call queue stages may not exceed 50 seconds');
END;
--> statement-breakpoint
CREATE TRIGGER `call_queue_stages_total_update`
BEFORE UPDATE OF queue_id, ring_duration_seconds ON `call_queue_stages`
FOR EACH ROW WHEN COALESCE((SELECT SUM(ring_duration_seconds) FROM call_queue_stages WHERE queue_id = NEW.queue_id AND id <> OLD.id), 0) + NEW.ring_duration_seconds > 50
BEGIN
	SELECT RAISE(ABORT, 'call queue stages may not exceed 50 seconds');
END;
--> statement-breakpoint
CREATE TRIGGER `call_events_scope_insert`
BEFORE INSERT ON `call_events`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
)) OR (NEW.queue_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM call_queues WHERE id = NEW.queue_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
))
BEGIN
	SELECT CASE
		WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active') THEN RAISE(ABORT, 'call event channel must be an active Facebook Page in its workspace')
		WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id) THEN RAISE(ABORT, 'call event conversation must belong to its workspace and channel')
		ELSE RAISE(ABORT, 'call event queue must belong to its workspace and channel') END;
END;
--> statement-breakpoint
CREATE TRIGGER `call_events_scope_update`
BEFORE UPDATE OF workspace_id, channel_id, conversation_id, queue_id ON `call_events`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
)) OR (NEW.queue_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM call_queues WHERE id = NEW.queue_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
))
BEGIN
	SELECT CASE
		WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active') THEN RAISE(ABORT, 'call event channel must be an active Facebook Page in its workspace')
		WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id) THEN RAISE(ABORT, 'call event conversation must belong to its workspace and channel')
		ELSE RAISE(ABORT, 'call event queue must belong to its workspace and channel') END;
END;
