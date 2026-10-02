# Single ingress Worker exports the Conversation Durable Object

The ingress Worker (Hono) and the Conversation Durable Object are deployed as one Worker: the Worker serves the Meta webhook, Cloudflare Email Service's `email()` handler (see ADR 0014), and the authenticated app API, and also exports the `ConversationDO` class, reached via `env.CONVERSATION_DO.idFromName(conversationId)`.

We chose one Worker over separate ingress + conversation Workers because it matches Cloudflare's own chat/DO examples, collapses the webhook→DO hop into an in-process `stub.fetch()`, and a single Meta app plus a handful of Pages gets no benefit from independent deploys.

Consequences: an ingress deploy also redeploys the DO class, so DO storage schema/version changes are managed deliberately (they already are, independent of D1). Agent WebSocket connections connect to the Worker's route; the Worker forwards the upgrade to the DO via `stub.fetch()`.
