# Channel abstraction: canonical envelope, DO-side dedup, Worker-side token selection

Channel adapters (`packages/channel`) normalize provider-specific payloads (Facebook webhook, Cloudflare email `email()` handler) into a canonical channel-agnostic Message envelope defined in `packages/contracts`. The Durable Object only ever sees canonical Messages — it has no knowledge of Facebook or email payload shapes.

Idempotency dedup is the DO's job, keyed on `providerMessageId`: the Worker passes the provider message id through, and the DO checks its own SQLite before appending, because the DO is the single-threaded authority on the timeline and the only place that can dedup atomically. Per-Page token selection happens in the Worker's dispatch layer — the adapter receives a fully-resolved send context and never reads secrets.
