-- WhatsApp webhook deliveries identify their destination only by Meta Phone Number ID.
-- Add an installation-global fence for every non-deleted phone channel; deleted
-- historical rows may share the ID. SQLite creates no schema object if duplicate
-- existing identities make this statement fail, so retrying after resolution is safe.
CREATE UNIQUE INDEX idx_channels_whatsapp_phone_identity
ON channels(external_id)
WHERE type = 'whatsapp_phone' AND status <> 'deleted';
