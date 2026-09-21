# DO/D1 dual-authority boundary

Conversation state is split by authority. The Durable Object is authoritative for timeline state (Messages and Comments) and upserts a summary row to D1 immediately per message. D1 is authoritative for metadata state (status, assignee, snoozed_until, inbox, tags) — it is relational, queryable, and mutated by the rules engine.

Mutations flow in both directions: messages flow DO→D1 (summary sync); metadata flows D1→DO (the Worker writes D1, then asks the DO to broadcast a `conversation-updated` event to connected agents). The DO never persists metadata — it is the fanout relay for it.

Consequence: snooze revival is a Cron Trigger (scheduled Worker) that scans D1 for due `snoozed_until` rows and clears them, not a per-conversation DO alarm. DO alarms stay reserved for DO-local state (summary-sync batching, presence cleanup).
