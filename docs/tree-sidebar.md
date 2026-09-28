# Tree sidebar

## Purpose and boundary

The inbox tree is navigation and aggregation metadata, not a second routing
model. `conversations.inbox_id` remains the only current conversation
destination. Moving an inbox changes only its `parent_inbox_id`, sibling
`sort_order`, and tree version; it does not change conversations, channel
defaults, or rules.

Inbound routing remains channel → default inbox → rules → one destination
inbox. The tree organizes that destination inboxes for display and selection.

## Sidebar response and selection

`GET /api/workspaces/:workspaceId/sidebar` returns the authorized tree for the
current workspace member. Its stable node IDs include sections, smart views,
inboxes, channel groups/channels, tags, and saved views. The response includes
per-user sidebar preferences and the caller's administrative capability.

The default sections are:

1. My Work — Assigned to me, Unassigned, Snoozed, and Done/Closed.
2. Shared Inboxes — the recursive inbox tree.
3. Channels — Facebook and Email groups when linked channels exist.
4. Tags.
5. Saved Views.

A leaf inbox selection uses an exact inbox scope. Selecting an inbox with
children requests descendant scope, so the Worker expands the selected inbox
and its readable descendants before the conversation-list query is ordered and
paginated. Clients do not request child pages or merge child results locally.

The React tree supplies semantic `tree`/`treeitem` roles, roving keyboard
focus, Arrow-key expand/collapse navigation, Enter/Space selection, and search
when the expanded node count exceeds 12. Search only filters the already
authorized sidebar response. Tree settings use the existing inbox settings
drawer; shared drag-and-drop is not part of this release.

## Authorization and visibility

The Worker, rather than the UI, is the authorization boundary for the tree and
conversation data. The shared inbox-scope helper is used by sidebar assembly,
conversation list expansion, conversation detail/timeline checks, and
conversation mutation/DO authorization seams.

Only non-archived inboxes readable by the current workspace member appear in
or contribute to the tree. Readability is evaluated per inbox:

- `shared`: workspace-readable when it has no explicit grants; otherwise only
  its `inbox_members` grants may read it.
- `team`: requires a valid same-workspace `team_id` and matching
  `team_members` membership.
- `private`: requires an explicit `inbox_members` grant. Workspace owners and
  administrators can configure it but do not gain conversation read access
  solely from that role.
- `system`: service-managed and workspace-readable by default.

Mailbox authorization is an additional restriction. A private mailbox requires
both its owner/delegate authorization and the backing private inbox grant; a
team shared mailbox must use its matching team inbox. A readable parent never
causes an unreadable child or its conversations to be returned.

Tree traversal rejects self-parenting, cross-workspace parents, cycles, and
excessive depth. Tree moves are versioned: the caller supplies the inbox's
expected tree version, so a stale concurrent move fails rather than silently
overwriting a newer placement. Archiving hides an inbox as a tree node without
re-homing conversations; visible active children are promoted for display to
the nearest visible active ancestor or root.

## Counts and refreshes

Inbox badges represent actionable open conversations (excluding future-snoozed
items) in the caller's authorized inbox scope. The Worker computes recursive
inbox aggregates with a recursive CTE and `COUNT(DISTINCT conversations.id)`,
so a parent count includes each readable descendant conversation once. The
browser does not sum badges or derive totals from a paginated conversation
page.

If a sidebar count query fails, the navigation tree still renders and the
affected counts are unavailable (`null`) rather than displayed as zero. After a
conversation mutation, the web app invalidates the active workspace's sidebar
and conversation queries. The sidebar also refetches every five seconds while
online as a bounded fallback.

## Personal preferences

Sidebar preferences are scoped to one user and one workspace. They store
collapsed sections, collapsed node IDs, last-open branch IDs, pinned and hidden
item IDs, and item order. The client applies preference changes optimistically,
debounces persistence by 250 ms, and restores the prior value if the request
fails. The Worker validates and removes unknown or unauthorized IDs.

Preferences affect presentation only. They cannot alter shared tree placement,
conversation destinations, channel defaults, or routing rules.

## Operations

Administrators create and edit shared inboxes through the sidebar drawer. A
move uses:

`POST /api/workspaces/:workspaceId/inboxes/:inboxId/move`

with `parentInboxId`, optional `beforeInboxId`, and `expectedTreeVersion`.
The endpoint is navigation-only and returns a conflict for an invalid parent,
cycle, sibling anchor, or stale version. Refresh the sidebar and retry after a
conflict. Archive is the supported tree lifecycle operation; destructive
conversation re-homing is intentionally not exposed in tree management.

## Phase 2 exclusions

- Accessible drag-and-drop that calls the same versioned move endpoint.
- A richer saved-view builder.
- Unread aggregate refinements.
- Server-pushed workspace sidebar revisions.
- Count materialization only after representative query-plan measurements show
  that recursive aggregates require it.
