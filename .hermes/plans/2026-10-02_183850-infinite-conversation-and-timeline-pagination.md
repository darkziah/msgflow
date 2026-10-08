# Infinite Conversation and Timeline Pagination Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the inbox’s fixed 200-conversation fetch and full Conversation DO timeline fetch with stable cursor pagination consumed through TanStack `useInfiniteQuery`, so agents can scroll to older conversations and email/chat history without losing live updates or scroll position.

**Architecture:** Use opaque, keyset cursors rather than offsets: D1 conversation pages use the existing newest-first `lastMessageAt` ordering plus `id` as a deterministic tie-breaker; the Conversation DO returns pages from one chronological, merged timeline stream of Messages, Comments, and Activities using `createdAt` plus `id`. Keep all current authorization checks at the Worker boundary, retain the existing WebSocket for live items, and let the web app flatten/dedupe infinite-query pages with live events. The activity modal consumes the same paged timeline items; do not expand unrelated bounded operational lists (email delivery attempts and ingress operations) in this change.

**Tech Stack:** Bun, TypeScript, Hono, Cloudflare Workers + Durable Objects + D1/Drizzle, React 19, TanStack React Query v5, Vitest, Testing Library.

---

## Current context / assumptions

- The application is a Bun monorepo. The browser lives in `apps/web`; its Worker API and per-conversation Durable Object live in `apps/worker`.
- `apps/web/src/routes/index.tsx:244-266` currently uses `useQuery` for one conversation response. `apps/worker/src/queries.ts:141-268` hard-caps that D1 query at 200 rows.
- `apps/web/src/components/inbox/ConversationThread.tsx:73-76` fetches the entire `TimelineResponse`. `apps/worker/src/index.ts:572-623` calls three unbounded/singly bounded DO endpoints; `apps/worker/src/conversation-do.ts:296-326` currently returns all Messages/Comments and only the latest 50 Activities.
- The existing timeline UI renders Message and Comment items together in ascending `createdAt`, and its current `bottomRef.scrollIntoView()` effect at `ConversationThread.tsx:247-252` scrolls to the newest content. The new implementation must keep this initial behavior, but must not jump to the bottom when older history is prepended.
- The inbox ordering is “newest activity first”, including null timestamps last (`queries.ts:249-253`). Pagination must preserve that exact ordering, including tied timestamps and null timestamps.
- Conversation pages must stay explicitly workspace-scoped. Do not add a default workspace fallback; retain `requireWorkspaceAccess()` and `getConversation()` authorization before any DO request.
- “Other possible pagination” is intentionally scoped to the comment/activity records already returned by the conversation timeline. It excludes `apps/worker/src/email-api.ts` operational diagnostic lists capped at 50/200; they have no scroll UI and adding pagination would be YAGNI.

## Cursor and response contract

Create one shared browser/Worker-safe pagination contract in `packages/contracts/src/types/index.ts` (and export it from the existing package barrel if that barrel requires explicit exports):

```ts
export interface PageInfo {
  nextCursor: string | null;
}

export interface ConversationListResponse extends PageInfo {
  conversations: ConversationSummary[];
}

export type TimelineItem =
  | { type: "message"; item: Message }
  | { type: "comment"; item: Comment }
  | { type: "activity"; item: Activity };

export interface TimelinePageResponse extends PageInfo {
  items: TimelineItem[];
}
```

Use opaque base64url-encoded JSON cursor payloads. Do not accept raw SQL values from the client. Define these exact payload shapes in the layer that owns each ordering:

```ts
// apps/worker/src/queries.ts: D1 conversation order
interface ConversationCursor {
  lastMessageAt: string | null;
  id: string;
}

// apps/worker/src/conversation-do.ts: merged timeline order
interface TimelineCursor {
  createdAt: string;
  id: string;
}
```

The Worker and DO must reject malformed cursor strings with HTTP 400. Clamp `limit` to `1..100`; default both APIs to `50`. A response has `nextCursor: null` when fewer than `limit + 1` authorized records exist. Fetch `limit + 1`, return the first `limit`, and derive the cursor from the final returned record. Never expose a cursor for the look-ahead record.

## Step-by-step tasks

### Task 1: Add paginated shared contract types

**Objective:** Make the two page response shapes available to both the web client and Worker without changing any HTTP behavior yet.

**Files:**
- Modify: `packages/contracts/src/types/index.ts:313-323`
- Modify: `packages/contracts/src/index.ts` only if the existing barrel does not already re-export `types/index.ts`
- Create: `packages/contracts/src/pagination-types.test.ts`

**Step 1: Write the failing compile-level contract test**

Create `packages/contracts/src/pagination-types.test.ts`:

```ts
import { expect, test } from "bun:test";
import type {
  ConversationListResponse,
  TimelinePageResponse,
} from "./types";

test("pagination responses expose an opaque next cursor", () => {
  const conversations: ConversationListResponse = {
    conversations: [],
    nextCursor: "opaque-cursor",
  };
  const timeline: TimelinePageResponse = {
    items: [],
    nextCursor: null,
  };

  expect(conversations.nextCursor).toBe("opaque-cursor");
  expect(timeline.nextCursor).toBeNull();
});
```

**Step 2: Run the test to verify failure**

Run: `bun --filter @msgflow/contracts test src/pagination-types.test.ts`

Expected: FAIL with missing `ConversationListResponse` and `TimelinePageResponse` exports.

**Step 3: Implement the minimal contract**

At `packages/contracts/src/types/index.ts:313`, replace the old complete-timeline-only declarations with the following, retaining the deprecated `MessagesResponse` alias only if another current caller uses it:

```ts
export interface PageInfo {
  nextCursor: string | null;
}

export interface ConversationListResponse extends PageInfo {
  conversations: ConversationSummary[];
}

export type TimelineItem =
  | { type: "message"; item: Message }
  | { type: "comment"; item: Comment }
  | { type: "activity"; item: Activity };

export interface TimelinePageResponse extends PageInfo {
  items: TimelineItem[];
}

/** @deprecated Replace with TimelinePageResponse. */
export type TimelineResponse = TimelinePageResponse;
export type MessagesResponse = TimelineResponse;
```

Update the package barrel only if its actual export graph requires it; do not create a second re-export path.

**Step 4: Verify pass**

Run: `bun --filter @msgflow/contracts test src/pagination-types.test.ts`

Expected: PASS — 1 test passes.

**Step 5: Commit**

```bash
git add packages/contracts/src/types/index.ts packages/contracts/src/pagination-types.test.ts packages/contracts/src/index.ts
git commit -m "feat: add cursor pagination contracts"
```

Expected: one commit; omit `packages/contracts/src/index.ts` from `git add` if it was not changed.

### Task 2: Paginate conversations in D1 with a stable keyset cursor

**Objective:** Make `listConversations` return deterministic pages that do not duplicate or skip equal timestamps or null timestamp rows.

**Files:**
- Modify: `apps/worker/src/queries.ts:120-268`
- Create: `apps/worker/test/conversation-pagination.test.ts`

**Step 1: Write failing unit tests for the query service**

Use the existing `createTestDb`, `seedWorkspace`, and Drizzle helpers from `apps/worker/test/helpers.ts`. Seed one readable inbox/contact/channel and six conversations with this ordering data: `2026-01-03T00:00:00.000Z` (`c3`, `c2`), `2026-01-02T00:00:00.000Z` (`c1`), `2026-01-01T00:00:00.000Z` (`c0`), then `null` (`n2`, `n1`). Call `listConversations` with `{ limit: 2 }`, then repeat using each returned cursor.

Add these assertions verbatim after obtaining the responses:

```ts
expect(first.conversations.map((row) => row.id)).toEqual(["c3", "c2"]);
expect(first.nextCursor).toEqual(expect.any(String));
expect(second.conversations.map((row) => row.id)).toEqual(["c1", "c0"]);
expect(third.conversations.map((row) => row.id)).toEqual(["n2", "n1"]);
expect(third.nextCursor).toBeNull();
expect([...first.conversations, ...second.conversations, ...third.conversations])
  .toHaveLength(6);
```

Also test that a malformed cursor rejects with the service’s typed 400-equivalent error that the route will map to a 400 response; do not silently fall back to page one.

**Step 2: Run the focused test to verify failure**

Run: `bun --filter @msgflow/worker test test/conversation-pagination.test.ts`

Expected: FAIL because `ConversationListOptions` has no `limit`/`cursor` and the result is an array with no `nextCursor`.

**Step 3: Implement minimal D1 pagination**

1. Change `ConversationListOptions` in `apps/worker/src/queries.ts` to include `cursor?: string` and `limit?: number`.
2. Add private `encodeConversationCursor` and `decodeConversationCursor` helpers in that file. Decode base64url JSON, validate exactly `lastMessageAt` is a string or null and `id` is a non-empty string, and throw `new ManageError(400, "invalid cursor")` (use the project’s actual error constructor after inspecting `apps/worker/src/errors.ts`).
3. Preserve all existing authorization/filter conditions. Append a keyset predicate after them:
   - for a non-null cursor timestamp: include non-null rows with an older timestamp, tied rows with a lexically smaller id, **and** null-timestamp rows;
   - for a null cursor timestamp: include only null-timestamp rows with a lexically smaller id.
4. Order by the existing null bucket, `desc(conversations.lastMessageAt)`, then `desc(conversations.id)`.
5. Request `limit + 1`, run the existing mailbox-access filter, and do not calculate `nextCursor` until after that filter. Because the access filter can remove look-ahead rows, over-fetch D1 rows in a bounded loop until it has `limit + 1` authorized rows or raw rows are exhausted. Keep tag loading limited to the returned page ids.
6. Return `{ conversations, nextCursor }` satisfying `ConversationListResponse`; remove the old `.limit(200)`.

**Step 4: Verify pass and regressions**

Run:

```bash
bun --filter @msgflow/worker test test/conversation-pagination.test.ts
bun --filter @msgflow/worker test test/conversation-permissions.test.ts
```

Expected: both commands exit 0; the pagination test reports no duplicates and `conversation-permissions` remains green.

**Step 5: Commit**

```bash
git add apps/worker/src/queries.ts apps/worker/test/conversation-pagination.test.ts
git commit -m "feat: paginate conversation queries"
```

### Task 3: Expose conversation cursor and page size through the HTTP and browser API

**Objective:** Keep the existing `/api/conversations` endpoint and all filters while allowing an infinite query to request subsequent pages.

**Files:**
- Modify: `apps/worker/src/index.ts:475-540`
- Modify: `apps/web/src/lib/api.ts:148-185`
- Extend: `apps/worker/test/conversation-pagination.test.ts`
- Create: `apps/web/src/lib/api.pagination.test.ts`

**Step 1: Write failing transport tests**

In the Worker test, exercise the route with `?workspaceId=<id>&limit=2&cursor=<cursor>` using the project’s route-test harness. Assert the JSON matches `{ conversations: [...], nextCursor: string | null }`; request `cursor=not-a-cursor` and assert HTTP 400.

In `apps/web/src/lib/api.pagination.test.ts`, mock `global.fetch`, call:

```ts
await api.listConversations({ workspaceId: "workspace-a", status: "open", limit: 50, cursor: "next-page" });
```

and assert the requested URL is exactly:

```ts
"/api/conversations?workspaceId=workspace-a&status=open&limit=50&cursor=next-page"
```

**Step 2: Run failing tests**

Run:

```bash
bun --filter @msgflow/worker test test/conversation-pagination.test.ts
bun --filter @msgflow/web test src/lib/api.pagination.test.ts
```

Expected: FAIL because the route ignores pagination query parameters and `api.listConversations` cannot serialize them.

**Step 3: Implement transport plumbing**

- In `apps/worker/src/index.ts`, parse `limit` and `cursor` once, pass them to `listConversations`, and return its page object directly. Invalid `limit` (non-integer, less than 1, greater than 100) and malformed cursor must return the existing JSON error envelope with status 400.
- In `apps/web/src/lib/api.ts`, import `ConversationListResponse`, add `limit?: number; cursor?: string` to the `listConversations` parameter type, serialize both only when supplied, and change its return type to `Promise<ConversationListResponse>`.
- Do not rename the endpoint or drop existing facet query parameters.

**Step 4: Verify pass**

Run the two focused commands from Step 2.

Expected: both exit 0; the web test sees the exact cursor query string and the worker test sees page metadata plus a 400 malformed-cursor response.

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/test/conversation-pagination.test.ts apps/web/src/lib/api.ts apps/web/src/lib/api.pagination.test.ts
git commit -m "feat: expose conversation page cursors"
```

### Task 4: Implement one paged, merged timeline in the Conversation DO

**Objective:** Page email and chat Message history together with Comment and Activity records in the exact chronological order the UI displays.

**Files:**
- Modify: `apps/worker/src/conversation-do.ts:120-134,296-326`
- Modify: `apps/worker/src/index.ts:572-623`
- Extend: `apps/worker/test/conversation-do-recovery.test.ts`
- Modify: `packages/contracts/src/types/index.ts` only if Task 1’s types need a correction discovered by the test

**Step 1: Write failing DO test**

Extend `apps/worker/test/conversation-do-recovery.test.ts` (it already uses a real bundled DO and Miniflare) to append three messages, two comments, and two activities with deliberately interleaved `createdAt` values and a tied timestamp with distinct ids. Request:

```ts
await stub.fetch("https://do/timeline?limit=3")
```

Assert this exact page protocol:

```ts
expect(first.items.map(({ type, item }) => `${type}:${item.id}`)).toEqual([
  "activity:activity-2",
  "message:message-3",
  "comment:comment-2",
]);
expect(first.nextCursor).toEqual(expect.any(String));
```

Request the second page with `?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}` and assert it contains the next three older unique items. Assert an invalid cursor produces status 400; assert a final short page returns `nextCursor: null`.

**Step 2: Run the failing DO test**

Run: `bun --filter @msgflow/worker test test/conversation-do-recovery.test.ts`

Expected: FAIL because `/timeline` does not exist.

**Step 3: Implement the DO endpoint**

1. Route `GET /timeline` in `ConversationDO.fetch()`; parse and clamp `limit` exactly as specified above.
2. Implement a private `listTimeline(cursor, limit)` which uses a single SQLite `UNION ALL` over `messages`, `comments`, and `activities`, projecting `type`, `id`, `created_at`, and the fields necessary for the existing `rowToMessage`, `rowToComment`, and `rowToActivity` mappers. Order by `created_at DESC, id DESC`; add `WHERE (created_at < ? OR (created_at = ? AND id < ?))` when a cursor is present.
3. Fetch `limit + 1`, map the first `limit` records to `TimelineItem`, and return `{ items, nextCursor }`. The endpoint returns newest-to-oldest; the browser alone reverses display order.
4. Keep `/messages`, `/comments`, and `/activities` temporarily for compatibility only if another repository caller still uses them. After searching all usages, remove only the unused Worker-internal fetches—not public behavior blindly.
5. In `apps/worker/src/index.ts`, replace the three parallel DO calls with a single authorized `stub.fetch()` to `/timeline`, forwarding URL-encoded `cursor` and `limit`. Return its `TimelinePageResponse` unchanged; preserve 502 behavior when the stub fails.

**Step 4: Verify pass**

Run:

```bash
bun --filter @msgflow/worker test test/conversation-do-recovery.test.ts
bun --filter @msgflow/worker build
```

Expected: test passes and TypeScript compilation exits 0.

**Step 5: Commit**

```bash
git add apps/worker/src/conversation-do.ts apps/worker/src/index.ts apps/worker/test/conversation-do-recovery.test.ts packages/contracts/src/types/index.ts
git commit -m "feat: page merged conversation timelines"
```

### Task 5: Add paginated timeline request support to the web API

**Objective:** Give `ConversationThread` a typed page request instead of a full-timeline request.

**Files:**
- Modify: `apps/web/src/lib/api.ts:191-194`
- Extend: `apps/web/src/lib/api.pagination.test.ts`

**Step 1: Write the failing browser-API test**

Add this test:

```ts
await api.getMessages("conversation-a", "workspace-a", {
  limit: 50,
  cursor: "older-page",
});

expect(fetch).toHaveBeenCalledWith(
  "/api/conversations/conversation-a/messages?workspaceId=workspace-a&limit=50&cursor=older-page",
  expect.any(Object),
);
```

**Step 2: Run it to verify failure**

Run: `bun --filter @msgflow/web test src/lib/api.pagination.test.ts`

Expected: FAIL because `getMessages` accepts two arguments and does not serialize pagination parameters.

**Step 3: Implement the minimal client API**

Change `getMessages` to return `TimelinePageResponse` and accept an optional `{ cursor?: string; limit?: number }` third argument. Build the URL with `URLSearchParams` so `workspaceId`, `limit`, and `cursor` are encoded once. Keep the method name to minimize unrelated call-site churn.

**Step 4: Verify pass**

Run: `bun --filter @msgflow/web test src/lib/api.pagination.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.pagination.test.ts
git commit -m "feat: add timeline page client"
```

### Task 6: Convert the inbox list to `useInfiniteQuery` and a bottom sentinel

**Objective:** Load more conversations when the list viewport reaches its bottom, while preserving filtering, keyboard navigation, live invalidation, and the current UI shell.

**Files:**
- Modify: `apps/web/src/routes/index.tsx:1-9,244-371`
- Modify: `apps/web/src/components/inbox/ConversationList.tsx:1-100`
- Extend: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write failing UI tests**

Add a focused inbox test that mocks `api.listConversations` with two pages:

```ts
vi.mocked(api.listConversations)
  .mockResolvedValueOnce({ conversations: [firstConversation], nextCursor: "page-2" })
  .mockResolvedValueOnce({ conversations: [secondConversation], nextCursor: null });
```

Render `Inbox`, trigger the list’s `onScroll` with `scrollTop + clientHeight >= scrollHeight - 24`, and assert:

```ts
await waitFor(() =>
  expect(api.listConversations).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: "page-2", limit: 50 }),
  ),
);
expect(screen.getByText(secondConversation.contact.displayName)).toBeInTheDocument();
```

Also assert changing status or filters starts a fresh request with no `cursor`, and `ArrowDown` reaches the second loaded conversation after page two arrives.

**Step 2: Run the failing test**

Run: `bun --filter @msgflow/web test src/components/inbox/ui-contract.test.tsx`

Expected: FAIL because the route uses `useQuery`, renders only `data.conversations`, and has no scroll callback.

**Step 3: Implement the minimal infinite list**

1. Replace the conversation `useQuery` in `apps/web/src/routes/index.tsx` with `useInfiniteQuery`:

```ts
const conversationsQuery = useInfiniteQuery({
  queryKey: ["conversations", activeWorkspaceId, status, filters],
  queryFn: ({ pageParam }) => api.listConversations({
    workspaceId: activeWorkspaceId,
    status,
    mailboxId: filters.mailboxId,
    inboxId: filters.inboxId,
    inboxScope: filters.inboxScope,
    q: filters.q,
    assigneeId: filters.assigneeId,
    unassigned: filters.unassigned,
    snoozed: filters.snoozed,
    channel: filters.channel,
    channelId: filters.channelId,
    tagId: filters.tagId,
    savedViewId: filters.savedViewId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    limit: 50,
    cursor: pageParam,
  }),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  enabled: Boolean(activeWorkspaceId),
  refetchInterval: 5000,
});
```

2. Derive `conversations` with `conversationsQuery.data?.pages.flatMap((page) => page.conversations) ?? []`. Use that same flattened variable for badge count, `ConversationList`, and keyboard navigation; the badge is now “loaded conversations”, not a server total.
3. Pass `hasNextPage`, `isFetchingNextPage`, and an `onLoadMore` callback into `ConversationList`. Keep its existing list markup/styles; add an `onScroll` handler to its existing `<ul>` that invokes `onLoadMore()` only within 24px of the bottom and only if another page exists and is not already fetching. Render a small `Loading more conversations…` status row while fetching.
4. Do not put an `IntersectionObserver` in the page container and the `<ul>` simultaneously. The `<ul>` is the actual scrollable element, so it owns the trigger.
5. Existing `invalidateWorkspaceConversationViews()` can continue invalidating the `['conversations', workspaceId]` prefix: TanStack will refetch the first page. Do not mutate or concatenate cursor pages manually after WebSocket changes.

**Step 4: Verify pass**

Run:

```bash
bun --filter @msgflow/web test src/components/inbox/ui-contract.test.tsx
bun --filter @msgflow/web test src/routes/-sidebar-live-update.test.tsx
```

Expected: both pass; the live-update test still observes invalidation of the `conversations` prefix.

**Step 5: Commit**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/components/inbox/ConversationList.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat: infinitely scroll inbox conversations"
```

### Task 7: Convert the conversation timeline to `useInfiniteQuery` with prepend-safe history loading

**Objective:** Load older email/chat history at the top of the timeline without changing first-open auto-scroll, live event display, read cursors, email collapse behavior, or composer behavior.

**Files:**
- Modify: `apps/web/src/components/inbox/ConversationThread.tsx:1-10,73-76,191-252,340-426`
- Extend: `apps/web/src/components/inbox/ui-contract.test.tsx`

**Step 1: Write failing thread tests**

Mock two `api.getMessages` pages, first newest-to-oldest with `nextCursor: "older"`, then the older page with `nextCursor: null`. Render `ConversationThread`, locate the element with `aria-label="Conversation timeline"` (add this label in the implementation), set its `scrollTop` to 0, and dispatch `scroll`.

Assert:

```ts
await waitFor(() =>
  expect(api.getMessages).toHaveBeenLastCalledWith(
    conversation.id,
    "workspace-1",
    { cursor: "older", limit: 50 },
  ),
);
expect(screen.getByText("oldest message text")).toBeInTheDocument();
```

Stub `scrollHeight` before and after the load and assert the component restores `scrollTop` by the height difference. Add a second test proving the initial newest page calls `scrollIntoView` once, while loading older pages does not issue a new bottom scroll. Include one `message:new` and one `comment:new` WebSocket event and assert each appears once even if a later page contains the same id.

**Step 2: Run failing tests**

Run: `bun --filter @msgflow/web test src/components/inbox/ui-contract.test.tsx`

Expected: FAIL because the thread has a regular `useQuery`, no top-load trigger, and its existing effect always scrolls to bottom after any timeline change.

**Step 3: Implement the paged thread**

1. Replace the timeline `useQuery` with `useInfiniteQuery`, keyed as `['messages', workspaceId, conversationId]`, with `initialPageParam: undefined`, `limit: 50`, and `getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined`.
2. Flatten fetched `TimelineItem`s, then merge WebSocket Message/Comment/Activity entries by a single `type:id` key. Sort display items ascending by `item.createdAt`, then `item.id`, so the DOM remains oldest-to-newest. Use type guards for render paths instead of testing for `"kind" in item` after the response shape change.
3. Give the existing scrolling timeline container `ref={timelineScrollRef}` and `aria-label="Conversation timeline"`. On its `onScroll`, when `scrollTop <= 24` and an older cursor exists, record `{ scrollTop, scrollHeight }`, call `fetchNextPage()`, then in a `useLayoutEffect` after the page is rendered set `scrollTop` to `prior.scrollTop + (current.scrollHeight - prior.scrollHeight)`. Clear the saved measurement afterward.
4. Replace the unconditional bottom-scroll effect with a `didInitialScrollRef`. Scroll to `bottomRef` only after the first nonempty initial page, or when a new live item/composer send arrives while the viewer is already within 48px of bottom. Never bottom-scroll in response to an older-page fetch.
5. Keep `markRead()` based on the highest-sequence Message among both fetched and live timeline items. It must not move the cursor backwards when an older page arrives.
6. Move ActivityModal input to the flattened timeline Activity entries. It will show all activities loaded as the agent scrolls history; do not add a separate Activity endpoint or duplicate cursor implementation.
7. On composer send, invalidate the `['messages', workspaceId, conversationId]` query prefix. On a `message:new`, `comment:new`, or `activity:new` frame, preserve the current local-live approach; dedupe after merging rather than calling `setQueryData` across every infinite page.

**Step 4: Verify pass**

Run:

```bash
bun --filter @msgflow/web test src/components/inbox/ui-contract.test.tsx
bun --filter @msgflow/web test src/routes/-sidebar-live-update.test.tsx
```

Expected: both exit 0. The UI contract test proves older history appends without a scroll jump and live timeline entries are not duplicated.

**Step 5: Commit**

```bash
git add apps/web/src/components/inbox/ConversationThread.tsx apps/web/src/components/inbox/ui-contract.test.tsx
git commit -m "feat: infinitely scroll conversation history"
```

### Task 8: Run repository validation and perform manual browser verification

**Objective:** Confirm type, unit, integration, and visual behavior across browser and Worker packages.

**Files:**
- No code changes expected.

**Step 1: Run automated validation**

Run:

```bash
bun run test
bun run lint
bun run build
```

Expected: all commands exit 0. Resolve any new failures before proceeding; do not modify `.hermes/backups/`, which is pre-existing untracked workspace state.

**Step 2: Run local UI verification**

Run in one terminal:

```bash
bun run dev
```

Expected: Turbo starts the web and Worker development services without build errors. In the browser, seed or use a workspace containing more than 50 conversations and one email conversation plus one Facebook/WhatsApp chat conversation containing more than 50 mixed timeline items. Verify each checklist item:

1. Inbox list appends the next 50 exactly once at bottom; a tied `lastMessageAt` boundary has no gap or duplicate.
2. Changing status, sidebar filter, search, or workspace replaces page one and never shows an old page from another filter/workspace.
3. Opening email and chat conversations starts at the newest message; scrolling to top loads older Messages, Comments, and Activities without moving the visible first item.
4. A live inbound message reaches the bottom once and unread/read behavior still reflects its `seq`.
5. Network requests show `limit=50`; later calls include an opaque `cursor`; malformed manually edited cursors return HTTP 400 rather than page one.

**Step 3: Commit only if validation required fixes**

```bash
git status --short
git add <only-files-fixed-during-validation>
git commit -m "fix: complete pagination validation"
```

Expected: no commit if no validation fix was necessary. Never include `.hermes/backups/`.

## Tests / validation summary

- Contract: `bun --filter @msgflow/contracts test src/pagination-types.test.ts`
- Worker query + transport: `bun --filter @msgflow/worker test test/conversation-pagination.test.ts`
- DO timeline: `bun --filter @msgflow/worker test test/conversation-do-recovery.test.ts`
- Existing access regression: `bun --filter @msgflow/worker test test/conversation-permissions.test.ts`
- Web API + UI behavior: `bun --filter @msgflow/web test src/lib/api.pagination.test.ts` and `bun --filter @msgflow/web test src/components/inbox/ui-contract.test.tsx`
- Full gate: `bun run test && bun run lint && bun run build`

## Risks, tradeoffs, and open questions

- **Cursor staleness under active inboxes:** New messages can reorder conversation pages while the agent scrolls. Keyset pagination prevents duplicates/skips relative to each request’s ordering but cannot create a snapshot without a server-side watermark. This plan intentionally chooses live correctness and prefix invalidation over a snapshot token; the list can refresh page one through the existing five-second refetch and DO invalidation.
- **Private mailbox authorization after pagination:** `filterMailboxAccess()` occurs after the SQL query. The implementation must over-fetch in a bounded loop before producing a cursor, otherwise filtered look-ahead records can create misleading empty pages or terminate too early.
- **Timeline chronology:** Message `seq` is for unread state, not a global timeline sequence; Comments and Activities have no `seq`. The merged timeline uses the existing UI ordering (`createdAt`, then `id`) and must retain that tie-breaker in its cursor.
- **No virtualization in this task:** Infinite query prevents network/database unboundedness but the DOM will still grow during a long browsing session. Add virtualization only after profiling demonstrates it is needed; it would complicate the “preserve scroll after prepend” behavior.
- **Activity modal scope:** It shows activities loaded with the timeline. A separate activity-only endpoint is deliberately excluded to avoid duplicate pagination logic; if product requires activity search or direct jump-to-oldest, create a separate plan.
- **Server response compatibility:** This changes `/api/conversations/:id/messages` from sibling arrays to a paged `items` stream. Before execution, search for non-web consumers (smoke scripts, API docs, external integrations). If any exist, version the endpoint or temporarily return a compatibility representation rather than breaking them silently.
