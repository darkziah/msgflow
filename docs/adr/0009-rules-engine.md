# Rules engine: synchronous pre-append evaluation, first-match routing / all-apply additive

Rules evaluate synchronously in the Worker ingest path — after normalization and conversation-ID resolution but before the DO append — so the DO receives a fully-routed message (final inbox, assignee, tags) in one append and stays free of rules logic.

Evaluation is an ordered rule list: routing actions (set inbox, assign) are first-match-wins in rule order; additive actions (add/remove tag, notify, set priority) all apply. Rules live in D1, read per ingest (cache later); Phase 1 is single-workspace rules.

Assignment strategies (round-robin, least-busy-first) need mutable D1 counters (per-inbox last-assigned cursor, per-agent open-assigned counts), computed in the Worker during rule evaluation.
