# Search scope: D1-native facets now, full-text body search deferred

Phase 1 search covers D1-native facets — sender, subject (email-only), tags, assignee, inbox, channel, date range, status, and the last-message-preview in the D1 summary — plus saved "views" (stored filter presets in D1).

Full-text body, attachment, and @mention search are deferred to Phase 2: they require the DO to upsert a searchable projection into D1 (FTS5-indexed) alongside the summary, since message bodies are authoritative in the DO and cross-DO queries are forbidden.
