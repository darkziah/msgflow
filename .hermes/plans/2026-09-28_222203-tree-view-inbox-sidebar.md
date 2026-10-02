# MsgFlow Tree-View Inbox Sidebar Implementation Plan

> **For Hermes:** Use `software-development:subagent-driven-development` to implement this plan task-by-task, preserving the pre-existing changes in `apps/web/src/components/inbox/Composer.tsx` and `apps/web/src/components/inbox/ui-contract.test.tsx`.

**Goal:** Evolve the existing sidebar into a permission-safe navigation tree whose hierarchy never changes MsgFlow’s channel → default inbox → rules → destination-inbox routing.

**Architecture:** Keep `inboxes` as the sole conversation destination model and add parent/sort/navigation metadata to that same table. Assemble one authorized, normalized sidebar tree on the Worker; selection yields a normalized list-filter contract consumed server-side by `listConversations`, including a recursive descendant scope for parent inbox nodes. Keep shared hierarchy mutations separate from per-user overlay preferences and do not introduce drag-and-drop in this release; the existing drawer supplies explicit administrator move controls.

**Tech stack:** Bun workspaces, Cloudflare Worker/Hono, D1/SQLite, Drizzle, Effect Schema, React 19, TanStack Query/Router, Vitest, Miniflare D1 tests, Biome.

---

## Current context / assumptions

### Discovery gap report

| Area | Existing implementation to reuse | Required change | Do not duplicate |
|---|---|---|---|
| Inbox/routing model | `packages/db/src/schema.ts:195-259` has `inboxes`, `inbox_channels`, and `inbox_members`; `conversations.inbox_id` is the only current destination. `apps/worker/src/rules.ts` and `apps/worker/src/manage.ts` own default-inbox/rule routing. | Add nullable `parent_inbox_id`, hierarchy ordering, and an explicit visibility policy to `inboxes` via one forward migration. | Do not add a second “tree inbox”, “folder”, or conversation-ownership table. Do not modify rule destination semantics when moving a tree node. |
| Sidebar persistence | `packages/db/migrations/0004_inbox_routing_sidebar.sql` and `schema.ts:798-823` already created `user_sidebar_preferences`; `workspace-api.ts:493-548` safely persists user-scoped preferences. | Add collapsed node IDs and last-open branch, retain existing section/pin/hide/order state, and migrate the stable-ID validator. | Do not put collapse/pin/hide state on `inboxes` or in shared sort columns. |
| Sidebar API | `apps/worker/src/workspace-api.ts:getSidebar` and `apps/worker/src/index.ts:1276-1286` already expose a single authorized workspace sidebar endpoint. | Replace the flat section/group response with a normalized nested tree and server-calculated counts/capabilities. | Do not split permission-sensitive assembly across browser calls. |
| Sidebar UI | `apps/web/src/components/sidebar/Sidebar.tsx` already has section collapse, active filters, user preference patching, admin drawer, menus, and a `15s` sidebar query. | Replace section/group rendering with recursive tree rows, keyboard roving focus, tree search, node expansion, correct active selection, and capability-gated menu actions. | Do not create a parallel sidebar or remove the existing `AppShell` integration in `apps/web/src/routes/index.tsx`. |
| Inbox administration | `InboxSettingsDrawer.tsx` and `manage.ts:createInbox/updateInbox/archiveInbox/reorderInboxes` already have owner/admin enforcement. | Add explicit parent move controls, cycle prevention, optimistic concurrency/version check, and archive-parent handling. | Do not use existing generic `deleteInbox`; it rehomes all conversations (`manage.ts:1376-1394`) and violates the requested “tree edits never reroute conversations” invariant. |
| Counts/filtering | `queries.ts:listConversations` owns server-side query facets and snooze exclusion. `workspace-api.ts:getSidebar` computes per-inbox and smart-queue counts server-side. | Add recursive descendant filtering/count unions and a normalized node-to-filter contract. | Do not sum child badges or merge client-paginated results; that leaks duplicates and incorrect parent totals. |
| Permissions | `access.ts` enforces workspace role; mailbox-private visibility is applied by `conversationReadPredicate` and `canAccessMailbox`. | Implement inbox/team/private visibility in the conversation list and sidebar tree using one shared authorized-inbox scope helper. | Do not rely on hiding nodes in React; current inbox membership is not a sufficient list-read fence. |
| Secondary node data | `channels`, nested `tags`, and `saved_filters` already exist; current sidebar exposes tags/views. | Reproject them into the normalized tree after My Work and Shared Inboxes are correct. | Do not create duplicate channel/tag/view tables. |
| Tests/demo | `apps/worker/test/routing.test.ts` is the Miniflare D1 regression suite; `apps/web` uses Vitest; `packages/db/seed/demo.sql` is rerunnable. | Extend the existing test styles and add hierarchy fixtures/demo rows. | Do not change user-modified Composer files. |

### Verified conflicts that must be resolved before implementation starts

1. `inboxes` has no parent column, so it cannot represent a shared inbox tree today.
2. The current sidebar is already a sidebar feature, but it is a flat `Inbox`/`Assigned`/`Teams`/`Tags`/`Views` grouping (`workspace-api.ts:278-410`), not the required `My Work` + `Shared Inboxes` tree. It must be extended, not replaced in parallel.
3. The current list query accepts only one exact `inboxId` (`queries.ts:157`) and therefore cannot make a parent inbox include descendants.
4. The existing UI allows every inbox row to be HTML-dragged; admins call `reorderInboxes`, members alter personal order (`Sidebar.tsx:166-203`). This is unsafe for tree hierarchy because it lacks an explicit parent target, cycle checks, and conflict control. Disable shared inbox dragging in Phase 1 and use the drawer’s explicit “Move under…” action.
5. The current conversation read model is workspace-wide for non-private-mailbox conversations (`queries.ts:289-308`); `inbox_members` and `inboxes.team_id` are not an enforced conversation authorization boundary. The requested team/private inbox privacy cannot be claimed until the list, detail, timeline, mutation, and count paths share a server-side inbox scope predicate.
6. `deleteInbox` currently moves conversations to another inbox. Tree editing must not call it. The tree release should expose archive only; retain destructive delete as unavailable/deprecated until a separately approved, explicit conversation-transfer workflow exists.

**Blocking decision:** Before Task 2, obtain product/ADR confirmation that an inbox may be one of `shared | team | private | system`, where `private` means explicitly granted `inbox_members` (not a private email mailbox), and that owners/admins may administer but do not automatically read a private inbox’s conversations. This plan assumes that decision. If it is rejected, stop after Task 1 and amend the authorization design before any schema migration.

### Routing versus tree hierarchy

- Routing remains: incoming channel → exactly one default inbox → matching rules → one destination `conversations.inbox_id`.
- Tree hierarchy is only `inboxes.parent_inbox_id` for navigation, aggregation, and display. Updating it never writes `conversations.inbox_id`, `inbox_channels.is_default`, rule actions, or historical messages.
- A parent node selects the authorized transitive set of descendant inbox IDs. A leaf selects exactly itself. The list performs `WHERE conversations.inbox_id IN (...)`, so a conversation can appear once only.

## Proposed migration and response shapes

Create the next numerically ordered migration after inspecting the current journal; use `0026_tree_view_sidebar.sql` only if `0026` is unused at implementation time.

```sql
ALTER TABLE inboxes ADD parent_inbox_id text REFERENCES inboxes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE inboxes ADD visibility_type text NOT NULL DEFAULT 'shared'
  CHECK (visibility_type IN ('shared', 'team', 'private', 'system'));
--> statement-breakpoint
ALTER TABLE inboxes ADD tree_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE user_sidebar_preferences ADD collapsed_node_ids_json text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE user_sidebar_preferences ADD last_open_branch_ids_json text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX idx_inboxes_workspace_parent_order
  ON inboxes(workspace_id, parent_inbox_id, sort_order, id);
--> statement-breakpoint
CREATE INDEX idx_inboxes_workspace_visibility
  ON inboxes(workspace_id, visibility_type, is_archived);
```

Use the following contract (adapt names only when the existing contract naming convention demands it):

```ts
export type SidebarNodeType =
  | "section" | "smart-view" | "inbox" | "channel-group" | "channel" | "tag" | "saved-view";

export interface SidebarNode {
  id: string;
  type: SidebarNodeType;
  parentId: string | null;
  label: string;
  icon: string | null;
  color: string | null;
  count: number | null;
  unreadCount?: number;
  unassignedCount?: number;
  children: SidebarNode[];
  isCollapsible: boolean;
  isEditable: boolean;
  isHidden: boolean;
  permissionState: "allowed" | "readonly";
  filter: ConversationListFilter;
}

export type ConversationListFilter = {
  status?: "open" | "archived" | "all";
  inboxId?: string;
  inboxScope?: "exact" | "descendants";
  channelIds?: string[];
  channelType?: "facebook" | "email";
  tagId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  snoozed?: boolean;
  savedFilterId?: string;
};
```

Keep saved-filter definitions server-side. The client may receive a saved view’s node ID, but must request/receive validated normalized filters rather than deserialize arbitrary `filters_json` into the query string.

---

## Step-by-step tasks

### Task 1: Record the navigation/routing and visibility decision

**Objective:** Make the blockers above an explicit, reviewable architecture decision before a migration makes privacy semantics permanent.

**Files:**
- Create: `docs/adr/0026-tree-sidebar-navigation.md`
- Modify: `CONTEXT.md` only if the ADR is accepted and its vocabulary introduces `Inbox visibility`.

**Step 1: Write the ADR first**

Include these accepted invariants verbatim:

```md
- `conversations.inbox_id` remains the sole current destination and is never changed by hierarchy edits.
- `inboxes.parent_inbox_id` is navigation-only and may reference only an inbox in the same workspace.
- A parent selection expands to its permitted descendants in the Worker; it never sums client-side child pages.
- `shared` is workspace-visible, `team` requires membership in `inboxes.team_id`, and `private` requires `inbox_members`.
- Workspace owner/admin grants configuration authority but not private-inbox conversation read authority.
- Archive is the only tree lifecycle operation in this release; deleting/re-homing conversations is out of scope.
```

**Step 2: Verify the pre-existing conflict before changing code**

Run:

```bash
bun test apps/worker/test/routing.test.ts --max-concurrency=1
```

Expected: existing routing suite passes; no hierarchy behavior exists yet.

**Step 3: Obtain approval**

Do not begin Task 2 without approval for the private/team visibility interpretation. If product requires admin read access to private inboxes, amend this ADR and every expected authorization test before continuing.

**Step 4: Commit**

```bash
git add docs/adr/0026-tree-sidebar-navigation.md CONTEXT.md
git commit -m "docs: define inbox tree navigation boundary"
```

### Task 2: Add hierarchy and preference persistence through one additive migration

**Objective:** Extend existing tables safely without replacing IDs, channels, routing links, or preferences.

**Files:**
- Modify: `packages/db/src/schema.ts:195-259,798-823`
- Create: `packages/db/migrations/0026_tree_view_sidebar.sql` (use next free migration number)
- Modify: `packages/db/migrations/meta/_journal.json` only if generated tooling requires it
- Modify: `packages/contracts/src/types/index.ts:496-582`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing schema/migration tests**

Add tests that use a fresh Miniflare database to prove:

```ts
expect(await ctx.env.DB.prepare("PRAGMA table_info(inboxes)").all())
  .toContainEqual(expect.objectContaining({ name: "parent_inbox_id" }));
expect(await ctx.env.DB.prepare("PRAGMA table_info(user_sidebar_preferences)").all())
  .toContainEqual(expect.objectContaining({ name: "collapsed_node_ids_json" }));
```

Also insert a parent and child with the same workspace, then assert the child’s `parentInboxId` round-trips through Drizzle.

**Step 2: Run the focused test to verify failure**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL because the columns/types do not exist.

**Step 3: Implement the minimal additive schema/migration**

- Add `parentInboxId`, `visibilityType`, and `treeVersion` to `inboxes`.
- Add `collapsedNodeIdsJson` and `lastOpenBranchIdsJson` to `userSidebarPreferences`.
- Use the SQL shown above, with the next actual migration number.
- Preserve the existing `sort_order`; it becomes sibling order scoped by parent, not a new ordering table.
- Generate with the repository’s migration workflow, inspect SQL, and change boolean defaults to SQLite-safe `0` where applicable.

**Step 4: Verify migration chain and focused test**

```bash
cd packages/db && bun run build
cd ../..
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: PASS, and the test database applies the full migration chain including the new columns/indexes.

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations packages/contracts/src/types/index.ts apps/worker/test/routing.test.ts
git commit -m "feat: add inbox tree persistence"
```

### Task 3: Centralize authorized inbox scope and hierarchy validation

**Objective:** Establish the only reusable authorization/hierarchy primitive before changing list, counts, or UI.

**Files:**
- Create: `apps/worker/src/inbox-tree.ts`
- Modify: `apps/worker/src/access.ts`
- Modify: `apps/worker/src/manage.ts:1175-1634`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing service tests**

Add isolated tests for:

1. shared inbox is included for an authorized workspace member;
2. team inbox is included only for a `team_members` row;
3. private inbox is included only for its `inbox_members` row;
4. owner/admin can edit all inbox configurations but cannot obtain a private inbox in `getReadableInboxIds` without an explicit grant;
5. foreign workspace parent is rejected;
6. moving a node below itself or any descendant returns `ManageError` 409;
7. parent move changes only `parent_inbox_id`, `sort_order`, and `tree_version`; conversation inbox IDs and `inbox_channels.is_default` are unchanged.

**Step 2: Run the focused test to verify failure**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL because `getReadableInboxIds`, `getInboxDescendantIds`, and `moveInboxInTree` do not exist.

**Step 3: Implement minimal shared helpers**

In `apps/worker/src/inbox-tree.ts`, implement and export:

```ts
export async function getReadableInboxIds(
  db: ReturnType<typeof drizzle>, workspaceId: string, userId: string,
): Promise<string[]>;

export async function getInboxDescendantIds(
  db: ReturnType<typeof drizzle>, workspaceId: string, rootInboxId: string, readableInboxIds: string[],
): Promise<string[]>;

export async function assertValidInboxParent(
  db: ReturnType<typeof drizzle>, workspaceId: string, inboxId: string, parentInboxId: string | null,
): Promise<void>;
```

Use a parameterized SQLite `WITH RECURSIVE` query for descendants and cycle detection; constrain every traversal by `workspace_id`. Keep depth bounded defensively (for example 64) and convert malformed/cyclic legacy data into a 409/error rather than recursing forever.

Extend `createInbox`, `updateInbox`, and a new explicit `moveInboxInTree` service to validate parent IDs and sibling ordering. Do not call `setDefaultInbox`, `evaluateRules`, or update `conversations` from this path. Reject stale `expectedTreeVersion` with 409 so two admins cannot silently overwrite each other’s move.

**Step 4: Verify pass**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: PASS; service-level privacy, cycle, and no-reroute assertions pass.

**Step 5: Commit**

```bash
git add apps/worker/src/inbox-tree.ts apps/worker/src/access.ts apps/worker/src/manage.ts apps/worker/test/routing.test.ts
git commit -m "feat: enforce inbox tree visibility and moves"
```

### Task 4: Make every conversation read/count path consume the same authorized scope

**Objective:** Ensure inaccessible inboxes and their counts cannot leak through parent selections, All, smart queues, tags, or saved views.

**Files:**
- Modify: `apps/worker/src/queries.ts:107-230`
- Modify: `apps/worker/src/index.ts:393-440,442-469` and all conversation detail/timeline/mutation handlers found by search
- Modify: `apps/worker/src/conversation-permissions.ts` if it is the existing detail/timeline authorization seam
- Test: `apps/worker/test/conversation-permissions.test.ts`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing tests**

Test a workspace containing a shared root, a permitted child, and an inaccessible team/private child. Assert:

```ts
expect((await listConversations(env, MEMBER, { inboxId: root, inboxScope: "descendants" }, workspaceId))
  .map((row) => row.id))
  .toEqual([permittedConversationId]);
```

Add exact-leaf, parent-union/no-duplicate, unauthorised guessed inbox ID, channel/tag/smart queue, conversation detail, timeline read, and metadata mutation tests. Every unauthorized access must return the repository’s 403/404-safe response and expose no count.

**Step 2: Run failing tests**

```bash
cd apps/worker && bun test test/conversation-permissions.test.ts --max-concurrency=1
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL because `ConversationListOptions` has no descendant scope and current non-mailbox reads are workspace-wide.

**Step 3: Implement one normalized filter path**

- Extend `ConversationListOptions` with `inboxScope?: "exact" | "descendants"`, `channelIds?: string[]`, and a server-resolved saved-view filter input; do not accept arbitrary comma-separated inbox IDs from the browser.
- In the route, validate only a requested node/filter identity, resolve it against the current user/workspace, then pass the authorized resolved inbox/channel scope to `listConversations`.
- In `listConversations`, intersect requested scope with `getReadableInboxIds` before constructing `inArray(conversations.inboxId, ids)`. Return an empty list, not an unscoped list, for an empty allowed scope.
- Reuse that identical scope in sidebar counts. Preserve `open|archived` and future-snooze exclusivity exactly as current code does.
- Route detail, timeline, read cursor, tag mutation, status/assignment/snooze/move, comment, and WebSocket authorization through the same inbox-aware predicate before resolving a DO.

**Step 4: Verify pass**

```bash
cd apps/worker && bun test test/conversation-permissions.test.ts --max-concurrency=1
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: PASS; inaccessible nodes, conversations, totals, and descendants do not leak.

**Step 5: Commit**

```bash
git add apps/worker/src/queries.ts apps/worker/src/index.ts apps/worker/src/conversation-permissions.ts apps/worker/test/conversation-permissions.test.ts apps/worker/test/routing.test.ts
git commit -m "feat: scope conversation reads to authorized inbox trees"
```

### Task 5: Replace the sidebar flat DTO with a normalized, server-assembled tree

**Objective:** Make `GET /api/workspaces/:workspaceId/sidebar` the authoritative permitted tree with correct count unions and node capabilities.

**Files:**
- Modify: `packages/contracts/src/types/index.ts:496-609`
- Modify: `packages/contracts/src/management-schema.ts:44-58`
- Modify: `apps/worker/src/workspace-api.ts:49-605`
- Modify: `apps/worker/src/index.ts:1274-1286,1699-1720`
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing tree tests**

Add fixtures that produce `My Work`, `Shared Inboxes`, a parent/child/grandchild hierarchy, a hidden restricted leaf, one Facebook channel, one email channel, one tag, and one saved view. Assert:

- root section order is exactly `my-work`, `shared-inboxes`, `channels`, `tags`, `saved-views`;
- parent contains only permitted descendants;
- parent count equals `COUNT(DISTINCT conversations.id)` over its accessible descendant IDs, not the sum of children;
- a conversation in one leaf occurs once in its parent count;
- My Work counts use the current user and actionable/open/not-future-snoozed predicate;
- private tag visibility follows existing tag ownership rules;
- sidebar response gives `isEditable: true` only to workspace admins for shared inbox nodes;
- malformed stored preference JSON falls back safely;
- counts still return nodes with `count: null` if a count subquery fails (log server-side failure without failing the whole tree response).

**Step 2: Run failing test**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL because current `SidebarSection`/`SidebarGroup` cannot represent nested inboxes or node expansion preferences.

**Step 3: Implement the tree contract and assembler**

- Replace legacy `SidebarItem/SidebarGroup/SidebarSection` types with `SidebarNode` and `SidebarTreeResponse`; remove obsolete type uses in the same commit so the web build cannot bind to both shapes.
- Build node maps by stable IDs: `section:my-work`, `section:shared-inboxes`, `inbox:<id>`, `channel-group:facebook`, `channel:<id>`, `tag:<id>`, `view:<id>`, `smart:<name>`.
- Return only `getReadableInboxIds` results. When a parent has no permitted children and is not independently actionable, omit it rather than leaking its label/count.
- Compute leaf/open/unread/unassigned counts in SQL from the authorized scope. Derive each parent count with a recursive descendant CTE and `COUNT(DISTINCT conversations.id)`. Badge format belongs in the UI; return numeric counts.
- Extend preferences with `collapsedNodeIds` and `lastOpenBranchIds`, validate IDs against nodes the current user may see, and never let unknown stored IDs affect output.
- Preserve pin/hide/order as per-user overlays. Apply them in the Worker where possible so hidden nodes do not flash before the browser applies preferences; keep a local UI fallback for optimistic updates.
- Add `GET /api/workspaces/:workspaceId/sidebar` response caching only after a measured query plan. Do not cache across user/workspace IDs.

**Step 4: Verify pass and contracts build**

```bash
cd packages/contracts && bun run build
cd ../..
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: contract build and focused Miniflare tests PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/types/index.ts packages/contracts/src/management-schema.ts apps/worker/src/workspace-api.ts apps/worker/src/index.ts apps/worker/test/routing.test.ts
git commit -m "feat: serve authorized sidebar navigation tree"
```

### Task 6: Add explicit, safe administrator tree moves and archive behavior

**Objective:** Expose tree editing without routing or historical-conversation side effects.

**Files:**
- Modify: `packages/contracts/src/management-schema.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/manage.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/sidebar/InboxSettingsDrawer.tsx`
- Test: `apps/worker/test/routing.test.ts`
- Test: `apps/web/src/components/sidebar/InboxSettingsDrawer.test.tsx` (new)

**Step 1: Write failing service/UI tests**

Test `POST /api/workspaces/:workspaceId/inboxes/:inboxId/move` with:

```json
{ "parentInboxId": "parent-id", "beforeInboxId": null, "expectedTreeVersion": 3 }
```

Assert admin succeeds, member receives 403, cross-workspace/cycle/stale-version receives 409/404 as appropriate, and neither `conversations.inbox_id` nor `inbox_channels.is_default` changes. UI test: non-admin sees no edit control; admin drawer shows Parent Inbox selector and server error.

**Step 2: Run failing tests**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
cd ../web && bun test src/components/sidebar/InboxSettingsDrawer.test.tsx
```

Expected: FAIL because the move endpoint/control does not exist.

**Step 3: Implement minimal explicit move**

- Add an Effect Schema request with `parentInboxId`, optional sibling placement, and required `expectedTreeVersion`.
- Add the new route only; do not overload `/reorder` with parent changes.
- In one D1 batch, revalidate workspace/admin, source/current parent/target parent, no cycle, re-number source and target sibling groups deterministically, then increment moved inbox `tree_version`.
- In the existing drawer, add a “Tree location” section with `Root of Shared Inboxes` plus permitted inbox choices excluding the edited node and descendants. Submit the endpoint, invalidate `["sidebar", workspaceId]` plus inbox lists, and display 409 conflict text with a Reload action.
- Retain channel links/default management as a visibly separate “Routing” section. Add explanatory copy: “Moving this node only changes sidebar organization; existing conversations and routing rules stay unchanged.”
- Remove `draggable` shared-inbox behavior from `Sidebar.tsx` in this release. Personal pin ordering remains via preferences; no shared DnD until phase 2.
- Do not render the destructive delete endpoint in tree management. Archive instead; define archive parent behavior as: archive the node, leave children attached and visible under the nearest active ancestor/root, and preserve all conversations in their current leaf inboxes.

**Step 4: Verify pass**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
cd ../web && bun test src/components/sidebar/InboxSettingsDrawer.test.tsx
```

Expected: PASS; tree move is admin-only, conflict-safe, and proves no reroute.

**Step 5: Commit**

```bash
git add packages/contracts/src/management-schema.ts apps/worker/src/index.ts apps/worker/src/manage.ts apps/web/src/lib/api.ts apps/web/src/components/sidebar/InboxSettingsDrawer.tsx apps/worker/test/routing.test.ts apps/web/src/components/sidebar/InboxSettingsDrawer.test.tsx
git commit -m "feat: add safe shared inbox tree moves"
```

### Task 7: Render the recursive sidebar tree with persistent expansion and keyboard navigation

**Objective:** Ship My Work and Shared Inboxes as the first usable tree sections in the existing left sidebar shell.

**Files:**
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx`
- Modify: `apps/web/src/components/sidebar/sidebar-prefs.ts`
- Create: `apps/web/src/components/sidebar/SidebarTree.tsx`
- Create: `apps/web/src/components/sidebar/SidebarTree.test.tsx`
- Modify: `apps/web/src/routes/index.tsx:185-204,277-290`
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Write failing UI tests**

Use a fixture `SidebarTreeResponse` to assert:

- My Work appears before Shared Inboxes;
- collapsed parent hides its descendants and updates `collapsedNodeIds` through the preferences API;
- ArrowRight expands/focuses first child, ArrowLeft collapses/focuses parent, ArrowUp/ArrowDown move through visible rows, Enter selects;
- active parent/child row reflects the normalized filter;
- a 1,024 count renders `999+` while its accessible label is `aria-label="1024 actionable conversations"`;
- selecting parent calls `onSelect({ inboxId: "parent", inboxScope: "descendants", status: "open" })`;
- selecting a leaf calls exact scope;
- `isEditable: false` does not render hover edit actions;
- search filters visible rows but keeps ancestor paths required to reach a match;
- the empty tree renders “No shared inboxes yet” and an admin-only create button.

**Step 2: Run to verify failure**

```bash
cd apps/web && bun test src/components/sidebar/SidebarTree.test.tsx
```

Expected: FAIL because `SidebarTree` and nested node semantics do not exist.

**Step 3: Implement the recursive component**

- Keep `Sidebar.tsx` as fetch/preference/drawer orchestration; move recursion and roving-tabindex logic into `SidebarTree.tsx`.
- Render semantic `role="tree"`, `role="treeitem"`, `aria-level`, `aria-expanded`, and one tab stop. Do not use nested buttons.
- Persist section collapse and inbox/channel/tag node collapse separately through `PATCH sidebar-preferences`; debounce preference writes by 250 ms and retain the existing optimistic rollback behavior.
- Add a small tree filter input only when the expanded node count is above the agreed threshold (start at 12); use client filtering only on already-authorized tree data.
- Replace flat `itemFilters` with a pure exported `nodeFilter(node)` function. In `index.tsx`, clear selected conversation (`c`) when a node changes; if a selected node is removed/inaccessible after a refetch, reset filters to My Work/Assigned-to-me and navigate to the workspace-only URL.
- Preserve the current sidebar pane width, compact mode, AppShell placement, drawer behavior, TooltipProvider primitives, and mobile sidebar behavior.

**Step 4: Verify pass**

```bash
cd apps/web && bun test src/components/sidebar/SidebarTree.test.tsx
bun run build
```

Expected: tree tests PASS and Vite build exits 0.

**Step 5: Commit**

```bash
git add apps/web/src/components/sidebar/Sidebar.tsx apps/web/src/components/sidebar/sidebar-prefs.ts apps/web/src/components/sidebar/SidebarTree.tsx apps/web/src/components/sidebar/SidebarTree.test.tsx apps/web/src/routes/index.tsx apps/web/src/lib/api.ts
git commit -m "feat: render navigable inbox sidebar tree"
```

### Task 8: Add Channels, Tags, and Saved Views as secondary normalized nodes

**Objective:** Complete the requested navigation sections without weakening the first-release My Work/Shared Inbox behavior.

**Files:**
- Modify: `apps/worker/src/workspace-api.ts`
- Modify: `apps/worker/src/queries.ts`
- Modify: `packages/contracts/src/types/index.ts`
- Modify: `apps/web/src/components/sidebar/SidebarTree.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Test: `apps/worker/test/routing.test.ts`
- Test: `apps/web/src/components/sidebar/SidebarTree.test.tsx`

**Step 1: Write failing tests**

Cover channel group selection (`channelIds` for Facebook/Email group; exact `channelId` for leaf), visible tag selection, saved view selection with validated saved filters, hidden optional Tags/Views section behavior, and private tag omission for another agent.

**Step 2: Run failing tests**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
cd ../web && bun test src/components/sidebar/SidebarTree.test.tsx
```

Expected: FAIL until these node types produce normalized filters.

**Step 3: Implement narrowly**

- Project existing `channels`, `tags`, and `saved_filters` into the existing tree endpoint; do not add new endpoints unless a node’s data cannot be obtained there.
- Use existing `tags.visibility`/owner rules and the authorized inbox scope for their counts.
- Expand the server filter resolver so saved-view definitions are validated with `validateFilters` and intersected with current access on every selection; a stale/deleted view returns 404 and causes the UI to clear selection.
- Let users hide Tags and Saved Views as section preferences. Do not implement channel/tag drag-drop.

**Step 4: Verify pass**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
cd ../web && bun test src/components/sidebar/SidebarTree.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/workspace-api.ts apps/worker/src/queries.ts packages/contracts/src/types/index.ts apps/web/src/components/sidebar/SidebarTree.tsx apps/web/src/routes/index.tsx apps/worker/test/routing.test.ts apps/web/src/components/sidebar/SidebarTree.test.tsx
git commit -m "feat: add channels tags and views to sidebar tree"
```

### Task 9: Make count refreshes targeted and robust

**Objective:** Refresh impacted sidebar counts after all listed metadata transitions without relying on full frontend pagination merges.

**Files:**
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/inbox/ConversationActions.tsx`
- Modify: `apps/web/src/components/inbox/TagPicker.tsx`
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx`
- Modify: `apps/worker/src/index.ts` only if a lightweight sidebar revision response is needed
- Test: `apps/web/src/routes/-sidebar-live-update.test.tsx` (new)
- Test: `apps/worker/test/routing.test.ts`

**Step 1: Write failing tests**

For inbox move, assignment, status/archive/reopen, snooze, unread/read, and tag update, assert the action invalidates only `['sidebar', workspaceId]` and the affected conversation query keys. For inbound/provider events, test that the existing conversation DO event triggers a bounded sidebar refetch/revision refresh rather than rebuilding counts from the current page.

**Step 2: Run failing tests**

```bash
cd apps/web && bun test src/routes/-sidebar-live-update.test.tsx
cd ../worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL until shared invalidation helpers exist.

**Step 3: Implement the minimal invalidation strategy**

- Create one exported web helper (for example `invalidateWorkspaceConversationViews(queryClient, workspaceId)`) and call it after successful conversation/tag/inbox mutations.
- Keep the existing conversation polling as a reconnect fallback. Reduce sidebar polling only after a websocket/revision path is verified; start by polling the small sidebar endpoint every 5 seconds while online and suspend it while offline, rather than refetching separate count endpoints.
- If a cross-conversation update channel is added, make it transmit only `{ workspaceId, sidebarRevision }`; the client then invalidates the tree query. Do not broadcast counts or unauthorized node data from a conversation DO.
- In sidebar assembly, isolate count-query failure from structural tree failure: return nodes with unavailable count rather than a broken navigation sidebar.

**Step 4: Verify pass**

```bash
cd apps/web && bun test src/routes/-sidebar-live-update.test.tsx
cd ../worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: PASS; no UI test calculates parent totals from paginated conversation rows.

**Step 5: Commit**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/components/inbox/ConversationActions.tsx apps/web/src/components/inbox/TagPicker.tsx apps/web/src/components/sidebar/Sidebar.tsx apps/worker/src/index.ts apps/web/src/routes/-sidebar-live-update.test.tsx apps/worker/test/routing.test.ts
git commit -m "feat: refresh sidebar counts after conversation changes"
```

### Task 10: Upgrade local demo data for tree inspection

**Objective:** Provide rerunnable local data that demonstrates hierarchy without polluting production paths or changing routing behavior.

**Files:**
- Modify: `packages/db/seed/demo.sql`
- Test: `apps/worker/test/routing.test.ts`
- Optional test script: existing local D1 workflow only; do not reset a developer’s database.

**Step 1: Write a seed-shape regression**

Test that the seed’s named inboxes have this navigation only:

```text
Customer Support
  General
  Technical Support
  Billing
Sales
  New Leads
  VIP Customers
```

Assert each existing channel still has exactly one default inbox and each rule still points to the same leaf destination as before hierarchy metadata is added.

**Step 2: Run failing test**

```bash
cd apps/worker && bun test test/routing.test.ts --max-concurrency=1
```

Expected: FAIL because parent fields are absent from existing seed data.

**Step 3: Update only seed hierarchy fields**

- Add two stable parent inbox rows (or repurpose existing safe shared inboxes only after confirming no rule/default behavior changes).
- Set child `parent_inbox_id`/sibling `sort_order`; leave `inbox_channels`, `rules`, and existing conversation destination IDs unchanged.
- Use `INSERT OR IGNORE`/idempotent updates consistent with the seed’s current style.

**Step 4: Verify seed safely on an isolated scratch D1 database**

```bash
cd apps/worker
DB_FILE="$(mktemp -u /tmp/msgflow-tree-seed.XXXXXX.sqlite)"
for migration in ../../packages/db/migrations/*.sql; do bunx wrangler d1 execute msgflow --local --file="$migration"; done
bunx wrangler d1 execute msgflow --local --file=../../packages/db/seed/demo.sql
bunx wrangler d1 execute msgflow --local --file=../../packages/db/seed/demo.sql
bun test test/routing.test.ts --max-concurrency=1
```

Expected: seed applies twice without duplicate rows, focused tests PASS. Before executing for real, adapt the exact scratch-D1 invocation to the repository’s Miniflare state workflow; do not use or delete an existing local database.

**Step 5: Commit**

```bash
git add packages/db/seed/demo.sql apps/worker/test/routing.test.ts
git commit -m "chore: seed inbox sidebar tree demo"
```

### Task 11: Run the full verification and document operational behavior

**Objective:** Confirm the integrated feature satisfies every acceptance criterion and document known phase-two exclusions.

**Files:**
- Create: `docs/tree-sidebar.md`
- Modify: `README.md` only if local demo instructions are currently documented there.

**Step 1: Write the implementation notes**

`docs/tree-sidebar.md` must state:

- routing hierarchy vs. navigation hierarchy;
- counts use authorized recursive inbox sets and `COUNT(DISTINCT conversations.id)`;
- permission checks occur in Worker tree/list/detail/mutation/DO authorization seams, not UI visibility;
- user preference fields are per-user/per-workspace and cannot mutate shared routing;
- phase 2: accessible drag-and-drop backed by the same move endpoint, richer saved-view builder, unread aggregate refinements, server-pushed workspace sidebar revisions, and measured count materialization only if query plans require it.

**Step 2: Run full checks**

```bash
bun run test
bun run lint
bun run build
bunx biome format --check packages/db/src/schema.ts packages/contracts/src/types/index.ts packages/contracts/src/management-schema.ts apps/worker/src/inbox-tree.ts apps/worker/src/workspace-api.ts apps/worker/src/queries.ts apps/worker/src/manage.ts apps/worker/src/index.ts apps/web/src/components/sidebar/Sidebar.tsx apps/web/src/components/sidebar/SidebarTree.tsx apps/web/src/components/sidebar/InboxSettingsDrawer.tsx apps/web/src/routes/index.tsx

git diff --check
git status --short
```

Expected: all commands exit 0. `git status --short` contains only intentional tree-sidebar/docs changes plus the user’s pre-existing Composer changes, which must remain unmodified by this feature.

**Step 3: Perform manual local acceptance with representative data**

Run `bun run dev`, authenticate as owner, member, team member, and private-inbox member. At desktop and mobile widths verify:

1. My Work and Shared Inboxes are first;
2. nested expansion/collapse persists after reload;
3. parent selection returns distinct conversations from accessible descendants;
4. leaf selection returns exact leaf conversations;
5. counts change after assignment/status/snooze/tag/inbox move;
6. a restricted child is absent and cannot be fetched by manually changing query parameters;
7. admin drawer move/archive retains each historical `conversations.inbox_id` and every channel default/rule destination;
8. deleted/stale/inaccessible selected nodes recover to My Work without a blank list;
9. no sidebar controls overlap in the existing fixed pane.

**Step 4: Commit**

```bash
git add docs/tree-sidebar.md README.md
git commit -m "docs: document inbox sidebar tree behavior"
```

---

## Tests / validation matrix

| Acceptance criterion | Primary automated proof |
|---|---|
| My Work/Shared Inboxes first and recursive UI | `SidebarTree.test.tsx` order/ARIA/selection tests |
| Parent selection includes descendants without duplicates | `routing.test.ts` recursive scope + distinct count/list fixtures |
| Accurate actionable counts | `routing.test.ts` status/snooze/assignment/tag fixtures; no client count aggregation |
| Persistent personal collapse state | Worker preference persistence tests + SidebarTree preference mutation test |
| Restricted nodes/counts never leak | `conversation-permissions.test.ts` list/detail/timeline/count tests |
| Admin create/edit/move/archive only | `routing.test.ts` service/route authorization tests + drawer test |
| Tree edits do not reroute | `routing.test.ts` snapshots of conversations/default links/rules before and after move |
| Existing routing remains | Existing routing/default-inbox/rules tests run unchanged in full worker suite |
| Large/deep/empty/offline/race edge cases | focused recursive, 999+, no-inbox, stale-version, and count-failure tests in routing/UI suites |

Use the TDD order stated in each task. Do not commit unless the task’s focused tests pass. Do not run root `bun run format` during this scoped work because it writes unrelated files; use Biome check/targeted formatting only.

## Risks, tradeoffs, and open questions

1. **Authorization rollout is the largest risk.** Enforcing team/private inbox access changes the current workspace-wide conversation read behavior. It must be released atomically across list/detail/timeline/WebSocket/mutations; otherwise the sidebar can be correct while a guessed conversation ID leaks data.
2. **Tree selection needs an explicit contract.** A raw `inboxIds[]` browser query would create an authorization bypass surface. The server must resolve a node/filter identity and intersect it with readable inbox IDs.
3. **Recursive count cost grows with depth and inbox count.** Begin with indexed recursive CTEs and inspect `EXPLAIN QUERY PLAN` with representative data. Add a materialized aggregate/revision table only after measurements prove the direct query inadequate; premature materialization complicates ingest and race recovery.
4. **Archived parent semantics are ambiguous.** This plan keeps children usable and reparents their visual placement to the nearest active ancestor/root. Confirm whether the product instead wants archive cascading (not recommended because it would hide active leaves).
5. **“Private inbox” must not be confused with Private Mailbox.** They are separate concepts. A private mailbox’s content rules remain mailbox-specific; its inbox visibility must satisfy both mailbox authorization and inbox visibility, never broaden either.
6. **Channels/Tags/Saved Views are secondary.** Do not delay My Work, hierarchy, permission fencing, and count correctness to ship all secondary node polish at once.
7. **Drag-and-drop is intentionally phase 2.** Existing HTML drag-drop is insufficiently accessible and safe. The explicit drawer move API is the delivery path now; later DnD must call that exact versioned API and never alter routing.
8. **Potential scope clarification:** Does “Unassigned” mean all actionable conversations in every readable inbox (this plan) or only under a selected shared-inbox branch? The plan uses global readable scope for My Work; branch-local Unassigned can be a future contextual smart view.
