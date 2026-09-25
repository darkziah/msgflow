# MsgFlow Multi-Domain Email Implementation Plan

> For Hermes: execute sequentially; do not deploy or change Cloudflare/DNS.

Goal: replace the generic lazily-provisioned email channel path with workspace-owned multi-domain logical mailboxes, private/shared authorization, durable ingress/outbox, reply identities, and owner-led setup flows.

Architecture: Keep `channels`, inboxes, rules, conversations, D1/DO split, and the existing sidebar. Add workspace-scoped email-domain/mailbox metadata and private email persistence in D1/R2. Resolve recipient ownership before MIME parsing; D1/R2 own ingress/outbox state and the conversation DO receives only routed canonical messages. ADR 0021 is authoritative for the business decisions.

## Phase 0 — Baseline and drift repair

Files:
- Modify `README.md`, `apps/worker/README.md`, `docs/adr/0006-auth-drizzle-d1.md`, `docs/adr/0020-r2-image-attachments.md`
- Modify or remove only the stale `createEmailChannel` assertion in `apps/worker/test/routing.test.ts` after replacing it with tested mailbox onboarding

1. Record current build/lint/test/dry-run status and document that Cloudflare dashboard/DNS setup is operator-only.
2. Correct ADR 0006 auth wording and README ADR index after the username implementation lands.
3. Replace the broken generic-email onboarding test with the actual domain/mailbox API coverage.

Acceptance: lint/build/dry-run pass; test suite loads.

## Phase 1 — Auth, domain/mailbox schema, authorization, setup APIs

Files:
- Modify `packages/db/src/auth-schema.ts`, `packages/db/better-auth.config.ts`, `packages/auth/src/index.ts`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/routes/login.tsx`
- Modify `packages/db/src/schema.ts`, add migration `packages/db/migrations/0008_*.sql` and journal metadata
- Create `apps/worker/src/email-address.ts`, `apps/worker/src/mailboxes.ts`, `apps/worker/src/setup.ts`
- Modify `apps/worker/src/access.ts`, `apps/worker/src/env.ts`, `apps/worker/src/index.ts`, `packages/contracts/src/types/index.ts`
- Add focused Miniflare tests under `apps/worker/test/`

1. Add Better Auth username plugin with immutable lowercase ASCII username validation. Retain verified email/password login as an alternate login and recovery contact. Disable public unassigned signup; implement owner invitation/onboarding API shape.
2. Add tables/indexes for `email_domains`, `mailboxes`, explicit private delegates, shared team grants, mailbox audit events, durable inbound records, stored RFC metadata/thread bridges, outbound attempts/status events, and onboarding state. Constrain canonical domain globally and address globally; private owner/local-part invariants must be checked in services plus SQLite constraints where expressible.
3. Add normalized email/domain/local-part utilities. Reject Unicode local-parts, plus tags, reserved names, invalid dots, and collisions. Private mailbox local-part equals username; shared business addresses only through owner-controlled flow.
4. Add owner-only first-use setup and separate owner-only domain/mailbox onboarding APIs. They only create pending records and Cloudflare instructions; never call Cloudflare APIs or alter DNS.
5. Implement mailbox-level authorization. Private read/send access is owner/delegate only; shared access derives from active linked-team membership. Admins have configuration access but no private content access. Enforce mailbox/conversation authorization on list/detail/timeline/read/send/WebSocket.
6. Re-authorize scheduled sends at dispatch.

Acceptance: authorization matrix tests cover owner/delegate/admin/team revocation/deactivated agent; migration chain applies on fresh scratch D1; no generic inbound channel is lazily created.

## Phase 2 — Durable ingress and private storage

Files:
- Modify `apps/worker/src/index.ts`, `apps/worker/src/ingest.ts`, `packages/channel/src/email.ts`, `apps/worker/src/conversation-do.ts`
- Create `apps/worker/src/email-ingress.ts`, `apps/worker/src/email-storage.ts`, `apps/worker/src/email-retention.ts`
- Modify `apps/worker/wrangler.toml`, `apps/worker/src/env.ts`, contracts and tests

1. Add a separate private R2 binding for raw MIME and email attachments; keep public R2 strictly for Messenger images.
2. Resolve canonical envelope recipient to enabled domain/mailbox before MIME parsing. Unknown/disabled/suspended/invalid recipients call `setReject` and create privacy-minimal audit metrics only.
3. Archive raw MIME and create an idempotent inbound D1 record before accepting. Process/replay from durable state; model parse failures as authorized mailbox quarantine, not a Conversation.
4. Parse text and selected PDF/images only; enforce 5 MiB total inbound policy. Keep raw HTML only in raw MIME and show derived text. Provide authorized attachment download route with attachment disposition.
5. Preserve mailbox-scoped RFC Message-ID/In-Reply-To/References metadata. Use current receiving mailbox identity and explicit Thread Bridge lookup; never merge by subject/contact.
6. Add retention job for 90-day raw MIME and 365-day email attachment expiry, with auditable results.

Acceptance: Miniflare tests simulate duplicate delivery, raw-write/DB/DO partial failure, malformed MIME quarantine, unknown/disabled rejection, cross-tenant isolation, attachment policy, replay and retention.

## Phase 3 — Outbound identities, events, and UI

Files:
- Modify `apps/worker/src/outbound.ts`, `apps/worker/src/scheduled.ts`, `packages/channel/src/email.ts`, contracts, schema, routes
- Modify `apps/web/src/components/inbox/Composer.tsx`, `ConversationThread.tsx`, `apps/web/src/lib/api.ts`; create mailbox/domain setup components within the existing Settings/sidebar patterns
- Add queue consumer/event handler and tests

1. Change email sends to Cloudflare structured `EMAIL.send` API. Persist returned provider ID; use approved threading headers plus `X-MsgFlow-*` correlation.
2. Require a server-authorized Reply Identity, defaulted to receiving mailbox. Confirm a private identity override in a shared conversation; record selected From, bridge, audit event, and immutable send intent before dispatch.
3. Model send states `draft|queued|sending|accepted|failed|uncertain` separately from delivery lifecycle. Ingest documented Email Sending Queue events per domain for delivered/deferred/bounced/failed/rejected/complained.
4. Add assigned-mailbox list, From selector, mailbox/channel indicators, pending/failed/uncertain UI, owner domain/mailbox onboarding settings, and operator checklist. Do not add compose/reply-all/forward/Cc/Bcc.

Acceptance: end-to-end service tests prove From authorization, bridge threading, team shared mailbox behavior, accepted-versus-delivered, scheduled reauthorization, and all UI state contracts.

## Phase 4 — Operator runbook and pilot validation

Files:
- Create `docs/runbooks/email-domain-pilot.md`, update README and ADRs

1. Document the exact `inbox-test.yeheyremit.jp` dashboard-only procedure: Email Routing subdomain + catch-all route to Worker, Email Sending subdomain onboarding, DNS preview/records, queue subscription, and validation without apex changes.
2. Require operator confirmation before every external action. Record expected DNS checks and actual headers/SPF/DKIM/DMARC verification procedure.
3. Run pilot acceptance with two private users and shared support after explicit approval. Add a second test subdomain only after the first passes.

Acceptance: no external configuration occurs from the app or this implementation session. Runbook contains rollback/incident/suspension/replay procedure.

Validation commands:
- `bun run lint`
- `bun run build`
- `bun run test`
- `cd apps/worker && bunx wrangler deploy --dry-run`
- fresh SQLite migration-chain application through the Miniflare test harness
