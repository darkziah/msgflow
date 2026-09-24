# Effect Schema Rollout Inventory

## Evidence and version decision

- `effect` was not installed before this change. `@msgflow/contracts` now owns
  `effect` 3.22.2 and imports `effect/Schema` through `import { Schema } from
  "effect"`.
- `drizzle-orm` resolves to 0.45.2 (`apps/worker/package.json`,
  `packages/db/package.json`). Its installed package has no
  `drizzle-orm/effect-schema` export. Drizzle's current public documentation
  describes that integration for v1, so this rollout intentionally avoids a
  risky ORM upgrade.
- The repository uses strict TypeScript (`tsconfig.json`), Bun workspaces,
  Hono in `apps/worker/src/index.ts`, Drizzle D1 in `packages/db`, and
  Miniflare-backed service tests in `apps/worker/test`.

## Boundary inventory and migration order

| Priority | Boundary | Existing validation | Proposed contract | Handling and test focus |
| --- | --- | --- | --- | --- |
| P0 | Inbox create HTTP: `index.ts` → `createInbox` | Route passed `await c.req.json()` directly; service checked name/config/RBAC | `InboxCreateRequestSchema` | Implemented. 64 KiB bound, syntax/schema 400s, unknown keys stripped for compatibility; service continues tenant/RBAC/uniqueness checks. |
| P0 | Channel-token connection HTTP: `index.ts` → `connectChannelToken` | Route parsed/cast JSON and manually checked a nonblank string | `ChannelConnectRequestSchema` | Implemented. Bounded decode, token trimming, and unknown-key stripping happen before encryption; service retains workspace/channel/admin checks. |
| P0 | Other management HTTP commands: tags, rules, canned replies, inbox updates/links/reorder, sidebar preferences | Handwritten checks and casts | Explicit request schemas beside the inbox schema | Migrate command-by-command with response/status parity tests before deleting handwritten validators. |
| P0 | Conversation writes: send, comment, read, metadata patch, attachment metadata | Handwritten checks plus multiple asserted request bodies | Distinct public request schemas; retain attachment ownership/R2 checks | Test malformed JSON, field constraints, conversation/workspace authorization, idempotency and provider-state behavior. |
| P1 | Messenger ingress: `packages/channel/src/facebook.ts` | Structural type guard then nested optional access | Extension-tolerant provider envelope schema | Validate required entry/messaging/message fields, preserve signature-first raw body and replay behavior; do not change Facebook transport. |
| P1 | Email ingress / MIME-derived metadata: `index.ts:parseEmailMessage`, `packages/channel/src/email.ts` | `PostalMime` result trusted and cast | Narrow parsed-mail schema | Validate data required by routing after MIME parsing; retain current raw/replay handling. This is validation only, not an email transport change. |
| P1 | Durable Object commands/events: `conversation-do.ts` | `request.json()` assertions; persisted JSON.parse casts | Versioned command/event envelopes and Message/Comment/Activity schemas | Decode Worker-to-DO commands and persisted payload/attachments/details on read; provide compatibility defaults or migrations for existing DO rows. |
| P1 | D1 flexible JSON: sidebar preferences, saved filters, scheduled/outbound attachments | `JSON.parse` plus manual filtering/fallbacks | Versioned persistence schemas | Decode on read, retain safe defaults for legacy/corrupt UI state, reject/quarantine security-sensitive invalid rows without logging contents. |
| P2 | Provider responses and callbacks: Graph profile/send response | Assertions/casts | Narrow response schemas | Treat response extensions as allowed; validate only data used for state transitions. |
| P2 | Public response encoding | Interfaces/casts | Selective response schemas | Add only where wire compatibility is material; avoid unexpected transforms for existing clients. |

## Rollout rules

1. Add contracts in `@msgflow/contracts`; keep only Worker HTTP stream/parsing
   adapters in `apps/worker/src/validation.ts`.
2. Decode once at the boundary. Keep authorization and business checks in the
   existing services and SQL constraints in Drizzle/D1.
3. Preserve the API error envelope and auth/403/404 distinctions. Add parity
   tests before replacing an existing validator.
4. Version DO and persisted JSON schemas before changing a shape that survives
   deployment. Never make a decoder assume all stored data was written by the
   current deployment.
5. Do not use generated Drizzle insert schemas for public payloads. Re-evaluate
   Drizzle Effect helpers only during a dedicated ORM upgrade.
