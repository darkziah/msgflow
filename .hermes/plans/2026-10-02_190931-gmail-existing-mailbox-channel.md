# Gmail Existing-Mailbox Channel Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a Google Gmail API channel so a Workspace can connect an existing shared Gmail/Google Workspace mailbox, ingest its inbound messages into MsgFlow, and send replies from that mailbox through Gmail.

**Architecture:** Add a distinct `gmail` transport beside `facebook_page`, `whatsapp_phone`, and Cloudflare `email`; do not alter the logical Cloudflare Mailbox channel or Cloudflare Email Routing path. Each Gmail connection is a Workspace-owned shared channel bound to one existing Inbox, stores its Google OAuth refresh credential encrypted with the existing AES-GCM channel-token mechanism, and projects Gmail API messages through the existing canonical inbound → D1 → Conversation DO path. Gmail Pub/Sub push only advances a durable history cursor: sync workers fetch history/message content idempotently, while outbound uses Gmail `users.messages.send` and stores Gmail message/thread IDs for reconciliation.

**Tech Stack:** Bun/TypeScript monorepo; Cloudflare Workers, D1/Drizzle, Durable Objects, Hono, Effect schemas, React/TanStack Query; Google OAuth 2.0, Gmail REST API, Google Cloud Pub/Sub push; existing `postal-mime` MIME parser and `CHANNEL_TOKEN_ENCRYPTION_KEY` AES-GCM encryption.

---

## Revision 2 — authoritative alignment with Gmail Channel specification

This section supersedes every conflicting assumption, file path, scope limit, task instruction, and acceptance criterion below. It is the implementation authority for this plan.

### Confirmed design

- Gmail is a distinct `gmail` Channel backed by exactly one **Gmail Account**. It is not a Cloudflare Mailbox, Email Domain, Email Routing recipient, or Reply Identity. It must never create or query `mailboxes`, `email_domains`, `email_ingress`, `email_canonical_messages`, `email_identity_bridges`, or `mailbox_delegates` for Gmail traffic.
- A Gmail Conversation is exactly one Gmail `threadId` within one Gmail Channel plus one Contact. Generate the Worker-owned conversation ID as `gmail:<channelId>:<threadId>` and preserve `threadId` in a durable Gmail mapping. Comments and Activities remain app-only because Gmail adapter input/output is canonical customer-facing Message data only.
- Add **Gmail Account** to `CONTEXT.md` directly after **Channel**: “A Google mailbox connected through OAuth, represented by exactly one Gmail Channel and one default Inbox; it is not a Mailbox, Email Domain, or Reply Identity.” Add its relationship to Channel/Conversation and a flagged ambiguity that reserves “Mailbox” for the Cloudflare logical-email concept.
- Owners/Admins manage Gmail connection lifecycle only. A Gmail Account is either `private` (connecting Agent + explicit Gmail delegates) or `shared` (authorized Team, or explicit shared-Inbox readers if no Team is attached). Admin/Owner role never grants private Gmail content read/send authority. Add Gmail-specific permissions/delegates rather than widening Cloudflare Mailbox permission code.
- Every Gmail management/data request receives explicit `workspaceId`. OAuth state binds `workspaceId`, `actorUserId`, `inboxId`, access mode/audience, backfill days, callback origin, nonce, PKCE verifier, expiry, and one-time consumption. No service infers a default Workspace.

### Correct repository insertion points

- Migration authority is `packages/db/migrations/`, with metadata in `packages/db/migrations/meta/`; `apps/worker/test/helpers.ts` applies that directory. Do not create root `migrations/*` for this feature.
- Existing adapter boundary: `packages/channel/src/types.ts` (`NormalizedInbound`, `OutboundMessage`, `ChannelAdapter`) → Worker provider resolution → `apps/worker/src/ingest.ts`/`routeInbound()` → Conversation DO. The DO never sees Google OAuth, Pub/Sub, raw Gmail API data, credentials, or provider thread rules.
- Existing outbound fence: `apps/worker/src/outbound.ts` persists `outbound_intents` before provider dispatch and returns `uncertain` for ambiguous provider outcomes. Gmail must join this path and must not retry ambiguous `users.messages.send` calls.
- Existing HTTP boundary: contracts live in `@msgflow/contracts`; JSON routes call `decodeJsonBody()` in `apps/worker/src/validation.ts`; retain existing 400/401/403/404 error parity. OAuth callback query and Pub/Sub JWT/data must receive narrow validation without exposing raw provider errors.
- Existing cron claim reference: `apps/worker/src/scheduled-claim.ts`. Gmail needs an account-specific D1 compare-and-set claim/lease with the same crash-recovery discipline, invoked by `handleScheduled()`.

### Required persistent model

Add `"gmail"` to the `channels.type` enum and create, in the next generated `packages/db/migrations/` migration, these D1 tables and indexes:

```ts
gmailAccounts(
  id, workspaceId, channelId, ownerUserId, accessMode, teamId,
  googleSub, email, encryptedRefreshToken, tokenKeyVersion,
  historyId, watchExpirationAt, syncState, lastSyncedAt,
  backfillDays, scopesJson, archiveRemovesInboxLabel,
  syncClaimToken, syncClaimedAt, lastError, createdAt, updatedAt,
)
gmailAccountDelegates(accountId, userId, createdAt)
gmailMessageRefs(
  channelId, gmailMessageId, gmailThreadId, conversationId,
  direction, rfcMessageId, inReplyTo, referencesJson, labelIdsJson,
  rawObjectKey, processedAt, createdAt,
)
gmailOauthSessions(
  id, workspaceId, actorUserId, inboxId, accessMode, teamId,
  backfillDays, encryptedState, expiresAt, consumedAt, createdAt,
)
```

Constraints: `channelId` is one-to-one with `gmailAccounts`; `googleSub` is globally unique for active accounts, and email is unique per active Workspace account; `(channelId, gmailMessageId)` and `(channelId, gmailThreadId)` are unique; delegates have a composite primary key. A Google account may be connected to only one active Workspace Gmail Account, preventing cross-tenant ownership ambiguity. Add `conversations.external_thread_id` only if no existing durable conversation field can store `threadId`; make `(channel_id, external_thread_id)` unique when non-null. Do not store Gmail OAuth credentials in generic `channels.accessToken`/`refreshToken`; preserve them for their current providers and store versioned encrypted refresh tokens on `gmail_accounts`.

### OAuth and Google configuration

- Scopes: `openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send`. `gmail.modify` is justified by the opt-in archive behavior that can remove `INBOX`; it does not authorize any unplanned label/read/delete/draft synchronization.
- Use Google authorization-code OAuth with `access_type=offline`, `prompt=consent`, PKCE S256, a ten-minute one-time state session, identity verification of `sub` and verified email, and a callback session check for the original Agent.
- Encrypt the refresh token using `channel-token-crypto`; store `token_key_version=1`; reject unknown versions and plaintext. Never return or log token, state, verifier, OAuth code, client secret, or decoded Google error contents. `invalid_grant` means `sync_state='reconnect_required'` for only that account.
- Required deployment-only variables in `apps/worker/src/env.ts` and `.dev.vars.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PUBSUB_TOPIC`. Add guarded 503 responses if missing; do not put values in `wrangler.toml`.

### Required sync/content behavior

- Initial sync: configurable 1–90 days, default 30, hard cap 5,000 threads, using `threads.list` then `threads.get(format=full)`; record an explicit truncation warning. Store initial terminal `historyId` only after durable projection completes.
- Incremental sync: `users.history.list`; a Gmail history 404 clears the stale cursor and runs the bounded configured backfill. Cursor advances only after the corresponding page projects successfully.
- Watch: `users.watch`; Pub/Sub push verifies OIDC JWT against Google JWKS, then records only durable pending work and returns 204. It must not fetch Gmail API content inside the webhook. Cron renews watches before expiry and runs bounded polling fallback, all serialized by account claim.
- Filter Gmail `SPAM`, `TRASH`, and `DRAFT`; ingest Inbox by default. Project externally sent Gmail mail as canonical outbound. Deduplicate a MsgFlow-sent message when later found via Gmail history by the durable `(channelId, gmailMessageId)` mapping. Run existing rules only for new inbound Conversations.
- Reuse existing MIME/HTML/attachment policy through extracted provider-neutral helpers: archive raw source privately, sanitize HTML, derive text, preserve Message-ID/In-Reply-To/References/threadId/labels, and accept only existing PDF/image size/type constraints. Gmail records use Gmail private prefixes/tables and Gmail account authorization, not Cloudflare email-ingress tables.

### Required outbound and archive behavior

- Use Gmail `users.messages.send` with raw RFC 5322, CRLF, connected Gmail address as From, `threadId`, `In-Reply-To`, `References`, and normalized `Re:` subject. Persist returned Gmail message/thread IDs and project accepted output once through the current outbound reconciliation flow.
- Retry only known unaccepted Gmail 429/5xx errors using persisted retry/backoff; auth failures become reconnect-required; network ambiguity remains `uncertain` and is never automatically resent.
- `archiveRemovesInboxLabel` is a Gmail Account option, default false. When true, an authorized MsgFlow archive transition may remove only `INBOX` after MsgFlow has persisted archive state. Failed Gmail label mutation is audited/visible and never rolls back MsgFlow archive. Unarchive, read-state, deletion, drafts, CC/BCC, and general label sync remain out of scope.

### Required routes, UI, and documentation

Add routes with explicit workspace validation:

```text
POST   /api/workspaces/:workspaceId/gmail-channels/oauth/start
GET    /api/gmail-oauth/callback
POST   /api/workspaces/:workspaceId/gmail-channels/:channelId/resync
POST   /api/workspaces/:workspaceId/gmail-channels/:channelId/disconnect
POST   /api/workspaces/:workspaceId/gmail-channels/:channelId/delegates
DELETE /api/workspaces/:workspaceId/gmail-channels/:channelId/delegates/:userId
PATCH  /api/workspaces/:workspaceId/gmail-channels/:channelId/options
POST   /webhooks/gmail/pubsub
```

Extend the existing Settings → Channels wizard and the first-use `apps/web/src/routes/setup/channel.tsx` flow with **Connect Gmail**. It selects default Inbox, private/shared audience (and Team when shared), and backfill days defaulting to 30, then redirects to Google. Account rows display address, audience, sync state, last sync, truncation/reconnect state, Resync/Disconnect, and archive option. They must never render credentials. Do not redesign the existing Channel settings shell or blur Gmail with Cloudflare Shared Email.

Create `docs/adr/0028-gmail-channel.md`, `docs/runbooks/gmail-channel-operator.md`, update `docs/adr/0014-email-channel-cloudflare.md` to retain its Cloudflare-only scope, and extend `docs/effect-schema-rollout.md`. The runbook must cover Gmail/PubSub API enablement, OAuth consent/redirect, restricted-scope production verification, testing-mode seven-day refresh-token expiration, topic publisher grant to `gmail-api-push@system.gserviceaccount.com`, authenticated push subscription, deployment variables, acceptance test, and rollback/disconnect.

### Required phased commits and validation

1. `feat: add gmail domain contracts` — glossary, ADR skeleton, Effect contracts, schema/migration/snapshots, migration tests.
2. `feat: connect gmail accounts with oauth` — OAuth/PKCE, encryption versioning, lifecycle/delegates/permission checks, routes.
3. `feat: sync gmail channel messages` — Gmail API client, MIME fixtures, backfill/history/PubSub/cron sync and mapping/idempotency.
4. `feat: send gmail channel messages` — raw RFC sends, thread round-trip, retry/uncertain/reconnect, archive option.
5. `feat: add gmail channel setup ui` — settings/setup UI, runbook, operator/config guards.

Each phase follows TDD: add failing focused test; run it and observe failure; implement minimally; rerun focused test; run relevant legacy regression; commit. Before final delivery run:

```bash
bun run lint
bun run test
bun run build
cd apps/worker && bunx wrangler deploy --dry-run --config wrangler.toml
```

Expected: lint/test/build exit 0; dry run succeeds with no new Cloudflare binding. Also run the full `packages/db/migrations/` chain against fresh Miniflare D1 and verify Gmail tables/indexes exist while Cloudflare email/mailbox data remains unchanged.

### Mandatory focused tests

- MIME fixtures, HTML sanitizer, PDF/image attachment policy, inbound/outbound RFC metadata.
- OAuth state/PKCE/replay/identity match; key version rejection/rotation; invalid_grant/reconnect.
- Explicit Workspace and lifecycle permission parity; private owner/delegate and shared team access; immediate revocation; audit connect/disconnect/delegation.
- Initial 30-day backfill, configurable bounds/cap warning, history expiry, Pub/Sub JWT rejection/valid enqueue-only behavior, duplicate/out-of-order events, leases, watch renewal, polling fallback.
- Gmail thread round-trip, external Sent projection, MsgFlow-sent dedupe, rule execution only on new inbound Conversation.
- Outbound idempotency, 429/5xx retry/backoff, uncertain send fence, archive option default/on/failure.
- Settings/setup wizard roles, visible status/reconnect, no credentials rendered, and existing Cloudflare Email/Messenger/WhatsApp regression tests.

## Current context / assumptions

## Current context / assumptions

- `channels` currently supports `facebook_page`, `email`, and `whatsapp_phone` in `packages/db/src/schema.ts:243`; credentials already use encrypted `accessToken` / `refreshToken` fields and the Worker-only `CHANNEL_TOKEN_ENCRYPTION_KEY` (`apps/worker/src/channel-token-crypto.ts`).
- Cloudflare Email Service is already a separate logical-Mailbox implementation: inbound goes through `apps/worker/src/email-ingress.ts`, outbound through `apps/worker/src/outbound.ts`, and must remain intact. ADR `docs/adr/0014-email-channel-cloudflare.md` must be amended because its “not Gmail API” decision is no longer globally true; it remains true for the Cloudflare Email channel.
- The existing message pipeline is reusable: `routeInbound()` projects normalized inbound content to a Conversation DO; `sendOutbound()` persists an idempotent intent before crossing a provider boundary; `apps/worker/src/outbound.ts:462` resolves provider-specific credentials.
- First release scope: one connected existing Gmail account equals one `gmail` Channel connected to one existing shared Inbox. It synchronizes received messages in Gmail’s `INBOX` label, sends new/reply messages through Gmail, and does not create Gmail labels, archive/delete Gmail mail, synchronize drafts, or import Sent messages written outside MsgFlow. Multiple shared Gmail accounts per Workspace are allowed; a Gmail address cannot be active in more than one Workspace. Per-Agent personal Gmail connections, Gmail delegated-mailbox semantics, CC/BCC/reply-all, attachments, and bidirectional sent-mail import are explicitly out of scope.
- The OAuth redirect and Pub/Sub endpoint are deployment-specific public URLs. They must be configured by the technical operator; the application must not create Google Cloud projects, topics, subscriptions, IAM bindings, or OAuth clients. New operator configuration is stored as Worker secrets/vars, never committed.
- Google scopes for this scope are `https://www.googleapis.com/auth/gmail.modify` (watch/history/message retrieval) and `https://www.googleapis.com/auth/gmail.send` (outbound send). The redirect flow must request `access_type=offline`, `prompt=consent`, PKCE, and a signed short-lived state that binds the Workspace, selected Inbox, initiating Owner/Admin, and PKCE verifier.

## Files likely to change

- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/migrations/*`, `packages/db/migrations/meta/_journal.json`
- Modify: `packages/contracts/src/types/index.ts`, `packages/contracts/src/management-schema.ts`, `packages/contracts/src/provider-schema.ts`, `packages/contracts/src/index.ts`
- Create: `apps/worker/src/gmail-api.ts`, `apps/worker/src/gmail-oauth.ts`, `apps/worker/src/gmail-sync.ts`, `apps/worker/src/gmail-pubsub.ts`, `apps/worker/src/gmail-channel.ts`
- Modify: `apps/worker/src/env.ts`, `apps/worker/src/index.ts`, `apps/worker/src/manage.ts`, `apps/worker/src/outbound.ts`, `apps/worker/src/scheduled.ts`, `apps/worker/wrangler.toml`, `apps/worker/.dev.vars.example`
- Modify: `packages/channel/src/types.ts`, `packages/channel/src/index.ts`; create `packages/channel/src/gmail.ts`
- Create focused Worker tests under `apps/worker/test/gmail-*.test.ts`
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/routes/settings.tsx`, `apps/web/src/routes/-settings.contract.test.tsx`; create `apps/web/src/components/settings/GmailChannel.tsx` and its test
- Modify/create: `docs/adr/0014-email-channel-cloudflare.md`, `docs/adr/0028-gmail-existing-mailbox-channel.md`, `docs/runbooks/gmail-channel-operator.md`, `README.md`

## Step-by-step tasks

### Task 1: Establish the Gmail channel contract and preserve the Cloudflare channel boundary

**Objective:** Define the provider identifiers and public management DTOs before changing persistence or routes.

**Files:**
- Modify: `packages/contracts/src/types/index.ts`
- Modify: `packages/contracts/src/management-schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/gmail-channel-schema.test.ts` (create)

**Step 1: Write the failing contract test**

```ts
import { describe, expect, test } from "bun:test";
import {
  GmailChannelCreateRequestSchema,
  GmailPubSubPushSchema,
} from "./gmail-channel-schema";
import { Schema } from "effect";

describe("Gmail channel schemas", () => {
  test("accepts a bounded Inbox-targeted OAuth start request", () => {
    const decoded = Schema.decodeUnknownSync(GmailChannelCreateRequestSchema)({
      inboxId: "inbox-support",
    });
    expect(decoded).toEqual({ inboxId: "inbox-support" });
  });

  test("accepts only a Pub/Sub envelope with encoded message data", () => {
    const decoded = Schema.decodeUnknownSync(GmailPubSubPushSchema)({
      message: { messageId: "pubsub-1", data: "eyJlbWFpbEFkZHJlc3MiOiJhQGIuY29tIn0" },
      subscription: "projects/p/subscriptions/msgflow-gmail",
    });
    expect(decoded.message.messageId).toBe("pubsub-1");
  });
});
```

**Step 2: Run it to verify failure**

Run: `bun test packages/contracts/src/gmail-channel-schema.test.ts`

Expected: FAIL with module/schema-not-found errors.

**Step 3: Add the minimal public contract**

Create `packages/contracts/src/gmail-channel-schema.ts`:

```ts
import { Schema } from "effect";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));

export const GmailChannelCreateRequestSchema = Schema.Struct({
  inboxId: Identifier,
});

export const GmailPubSubPushSchema = Schema.Struct({
  message: Schema.Struct({
    messageId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255)),
    data: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(16_384)),
  }),
  subscription: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_024)),
});

export type GmailChannelCreateRequest = Schema.Schema.Type<
  typeof GmailChannelCreateRequestSchema
>;
```

Export it from `packages/contracts/src/index.ts`. Extend the shared `Channel` union and every schema that enumerates channel transport values to include `"gmail"`; do not rename the current `"email"` type because it remains the Cloudflare logical-Mailbox channel.

**Step 4: Run the focused test and package build**

Run: `bun test packages/contracts/src/gmail-channel-schema.test.ts && bun --filter @msgflow/contracts run build`

Expected: test reports `2 pass`; contracts build exits `0`.

**Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat: define gmail channel contracts"
```

### Task 2: Add durable Gmail connection and sync state

**Objective:** Persist OAuth/sync state separately from generic channel fields so credentials, cursors, watch expiry, and replay state are queryable and constrained.

**Files:**
- Modify: `packages/db/src/schema.ts:243-294`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/00NN_gmail_channels.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `apps/worker/test/gmail-schema.test.ts` (create)

**Step 1: Write a failing migration-backed test**

Use `createTestDb()` from `apps/worker/test/helpers.ts`; assert that duplicate active Gmail account identities cannot be inserted and that a sync record is one-to-one with a Gmail channel:

```ts
test("a Gmail address has one active channel and one sync cursor", async () => {
  const { db, workspaceId } = await seedWorkspaceWithOwner();
  await db.insert(channels).values(gmailChannel(workspaceId, "gmail-1", "support@example.com"));
  await db.insert(gmailChannelSync).values(gmailSync("gmail-1", "100"));

  await expect(
    db.insert(channels).values(gmailChannel("other-workspace", "gmail-2", "support@example.com")).run(),
  ).rejects.toThrow();
  await expect(db.insert(gmailChannelSync).values(gmailSync("gmail-1", "101")).run()).rejects.toThrow();
});
```

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-schema.test.ts`

Expected: FAIL because `gmailChannelSync` and the `gmail` type/index do not exist.

**Step 3: Implement the smallest schema**

Add `"gmail"` to `channels.type`. Create `gmail_channel_sync` with exactly:

```ts
export const gmailChannelSync = sqliteTable(
  "gmail_channel_sync",
  {
    channelId: text("channel_id").primaryKey().references(() => channels.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    gmailAddress: text("gmail_address").notNull(),
    historyId: text("history_id"),
    watchExpirationAt: text("watch_expiration_at"),
    syncState: text("sync_state", { enum: ["pending", "syncing", "ready", "reauthorization_required", "error"] }).notNull().default("pending"),
    syncLeaseToken: text("sync_lease_token"),
    syncLeaseUntil: integer("sync_lease_until"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_gmail_channel_sync_address").on(t.gmailAddress),
    index("idx_gmail_channel_sync_watch").on(t.watchExpirationAt),
  ],
);
```

Store the encrypted OAuth refresh token in `channels.refreshToken`, the short-lived access token in `channels.accessToken`, and its expiry in `channels.tokenExpiresAt`; do not add a duplicate credential store. Add a migration that creates the table and a partial unique index preventing a non-deleted Gmail channel from reusing the same normalized Gmail address. Hand-inspect SQL before it becomes part of the migration chain.

**Step 4: Verify fresh migration and constraints**

Run: `bun test apps/worker/test/gmail-schema.test.ts && bun run build`

Expected: focused test passes and `turbo build` exits `0`.

**Step 5: Commit**

```bash
git add packages/db apps/worker/test/gmail-schema.test.ts
git commit -m "feat: persist gmail channel sync state"
```

### Task 3: Add encrypted Google OAuth state and token exchange primitives

**Objective:** Create a testable OAuth implementation that never exposes Google credentials to the browser or logs them.

**Files:**
- Create: `apps/worker/src/gmail-oauth.ts`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/.dev.vars.example`
- Test: `apps/worker/test/gmail-oauth.test.ts` (create)

**Step 1: Write failing tests**

Test `createGmailAuthorizationUrl()` for `response_type=code`, `access_type=offline`, `prompt=consent`, both scopes, a generated PKCE challenge, and an opaque encrypted state. Test `verifyGmailOAuthState()` rejects a state for a different actor or expired timestamp. Stub `fetch` and test `exchangeGmailAuthorizationCode()` sends the exact code-verifier and rejects a response with no refresh token.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-oauth.test.ts`

Expected: FAIL because `gmail-oauth.ts` does not exist.

**Step 3: Implement minimal OAuth helpers**

Add these environment fields to `apps/worker/src/env.ts` and the documented example only (not real credentials):

```ts
GMAIL_OAUTH_CLIENT_ID: string;
GMAIL_OAUTH_CLIENT_SECRET: string;
GMAIL_OAUTH_REDIRECT_URI: string;
GMAIL_PUBSUB_AUDIENCE: string;
GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: string;
```

Implement a local `GmailOAuthState` payload containing `workspaceId`, `inboxId`, `actorId`, `codeVerifier`, `expiresAt`, and a random nonce. Encrypt/decrypt it with `encryptChannelToken`/`decryptChannelToken` and `CHANNEL_TOKEN_ENCRYPTION_KEY`; validate all fields and require `expiresAt > Date.now()` before accepting it. Generate a 64-character verifier from random bytes and derive `code_challenge = base64url(SHA-256(verifier))`. Use the exact authorization endpoint `https://accounts.google.com/o/oauth2/v2/auth` and token endpoint `https://oauth2.googleapis.com/token`. Never place client secret, verifier, refresh token, or decoded state in a URL, API response, or audit event.

**Step 4: Verify focused tests and type check**

Run: `bun test apps/worker/test/gmail-oauth.test.ts && bun --filter @msgflow/worker run type-check`

Expected: OAuth tests pass; type check exits `0`.

**Step 5: Commit**

```bash
git add apps/worker/src/gmail-oauth.ts apps/worker/src/env.ts apps/worker/.dev.vars.example apps/worker/test/gmail-oauth.test.ts
git commit -m "feat: add secure gmail oauth primitives"
```

### Task 4: Create and authorize the Gmail connection flow

**Objective:** Let a Workspace Owner or Administrator start Google OAuth for a selected active shared Inbox, then atomically create the Gmail channel from the callback.

**Files:**
- Create: `apps/worker/src/gmail-channel.ts`
- Modify: `apps/worker/src/manage.ts:691-1100`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/gmail-channel-management.test.ts` (create)

**Step 1: Write failing route/service tests**

Cover: member gets `403`; archived/missing Inbox gets `404`; OAuth-start response contains only `authorizationUrl`; callback rejects changed Workspace/actor state; successful callback calls Gmail `users.getProfile`, normalizes the returned email, encrypts tokens, creates a `gmail` channel plus default `inbox_channels` link and `gmail_channel_sync` record; collision returns `409`; no refresh token returns a clear reauthorization error.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-channel-management.test.ts`

Expected: FAIL with missing Gmail routes/services.

**Step 3: Implement the routes and transaction**

Add exactly these HTTP endpoints:

- `POST /api/workspaces/:workspaceId/gmail-channels/oauth/start` with `GmailChannelCreateRequestSchema`; authorize with `requireAdminAccess`; return `{ authorizationUrl }`.
- `GET /api/gmail-oauth/callback`; validate Google `error`, `state`, and `code`; require a valid current Better Auth session for the state actor; exchange code; call `GET https://gmail.googleapis.com/gmail/v1/users/me/profile`; create/restore the channel transactionally; redirect only to `${BETTER_AUTH_URL}/settings?workspace=<id>&section=channels&gmail=connected` after success.
- `POST /api/workspaces/:workspaceId/gmail-channels/:channelId/disconnect`; authorize Admin, mark the channel `disconnected`, clear encrypted Google access/refresh credentials and sync leases, but retain conversations/history.

The create transaction must insert a normal `channels` row with `type: "gmail"`, `externalId: normalizedGoogleEmail`, `displayName: normalizedGoogleEmail`, and the encrypted tokens. It must link the chosen Inbox via the existing `inboxChannels` machinery, create `gmail_channel_sync`, and write an audit event that contains only IDs/address/state, never tokens. Do not overload `createSharedMailbox` or create a `mailboxes` record: Gmail is a provider channel, not a Cloudflare logical Mailbox.

**Step 4: Verify focused service/route tests**

Run: `bun test apps/worker/test/gmail-channel-management.test.ts`

Expected: all OAuth start/callback authorization, collision, and disconnect tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/gmail-channel.ts apps/worker/src/manage.ts apps/worker/src/index.ts apps/worker/test/gmail-channel-management.test.ts
git commit -m "feat: connect gmail channels with oauth"
```

### Task 5: Implement a small Gmail REST client with refresh fencing

**Objective:** Centralize Gmail HTTP, expiry-aware token refresh, error normalization, and retry-safe request construction.

**Files:**
- Create: `apps/worker/src/gmail-api.ts`
- Test: `apps/worker/test/gmail-api.test.ts` (create)

**Step 1: Write failing tests**

Test that an unexpired token is used without refresh; an expired token refreshes once and persists encrypted replacements; concurrent refresh candidates do not overwrite a newer token; 401 after a request forces one refresh/retry; a Google `invalid_grant` marks only that channel `reauthorization_required`; rate-limit/5xx errors are retryable; other 4xx errors are definitive. Assert requests include `Authorization: Bearer ...` and no token appears in an error value.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-api.test.ts`

Expected: FAIL because the Gmail client is absent.

**Step 3: Implement the minimal client**

Expose a `GmailApi` factory that accepts `Env` and `channelId`, decrypts credentials only within the Worker, and provides typed methods:

```ts
getProfile(): Promise<{ emailAddress: string; historyId: string }>;
watch(topicName: string): Promise<{ historyId: string; expiration: string }>;
listHistory(startHistoryId: string): Promise<GmailHistoryPage>;
getMessage(id: string): Promise<GmailMessage>;
sendRaw(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
```

Use `https://gmail.googleapis.com/gmail/v1/users/me/...`; encode raw RFC 5322 mail as base64url with no padding. Make token replacement a compare-and-set update on the persisted previous encrypted token. Never retry a POST `sendRaw` after a network ambiguity: return an `uncertain` provider result to the existing outbound state machine.

**Step 4: Verify client tests**

Run: `bun test apps/worker/test/gmail-api.test.ts && bun --filter @msgflow/worker run type-check`

Expected: all Gmail-client tests pass; type check exits `0`.

**Step 5: Commit**

```bash
git add apps/worker/src/gmail-api.ts apps/worker/test/gmail-api.test.ts
git commit -m "feat: add gmail api client"
```

### Task 6: Normalize and project Gmail inbound messages without changing Cloudflare email

**Objective:** Convert Gmail API messages to canonical MsgFlow messages, deduplicate them durably, and route them to the Gmail channel’s configured Inbox.

**Files:**
- Create: `packages/channel/src/gmail.ts`
- Modify: `packages/channel/src/index.ts`, `packages/channel/src/types.ts`
- Create: `apps/worker/src/gmail-sync.ts`
- Modify: `apps/worker/src/ingest.ts`
- Test: `packages/channel/src/gmail.test.ts` (create)
- Test: `apps/worker/test/gmail-sync.test.ts` (create)

**Step 1: Write failing normalization tests**

Use a Gmail API fixture with headers (`Message-ID`, `In-Reply-To`, `References`, `From`, `Subject`, `Date`), a base64url `text/plain` part, and `threadId`. Assert it emits:

```ts
{
  channel: "gmail",
  providerMessageId: "gmail-message-id",
  senderId: "customer@example.test",
  payload: {
    gmailThreadId: "gmail-thread-id",
    gmailMessageId: "gmail-message-id",
    rfcMessageId: "<rfc@example.test>",
    subject: "Need help",
  },
}
```

Also assert the sync ignores messages labeled `SENT`, skips Gmail self-sent mail, rejects malformed base64/header injection, uses the Gmail message ID rather than RFC Message-ID for provider deduplication, and keeps different Gmail `threadId`s separate even with the same subject.

**Step 2: Verify failure**

Run: `bun test packages/channel/src/gmail.test.ts apps/worker/test/gmail-sync.test.ts`

Expected: FAIL because Gmail normalization/sync do not exist.

**Step 3: Implement Gmail normalization and durable projection**

Add `gmailAdapter` that accepts a parsed Gmail API message supplied by Worker code; it must not receive OAuth credentials or Cloudflare types. Parse only `text/plain` for this release and cap decoded text at the existing 256 KiB email text limit. Do not download attachments or render HTML in this release.

In `gmail-sync.ts`, resolve channel/inbox ownership from `channels` + `inbox_channels`, call `routeInbound()` with `channel: "gmail"`, and use the durable Gmail provider message ID to guarantee exactly-once projection. Add a new `gmail_messages` mapping table in Task 2’s migration if needed for `(channel_id, gmail_message_id)` uniqueness and Gmail `threadId` → MsgFlow conversation mapping; do not use the existing Cloudflare `email_ingress` or `email_canonical_messages` tables because those model raw RFC ingress tied to logical Mailboxes.

Conversation IDs must be generated in Worker code as `gmail:<channelId>:<gmailThreadId>` for grouped Gmail threads. Route rules receive `channelType: "gmail"`; update contracts/queries/rule tests only where their channel enum currently excludes it. The Conversation DO sees only the canonical normalized `Message` and continues its own message-level deduplication.

**Step 4: Verify focused tests**

Run: `bun test packages/channel/src/gmail.test.ts apps/worker/test/gmail-sync.test.ts`

Expected: fixture parsing, provider duplicate suppression, self/Sent filtering, thread mapping, and route projection tests pass.

**Step 5: Commit**

```bash
git add packages/channel apps/worker/src/gmail-sync.ts apps/worker/src/ingest.ts apps/worker/test/gmail-sync.test.ts packages/db
git commit -m "feat: ingest gmail inbox messages"
```

### Task 7: Add Gmail history synchronization and safe full-resync recovery

**Objective:** Treat Pub/Sub history IDs as wake-up signals, not message payloads, and recover when Gmail history is no longer available.

**Files:**
- Modify: `apps/worker/src/gmail-sync.ts`
- Modify: `apps/worker/src/scheduled.ts`
- Test: `apps/worker/test/gmail-history-sync.test.ts` (create)

**Step 1: Write failing sync tests**

Test these cases with mocked Gmail API pages:

1. Multiple history pages process in order and persist the highest completed history ID only after every page projects.
2. Repeated/out-of-order notifications do not duplicate a message or regress the cursor.
3. A sync lease prevents overlapping syncs for the same channel.
4. Gmail `404` / `historyIdInvalid` clears the cursor, performs a bounded initial resync, and writes a visible `error`/recovery audit record.
5. Initial sync reads only `INBOX`, newest first, stops after 90 days or 5,000 messages, and stores an explicit truncation warning if capped.
6. A failed projection leaves the cursor unchanged for replay.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-history-sync.test.ts`

Expected: FAIL because no history cursor processor exists.

**Step 3: Implement the sync state machine**

Implement `syncGmailChannel(env, channelId, requestedHistoryId?)`. Acquire with a D1 compare-and-set lease (`syncLeaseToken`, `syncLeaseUntil`) and release it in `finally`. For a valid cursor, page `users.history.list` using `startHistoryId`; collect only `messagesAdded` IDs, retrieve each source message, and project it using Task 6. Commit `historyId` only after its corresponding page succeeds.

For an absent/invalid cursor, invoke a bounded `users.messages.list` initial sync with `labelIds=INBOX`, then fetch/project returned IDs and set the terminal mailbox history ID from `users.getProfile()`. Do not mutate Gmail labels or mark messages read. Cron should invoke due watch renewal and recovery syncs but must not retry a poisoned content item indefinitely; persist actionable state/error for an authorized operator.

**Step 4: Verify focused tests**

Run: `bun test apps/worker/test/gmail-history-sync.test.ts`

Expected: all cursor, lease, duplicate, invalid-history, and bounded-resync tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/gmail-sync.ts apps/worker/src/scheduled.ts apps/worker/test/gmail-history-sync.test.ts
git commit -m "feat: synchronize gmail history safely"
```

### Task 8: Add authenticated Pub/Sub ingress and Gmail watch lifecycle

**Objective:** Receive Google Pub/Sub pushes securely, acknowledge quickly, and renew Gmail watches before expiry.

**Files:**
- Create: `apps/worker/src/gmail-pubsub.ts`
- Modify: `apps/worker/src/index.ts`, `apps/worker/src/scheduled.ts`
- Test: `apps/worker/test/gmail-pubsub.test.ts` (create)

**Step 1: Write failing tests**

Test `POST /webhooks/gmail/pubsub` rejects absent/invalid JWT, wrong issuer, audience, service-account email, expired token, and malformed Pub/Sub body with `401`/`400`. Test a valid JWT/data payload returns `204`, finds the matching active Gmail address, invokes sync idempotently, and unknown/disconnected addresses return `204` without revealing whether an account exists. Test `ensureGmailWatch()` calls `users.watch` with exactly `topicName` and `labelIds: ["INBOX"]`, persists returned `historyId`/`expiration`, and renews watches when less than 24 hours remain.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-pubsub.test.ts`

Expected: FAIL because the Pub/Sub verifier/endpoint is absent.

**Step 3: Implement secure push and renewal**

Decode the Pub/Sub `message.data` base64url JSON to `{ emailAddress, historyId }`. Verify the OpenID Connect JWT using Google’s published JWKS, cache keys using HTTP cache headers, require `iss` exactly `accounts.google.com` or `https://accounts.google.com`, `aud === env.GMAIL_PUBSUB_AUDIENCE`, `email === env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`, and `email_verified === true`. Do not accept a bare shared secret.

After validation, look up the canonical Gmail address and call the durable sync routine. Return `204` for a valid but unrecognized address so the endpoint remains non-enumerable. Add cron handling that scans active Gmail channels with `watchExpirationAt <= now + 24h`; it renews watches and records `reauthorization_required` instead of spinning when refresh fails.

**Step 4: Verify focused tests**

Run: `bun test apps/worker/test/gmail-pubsub.test.ts`

Expected: JWT rejection matrix, non-enumeration, watch request, and renewal tests pass.

**Step 5: Commit**

```bash
git add apps/worker/src/gmail-pubsub.ts apps/worker/src/index.ts apps/worker/src/scheduled.ts apps/worker/test/gmail-pubsub.test.ts
git commit -m "feat: receive gmail pubsub updates"
```

### Task 9: Send Gmail messages through the existing idempotent outbound state machine

**Objective:** Reply from Gmail-backed conversations without weakening the existing no-double-send guarantees.

**Files:**
- Modify: `packages/channel/src/types.ts`, `packages/channel/src/gmail.ts`
- Modify: `apps/worker/src/outbound.ts`
- Modify: `apps/worker/src/gmail-api.ts`
- Test: `apps/worker/test/gmail-outbound.test.ts` (create)

**Step 1: Write failing tests**

Test that a Gmail conversation sends raw RFC 5322 with `From` equal to the connected Gmail address, contact address as `To`, subject preserved, `In-Reply-To`/`References` from the inbound RFC IDs, and the mapped Gmail `threadId`. Assert the exact Gmail message ID becomes `providerMessageId`; a second identical client message ID does not issue a second Gmail API call; ambiguous transport failure becomes `uncertain`; `invalid_grant` becomes reauthorization-required; and a Gmail channel cannot send on a Cloudflare `email` conversation or vice versa.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-outbound.test.ts`

Expected: FAIL because `resolveProviderContext()` lacks a Gmail branch.

**Step 3: Implement a Gmail adapter branch**

Extend `OutboundContext` with a structurally typed Gmail sender:

```ts
gmailSender?: {
  sendRaw(raw: string, threadId?: string): Promise<{ id: string; threadId: string }>;
};
```

In `resolveProviderContext()`, branch explicitly on `channel.type === "gmail"`, obtain the Gmail-thread mapping for the conversation, construct a raw text-only RFC 5322 message with CRLF line endings and sanitized header values, then call `GmailApi.sendRaw(raw, threadId)`. Keep `emailAdapter` and `env.EMAIL.send()` untouched for `channel.type === "email"`. Use `providerMessageId: result.id` and record `threadId` in the Gmail mapping table. Do not retry after a network-ambiguous Gmail send; reuse the current `uncertain` behavior.

**Step 4: Verify focused tests and regression email tests**

Run: `bun test apps/worker/test/gmail-outbound.test.ts apps/worker/test/email-pipeline.test.ts`

Expected: Gmail send tests and existing Cloudflare email pipeline tests pass.

**Step 5: Commit**

```bash
git add packages/channel/src apps/worker/src/outbound.ts apps/worker/src/gmail-api.ts apps/worker/test/gmail-outbound.test.ts
git commit -m "feat: send replies through gmail api"
```

### Task 10: Expose the Gmail connection in the existing Channels settings pattern

**Objective:** Add a clear “Google Gmail” provider choice without changing the Mailboxes area or replacing existing channel-management UI.

**Files:**
- Create: `apps/web/src/components/settings/GmailChannel.tsx`
- Create: `apps/web/src/components/settings/GmailChannel.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/routes/settings.tsx:169-201,254-278`
- Modify: `apps/web/src/routes/-settings.contract.test.tsx`

**Step 1: Write failing UI/API tests**

Assert that Settings → Channels → Add channel shows a button named `Google Gmail`, with copy “Connect an existing Gmail or Google Workspace inbox.” Clicking it renders only a shared Inbox selector and `Continue with Google`; submitting calls `api.startGmailOAuth(workspaceId, { inboxId })`; no token/password field exists. Assert an active Gmail row displays provider `Gmail`, address, Inbox, sync state, last sync, and a Disconnect action; a member cannot see connect/disconnect controls; the existing Shared Email option remains labeled as Cloudflare-provisioned mail.

**Step 2: Verify failure**

Run: `bun --filter @msgflow/web test src/components/settings/GmailChannel.test.tsx src/routes/-settings.contract.test.tsx`

Expected: FAIL because Gmail UI/API methods do not exist.

**Step 3: Implement the smallest UI**

Add API methods:

```ts
startGmailOAuth(workspaceId: string, body: { inboxId: string }) {
  return request<{ authorizationUrl: string }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/gmail-channels/oauth/start`,
    { method: "POST", body: JSON.stringify(body) },
  );
},
disconnectGmailChannel(workspaceId: string, channelId: string) {
  return request<{ success: true }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/gmail-channels/${encodeURIComponent(channelId)}/disconnect`,
    { method: "POST" },
  );
},
```

Extend `ChannelSummary` only with non-secret operational fields required by the row: `type: "gmail"`, `gmailSyncState`, `gmailLastSyncedAt`, `gmailWatchExpirationAt`. In the existing `ChannelsSection`, add `gmail` to `ChannelWizardType` and render `GmailChannel`; on successful start, use `window.location.assign(authorizationUrl)`. Update `ChannelRow` to use a Gmail icon/label and the dedicated disconnect mutation. Never show access/refresh credentials, token expiry values, raw Pub/Sub payloads, or “delivered” status.

**Step 4: Verify UI tests, lint, and production build**

Run: `bun --filter @msgflow/web test src/components/settings/GmailChannel.test.tsx src/routes/-settings.contract.test.tsx && bun run lint && bun run build`

Expected: focused tests pass, Biome reports no errors, and Turbo build exits `0`.

**Step 5: Commit**

```bash
git add apps/web/src/components/settings/GmailChannel.tsx apps/web/src/components/settings/GmailChannel.test.tsx apps/web/src/lib/api.ts apps/web/src/routes/settings.tsx apps/web/src/routes/-settings.contract.test.tsx packages/contracts/src
 git commit -m "feat: add gmail channel settings flow"
```

### Task 11: Document operator-only Google Cloud setup and revise architecture decisions

**Objective:** Make deployment prerequisites explicit without encoding Google project values or performing any external configuration from MsgFlow.

**Files:**
- Create: `docs/adr/0028-gmail-existing-mailbox-channel.md`
- Create: `docs/runbooks/gmail-channel-operator.md`
- Modify: `docs/adr/0014-email-channel-cloudflare.md`
- Modify: `README.md`
- Test: `apps/worker/test/gmail-operator-config.test.ts` (create)

**Step 1: Write a failing configuration guard test**

Test that `startGmailOAuth()` returns a controlled `503` when any Google OAuth configuration field is absent, and that the Pub/Sub endpoint returns `503` rather than accepting unauthenticated traffic when Pub/Sub verifier configuration is absent.

**Step 2: Verify failure**

Run: `bun test apps/worker/test/gmail-operator-config.test.ts`

Expected: FAIL until explicit configuration guards exist.

**Step 3: Implement config guards and documentation**

Add guards in the OAuth and Pub/Sub entry paths. Write the runbook with these exact operator steps and no automation commands that create resources:

1. Create/select a Google Cloud project; enable Gmail API and Pub/Sub API.
2. Configure OAuth consent screen, test/production publishing requirements, redirect URI `${PUBLIC_WORKER_ORIGIN}/api/gmail-oauth/callback`, and the two exact scopes from this plan.
3. Create a confidential web OAuth client; set `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI` as Worker secrets/vars.
4. Create one Pub/Sub topic and authenticated push subscription to `${PUBLIC_WORKER_ORIGIN}/webhooks/gmail/pubsub`; configure audience and service account; grant `roles/pubsub.publisher` to `gmail-api-push@system.gserviceaccount.com` for the topic.
5. Set `GMAIL_PUBSUB_AUDIENCE` and `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`; verify a signed test push is accepted only with valid OIDC JWT.
6. Connect a test Gmail account, verify initial Inbox import, receive a new inbound email, reply from MsgFlow, verify it appears in Gmail’s thread, verify duplicate push does not duplicate the timeline, and verify channel disconnect prevents later sync/send.
7. Roll back by disconnecting the channel in MsgFlow, revoking OAuth consent in Google, and removing/pausing the Pub/Sub subscription; do not delete MsgFlow conversation history.

Amend ADR 0014 to state that Cloudflare logical-Mailbox email remains Cloudflare Email Service only, while ADR 0028 defines the separate Gmail API channel. Do not falsely claim Gmail API, Pub/Sub, OAuth consent, or Google verification are complete merely because local tests pass.

**Step 4: Verify guards and documentation references**

Run: `bun test apps/worker/test/gmail-operator-config.test.ts && bun run lint && bun run build`

Expected: config-guard test passes; lint and build exit `0`.

**Step 5: Commit**

```bash
git add docs README.md apps/worker/src apps/worker/test/gmail-operator-config.test.ts
git commit -m "docs: add gmail channel operator runbook"
```

### Task 12: Run full regression and dry-run validation

**Objective:** Prove the added transport does not regress current Messenger, WhatsApp, Cloudflare email, migration, or UI behavior.

**Files:**
- Modify only if a test exposes a root-cause defect in the Gmail change.

**Step 1: Run focused provider regressions**

Run:

```bash
bun test apps/worker/test/gmail-*.test.ts \
  apps/worker/test/email-pipeline.test.ts \
  apps/worker/test/email-ingress-hardening.test.ts \
  apps/worker/test/whatsapp-pipeline.test.ts \
  apps/worker/test/routing.test.ts
```

Expected: all selected tests pass with zero failures.

**Step 2: Run repository validation**

Run:

```bash
bun run lint
bun run test
bun run build
cd apps/worker && bunx wrangler deploy --dry-run --config wrangler.toml
```

Expected: lint/test/build exit `0`; dry run bundles successfully and lists D1, all three Durable Objects, `EMAIL`, both R2 buckets, and no unintended binding change. Google OAuth/Pub/Sub use normal HTTPS/env configuration and require no new Wrangler binding.

**Step 3: Inspect migration chain on a fresh scratch database**

Run the project’s existing Miniflare migration test harness (the same helper used by `apps/worker/test/helpers.ts`) against a new scratch directory; do not delete or regenerate existing migrations.

Expected: every migration applies from an empty D1 database, `gmail_channel_sync` and Gmail message mapping constraints exist, and no legacy tables are dropped.

**Step 4: Commit the final verified state**

```bash
git add -A
git commit -m "feat: add gmail existing mailbox channel"
```

Do not commit `.env`, `.dev.vars`, OAuth client secrets, tokens, Pub/Sub JWTs, or generated local credentials.

## Tests / validation summary

- Unit tests: OAuth state/PKCE, token refresh fencing, JWT verification, Gmail API error mapping, Gmail MIME/header normalization, RFC thread construction.
- D1/Miniflare integration tests: schema uniqueness, Admin authorization, OAuth callback transactionality, history cursor leasing, duplicate/out-of-order notification handling, invalid-history recovery, channel disconnect, and idempotent outbound state.
- Regression tests: existing Cloudflare email ingress/outbound tests and Messenger/WhatsApp routing tests must remain green.
- UI tests: Gmail appears as a distinct provider under Channels, uses the existing settings dialog pattern, never asks users for a Google token, and preserves Cloudflare shared-email provisioning.
- Manual operator acceptance (after explicit approval, not during implementation): connect a disposable Gmail account, verify initial import + live inbound push + outbound reply + watch renewal + disconnect/revoke behavior.

## Risks, tradeoffs, and open questions

- Google OAuth scopes can require Google verification for production external users. Until the consent screen is approved/published, connections may be limited to configured test users; this is an external deployment gate.
- Gmail `watch()` expires and Pub/Sub is at-least-once. The history cursor, lease, idempotent Gmail-message mapping, and forced resync path are mandatory; polling only is not an acceptable replacement.
- Gmail history retention is limited. A long outage can force the bounded initial Inbox resync and may omit mail older than the 90-day/5,000-message first-release cap. The UI/runbook must show this condition instead of silently claiming completeness.
- Gmail API sends can become ambiguous after network failure. Match the existing outbound safety rule: mark `uncertain`, do not retry automatically, and require reconciliation/agent review.
- First release intentionally does not synchronize Gmail messages sent outside MsgFlow. If “outgoing” must include messages authored in Gmail itself, add a second phase that imports `SENT` history entries and carefully prevents duplication of MsgFlow-originated messages using stored Gmail message IDs.
- First release is a shared Workspace channel only. Per-Agent Gmail accounts change authorization, reply identity, settings UX, quotas, offboarding, and audit requirements; plan that as a distinct follow-up, not an option hidden in this flow.
- Attachments, HTML rendering, Gmail labels, draft sync, read-state synchronization, CC/BCC, and reply-all are excluded until their permission, storage, retention, and UI semantics are independently designed.
