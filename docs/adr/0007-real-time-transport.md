# Real-time transport: DO WebSocket for open threads, D1 polling for the list

Real-time delivery is scoped to the open conversation: the Durable Object fans out Messages, Comments, typing, and presence to connected agents over WebSocket, using the WebSocket Hibernation API so idle DOs stop billing. Presence/connection state is persisted — each WebSocket's agent id travels via `serializeAttachment()` so it survives hibernation, and typing/presence state is written to the DO's SQLite on change and rehydrated on wake.

The inbox list is not pushed: it polls D1 (React Query `refetchInterval` ~3–5s) plus optimistic updates when the agent acts. Cross-conversation push via a per-agent/per-inbox presence DO is deferred to Phase 2 — a 3–5s-stale list is imperceptible and matches Gmail's polled list, avoiding the complexity and cost of every conversation DO fanning out to an inbox DO.

Connection model: browser → Worker `/ws?conversationId=…` (session cookie) → `getSession` → `stub.fetch()` forward → DO handles the upgrade, tagging each connection with the agent id.
