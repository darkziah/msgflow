# WhatsApp Cloud API Channel Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan task-by-task.

**Goal:** Add a workspace-scoped WhatsApp Cloud API channel that Owners/Admins can create, update, disconnect, remove, receive text messages through, and reply to with text messages.

**Architecture:** Reuse the existing `channels` record, encrypted `access_token`, `meta_apps` app-secret/verification-token lifecycle, default-Inbox links, canonical ingress, durable outbound-intent state machine, and Conversation DO timeline. Add `whatsapp`/`whatsapp_phone` as first-class discriminants everywhere a Channel is currently a Facebook-or-email union; identify a channel by immutable Meta `phone_number_id` and associate it with the existing owning Meta App. Support text-only inbound and outbound in this increment; reject unsupported inbound types without creating a conversation, and surface Meta’s definitive outbound errors without claiming delivery.

**Tech stack:** Bun workspaces, TypeScript, Effect Schema, Drizzle/D1, Hono on Cloudflare Workers, Durable Objects, React/TanStack Query, Vitest, Biome.

---

## Current context / assumptions

- The repository is `/Users/dark/Documents/Projects/MsgFlow`; the working tree already has unrelated edits. Do not reset, reformat, stage, or commit someone else’s changes. Every `git add` below must use the exact files listed for that task.
- `channels` currently permits only `facebook_page | email`; `external_id` is a provider identity, credentials are encrypted by `apps/worker/src/channel-token-crypto.ts`, and each channel has exactly one default `inbox_channels` link.
- A WhatsApp channel is configured manually from Settings with: existing MsgFlow Meta App, Meta **Phone Number ID**, display name, long-lived/system-user access token, and active destination Inbox. Its `external_id` is the immutable Phone Number ID. The displayed phone number is informational and is derived from Meta at create/update validation; it is not an identity key.
- “Update” means editable display name, access-token rotation, and default Inbox reassignment. Phone Number ID and Meta App are immutable after creation because they route signed provider traffic. Inbox reassignment must use the existing `POST /api/workspaces/:workspaceId/channels/:channelId/default-inbox` invariant-preserving endpoint, not duplicate routing logic.
- “Remove” means soft-delete: clear all credentials and `meta_app_id`, unlink from all inboxes, mark `status='deleted'`, and retain all conversations/timeline data. Recreating the same Phone Number ID in the same workspace revives that row and creates a fresh default-Inbox link. A non-deleted Phone Number ID is installation-global, preventing ambiguous inbound routing across workspaces.
- This increment supports only user-initiated text messages inside WhatsApp’s provider-allowed customer-service window. It intentionally excludes templates, interactive messages, delivery/read-status projection, media upload/download, WhatsApp Business Account management, QR/embedded signup, and phone-number verification. Add ADR/risk notes rather than silently pretending these work.
- Confirmed provider facts to preserve: WhatsApp message webhooks use object `whatsapp_business_account`, identify the receiving number as `entry[].changes[].value.metadata.phone_number_id`, contain inbound text under `messages[]`, and carry outbound delivery states separately in `statuses[]`. Meta signs raw bodies with the app secret. The Cloud API sends text via `POST /{PHONE_NUMBER_ID}/messages` using a Bearer access token; pin the Graph version in one shared constant after rechecking the current Meta documentation during implementation.

## Files likely to change

- `packages/db/src/schema.ts`
- `packages/db/migrations/0027_whatsapp_channel.sql` (new) and `packages/db/migrations/meta/_journal.json`
- `packages/contracts/src/types/index.ts`
- `packages/contracts/src/channel-schema.ts`
- `packages/contracts/src/provider-schema.ts`
- `packages/channel/src/types.ts`
- `packages/channel/src/whatsapp.ts` (new)
- `packages/channel/src/index.ts`
- `apps/worker/src/whatsapp.ts` (new: provider validation helpers only)
- `apps/worker/src/manage.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/ingest.ts`
- `apps/worker/src/outbound.ts`
- `apps/worker/src/queries.ts`
- `apps/worker/src/workspace-api.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/routes/settings.tsx`
- focused test files under `packages/channel/src/`, `apps/worker/test/`, and `apps/web/src/routes/`
- `CONTEXT.md` and a new ADR only if the repository’s ADR convention requires accepted cross-cutting provider/lifecycle decisions to be documented.

Do not add a new Worker secret, a committed token, a phone number, a WABA ID, or an environment-specific webhook URL. Reuse `CHANNEL_TOKEN_ENCRYPTION_KEY` for per-channel bearer tokens and the selected encrypted `meta_apps.app_secret` to verify webhooks.

---

## Step-by-step tasks

### Task 1: Record the channel contract and database migration

**Objective:** Make WhatsApp phone numbers a valid, globally unambiguous channel identity without altering existing Facebook/email semantics.

**Files:**
- Modify: `packages/db/src/schema.ts:128-170,313-336`
- Create: `packages/db/migrations/0027_whatsapp_channel.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `apps/worker/test/provider-identity-migrations.test.ts`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing migration/schema tests.**

Add tests that apply the entire migration chain to a fresh Miniflare D1 and assert all of the following:

```ts
expect(await indexExists("idx_channels_whatsapp_phone_identity")).toBe(true);

await insertChannel("workspace-a", "whatsapp_phone", "phone-123", "active");
await expect(
  insertChannel("workspace-b", "whatsapp_phone", "phone-123", "active"),
).rejects.toThrow(/UNIQUE constraint failed/);

await insertChannel("workspace-b", "whatsapp_phone", "phone-123", "deleted");
```

Also extend the routing fixture helper’s type from `"email" | "facebook_page"` to include `"whatsapp_phone"`; this must fail to compile before the schema/type change.

**Step 2: Run the focused test to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/provider-identity-migrations.test.ts
```

Expected: FAIL because `whatsapp_phone` is not accepted by the Drizzle schema and `idx_channels_whatsapp_phone_identity` does not exist.

**Step 3: Implement the minimal schema and forward-only migration.**

In `packages/db/src/schema.ts`, extend both enum declarations exactly:

```ts
type: text("type", { enum: ["facebook_page", "whatsapp_phone", "email"] }).notNull(),
```

```ts
channelType: text("channel_type", {
  enum: ["facebook_page", "whatsapp_phone", "email"],
}).notNull(),
```

Add a partial unique index alongside `idx_channels_facebook_page_identity`:

```ts
uniqueIndex("idx_channels_whatsapp_phone_identity")
  .on(table.externalId)
  .where(
    sql`${table.type} = 'whatsapp_phone' AND ${table.status} <> 'deleted'`,
  ),
```

Generate migration `0027` on top of the existing chain; do not delete or regenerate old migrations. Because changing SQLite CHECK constraints may require a table rebuild, inspect the generated `INSERT INTO __new_channels ... SELECT ...` and ensure it selects only columns that exist in the prior table. Add this exact index SQL to the final migration if Drizzle omits the partial index:

```sql
CREATE UNIQUE INDEX idx_channels_whatsapp_phone_identity
ON channels(external_id)
WHERE type = 'whatsapp_phone' AND status <> 'deleted';
```

Append the matching `0027_whatsapp_channel` journal entry; retain all preceding entries and their order.

**Step 4: Run migration and focused tests to verify pass.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/provider-identity-migrations.test.ts
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
```

Expected: both commands exit 0; the migration test proves the partial global identity index, and the routing fixture accepts the new enum value.

**Step 5: Commit only this task.**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0027_whatsapp_channel.sql packages/db/migrations/meta/_journal.json apps/worker/test/provider-identity-migrations.test.ts apps/worker/test/routing.test.ts
git commit -m "feat: add WhatsApp channel identity"
```

---

### Task 2: Add canonical contracts and deterministic WhatsApp conversation IDs

**Objective:** Make WhatsApp a valid canonical channel in contracts without treating provider JSON as a database payload.

**Files:**
- Modify: `packages/contracts/src/types/index.ts:5-48,321-490`
- Modify: `packages/contracts/src/channel-schema.ts`
- Modify: `packages/contracts/src/provider-schema.ts`
- Test: `packages/contracts/src/types/index.test.ts` (create if no focused parser test exists)
- Test: `packages/contracts/src/channel-schema.test.ts` (create)

**Step 1: Write failing contract tests.**

Test that `whatsappConversationId("phone-123", "15551234567")` produces `wa:phone-123:15551234567`, `parseConversationId` returns `{ channel: "whatsapp", left: "phone-123", right: "15551234567" }`, and malformed `wa:` IDs return `null`. Test that the create schema strips unknown fields, trims strings, rejects blank values, and permits only these client-controlled fields:

```ts
{
  phoneNumberId: "phone-123",
  displayName: "Support WhatsApp",
  accessToken: "system-user-token",
  inboxId: "inbox-123",
  metaAppId: "meta-app-123",
}
```

**Step 2: Run to verify failure.**

Run:

```bash
cd packages/contracts && bun test src/types/index.test.ts src/channel-schema.test.ts
```

Expected: FAIL because no WhatsApp channel discriminant, conversation-ID helper, or schema exists.

**Step 3: Implement contracts.**

Apply these exact discriminants in `packages/contracts/src/types/index.ts`:

```ts
export type Channel = "facebook" | "whatsapp" | "email";
```

```ts
export interface ChannelSummary {
  id: string;
  type: "facebook_page" | "whatsapp_phone" | "email";
  displayName: string;
  externalId: string;
  status: "active" | "disconnected" | "error" | "deleted";
  hasToken: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add:

```ts
export function whatsappConversationId(phoneNumberId: string, waId: string): string {
  return `wa:${phoneNumberId}:${waId}`;
}
```

Extend `parseConversationId` to accept only `"wa"` in addition to existing prefixes and map it to canonical `"whatsapp"`. Update every public union that currently lists `"facebook" | "email"` (conversation summary, list filter, sidebar filter, and outbound message channel) to include `"whatsapp"`. Add `WhatsAppChannelCreateRequestSchema` and `WhatsAppChannelUpdateRequestSchema` to `packages/contracts/src/channel-schema.ts`; the update schema must allow only optional trimmed `displayName` and `accessToken`, require at least one field at the service boundary, and never accept `phoneNumberId`, `metaAppId`, `workspaceId`, `status`, or `inboxId`.

In `provider-schema.ts`, add tolerant Effect schemas for only the consumed WhatsApp data: object discriminator, entries/changes, `metadata.phone_number_id`, contacts `wa_id/profile.name`, text messages (`id`, `from`, epoch-seconds `timestamp`, `type`, `text.body`), and Graph send response `{ messages?: [{ id?: string }], error?: { message?: string; code?: number } }`. Model unknown provider extensions as optional/ignored, not as `Schema.Unknown` for fields the Worker consumes.

**Step 4: Run to verify pass.**

Run:

```bash
cd packages/contracts && bun run build && bun test src/types/index.test.ts src/channel-schema.test.ts
```

Expected: build exits 0 and both focused test files pass.

**Step 5: Commit.**

```bash
git add packages/contracts/src/types/index.ts packages/contracts/src/channel-schema.ts packages/contracts/src/provider-schema.ts packages/contracts/src/types/index.test.ts packages/contracts/src/channel-schema.test.ts
git commit -m "feat: define WhatsApp channel contracts"
```

---

### Task 3: Implement the pure WhatsApp adapter

**Objective:** Normalize only valid inbound text messages and send text messages through a structural, Worker-independent adapter.

**Files:**
- Create: `packages/channel/src/whatsapp.ts`
- Modify: `packages/channel/src/types.ts`
- Modify: `packages/channel/src/index.ts`
- Test: `packages/channel/src/whatsapp.test.ts` (new)

**Step 1: Write failing adapter tests.**

Cover these cases with mocked `fetch`:

1. One valid text payload normalizes to a `NormalizedInbound` with `channel: "whatsapp"`, `conversationId: "wa:phone-123:15551234567"`, `providerMessageId` from `messages[].id`, ISO timestamp from epoch seconds, contact `wa_id`, profile name in payload, and text body.
2. A `statuses[]`-only delivery returns `[]`; it is acknowledged by the route but never becomes an inbound conversation.
3. Non-text types (`image`, `unsupported`) return `[]`.
4. A successful `POST https://graph.facebook.com/<version>/phone-123/messages` sends exactly:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "15551234567",
  "type": "text",
  "text": { "preview_url": false, "body": "Hello" }
}
```

and returns the provider `messages[0].id`.
5. Network/JSON ambiguity returns `failureKind: "uncertain"`; 4xx Graph errors return `failureKind: "definitive"`; no adapter retries a provider call.
6. Empty text, text over the documented provider limit selected for this release, and any attachment return a definitive local failure.

**Step 2: Run to verify failure.**

Run:

```bash
cd packages/channel && bun test src/whatsapp.test.ts
```

Expected: FAIL because the adapter and `whatsappAccessToken` context do not exist.

**Step 3: Implement minimally.**

Extend `OutboundContext` in `packages/channel/src/types.ts`:

```ts
/** WhatsApp Cloud API: bearer token and receiving business phone-number ID. */
whatsapp?: { accessToken: string; phoneNumberId: string };
```

Create `packages/channel/src/whatsapp.ts` with an exported `WHATSAPP_GRAPH_VERSION` constant, `normalizeWhatsAppWebhook`, and `whatsappAdapter`. Keep all Graph version construction in this module. The send function must set `Authorization: Bearer <token>` as a header, never encode the bearer token in the URL, never log it, and parse the response through the shared Effect schema. Add `export * from "./whatsapp";` to the channel package index.

Do not implement media acquisition in this task. The adapter must reject `attachments?.length` with `"WhatsApp attachments are not supported"`; this prevents the shared composer from accepting content it cannot deliver.

**Step 4: Run to verify pass.**

Run:

```bash
cd packages/channel && bun test src/whatsapp.test.ts && bun run build
```

Expected: both commands exit 0.

**Step 5: Commit.**

```bash
git add packages/channel/src/types.ts packages/channel/src/whatsapp.ts packages/channel/src/whatsapp.test.ts packages/channel/src/index.ts
git commit -m "feat: add WhatsApp Cloud API adapter"
```

---

### Task 4: Add secure service-level channel lifecycle operations

**Objective:** Provide create, update, disconnect, remove, and revival semantics with workspace ownership, Meta validation, encryption, and Inbox invariants enforced below routes.

**Files:**
- Create: `apps/worker/src/whatsapp.ts`
- Modify: `apps/worker/src/manage.ts:688-988`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing service tests.**

Add a `describe("WhatsApp channel lifecycle")` block proving:

- Owner/Admin can create an active channel linked to an active inbox; Member and outsider receive the established `ManageError` 403/404 behavior.
- Creation calls the provider validation helper with the submitted Phone Number ID/token, persists only `enc:v1:` ciphertext, derives/stores the provider display number/name as display metadata, and inserts exactly one default Inbox link.
- A second active channel for the same Phone Number ID in either workspace yields 409 without leaking the other workspace.
- Update changes only display name and/or encrypted token; it rejects empty updates and does not mutate external ID, Meta App, or status.
- Disconnect clears credential state and blocks outbound; remove clears credential and `meta_app_id`, unlinks inboxes, marks deleted, and leaves conversation rows untouched.
- Recreate of a deleted same-workspace Phone Number ID reuses its ID and history but restores active credentials/default Inbox; a foreign active ID remains rejected.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
```

Expected: FAIL because WhatsApp service functions and validation helper are missing.

**Step 3: Implement the provider validator and lifecycle service.**

In new `apps/worker/src/whatsapp.ts`, implement `validateWhatsAppPhoneNumber(phoneNumberId, accessToken)`. It must call the current documented `GET /{phone_number_id}` Graph endpoint with `Authorization: Bearer`, a 3-second timeout, and fields sufficient to confirm returned ID plus a display label. Return only `{ phoneNumberId, displayName }`; translate all provider details into a generic `ManageError("WhatsApp phone number validation failed", 400)` at the service boundary. Never log the raw response or token.

In `apps/worker/src/manage.ts`, add:

```ts
export async function createWhatsAppChannel(
  env: Env,
  workspaceId: string,
  input: WhatsAppChannelCreateRequest,
  actorUserId: string,
): Promise<ChannelSummary>

export async function updateWhatsAppChannel(
  env: Env,
  workspaceId: string,
  channelId: string,
  input: WhatsAppChannelUpdateRequest,
  actorUserId: string,
): Promise<ChannelSummary>

export async function deleteWhatsAppChannel(
  env: Env,
  workspaceId: string,
  channelId: string,
  actorUserId: string,
): Promise<void>
```

Use `requireAdminAccess` (Owner or Administrator) consistently with configuration policy; validate the selected inbox and selected `metaApps` row in the same workspace before encrypting/persisting. Reuse `encryptChannelToken`, `disconnectChannel` behavior, and `env.DB.batch` atomic insert-or-revive plus Inbox-link write. Do not widen `connectChannelToken`: it validates a Facebook page and must remain Facebook-specific. Make `disconnectChannel` accept both `facebook_page` and `whatsapp_phone` only after adding a regression proving it cannot change an email row.

**Step 4: Run to verify pass.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
```

Expected: exit 0, including the new lifecycle and existing Facebook/email regression cases.

**Step 5: Commit.**

```bash
git add apps/worker/src/whatsapp.ts apps/worker/src/manage.ts apps/worker/test/routing.test.ts
git commit -m "feat: manage WhatsApp channel lifecycle"
```

---

### Task 5: Expose authenticated REST routes and signed WhatsApp webhook ingress

**Objective:** Mount explicit workspace-scoped management routes and a Meta-verified webhook that cannot be used to discover or create tenant state.

**Files:**
- Modify: `apps/worker/src/index.ts:20-101,952-1204,1215-1289`
- Test: `apps/worker/test/routing.test.ts`
- Test: `apps/worker/test/whatsapp-webhook.test.ts` (new)

**Step 1: Write failing route/webhook tests.**

Test source-level canonical route registration and service-level behavior for:

```text
POST   /api/workspaces/:workspaceId/whatsapp-channels
PATCH  /api/workspaces/:workspaceId/whatsapp-channels/:channelId
DELETE /api/workspaces/:workspaceId/whatsapp-channels/:channelId
GET    /webhooks/whatsapp/:metaAppId
POST   /webhooks/whatsapp/:metaAppId
```

In Miniflare/Hono tests, assert:

- All management operations require a session plus membership before accessing resources; only owner/admin succeeds.
- Route bodies use `decodeJsonBody` with the new schemas; unknown fields cannot set workspace, status, phone number ID, or Meta App.
- GET verifies `hub.mode=subscribe`, `hub.verify_token` against the selected Meta App’s stored token hash, and returns `hub.challenge`; wrong/missing values return 403.
- POST rejects malformed JSON, wrong object discriminator, a missing/invalid `x-hub-signature-256`, an inactive/missing channel, a phone number associated with a different Meta App, and a batch where any phone ID is unauthorized. It returns 200 only after valid signed messages are handed to ingress.
- A valid signed text message leads to exactly one route call per normalized message; replay safety is covered in Task 6.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-webhook.test.ts
```

Expected: FAIL because none of the routes or WhatsApp signature/identity checks exist.

**Step 3: Implement routes and webhook verification.**

Import the WhatsApp schemas/functions and mount the three management routes adjacent to the existing Facebook channel routes. Each route must derive both actor and `workspaceId` from the authenticated request/session, call `requireWorkspaceAccess` before the service, use `manageError`, and return `{ channel }` with 201 for create, `{ channel }` for update, and `{ success: true }` for delete.

Add `verifyWhatsAppSignature` beside `verifyMessengerSignature`; it must:

1. Parse only enough raw JSON to extract every non-empty `metadata.phone_number_id`.
2. Require `object === "whatsapp_business_account"` and at least one phone number.
3. Query only active `whatsapp_phone` channels linked to the path `metaAppId` and require an exact set match for every extracted phone ID.
4. Decrypt only the matched Meta App secret(s) using `CHANNEL_TOKEN_ENCRYPTION_KEY` and call the existing constant-time `verifyFacebookSignatureForSecrets` helper over the original raw body.

For GET verification, query the path Meta App in a constant-shape lookup, then compare the supplied token’s SHA-256 with `webhook_verify_token_hash` using a timing-safe comparison helper. Do not return whether the app/channel exists. For POST, normalize with `whatsappAdapter.normalizeInbound` and invoke `routeInbound` sequentially with `c.executionCtx.waitUntil` only if the existing Messenger path already has the same durable error-handling contract; otherwise await it so failures are observable and Meta can retry. Add a comment that `statuses[]` are deliberately acknowledged but not projected in this release.

**Step 4: Run to verify pass.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-webhook.test.ts
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
```

Expected: both commands exit 0; invalid signatures/configuration return 403 and valid signed text is accepted.

**Step 5: Commit.**

```bash
git add apps/worker/src/index.ts apps/worker/test/whatsapp-webhook.test.ts apps/worker/test/routing.test.ts
git commit -m "feat: add WhatsApp webhook and channel routes"
```

---

### Task 6: Route WhatsApp inbound messages and outbound replies end-to-end

**Objective:** Preserve the established D1/DO idempotency and outbound state-machine guarantees for WhatsApp conversations.

**Files:**
- Modify: `apps/worker/src/ingest.ts:30-370,437-520`
- Modify: `apps/worker/src/outbound.ts:1-508`
- Test: `apps/worker/test/whatsapp-ingress.test.ts` (new)
- Test: `apps/worker/test/outbound.test.ts` (create or extend the existing focused outbound suite)

**Step 1: Write failing end-to-end service tests.**

Use the existing Miniflare D1 fixture and a mocked Conversation DO/fetch to prove:

- A configured active WhatsApp channel finds its default Inbox by Phone Number ID, creates a contact identity scoped to that channel and a conversation `wa:<phoneNumberId>:<waId>`, then appends one canonical `channel: "whatsapp"` Message.
- The same `wamid` replay does not repeat rules or append a second message.
- An inactive/deleted phone number, a missing default Inbox, and an unconfigured Phone Number ID fail closed and never create a channel/contact/conversation.
- An inbound WhatsApp profile name populates only an empty `contacts.display_name` and never overwrites an existing user-known name.
- Outbound lookup decrypts only the selected WhatsApp channel token, sends to the contact’s `wa_id`, creates the D1 intent before the provider call, records the returned `wamid`, appends exactly one canonical outbound message after acceptance, and fences ambiguous failures as `uncertain` without retrying the provider.
- WhatsApp attachments fail before provider dispatch; email and Facebook attachment paths retain their existing passing behavior.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/outbound.test.ts
```

Expected: FAIL because `routeInbound`, contact union types, and `resolveProviderContext` do not recognize WhatsApp.

**Step 3: Implement the minimal channel-specific branches.**

In `ingest.ts`:

- Map parsed canonical `"whatsapp"` to persisted `"whatsapp_phone"`.
- Resolve only `channels.type='whatsapp_phone'`, `channels.external_id=parsed.left`, and `status='active'`; then require its active default Inbox exactly as for Facebook.
- Extend `getOrCreateContact`’s channel type union. Accept an optional provider profile record and use it only to fill a null `displayName`; keep email `primaryEmail` behavior email-only.
- Permit no attachments in WhatsApp traffic during this increment. Do not reuse Messenger image-copy code for a WhatsApp media ID.
- Pass `channelType: "whatsapp_phone"` to rules. Rules should continue to evaluate `channel.type` using the stored string.

In `outbound.ts`:

- Import `whatsappAdapter`.
- Add the `channel.type === "whatsapp_phone"` branch before email metadata lookup. Decrypt the channel token, return an error if absent/unreadable, and call:

```ts
send: (message) =>
  whatsappAdapter.sendOutbound(
    { whatsapp: { accessToken, phoneNumberId: channel.externalId } },
    message,
  ),
```

- Do not apply email reply-identity checks to WhatsApp. Keep the D1-before-provider intent sequence, provider acceptance persistence, and DO reconciliation unchanged.

**Step 4: Run to verify pass.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/outbound.test.ts
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
```

Expected: all exit 0; replay produces one message, outbound is persisted before dispatch, and unsupported attachments do not reach Meta.

**Step 5: Commit.**

```bash
git add apps/worker/src/ingest.ts apps/worker/src/outbound.ts apps/worker/test/whatsapp-ingress.test.ts apps/worker/test/outbound.test.ts
git commit -m "feat: route WhatsApp conversations and replies"
```

---

### Task 7: Carry WhatsApp through lists, filters, and the sidebar

**Objective:** Ensure WhatsApp conversations are visible and filterable without mislabeling or double-counting channel groups.

**Files:**
- Modify: `apps/worker/src/queries.ts:55-195,302-321`
- Modify: `apps/worker/src/workspace-api.ts:310-366`
- Modify: `apps/worker/src/index.ts:392-457`
- Modify: `packages/contracts/src/types/index.ts` (only if a remaining filter union was missed)
- Test: `apps/worker/test/routing.test.ts`
- Test: `apps/worker/test/sidebar.test.ts` (create/extend the current sidebar service test file)

**Step 1: Write failing visibility tests.**

Create one active Facebook, one WhatsApp, and one email conversation in a workspace. Assert:

- `GET/listConversations` maps persisted `whatsapp_phone` to canonical `channel: "whatsapp"`.
- `channel=whatsapp` returns only WhatsApp rows; Facebook/email filters retain their existing results.
- The sidebar has a `channel-group:whatsapp` node labelled `WhatsApp`, whose descendant leaves use the server-provided WhatsApp filter and whose counts include only WhatsApp conversations in readable Inbox scope.
- A restricted WhatsApp Inbox does not leak its channel/label/count to an unauthorized member.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
cd apps/worker && bun test --max-concurrency=1 test/sidebar.test.ts
```

Expected: FAIL because current unions and explicit channel-group arrays omit WhatsApp.

**Step 3: Implement all discriminant branches.**

Update `ConversationRow`, `ConversationListOptions`, `toSummary`, list-query filter validation in `index.ts`, and the `workspace-api.ts` channel-group tuple/map to include this exact mapping:

```ts
const channelGroups = (["facebook_page", "whatsapp_phone", "email"] as const);

const channelLabel = {
  facebook_page: "Facebook",
  whatsapp_phone: "WhatsApp",
  email: "Email",
} as const;

const canonicalChannel = {
  facebook_page: "facebook",
  whatsapp_phone: "whatsapp",
  email: "email",
} as const;
```

Use the mapping rather than nested ternaries so all three views agree. Preserve mailbox-specific filtering as email-only; a WhatsApp row must bypass `getMailboxAccessByAddress` just as Facebook does.

**Step 4: Run to verify pass.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
cd apps/worker && bun test --max-concurrency=1 test/sidebar.test.ts
```

Expected: both exit 0, with correct counts and no restricted Inbox disclosure.

**Step 5: Commit.**

```bash
git add apps/worker/src/queries.ts apps/worker/src/workspace-api.ts apps/worker/src/index.ts packages/contracts/src/types/index.ts apps/worker/test/routing.test.ts apps/worker/test/sidebar.test.ts
git commit -m "feat: expose WhatsApp conversations in inbox views"
```

---

### Task 8: Add the Settings add/update/remove experience

**Objective:** Let authorized operators create, rotate, rename, disconnect, remove, and reroute WhatsApp channels from the existing Settings → Channels surface.

**Files:**
- Modify: `apps/web/src/lib/api.ts:98-132,239-264`
- Modify: `apps/web/src/routes/settings.tsx:157-175`
- Modify: `apps/web/src/routes/-settings.contract.test.tsx`
- Test: `apps/web/src/routes/-settings.whatsapp.test.tsx` (new, route-adjacent dash-prefixed test)

**Step 1: Write failing UI/API tests.**

Mock API calls and verify:

- The Channels tab shows `Add WhatsApp channel` beside the existing Facebook Page flow, not as a replacement for it.
- The form requires Meta App, active Inbox, Phone Number ID, display name, and access token; it submits exactly `api.createWhatsAppChannel(workspaceId, { phoneNumberId, displayName, accessToken, inboxId, metaAppId })`.
- A WhatsApp row labels itself `WhatsApp`, never exposes token material, offers `Edit`, `Rotate token`, `Disconnect`, `Set default Inbox`, and `Remove WhatsApp`; it does not render Facebook Page terminology.
- Edit submits only `{ displayName }` and/or `{ accessToken }`; default Inbox calls the existing `api.setDefaultInbox`; removal calls `api.deleteWhatsAppChannel` after a destructive confirmation that says history is retained.
- Successful mutations invalidate the exact workspace-scoped `["channels", workspaceId]` and `["inboxes", workspaceId]` queries. Rejection is rendered through the existing alert component.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/web && bunx vitest run src/routes/-settings.contract.test.tsx src/routes/-settings.whatsapp.test.tsx
```

Expected: FAIL because the API facade and Settings controls do not exist.

**Step 3: Implement the API facade and UI.**

Add exact facade methods in `apps/web/src/lib/api.ts`:

```ts
createWhatsAppChannel(workspaceId: string, body: {
  phoneNumberId: string;
  displayName: string;
  accessToken: string;
  inboxId: string;
  metaAppId: string;
}) {
  return request<{ channel: ChannelSummary }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/whatsapp-channels`,
    { method: "POST", body: JSON.stringify(body) },
  );
},

updateWhatsAppChannel(workspaceId: string, channelId: string, body: {
  displayName?: string;
  accessToken?: string;
}) {
  return request<{ channel: ChannelSummary }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/whatsapp-channels/${encodeURIComponent(channelId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
},

deleteWhatsAppChannel(workspaceId: string, channelId: string) {
  return request<{ success: true }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/whatsapp-channels/${encodeURIComponent(channelId)}`,
    { method: "DELETE" },
  );
},
```

Keep `ChannelRow` type-discriminated. Do not call the generic Facebook `connectChannel` token endpoint for WhatsApp. Reuse existing `Card`, `Field`, `Input`, `Select`, `Button`, `Alert`, `useMutation`, and `confirm` patterns; do not redesign Settings or introduce a new modal framework. The phone-number ID and Meta App must be rendered as immutable metadata after creation. Use `type="password"` only for a new/rotated token field and clear it after a successful mutation.

**Step 4: Run to verify pass.**

Run:

```bash
cd apps/web && bunx vitest run src/routes/-settings.contract.test.tsx src/routes/-settings.whatsapp.test.tsx
cd apps/web && bun run build
```

Expected: both test files pass and the web build exits 0 with no TypeScript errors.

**Step 5: Commit.**

```bash
git add apps/web/src/lib/api.ts apps/web/src/routes/settings.tsx apps/web/src/routes/-settings.contract.test.tsx apps/web/src/routes/-settings.whatsapp.test.tsx
git commit -m "feat: manage WhatsApp channels in settings"
```

---

### Task 9: Document operator setup and decision boundaries

**Objective:** Make deployment and product limitations explicit before any real Meta credentials or webhook configuration is attempted.

**Files:**
- Modify: `CONTEXT.md:67-75,100-119`
- Create: `docs/adr/0027-whatsapp-cloud-api-channel.md` (unless a project ADR numbering audit identifies the next available number differs)
- Modify: `docs/runbooks/deploy-msgflow-cloudflare.md` (if present; otherwise create `docs/runbooks/whatsapp-cloud-api.md`)
- Test: no code test; use documentation review plus final checks.

**Step 1: Write a checklist-oriented documentation test/review note.**

Add an ADR acceptance checklist that requires the implementation to prove: global active Phone Number ID uniqueness, raw-body signature validation before parsing/route ingress, encryption at rest, no token in API/list/log output, soft deletion/history retention, and no tenant bootstrap from a webhook.

**Step 2: Verify the new documentation is absent/incomplete.**

Run:

```bash
rg -n "WhatsApp Cloud API|whatsapp_phone|webhooks/whatsapp" CONTEXT.md docs
```

Expected: no complete operator runbook/ADR exists before this task.

**Step 3: Document exact operator actions and product limits.**

The runbook must instruct an operator to:

1. Create/select the Meta App and enter its App ID/App Secret in MsgFlow Settings; preserve the one-time generated webhook verify token securely.
2. Create the WhatsApp channel with the Meta Phone Number ID, selected MsgFlow Meta App, long-lived/system-user access token, and destination Inbox.
3. Configure the WhatsApp product webhook callback as `https://<deployment-host>/webhooks/whatsapp/<msgflow-meta-app-id>` and use the generated verify token; subscribe to `messages`.
4. Confirm the deployed Worker is reachable over HTTPS, then send one inbound text and reply within the provider’s customer-service window.
5. Rotate/revoke credentials in Settings when needed; remove channels only through the soft-delete control.

State explicitly: production operators configure Meta dashboard/webhook settings manually; this release neither provisions Meta assets nor supports templates/media/status projection; a 200 webhook response means MsgFlow accepted processing, not customer delivery.

**Step 4: Verify documentation.**

Run:

```bash
rg -n "WhatsApp Cloud API|Phone Number ID|webhooks/whatsapp|customer-service window|soft-delete" CONTEXT.md docs/adr docs/runbooks
```

Expected: output includes all required concepts and no credential examples.

**Step 5: Commit.**

```bash
git add CONTEXT.md docs/adr/0027-whatsapp-cloud-api-channel.md docs/runbooks/whatsapp-cloud-api.md
git commit -m "docs: document WhatsApp Cloud API channel"
```

If the repository already has `docs/runbooks/deploy-msgflow-cloudflare.md`, stage that exact existing file instead of a duplicate new runbook.

---

### Task 10: Rebuild, run the full regression suite, and verify the Worker bundle

**Objective:** Verify the integrated feature without contacting Meta or mutating remote Cloudflare resources.

**Files:** No new implementation files; fix only failures caused by the WhatsApp change, following the prior task boundaries.

**Step 1: Rebuild workspace contracts before Worker checks.**

Run:

```bash
cd packages/contracts && bun run build
cd ../channel && bun run build
```

Expected: both exit 0 so Worker resolution cannot use stale package `dist` declarations.

**Step 2: Run serialized Worker tests.**

Run each affected Miniflare file separately:

```bash
cd apps/worker && bun test --max-concurrency=1 test/routing.test.ts
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-webhook.test.ts
cd apps/worker && bun test --max-concurrency=1 test/whatsapp-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/provider-identity-migrations.test.ts
```

Expected: every command exits 0. If an existing unrelated suite cannot load, report the named stale import/test blocker rather than changing unrelated transport code.

**Step 3: Run repository-level quality gates.**

Run:

```bash
cd /Users/dark/Documents/Projects/MsgFlow && bun run lint && bun run build && bun run test
cd apps/worker && bunx wrangler deploy --dry-run
```

Expected: lint/build/test exit 0. The dry run exits 0 and prints the existing D1, Durable Object, Email, and R2 bindings; it must not require or add a new binding for WhatsApp.

**Step 4: Review the exact change surface.**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD
```

Expected: `git diff --check` has no output. Confirm only intended WhatsApp files plus pre-existing user changes are modified; do not stage or amend unrelated work.

**Step 5: Commit only remaining verification fixes.**

If and only if this task required WhatsApp-specific fixes:

```bash
git add <exact WhatsApp files fixed in this task>
git commit -m "test: verify WhatsApp channel integration"
```

Otherwise make no empty commit.

---

## Tests / validation summary

Follow TDD for every code task: add the focused failing test first, run it and observe the named missing behavior, implement only enough code to pass, rerun that focused test, then commit the isolated task. The final acceptance suite must prove:

- Create, rename/token-rotate, disconnect, default-Inbox reassignment, soft-delete, and same-workspace revival of a WhatsApp channel.
- Owner/admin-only management and no cross-workspace Phone Number ID ambiguity.
- Tokens persist only as encrypted ciphertext and never appear in list/API/UI results.
- Valid signed Cloud API text payloads create one canonical WhatsApp conversation/message; invalid/foreign/malformed/replayed payloads fail closed or deduplicate.
- Outbound text persists intent before provider dispatch and never provider-retries ambiguous outcomes.
- WhatsApp filters/sidebar labels/counts are correct and obey Inbox authorization.
- Existing Facebook Messenger and email behavior remains green.
- `bun run lint`, `bun run build`, `bun run test`, and Worker `wrangler deploy --dry-run` pass.

## Risks, tradeoffs, and open questions

- **Meta App webhook configuration:** A Meta App may host Messenger and WhatsApp products, but this plan uses a WhatsApp-specific callback path containing MsgFlow’s internal Meta App ID. Confirm in the target Meta dashboard that the selected product accepts this callback URL without replacing required Messenger configuration. If Meta requires one app-global callback URL, replace the two product routes with one authenticated Meta dispatcher before deployment; do not configure two competing URLs.
- **24-hour/customer-service window:** Free-form replies can be rejected outside Meta’s allowed window. This release surfaces the provider error; template selection/approval is intentionally a later feature.
- **Phone number validation:** The exact Graph fields/version change over time. Recheck current official Meta docs immediately before implementation and keep version/field selection in `packages/channel/src/whatsapp.ts`, not scattered through services.
- **Media and interactive messages:** WhatsApp media uses provider media IDs and authenticated download/upload flows, unlike existing public Messenger image URLs. Supporting it safely needs a separate R2/privacy/design slice; do not quietly treat unknown inbound types as text.
- **Delivery statuses:** `statuses[]` are acknowledged but not projected into `outbound_intents`. Adding delivery/read/failed status updates later needs a provider-message-id lookup plus a durable audit/state transition design.
- **Meta credential lifecycle:** Validate that the selected long-lived/system-user token has only required WhatsApp permissions and a rotation process. Never put it in `wrangler.toml`, test fixtures committed to the repository, console output, or browser state.
- **Pre-existing worktree changes:** This plan assumes the implementer will preserve the current unrelated changes and use narrow commits. Resolve conflicts with the author before touching overlapping Settings, Worker routing, or contract files.
