# ADR 0022: Effect Schema Boundary Contracts

Status: Accepted

Date: 2026-09-24

## Context

MsgFlow receives untrusted HTTP JSON, Messenger webhook JSON, MIME-derived email
metadata, Durable Object commands/events, and JSON persisted in D1/DO SQLite.
The existing contracts package contained TypeScript interfaces, while Worker
routes and DO endpoints commonly used `request.json()` plus assertions. Those
assertions provide no runtime validation. Drizzle remains the SQL schema and
migration authority; Better Auth, Hono, Workers, D1, and the existing service
rules remain in place.

The installed Drizzle ORM is 0.45.2. Its package has no
`drizzle-orm/effect-schema` entry point; Drizzle's documented Effect helpers
are a later v1 capability. Upgrading Drizzle solely to introduce validators
would mix a persistence-library migration with this boundary rollout.

## Decision

Use `effect/Schema` from the `effect` package (3.22.2) for versioned runtime
contracts. Do not add deprecated `@effect/schema`. `@msgflow/contracts` owns
runtime-safe request, response, event, and flexible-persistence schemas; it
may be imported by both the Worker and browser. It must not import Drizzle,
Cloudflare bindings, credentials, or Node-only modules.

```
apps/web  ───────────────┐
                         v
                 @msgflow/contracts (effect/Schema)
                         ^
apps/worker HTTP adapter -┘
      | decoded DTOs only
      v
services: authorization + business rules
      v
@msgflow/db (Drizzle schema, migrations, D1 queries)
      v
D1 / ConversationDO storage
```

### Boundary conventions

- Decode unknown data once at ingress; pass the inferred decoded type to the
  service. Type assertions are not boundary validation.
- Keep public request schemas separate from Drizzle insert/select shapes.
  Request schemas exclude IDs, workspace and actor ownership, security flags,
  timestamps, delivery state, and provider credentials.
- `Schema.Struct` strips unknown fields for the initial HTTP slice. This is an
  explicit compatibility policy: legacy routes ignored extra fields. New
  security-sensitive routes may reject unknown fields only with compatibility
  tests and an API decision.
- Normalize only stable user-facing values where existing behavior supports it.
  The inbox create schema trims names and enforces a non-empty 120-character
  name; authorization, workspace/team ownership, channel existence, and
  uniqueness remain service/database responsibilities.
- Decode helpers return tagged results, never use `decodeUnknownSync` in a
  request handler. JSON syntax, body size, and schema failures map to the
  existing `{ success: false, error }` 400 envelope. Parse diagnostics and raw
  payloads are not returned or logged because they can include PII or secrets.
- Persisted JSON and DO envelopes need explicitly versioned schemas before
  migration. On read, decode data that can predate deployments or be corrupted;
  encode when compatibility matters. Preserve raw provider replay data only in
  the existing approved storage path and never include it in validation logs.
- Drizzle continues to own tables, indexes, SQLite constraints, migrations,
  transactions, and relational query shapes. Its Effect helpers can be assessed
  after a separately tested Drizzle upgrade; explicit public DTOs still remain
  required.

## Initial vertical slice

`POST /api/inboxes` and `POST /api/workspaces/:workspaceId/inboxes` share
`InboxCreateRequestSchema`. The Worker bounds/parses/decodes JSON before calling
`createInbox`. The service retains admin authorization, workspace-scoped team
checks, code-level uniqueness handling, and Drizzle/D1 writes unchanged.

## Consequences

- Existing valid inbox-create payloads retain their response shape and status.
- Invalid JSON and oversized bodies now fail predictably with a 400 response;
  invalid fields cannot reach the service.
- The same repeatable adapter is available for subsequent HTTP commands without
  adopting the Effect runtime across the application.
