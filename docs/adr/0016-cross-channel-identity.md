# Cross-channel identity resolution: deferred, forward-compatible

Phase 1 treats each channel identity (Facebook PSID, email address) as its own Contact — no automatic merging, matching Front/Missive's default where a Facebook thread and an email thread are separate. Merging identities is Phase 2.

The contacts model stays forward-compatible: Phase 1 models contacts as identities (channel + external_id); Phase 2 adds a nullable `canonical_contact_id` self-reference (or a separate "person" entity) to link identities without rewriting existing conversations.
