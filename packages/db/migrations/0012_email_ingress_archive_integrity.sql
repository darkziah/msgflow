-- Private R2 is authoritative for raw MIME. These D1 fields record the exact
-- archive identity and bounded source size for replay/quarantine operations.
ALTER TABLE `email_ingress` ADD `raw_sha256` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `email_ingress` ADD `raw_bytes` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `idx_email_ingress_mailbox_state_received`
ON `email_ingress` (`mailbox_id`, `state`, `received_at`);
