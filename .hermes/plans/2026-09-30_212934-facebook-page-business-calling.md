# Facebook Page Business Calling Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to execute this plan task-by-task, with a spec-compliance and code-quality review after each commit.

**Goal:** Add inbound, audio-only Messenger Business Calling for connected Facebook Page channels, routed through configurable Team-backed Call Queues and Ring Groups to an in-browser Agent softphone.

**Architecture:** Add Call Queue configuration and call audit state to D1, while using two new Durable Object classes: one Workspace-scoped dispatch DO maintains authenticated browser call sockets and immediate availability, and one Call Session DO serializes a single Meta call’s queue progression, accept race, 60-second deadline, and WebRTC signaling. The browser owns `RTCPeerConnection` and microphone media; the Worker owns Page-token decryption, Graph API requests, Meta webhook verification, authorization, durable configuration/audit, and forwarding only the required SDP between the browser and Meta.

**Tech stack:** Bun monorepo, TypeScript, Hono, Cloudflare Workers + Durable Objects + D1/Drizzle, React/TanStack Query/Router, Effect Schema, Vitest, Biome, Meta Messenger Business Calling API.

---

## Current context / confirmed product decisions

- This targets the **Messenger Business Calling API for Facebook Page channels**, not WhatsApp Calling. A Page must first be eligible for `messenger_api_calling`, and the Meta App must subscribe to the `calls` webhook field. Meta gives the business 60 seconds to accept an inbound consumer call.
- v1 is **consumer-to-business, audio-only**. Do not implement outbound calls, video, SIP/PBX integration, recordings, voicemail, IVR/DTMF, call transfers, callback scheduling, agent wrap-up, skills routing, longest-idle, or analytics dashboards.
- `RingGroup` and `CallQueue` are distinct domain resources:
  - A Ring Group selects members of one existing Team and uses `simultaneous` or durable `round_robin` ringing.
  - A Call Queue belongs to one Workspace, is assigned to one active Facebook Page Channel, contains ordered Ring Group stages, and has per-stage ring durations.
  - Each active Page Channel has at most one Call Queue. A Queue has a Team and can only reference Ring Groups for that Team.
- Agents opt into calls with Workspace-scoped `available | away | offline` state. Only **available** Team members with a live dispatch socket can ring. Closing the browser socket marks the Agent offline immediately; heartbeats expire stale state.
- Admins configure Ring Groups, Queue stage order/timeouts, business hours, and no-agent reply text. The sum of stage durations is capped at 50 seconds, leaving a 10-second buffer before Meta’s 60-second deadline; default stage duration is 15 seconds.
- The Queue advances only within that 50-second window. The first successful Agent accept wins atomically, becomes the Conversation Assignee, and is the only Agent allowed to establish or control the call. An Agent reject removes only that Agent from the current attempt; remaining eligible members continue to ring.
- For an inbound call, resolve the Page-scoped Facebook Contact by PSID. Reuse that Contact’s most recent open Conversation for the Page; otherwise create a new Conversation in the Page’s default Inbox. Record Call Activities, never synthetic customer-facing Messages.
- When no Agent can accept, reject/timeout/terminate the call, create an immutable Call Activity. Do not record audio. When delivery is permitted by Messenger policy, send the Queue’s configured no-agent text through the existing Messenger outbound adapter and record the result in the Activity.
- The web app must expose a global, accessible incoming-call overlay on every authenticated Workspace route, play a local ringtone, offer Accept/Reject, navigate the winning Agent to the Conversation, and show an audio call panel with microphone permission, mute, elapsed time, and hang-up.
- Submit the smallest supported Meta call-quality payload after a connected call, derived from `RTCPeerConnection.getStats()`. Keep only an aggregate result/error in the Call Activity; do not persist raw stats.

## Mandatory implementation boundaries

- Preserve `CONTEXT.md` terms: Page is a `facebook_page` Channel, Conversation status remains `open | archived`, customer-facing Messages cannot represent call events, and Activities remain siblings in the Conversation DO timeline.
- Do not use the existing `ConversationDO` as a call queue or global socket bus; it is authorized only after a Conversation has been selected and exists to own its timeline. The new global dispatch/session DO classes have a separate, explicit authorization contract.
- Page tokens and Meta App secrets remain encrypted at rest and are decrypted only in Worker provider calls. Browser code must never receive Page access tokens, App secrets, raw Meta webhook payloads, or Graph API credentials.
- Set the Page call routing to Meta `PARTNERS` only after an eligible Queue has been enabled and the App subscription/operator checklist is complete. A failed Graph call must leave the Queue disabled; do not falsely report Page calling active.
- Treat Meta webhook delivery as at-least-once. Store a provider call/event idempotency key before creating Activities, queue state, or sending a no-agent reply.
- Keep the selected Workspace explicit in every HTTP route, WebSocket URL, React Query key, D1 query, and DO authorization check. A guessed queue/call/conversation ID must not disclose data across Workspaces.

## References to verify at implementation time

- Meta Calling overview: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/calling`
- Consumer-to-business calls: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/calling/consumer2biz`
- Call settings/routing: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/calling/callsettings`
- JavaScript/WebRTC integration: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/calling/jsintegration`
- Existing Meta ingress: `apps/worker/src/index.ts:2398-2450`, `apps/worker/src/webhook.ts`, `packages/channel/src/facebook.ts`
- Existing Page-channel lifecycle: `apps/worker/src/meta-apps.ts`, `apps/worker/src/meta-oauth.ts`, `apps/worker/src/index.ts`, `apps/web/src/routes/settings.tsx`
- Existing timeline Activity seam: `apps/worker/src/activity.ts`, `apps/worker/src/conversation-do.ts`, `packages/contracts/src/types/index.ts:59-73`

---

## Step-by-step tasks

### Task 1: Record the irreversible calling model and vocabulary

**Objective:** Document the chosen Page-only calling model before schema or runtime work so later implementation does not regress into WhatsApp or a generic PBX abstraction.

**Files:**
- Modify: `CONTEXT.md`
- Create: `docs/adr/0027-facebook-page-business-calling.md`
- Test: none (documentation-only task)

**Step 1: Add glossary entries to `CONTEXT.md` after `Page`.**

Add these domain definitions verbatim, adjusting only heading position to match the existing glossary:

```md
**Call Queue**:
A Workspace-owned routing configuration for inbound calls to exactly one Facebook Page Channel. It selects one Team, an ordered list of Ring Group stages with bounded ring durations, business hours, and a no-agent Messenger reply. It is not an Inbox and does not change message routing.

**Ring Group**:
A Workspace-owned, Team-scoped subset of Agents that may receive a Call Queue stage. Its strategy is simultaneous or round-robin. It is not an Inbox membership grant.

**Call Presence**:
An Agent's explicit Workspace-scoped willingness and live ability to receive a business call: available, away, or offline. Only an available Agent with an authenticated live call-dispatch connection is eligible.

**Call Activity**:
An immutable system Activity attached to a Conversation that records an inbound business-call lifecycle event, routing outcome, and non-sensitive aggregate quality result. It is never a customer-facing Message and never includes call audio.
```

**Step 2: Write `docs/adr/0027-facebook-page-business-calling.md`.**

Include: Context, Decision, Consequences, and Rejected alternatives. The Decision must explicitly state:

```md
- Messenger Business Calling API is supported only for active `facebook_page` Channels.
- v1 accepts consumer-initiated, audio-only calls through a browser WebRTC peer.
- D1 owns Queue/Ring Group configuration, call audit/idempotency, and availability state; a Call Session DO serializes one call and a Workspace Call Dispatch DO owns global call sockets.
- Queue routing has a 50-second configurable maximum under Meta's 60-second inbound accept deadline.
- Activity records replace synthetic Message records; recordings and SIP/media-server holding audio are out of scope.
```

**Step 3: Review documentation consistency.**

Run: `git diff --check && git diff -- CONTEXT.md docs/adr/0027-facebook-page-business-calling.md`

Expected: exit 0; the diff uses Page/Conversation/Activity/Agent terminology consistently and does not mention WhatsApp Calling.

**Step 4: Commit.**

```bash
git add CONTEXT.md docs/adr/0027-facebook-page-business-calling.md
git commit -m "docs: define Facebook Page business calling model"
```

---

### Task 2: Add queue, ring group, presence, and call audit persistence

**Objective:** Create the D1 schema that enforces same-Workspace/Team relationships and makes inbound call handling idempotent.

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0028_facebook_page_calling.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `apps/worker/test/facebook-calling-migration.test.ts`

**Step 1: Write failing migration tests.**

Create a Miniflare/D1 test that applies the full migration chain and asserts all of the following with raw SQL:

```ts
expect(await tableExists("call_queues")).toBe(true);
expect(await tableExists("ring_groups")).toBe(true);
expect(await tableExists("ring_group_members")).toBe(true);
expect(await tableExists("agent_call_presence")).toBe(true);
expect(await tableExists("call_events")).toBe(true);

await expect(insertForeignWorkspaceQueue()).rejects.toThrow(/workspace|queue/i);
await expect(insertRingGroupMemberOutsideQueueTeam()).rejects.toThrow(/team|member/i);
await expect(insertSecondEnabledQueueForPage()).rejects.toThrow(/unique/i);
await expect(insertDuplicateMetaCallEvent()).rejects.toThrow(/unique/i);
```

The fixture must create two Workspaces, two Teams, two active Facebook Page channels, and each corresponding `team_members` row. Use the existing serial Miniflare helper; do not invent a parallel test harness.

**Step 2: Run the focused test to verify failure.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-migration.test.ts`

Expected: FAIL because `call_queues` and the migration do not exist.

**Step 3: Add Drizzle tables and migration.**

Add these table shapes in `packages/db/src/schema.ts`; use the project’s UUID/text timestamp conventions and foreign keys with `restrict` where history must survive:

```ts
export const ringGroups = sqliteTable("ring_groups", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  strategy: text("strategy", { enum: ["simultaneous", "round_robin"] }).notNull(),
  nextMemberCursor: integer("next_member_cursor").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ringGroupMembers = sqliteTable("ring_group_members", {
  id: text("id").primaryKey(),
  ringGroupId: text("ring_group_id").notNull().references(() => ringGroups.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  createdAt: text("created_at").notNull(),
});

export const callQueues = sqliteTable("call_queues", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(false),
  noAgentReplyText: text("no_agent_reply_text").notNull(),
  timezoneId: text("timezone_id").notNull(),
  weeklyOperatingHoursJson: text("weekly_operating_hours_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const callQueueStages = sqliteTable("call_queue_stages", {
  id: text("id").primaryKey(),
  queueId: text("queue_id").notNull().references(() => callQueues.id, { onDelete: "cascade" }),
  ringGroupId: text("ring_group_id").notNull().references(() => ringGroups.id, { onDelete: "restrict" }),
  stageOrder: integer("stage_order").notNull(),
  ringDurationSeconds: integer("ring_duration_seconds").notNull(),
});

export const agentCallPresence = sqliteTable("agent_call_presence", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["available", "away", "offline"] }).notNull().default("offline"),
  socketConnectedAt: text("socket_connected_at"),
  heartbeatExpiresAt: text("heartbeat_expires_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })]);

export const callEvents = sqliteTable("call_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "restrict" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "restrict" }),
  queueId: text("queue_id").references(() => callQueues.id, { onDelete: "restrict" }),
  providerCallId: text("provider_call_id").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  direction: text("direction", { enum: ["consumer_to_business"] }).notNull(),
  state: text("state", { enum: ["ringing", "accepted", "rejected", "timed_out", "terminated", "failed"] }).notNull(),
  acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
  terminalReason: text("terminal_reason"),
  qualitySummaryJson: text("quality_summary_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

In `0028_facebook_page_calling.sql`, add all tables, uniqueness/indexes, and SQLite triggers that reject cross-Workspace and Team violations. At minimum:

```sql
CREATE UNIQUE INDEX idx_call_queues_active_facebook_channel
  ON call_queues(channel_id)
  WHERE is_enabled = 1;
CREATE UNIQUE INDEX idx_call_events_provider_event
  ON call_events(channel_id, provider_event_id);
CREATE UNIQUE INDEX idx_ring_group_members_unique
  ON ring_group_members(ring_group_id, user_id);
CREATE UNIQUE INDEX idx_call_queue_stages_order
  ON call_queue_stages(queue_id, stage_order);
CREATE INDEX idx_agent_call_presence_eligible
  ON agent_call_presence(workspace_id, status, heartbeat_expires_at);
```

Add a `BEFORE INSERT` and corresponding `BEFORE UPDATE` trigger for `call_queues`, `ring_groups`, `ring_group_members`, and `call_queue_stages` to prove all linked objects share the required Workspace and Team. Add a trigger that rejects `ring_duration_seconds < 1`, `ring_duration_seconds > 50`, and a stage sum over 50 seconds. Do not rely only on Drizzle enum declarations.

Add journal entry `idx: 28`, with a `when` timestamp later than `1791331200001`; use the generated migration tag exactly. Do not delete or regenerate old migrations.

**Step 4: Re-run migration test.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-migration.test.ts`

Expected: PASS, including raw SQL rejections for invalid tenant/team/stage rows.

**Step 5: Commit.**

```bash
git add packages/db/src/schema.ts packages/db/migrations/0028_facebook_page_calling.sql packages/db/migrations/meta/_journal.json apps/worker/test/facebook-calling-migration.test.ts
git commit -m "feat(db): add Facebook Page calling persistence"
```

---

### Task 3: Add runtime contracts and strict Meta calling webhook decoding

**Objective:** Define browser-safe request/event contracts and reject malformed or unsupported Page calling payloads before routing.

**Files:**
- Create: `packages/contracts/src/calling-schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/types/index.ts`
- Create: `packages/channel/src/facebook-calling.ts`
- Modify: `packages/channel/src/index.ts`
- Test: `packages/channel/src/facebook-calling.test.ts`

**Step 1: Write failing decoder tests.**

Cover a valid Page `calls` connect event, duplicate provider event id extraction, a `terminate` event, an unrelated Messenger message event, a missing Page ID/PSID/call ID, unknown call event values, and invalid SDP fields. The valid assertion shape is:

```ts
expect(normalizeFacebookCallingWebhook(validConnect)).toEqual([
  expect.objectContaining({
    pageId: "page-1",
    psid: "psid-1",
    providerCallId: "call-1",
    providerEventId: "call-1:connect:1700000000",
    event: "connect",
    direction: "CONSUMER_TO_BUSINESS",
  }),
]);
```

**Step 2: Verify test failure.**

Run: `cd packages/channel && bun test src/facebook-calling.test.ts`

Expected: FAIL because `facebook-calling.ts` and its exported decoder do not exist.

**Step 3: Add minimal contracts and normalizer.**

Create `packages/contracts/src/calling-schema.ts` with Effect `Schema` definitions for client-controlled Queue/Ring Group/presence/accept/reject/hang-up/statistics payloads. Keep server-controlled IDs, provider call IDs, Page IDs, tenant IDs, actor IDs, and timestamps out of client request bodies. Export exact request DTOs for:

```ts
export interface CallPresenceUpdateRequest { status: "available" | "away"; }
export interface CallAcceptRequest { workspaceId: string; callId: string; sdp: string; sdpType: "offer"; }
export interface CallRejectRequest { workspaceId: string; callId: string; }
export interface CallTerminateRequest { workspaceId: string; callId: string; }
export interface CallMetricsRequest { workspaceId: string; callId: string; summary: { durationMs: number; packetsLost?: number; jitterMs?: number; roundTripTimeMs?: number; }; }
```

Create `packages/channel/src/facebook-calling.ts`. It must normalize only `object: "page"` entries that contain a `calls` array; do not modify `normalizeFacebookWebhook()`’s customer-message behavior. Build deterministic provider event IDs from stable provider values only, never `Date.now()`. Return structural data only; it must not call fetch, access a secret, or derive a Workspace.

Add type additions to `packages/contracts/src/types/index.ts`:

```ts
export type CallActivityAction =
  | "call.received" | "call.ringing" | "call.accepted" | "call.rejected"
  | "call.timed_out" | "call.terminated" | "call.no_agent_reply" | "call.quality_reported";
```

Extend `Activity["action"]` with those literals. Export the new schema from `packages/contracts/src/index.ts` and the normalizer from `packages/channel/src/index.ts`.

**Step 4: Build then rerun tests.**

Run:

```bash
cd packages/contracts && bun run build
cd ../channel && bun test src/facebook-calling.test.ts
```

Expected: contracts build exits 0; calling normalizer tests pass.

**Step 5: Commit.**

```bash
git add packages/contracts/src packages/channel/src
git commit -m "feat: add Messenger calling contracts and webhook decoder"
```

---

### Task 4: Build the authorized Queue configuration service and HTTP API

**Objective:** Let Workspace Owners/Admins manage Team-backed Ring Groups and Page Call Queues without allowing cross-tenant or invalid configuration.

**Files:**
- Create: `apps/worker/src/calling-config.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/validation.ts` only if a reusable bounded decoder helper is absent
- Test: `apps/worker/test/calling-config.test.ts`

**Step 1: Write failing service tests.**

Use real Miniflare D1/migrations and cover:

```ts
await expect(createCallQueue(env, foreignWorkspaceId, input, ownerId)).rejects.toMatchObject({ status: 404 });
await expect(createCallQueue(env, workspaceId, { ...input, channelId: emailChannelId }, ownerId)).rejects.toThrow(/Facebook Page/i);
await expect(createRingGroup(env, workspaceId, { teamId, memberIds: [notOnTeam] }, ownerId)).rejects.toThrow(/team member/i);
await expect(updateQueueStages(env, workspaceId, queueId, twoStagesTotaling51Seconds, ownerId)).rejects.toThrow(/50 seconds/i);
await expect(updateQueueStages(env, workspaceId, queueId, validStages, ordinaryMemberId)).rejects.toMatchObject({ status: 403 });
```

Also test a valid Queue list response omits access tokens, Meta App secrets, presence data for other Agents, and internal WebRTC fields.

**Step 2: Run to verify failure.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/calling-config.test.ts`

Expected: FAIL because the service and routes do not exist.

**Step 3: Implement the service and routes.**

`calling-config.ts` must expose only Workspace-scoped service functions. Each must first call the existing access layer with the explicit Workspace and actor. Validate all referenced Team, Team member, Page Channel, Ring Group, and Queue IDs in the same Workspace before insert/update. Reject archived/disconnected/non-Facebook channels. Never reuse `inboxes.assignmentStrategy` for call routing.

Mount these exact HTTP routes in `apps/worker/src/index.ts`; decode bodies once with Effect schemas and preserve established `{ success: false, error }` 400 errors:

```text
GET    /api/workspaces/:workspaceId/calling/ring-groups
POST   /api/workspaces/:workspaceId/calling/ring-groups
PATCH  /api/workspaces/:workspaceId/calling/ring-groups/:ringGroupId
DELETE /api/workspaces/:workspaceId/calling/ring-groups/:ringGroupId
GET    /api/workspaces/:workspaceId/calling/queues
POST   /api/workspaces/:workspaceId/calling/queues
PATCH  /api/workspaces/:workspaceId/calling/queues/:queueId
DELETE /api/workspaces/:workspaceId/calling/queues/:queueId
```

Queue create/update accepts `channelId`, `teamId`, `name`, `timezoneId`, `weeklyOperatingHours`, `noAgentReplyText`, and ordered `{ ringGroupId, ringDurationSeconds }[]`. Enforce 1–50 seconds per stage and a total not greater than 50 before D1 writes; return the normalized Queue summary with no credentials.

**Step 4: Run focused test.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/calling-config.test.ts`

Expected: PASS; no cross-workspace resource can be observed or mutated.

**Step 5: Commit.**

```bash
git add apps/worker/src/calling-config.ts apps/worker/src/index.ts apps/worker/test/calling-config.test.ts packages/contracts/src
git commit -m "feat: manage Facebook Page call queues and ring groups"
```

---

### Task 5: Add Page eligibility and call-setting synchronization

**Objective:** Enable a Queue only after the selected Page is eligible and Meta call settings can route inbound calls to MsgFlow.

**Files:**
- Create: `apps/worker/src/facebook-calling-provider.ts`
- Modify: `apps/worker/src/calling-config.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/facebook-calling-provider.test.ts`

**Step 1: Write failing provider tests with mocked `fetch`.**

Assert the service:

```ts
expect(fetch).toHaveBeenCalledWith(
  "https://graph.facebook.com/v21.0/page-1/business_messaging_feature_status",
  expect.objectContaining({ method: "POST" }),
);
expect(fetch).toHaveBeenCalledWith(
  "https://graph.facebook.com/v21.0/page-1/messenger_call_settings",
  expect.objectContaining({ method: "POST" }),
);
```

Cover disabled eligibility, Graph 4xx, transport/5xx uncertainty, an enabled Page with `call_routing.ring_target = "PARTNERS"`, and a failed settings sync. Assert a failure leaves `call_queues.is_enabled = 0` and does not expose the token in errors or logs.

**Step 2: Run to verify failure.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-provider.test.ts`

Expected: FAIL because the provider module is missing.

**Step 3: Implement minimal provider behavior.**

`facebook-calling-provider.ts` must decrypt the Page token only at the provider call boundary. Implement:

```ts
export async function checkMessengerCallingEligibility(input: {
  pageId: string; pageAccessToken: string;
}): Promise<{ eligible: boolean; error?: string }>;

export async function configureMessengerInboundCalling(input: {
  pageId: string; pageAccessToken: string;
  timezoneId: string; weeklyOperatingHours: unknown;
}): Promise<void>;
```

The second function must POST the documented `call_hours` and `call_routing: { ring_target: "PARTNERS" }` settings. It must never use `me`; use the exact Page ID. Apply reasonable `AbortSignal.timeout` handling and classify an ambiguous provider response as a controlled error requiring retry rather than claiming success.

Add an admin endpoint:

```text
POST /api/workspaces/:workspaceId/calling/queues/:queueId/enable
POST /api/workspaces/:workspaceId/calling/queues/:queueId/disable
```

`enable` performs eligibility, App/Page prerequisite validation, settings synchronization, then flips the Queue enabled in a D1 batch. `disable` first turns queue eligibility off locally, then attempts to restore routing to `META` or hide the Page call icon only if the confirmed product choice requires it; do not silently alter broader Page settings without documenting the operator consequence.

**Step 4: Run focused test.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-provider.test.ts`

Expected: PASS; failed Meta setup cannot create an apparently enabled queue.

**Step 5: Commit.**

```bash
git add apps/worker/src/facebook-calling-provider.ts apps/worker/src/calling-config.ts apps/worker/src/index.ts apps/worker/test/facebook-calling-provider.test.ts
git commit -m "feat: verify and configure Messenger Page calling"
```

---

### Task 6: Add authenticated workspace call dispatch and Agent presence

**Objective:** Deliver inbound call offers to authenticated eligible Agent browsers and keep availability correct on socket close and heartbeat expiry.

**Files:**
- Create: `apps/worker/src/call-dispatch-do.ts`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/wrangler.toml` (or the active Worker config discovered before implementation)
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/call-dispatch-do.test.ts`

**Step 1: Write failing DO tests.**

Test the following with the existing Worker/DO harness:

```ts
expect(await connectWithoutSession()).toHaveStatus(401);
expect(await connectForeignWorkspace()).toHaveStatus(403);
expect(await presenceAfterSocketClose(workspaceId, agentId)).toEqual("offline");
expect(await offeredAgents(callId)).toEqual([availableTeamMemberId]);
expect(await offeredAgents(callId)).not.toContain(awayId);
expect(await offeredAgents(callId)).not.toContain(nonTeamMemberId);
```

**Step 2: Run to verify failure.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/call-dispatch-do.test.ts`

Expected: FAIL because `CallDispatchDO` is absent.

**Step 3: Implement dispatch DO and API.**

Add `CALL_DISPATCH_DO: DurableObjectNamespace<CallDispatchDO>` to `Env` and add the class migration in the Worker configuration. The Worker route validates Better Auth and Workspace membership before resolving the deterministic Workspace DO name:

```text
GET /ws/calling?workspaceId=:workspaceId
```

The browser connection must be tagged with authenticated `{ workspaceId, userId }` using `serializeAttachment()`. On open/close, write `agent_call_presence` through the Worker/DO-owned D1 seam, never trusting a client user ID. Add:

```text
PATCH /api/workspaces/:workspaceId/calling/presence
```

It accepts only `available` or `away`; `offline` is system-owned. The browser sends a heartbeat every 15 seconds; the server stores expiry at now + 45 seconds. The DO closes/removes availability immediately on socket close. A stale expiry is treated as offline by every queue selection query.

Use one internal DO request to deliver an offer to an explicit authorized user list; never broadcast call metadata to all Workspace members. Define a browser event type shaped as:

```ts
{ type: "call:ring"; callId: string; conversationId: string; queueId: string; expiresAt: string; contact: { id: string; displayName: string | null; avatarUrl: string | null; } }
```

Do not include Meta SDP until an Agent has won the accept race.

**Step 4: Run focused test.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/call-dispatch-do.test.ts`

Expected: PASS; disconnect immediately removes eligibility and direct/foreign socket access is rejected.

**Step 5: Commit.**

```bash
git add apps/worker/src/call-dispatch-do.ts apps/worker/src/env.ts apps/worker/wrangler.toml apps/worker/src/index.ts apps/worker/test/call-dispatch-do.test.ts
git commit -m "feat: dispatch Page calls to available Agents"
```

---

### Task 7: Implement serialized call sessions and Page calling webhook ingress

**Objective:** Accept authentic Page call webhooks, route them through Queue stages, and make first-agent acceptance race-free.

**Files:**
- Create: `apps/worker/src/call-session-do.ts`
- Create: `apps/worker/src/calling-service.ts`
- Modify: `apps/worker/src/env.ts`
- Modify: `apps/worker/wrangler.toml` (or active Worker config)
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/activity.ts`
- Test: `apps/worker/test/facebook-calling-ingress.test.ts`
- Test: `apps/worker/test/call-session-do.test.ts`

**Step 1: Write failing ingress and session tests.**

Test all important seams:

```ts
// Signed connect webhook creates one event/session even when replayed.
expect(await postSignedConnectTwice()).toHaveD1Count("call_events", 1);

// 15s then 15s stage progression; only available group members receive each offer.
expect(dispatch.offersFor("call-1", "group-1")).toEqual(["agent-a", "agent-b"]);
expect(dispatch.offersFor("call-1", "group-2")).toEqual(["agent-c"]);

// Two simultaneous accepts: exactly one succeeds and exactly one assignee is written.
expect(await Promise.all([acceptAs("agent-a"), acceptAs("agent-b")])).toContainEqual(expect.objectContaining({ won: true }));
expect(await acceptedWinner("call-1")).toHaveLength(1);

// 50 second budget/Meta deadline paths.
expect(await advancePastLastStage()).toMatchObject({ state: "timed_out" });
expect(await activityActions(conversationId)).toContain("call.timed_out");

// Foreign/away/unoffered agents cannot accept or terminate.
await expect(acceptAs("foreign-agent")).rejects.toMatchObject({ status: 403 });
```

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/call-session-do.test.ts
```

Expected: FAIL because there is no call ingress/session implementation.

**Step 3: Implement the service, Call Session DO, and webhook branch.**

In `apps/worker/src/index.ts`, after existing `verifyMessengerSignature()` succeeds in `POST /webhooks/messenger/:metaAppId`, run both normalizers independently:

```ts
for (const message of normalizeFacebookWebhook(decoded.right)) await routeInbound(c.env, message);
for (const call of normalizeFacebookCallingWebhook(decoded.right)) await routeInboundFacebookCall(c.env, metaAppId, call);
```

Do not route calls through `routeInbound()`, which assumes a customer Message and processed-message key.

`calling-service.ts` must:

1. Look up only an active `facebook_page` Channel with the webhook’s Page ID and path Meta App ID.
2. Claim `(channel_id, provider_event_id)` in `call_events` before any side effects; replay returns 200 without re-ringing.
3. Resolve/create the existing Page-scoped Contact and an open Conversation using the same security and default-Inbox conventions as `apps/worker/src/ingest.ts`. Do not create a Message or `messages_summary` row.
4. Append `call.received` with `actorId: null`, then resolve the enabled Queue for the Channel. If absent/closed/no eligible member, send the no-agent text only when the adapter/provider reports Messenger delivery is allowed; append `call.no_agent_reply` with the result and reject the provider call.
5. Resolve `CALL_SESSION_DO.idFromName("facebook-call:" + providerCallId)`, POST only the normalized, validated routing snapshot, and let the session DO own all stage timers and accept state.

`CallSessionDO` storage is the authoritative state machine for one provider call. State must include call id, Workspace/Channel/Conversation/Queue IDs, current stage, deadline, currently offered Agent IDs, winner, and terminal outcome. On start it offers the first eligible stage; on `alarm()` it advances/rejects. It must set alarms based on absolute timestamps and never exceed the 50-second Queue budget or the Meta 60-second deadline. An accept transition must be one DO-serialized state change; only the winner triggers Page Graph `accept` signaling. Reject/terminate actions must be idempotent.

Add authenticated Worker routes for the dispatch-to-session commands:

```text
POST /api/workspaces/:workspaceId/calling/calls/:callId/accept
POST /api/workspaces/:workspaceId/calling/calls/:callId/reject
POST /api/workspaces/:workspaceId/calling/calls/:callId/terminate
POST /api/workspaces/:workspaceId/calling/calls/:callId/metrics
```

Every route authenticates the session, proves Workspace membership, forwards the actor ID, and lets the Call Session DO verify it was offered/won. The accept route forwards browser SDP to the Worker provider seam, receives Meta’s SDP answer, returns it only to the winning Agent, and records `call.accepted` before reporting success.

**Step 4: Run focused tests.**

Run:

```bash
cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/call-session-do.test.ts
```

Expected: PASS; webhook replay has no duplicate Activity/reply/offer, and exactly one concurrent accept wins.

**Step 5: Commit.**

```bash
git add apps/worker/src/call-session-do.ts apps/worker/src/calling-service.ts apps/worker/src/index.ts apps/worker/src/activity.ts apps/worker/src/env.ts apps/worker/wrangler.toml apps/worker/test/facebook-calling-ingress.test.ts apps/worker/test/call-session-do.test.ts
git commit -m "feat: route inbound Messenger Page calls"
```

---

### Task 8: Implement secure Graph signaling, lifecycle handling, and quality reporting

**Objective:** Complete Page-side accept/reject/terminate signaling without leaking credentials and record reliable lifecycle/quality Activities.

**Files:**
- Modify: `apps/worker/src/facebook-calling-provider.ts`
- Modify: `apps/worker/src/calling-service.ts`
- Modify: `apps/worker/src/call-session-do.ts`
- Test: `apps/worker/test/facebook-calling-provider.test.ts`
- Test: `apps/worker/test/call-session-do.test.ts`

**Step 1: Add failing tests.**

Add provider mocks for Graph accept/reject/terminate and status/termination webhooks. Assert:

```ts
expect(graphRequest.url).toBe("https://graph.facebook.com/v21.0/page-1/calls");
expect(JSON.parse(graphRequest.body)).toMatchObject({
  call_id: "call-1", action: "accept", session: { sdp_type: "offer", sdp: "offer-sdp" },
});
expect(await terminalActivity(conversationId)).toMatchObject({ action: "call.terminated" });
expect(await qualityActivity(conversationId)).toMatchObject({ action: "call.quality_reported" });
```

Also prove that token strings never appear in response bodies, thrown errors, Activity details, or test snapshots.

**Step 2: Run to verify failure.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-provider.test.ts test/call-session-do.test.ts`

Expected: FAIL for missing call provider methods/lifecycle behavior.

**Step 3: Implement provider calls.**

Add provider functions with explicit request/response parsing, bounded timeout, and no retry after uncertain provider acceptance:

```ts
acceptInboundMessengerCall({ pageId, pageAccessToken, callId, offerSdp }): Promise<{ answerSdp: string; renegotiationOffer?: string }>;
rejectInboundMessengerCall({ pageId, pageAccessToken, callId }): Promise<void>;
terminateMessengerCall({ pageId, pageAccessToken, callId }): Promise<void>;
submitMessengerCallMetrics({ pageId, pageAccessToken, callId, summary }): Promise<void>;
```

Verify the exact current Meta request fields before coding; do not infer them from WhatsApp’s Calling API. Process `call_status`, `media_update`, and `terminate` calling webhooks in the call normalizer/service. Forward necessary, validated renegotiation data only to the winning browser through the dispatch DO. Persist terminal state first, then append exactly one terminal Activity. Treat Graph 5xx/transport failure as `uncertain`; retain a `failed` audit state and never blindly call again.

**Step 4: Run focused tests.**

Run: `cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-provider.test.ts test/call-session-do.test.ts`

Expected: PASS; all signaling actions are token-safe and terminal state is idempotent.

**Step 5: Commit.**

```bash
git add apps/worker/src/facebook-calling-provider.ts apps/worker/src/calling-service.ts apps/worker/src/call-session-do.ts apps/worker/test/facebook-calling-provider.test.ts apps/worker/test/call-session-do.test.ts
git commit -m "feat: signal and audit Messenger Page calls"
```

---

### Task 9: Build calling API client and global browser dispatch provider

**Objective:** Keep the call socket alive globally, synchronize presence, and expose a typed call state machine to UI components.

**Files:**
- Create: `apps/web/src/lib/calling-api.ts`
- Create: `apps/web/src/components/calling/CallProvider.tsx`
- Create: `apps/web/src/components/calling/CallProvider.test.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Write failing UI/provider tests.**

Mock `WebSocket`, `navigator.mediaDevices.getUserMedia`, `RTCPeerConnection`, and the typed call API. Test:

```tsx
render(<CallProvider workspaceId="ws-1"><Probe /></CallProvider>);
fireSocketMessage({ type: "call:ring", callId: "call-1", conversationId: "c-1", expiresAt: futureIso, contact: { id: "p-1", displayName: "Ana", avatarUrl: null } });
expect(screen.getByRole("dialog", { name: /incoming call/i })).toBeVisible();

await user.click(screen.getByRole("button", { name: /accept/i }));
expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
expect(mockAccept).toHaveBeenCalledWith("ws-1", "call-1", expect.any(String));

socket.close();
expect(mockPresence).toHaveBeenLastCalledWith("ws-1", { status: "away" });
```

Also cover microphone denial, an expired offer, a remote terminate event, and cleanup that stops every media track and closes the peer connection.

**Step 2: Run to verify failure.**

Run: `cd apps/web && bunx vitest run src/components/calling/CallProvider.test.tsx`

Expected: FAIL because no calling client/provider exists.

**Step 3: Implement client/provider.**

`calling-api.ts` holds workspace-scoped `fetch` methods and URL building; use this exact authentication-safe pattern, adapting the existing `api` error helper rather than duplicating it:

```ts
export function callingSocketUrl(workspaceId: string): string {
  const base = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${base}//${window.location.host}/ws/calling?workspaceId=${encodeURIComponent(workspaceId)}`;
}
```

`CallProvider` opens a single socket for the selected, explicit Workspace, updates availability through the presence API, sends a 15-second heartbeat, and reconnects with bounded exponential backoff. Do not use a Conversation socket for a call. Its context must expose no credential and no raw page token:

```ts
interface CallContextValue {
  presence: "available" | "away" | "offline";
  setPresence(status: "available" | "away"): Promise<void>;
  incomingCall: IncomingCall | null;
  activeCall: ActiveCall | null;
  accept(): Promise<void>;
  reject(): Promise<void>;
  hangUp(): Promise<void>;
}
```

Create the `RTCPeerConnection` only after local microphone permission succeeds. On accept, create/set the local offer, call the server accept endpoint, apply only the returned remote answer, and send later renegotiation messages through the authenticated API/dispatch protocol. On every terminal path stop tracks, clear intervals/ringtone, close the peer connection, and report bounded aggregate `getStats()` values.

Mount the Provider once under the authenticated app shell in `apps/web/src/routes/__root.tsx`; it must follow the same explicit Workspace canonicalization used elsewhere and remount/close when Workspace changes.

**Step 4: Run focused test.**

Run: `cd apps/web && bunx vitest run src/components/calling/CallProvider.test.tsx`

Expected: PASS; there is one global socket and it fully cleans up after every call state.

**Step 5: Commit.**

```bash
git add apps/web/src/lib/calling-api.ts apps/web/src/lib/api.ts apps/web/src/components/calling/CallProvider.tsx apps/web/src/components/calling/CallProvider.test.tsx apps/web/src/routes/__root.tsx
git commit -m "feat(web): add global Messenger call dispatch"
```

---

### Task 10: Add the accessible incoming-call overlay and active audio panel

**Objective:** Give Agents a reliable softphone surface without replacing the existing conversation UI shell.

**Files:**
- Create: `apps/web/src/components/calling/IncomingCallDialog.tsx`
- Create: `apps/web/src/components/calling/ActiveCallPanel.tsx`
- Create: `apps/web/src/components/calling/IncomingCallDialog.test.tsx`
- Create: `apps/web/src/components/calling/ActiveCallPanel.test.tsx`
- Modify: `apps/web/src/components/calling/CallProvider.tsx`
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx`

**Step 1: Write failing component tests.**

Assert dialog semantics, Escape behavior, labels, and state:

```tsx
expect(screen.getByRole("dialog", { name: /incoming call from ana/i })).toBeVisible();
expect(screen.getByRole("button", { name: /accept call/i })).toBeEnabled();
expect(screen.getByRole("button", { name: /reject call/i })).toBeEnabled();

await user.click(screen.getByRole("button", { name: /mute microphone/i }));
expect(mockTrack.enabled).toBe(false);
await user.click(screen.getByRole("button", { name: /end call/i }));
expect(mockHangUp).toHaveBeenCalledTimes(1);
```

Test a rejected microphone permission shows an actionable message and leaves the call ringing until the Agent rejects or it expires. Test the active panel appears only for the winning Agent’s `conversationId`.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/web && bunx vitest run src/components/calling/IncomingCallDialog.test.tsx
cd apps/web && bunx vitest run src/components/calling/ActiveCallPanel.test.tsx
```

Expected: FAIL because the components are missing.

**Step 3: Implement UI.**

Use existing shadcn/Radix `Dialog`, `Button`, `Alert`, `Avatar`, and icon conventions; do not create absolute-positioned unmanaged modals. `IncomingCallDialog` must be global, focus-safe, screen-reader labelled, and visually show contact, Page/Queue, countdown, Accept, and Reject. Its ringtone must be local browser audio only, start only after the incoming event, and stop on every terminal transition.

`ActiveCallPanel` belongs in the selected `ConversationThread` header area rather than replacing the conversation or adding a bottom tab. It displays `Connected`, elapsed time, microphone mute state, and `End call`; it owns no routing state and consumes the Provider context.

After winning accept, navigate with the existing TanStack Router pattern to `/?workspace=<id>&c=<conversationId>` and invalidate the existing workspace conversation/sidebar query keys. Do not inject synthetic timeline bubbles; existing Activity modal/list rendering receives the Call Activity from the backend.

**Step 4: Run focused tests.**

Run:

```bash
cd apps/web && bunx vitest run src/components/calling/IncomingCallDialog.test.tsx
cd apps/web && bunx vitest run src/components/calling/ActiveCallPanel.test.tsx
```

Expected: PASS; keyboard and cleanup paths work.

**Step 5: Commit.**

```bash
git add apps/web/src/components/calling apps/web/src/components/inbox/ConversationThread.tsx
git commit -m "feat(web): add accessible Page call softphone"
```

---

### Task 11: Add Call Queue settings, Ring Group management, and availability controls

**Objective:** Let administrators configure the confirmed Page/Team routing model and let Agents explicitly become available.

**Files:**
- Create: `apps/web/src/components/settings/CallingSettingsSection.tsx`
- Create: `apps/web/src/components/settings/CallingSettingsSection.test.tsx`
- Create: `apps/web/src/components/calling/PresenceToggle.tsx`
- Create: `apps/web/src/components/calling/PresenceToggle.test.tsx`
- Modify: `apps/web/src/routes/settings.tsx`
- Modify: `apps/web/src/components/layout/AppTopBar.tsx`
- Modify: `apps/web/src/lib/calling-api.ts`

**Step 1: Write failing UI contract tests.**

Cover Page-only Queue selectors, Team-backed group membership, strategy selection, bounded stage validation, and disabled enable action:

```tsx
expect(screen.getByLabelText(/facebook page channel/i)).toBeInTheDocument();
expect(screen.queryByText(/whatsapp/i)).not.toBeInTheDocument();
await user.type(screen.getByLabelText(/ring duration/i), "51");
expect(screen.getByText(/total ringing time must not exceed 50 seconds/i)).toBeVisible();
expect(screen.getByRole("button", { name: /enable calling/i })).toBeDisabled();
```

Presence test verifies `available`/`away` transitions call the Workspace-scoped API and browser/socket closure displays `offline` without offering a user-controlled Offline choice.

**Step 2: Run to verify failure.**

Run:

```bash
cd apps/web && bunx vitest run src/components/settings/CallingSettingsSection.test.tsx
cd apps/web && bunx vitest run src/components/calling/PresenceToggle.test.tsx
```

Expected: FAIL because no calling settings/control exists.

**Step 3: Implement minimal Settings UI.**

Add a `calling` Settings section in `apps/web/src/routes/settings.tsx` and mount `CallingSettingsSection` only with an explicit Workspace. Use the same React Query and mutation/error patterns as the existing Channels and Team settings. It must:

- List/create/edit/archive Ring Groups; select exactly one Team, only its active members, and either simultaneous/round-robin strategy.
- List/create/edit/delete Queue configurations; Page Channel selector contains only active `facebook_page` channels, one Team, Queue name, timezone, operating hours, no-agent reply, and ordered Group stages.
- Validate 1–50 seconds per stage and total ≤50 on the client for feedback, while relying on server validation as authoritative.
- Show disabled/enabled state and precise Meta prerequisite/setup errors returned by the enable endpoint. Never expose Page tokens.
- State clearly that calling routes to MsgFlow partner apps and has no recording/voicemail in v1.

Put `PresenceToggle` in `AppTopBar` so it remains visible on every authenticated Workspace route. It must use the CallProvider rather than create a second socket or second presence mutation path.

**Step 4: Run focused tests.**

Run:

```bash
cd apps/web && bunx vitest run src/components/settings/CallingSettingsSection.test.tsx
cd apps/web && bunx vitest run src/components/calling/PresenceToggle.test.tsx
```

Expected: PASS; the UI cannot attempt an invalid or non-Page call configuration.

**Step 5: Commit.**

```bash
git add apps/web/src/components/settings/CallingSettingsSection.tsx apps/web/src/components/settings/CallingSettingsSection.test.tsx apps/web/src/components/calling/PresenceToggle.tsx apps/web/src/components/calling/PresenceToggle.test.tsx apps/web/src/routes/settings.tsx apps/web/src/components/layout/AppTopBar.tsx apps/web/src/lib/calling-api.ts
git commit -m "feat(web): configure Page call queues and availability"
```

---

### Task 12: Run end-to-end regression checks and perform a Meta sandbox acceptance pass

**Objective:** Verify schema, security, Worker bindings, UI, and the actual provider lifecycle before declaring the feature ready.

**Files:**
- Modify only if a failing check reveals a scoped defect.
- Create: `docs/runbooks/facebook-page-calling-pilot.md`
- Test: relevant existing/new Worker and web suites.

**Step 1: Add the operator runbook.**

Document this exact preflight checklist in `docs/runbooks/facebook-page-calling-pilot.md`:

1. Confirm Page eligibility with `messenger_api_calling` through the new Queue enable action.
2. In the Meta App dashboard, configure the existing App-specific callback URL `/webhooks/messenger/:metaAppId` and one-time verification token; subscribe the `calls`, `call_settings_update`, and current documented lifecycle fields.
3. Confirm the Page uses the intended App/Page token, Queue is enabled, and the settings readback has `call_routing.ring_target = PARTNERS` and matching call hours.
4. Log two Team Agents in separate browser profiles, both connect the Workspace call socket, set one available and one away, then confirm only the available Agent rings.
5. From a Meta test consumer, call the Page; accept once, speak both directions, mute/unmute, hang up, and confirm one Call Activity and no synthetic Message.
6. Repeat with two available Agents; confirm first accept wins and the loser cannot connect.
7. Repeat with no available Agent; confirm rejection, one missed/timed-out Activity, and the policy-permitted no-agent Messenger reply.
8. Export only call IDs/outcomes for troubleshooting; never capture token, SDP, or media contents in the runbook.

**Step 2: Run focused verification.**

Run:

```bash
cd packages/contracts && bun run build
cd ../channel && bun test src/facebook-calling.test.ts
cd ../../apps/worker && bun test --max-concurrency=1 test/facebook-calling-migration.test.ts
cd apps/worker && bun test --max-concurrency=1 test/calling-config.test.ts
cd apps/worker && bun test --max-concurrency=1 test/call-dispatch-do.test.ts
cd apps/worker && bun test --max-concurrency=1 test/facebook-calling-ingress.test.ts
cd apps/worker && bun test --max-concurrency=1 test/call-session-do.test.ts
cd apps/web && bunx vitest run src/components/calling/CallProvider.test.tsx src/components/calling/IncomingCallDialog.test.tsx src/components/calling/ActiveCallPanel.test.tsx src/components/settings/CallingSettingsSection.test.tsx src/components/calling/PresenceToggle.test.tsx
```

Expected: every focused command exits 0. If a Miniflare file competes for startup, rerun that single file alone; do not change concurrency globally.

**Step 3: Run repository gates and Worker binding validation.**

Run:

```bash
bun run lint
bun run build
cd apps/worker && bunx wrangler deploy --dry-run
git diff --check
git status --short
```

Expected: lint/build/dry-run/diff-check exit 0. The dry-run binding list includes both new DO namespaces and their migrations, D1, and existing bindings. `git status --short` contains only the planned source/docs changes plus the three pre-existing untracked files; do not modify or stage those pre-existing files.

**Step 4: Perform sandbox acceptance.**

Use a dedicated Meta test Page and test consumer. This is an explicit external operator action; do not run it against production. Record the deployment version, Page ID, Queue ID, test time, and outcomes in the PR/issue—not secrets, SDP, or recordings.

**Step 5: Commit.**

```bash
git add docs/runbooks/facebook-page-calling-pilot.md
git commit -m "docs: add Facebook Page calling pilot runbook"
```

---

## Tests / validation summary

- Follow the red → green → commit loop in every code task above; do not implement a testless vertical slice.
- Worker tests stay serialized: `cd apps/worker && bun test --max-concurrency=1 <single-test-file>`.
- Browser tests use `cd apps/web && bunx vitest run <test-paths>`; bare `bun test` does not provide jsdom.
- Required security regressions:
  - Invalid/mixed Page webhook payload and signature reject before any token decryption/routing.
  - Meta App + Page lookup remains installation-globally unambiguous and Workspace-scoped after lookup.
  - Webhook replay creates one call event, one routing attempt, one no-agent reply at most, and no duplicate Activity.
  - Queue, Group, Agent presence, call ID, conversation ID, and socket URL cannot cross Workspace boundaries.
  - Only an offered, currently authorized Agent can accept; a first-winner atomic test proves no double connection.
  - Page access tokens, App secrets, provider raw payloads, SDP, and raw WebRTC stats never reach React Query cache, Activity details, logs, or API responses.
  - Closing a browser socket removes eligibility immediately; stale heartbeats expire; an `away` Agent is never rung.
  - Total stage duration cannot exceed 50 seconds in client validation, service validation, D1 constraint/trigger test, or Call Session DO scheduling.
- Required provider/manual regression: validate eligibility, `PARTNERS` routing, actual inbound audio, busy/no-agent behavior, terminal activities, and quality submission with a Meta sandbox Page before production enablement.

## Risks, tradeoffs, and open questions

- **Meta availability and permissions:** Messenger Business Calling is Page/country/feature-gated and Meta may require App review, partner approval, permission scopes, or webhook field changes. Confirm current eligibility and dashboard requirements before planning a production date.
- **No hold recording without separate media infrastructure:** A Cloudflare Worker plus browser softphone cannot accept a call and play audio with no Agent. That requires an always-on WebRTC/SIP media service and is intentionally excluded. The selected no-agent text reply is the v1 fallback.
- **Browser reliability:** A laptop sleep, background tab throttling, blocked microphone, blocked autoplay, NAT, or network change can interrupt an accepted browser call. The design records the terminal reason and favors clear retry/reject UX over hidden retries.
- **Presence correctness:** A dispatch DO close is immediate; heartbeat expiry protects against unclean exits. Cross-device Agent policy is deliberately unspecified in this plan: v1 should ring all live available sockets for the same Agent but allow only one accept. Confirm later whether one Agent may answer on more than one device.
- **Conversation reuse:** “Most recent open Conversation for the Page Contact” is confirmed. If a Contact has multiple active Conversations on the same Page, select deterministically by `updated_at DESC, id DESC` and add a focused test; do not guess from title/subject.
- **No-agent reply policy:** The Worker must obey Messenger’s live provider policy/error response. If delivery is not allowed, log `not_sent_policy` rather than trying alternate copy/templates. Product copy and localization for the default no-agent text still need owner approval.
- **Call settings authority:** Meta Business Suite users can change Page call hours/routing out of band. Treat the Meta `call_settings_update` webhook as an audit/reconciliation signal and visibly mark the Queue requiring operator review rather than silently rewriting settings in a loop.
- **Metrics schema:** Verify Meta’s current exact metrics endpoint and required fields before implementation. The plan intentionally requires a narrow translation layer instead of hard-coding a payload based on old examples.
- **Operational rollout:** Do not enable `PARTNERS` routing for a Page until two Agents have completed the sandbox acceptance checklist; otherwise users may lose a previously working Meta-owned Page call route.
