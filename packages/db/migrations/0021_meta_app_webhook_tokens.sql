ALTER TABLE meta_apps ADD COLUMN webhook_verify_token_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_meta_apps_webhook_verify_token_hash
  ON meta_apps(webhook_verify_token_hash)
  WHERE webhook_verify_token_hash IS NOT NULL;
