# ADR 0026: Tree sidebar navigation boundary

**Status:** Accepted

## Context

ADR 0017 established inboxes as routing destinations and the sidebar as a
workspace-scoped read shape. The refreshed sidebar needs nested inbox
navigation without changing the routing model or weakening inbox visibility.
A hierarchy must therefore organize navigation and selection only: it must not
introduce a second destination for conversations, change client pagination
semantics, or imply that Workspace configuration roles can read private queue
content.

This ADR supersedes the older workspace-wide sidebar/read-model scope in ADR
0017's **"Workspace-scoped API + access model"** and **"Sidebar"** decisions
where those decisions say that reads require workspace membership and that all
non-archived inboxes render for members. Hierarchy-aware authorization replaces
that scope on every inbox/sidebar and conversation list, detail, timeline, and
mutation path. ADR 0017's routing, presentation, lifecycle, preference, and
other non-conflicting decisions remain accepted; this ADR does not supersede
ADR 0017's virtual-queue decision.

This ADR also distinguishes similarly named resources. Inbox visibility is a
four-mode taxonomy; a Private Mailbox is a separate resource that can be backed
by a private Inbox. Private Mailbox provisioning synchronizes the backing
Inbox's auditable membership grants with mailbox owner/delegate authorization;
workspace configuration authority does not override content authorization.

## Decisions

### Tree model and routing boundary

- `conversations.inbox_id` remains the sole current destination and is never
  changed by hierarchy edits.
- `inboxes.parent_inbox_id` is navigation-only and may reference only an inbox
  in the same Workspace.
- The hierarchy is an acyclic forest. APIs and database constraints that create
  or update a parent link reject a self-parent and reject any proposed parent
  that is a descendant of the source inbox. Ancestor/descendant validation and
  traversal must be bounded and defensive (visited-set/cycle detection plus a
  depth or node bound), so corrupt or concurrent data cannot loop or exhaust a
  request.
- Parent/child links are presentation structure, not routing rules, assignment
  state, or a replacement for the current inbox destination.
- Archive is the only tree lifecycle operation in this release; deleting or
  re-homing conversations is out of scope.

### Parent selection and pagination

- A parent selection expands in the Worker to that selected Inbox's own
  conversations plus every readable recursive descendant's conversations,
  distinct by conversation id. It never sums client-side child pages.
- The Worker applies the active Agent's inbox and Mailbox visibility rules while
  resolving descendants and returns one authoritative conversation result set
  and page boundary for the selected tree node.
- The expanded result preserves the existing deterministic conversation-list
  ordering and pagination semantics; deduplication occurs before that ordering
  and cursor/page boundary are applied.
- Clients render that result and its pagination cursor. They do not issue one
  conversation-list request per child and merge, count, sort, or paginate those
  results locally.

### Inbox visibility, storage, and authority

- `inboxes.visibility_type` is exactly one of `shared | team | private |
  system`. No other value or overloaded meaning is permitted.
- A `shared` Inbox is visible and readable to authorized Workspace members
  under its public/restricted policy. A public shared Inbox is available to
  Workspace members; a restricted shared Inbox uses the app's existing
  `inbox_members` mechanism to grant its authorized members access. Its
  public/restricted policy and grants define shared access.
- A `team` Inbox requires a non-null `inboxes.team_id` that belongs to the same
  Workspace as the Inbox, and a matching `team_members` membership for access.
  Creation and updates validate both requirements. `inbox_members` must never
  substitute for `team_members` membership when `visibility_type = team`.
- A Shared Mailbox linked to a Team must use `visibility_type = 'team'`; its
  backing Inbox's `team_id` must be that same Workspace Team. Subject to the
  Mailbox lifecycle/readiness gates, active `team_members` receive the Shared
  Mailbox's documented read, reply, and send-as authority. This path requires
  no `inbox_members` projection, and `inbox_members` cannot substitute for
  `team_members` on that team Inbox.
- A Shared Mailbox with no Team must use a restricted shared Inbox
  (`visibility_type = 'shared'`) and its explicit `inbox_members` grants until
  an administrator deliberately makes that shared Inbox public. A public shared
  Inbox means Workspace members; a restricted shared Inbox means only its
  `inbox_members` grants.
- Every Shared Mailbox authorization requires both the Mailbox's applicable
  lifecycle/access authorization and the backing Inbox policy. No broad parent,
  Workspace owner, or administrator role bypasses either requirement.
- A `private` Inbox is a generic private Inbox and requires an explicit
  `inbox_members` grant for every content reader. Workspace owners and admins
  may configure it, but cannot read its conversations without their own
  `inbox_members` grant.
- `system` is reserved for an actual product-managed routing Inbox with a real
  conversation destination. A persisted `inboxes.visibility_type = 'system'`
  row is never a virtual queue, generic visibility/configuration record, or
  virtual node: ADR 0017's My Work smart views, Snoozed, and other virtual
  queues remain sidebar/query nodes and are never `inboxes` rows. Only service
  code may create, edit, or move a system Inbox. Its visibility is explicitly
  Workspace-readable unless a product-specific service defines a different
  policy.
- A Private Mailbox remains a separate resource. Its provisioning and every
  owner/delegate lifecycle change atomically materialize or synchronize the
  corresponding auditable `inbox_members` grants (or equivalent auditable
  projection) for its backing private Inbox; delegate revocation immediately
  revokes the corresponding grant. Effective content access requires matching
  Mailbox owner/delegate authorization and that synchronized grant, not a
  separately acquired manual grant. An arbitrary Inbox member, ancestor,
  Workspace owner, or admin cannot bypass Mailbox authorization. This rule
  applies to direct selection, parent expansion, detail, timeline, and
  mutations.
- Parent-tree visibility, a readable ancestor, Workspace owner/admin
  configuration authority, and descendant expansion cannot override any Inbox
  visibility rule or the Private Mailbox authorization-and-synchronized-grant
  rule.
- Direct inbox selection, descendant expansion, conversation detail and
  timeline reads, and all conversation mutations enforce the same hierarchy-
  aware authorization rules. A permitted parent never exposes an inaccessible
  child or its conversations.

### Archive behavior

- Archiving an Inbox does not cascade: its children retain their
  `parent_inbox_id` and conversations remain assigned to their current Inbox.
- Tree assembly hides an archived parent as a selection node and promotes each
  visible active child to the nearest visible active ancestor, or to the root
  when none exists. This promotion is display-only and does not rewrite parent
  links or `conversations.inbox_id`.
- Conversations in an archived Inbox remain reachable only through a permitted
  selection under existing lifecycle rules. The archived parent itself is not
  a tree selection node, except where ADR 0017's existing open-assigned
  never-remove lifecycle state requires that Inbox to remain visible; that
  exception does not make it a parent-selection node or expose inaccessible
  descendants.

## Consequences

- Existing routing continues to write only `conversations.inbox_id`; hierarchy
  edits cannot move conversations or alter their current queue.
- Parent-link APIs and database constraints must reject cross-Workspace links,
  self-parents, and descendant-parent cycles, and must use bounded defensive
  traversal while preserving the navigation-only boundary.
- Conversation-list query work belongs in the Worker so visibility filtering,
  recursive expansion, deduplication, ordering, counts, and cursors remain
  consistent for direct and parent-node navigation.
- All list, detail, timeline, and mutation paths replace ADR 0017's older
  workspace-wide sidebar/read-model authorization with the hierarchy-aware
  Inbox and Mailbox authorization defined here.
- Archive UI must promote visible active children without re-homing them or
  their conversations, while preserving the stated never-remove exception.
- Tests for the tree implementation must cover same-Workspace parent links,
  self-parent and descendant-cycle rejection, bounded traversal, Worker-side
  permitted-descendant expansion including the selected Inbox's own distinct
  conversations, deterministic ordering/cursors, all four visibility modes
  (`shared`, `team`, generic `private`, and product-managed routing `system`),
  shared restricted grants, team `team_id` Workspace ownership and
  `team_members`-only access, generic private `inbox_members` grants and the
  owner/admin no-read boundary, and system Inbox service-only lifecycle with
  Workspace-readable default visibility. Tests must specifically cover a
  Team-linked Shared Mailbox using a `team` Inbox with the same `team_id`,
  active-`team_members` read/reply/send-as authority subject to Mailbox
  lifecycle/readiness, and no `inbox_members` projection or substitution; and a
  no-Team Shared Mailbox using restricted `shared` Inbox `inbox_members` grants
  until an administrator deliberately makes it Workspace-public. They must also
  prove that Shared Mailbox access requires both Mailbox lifecycle/access
  authorization and backing-Inbox policy, with no parent, owner, or admin bypass.
  Tests must also verify that ADR 0017 virtual queues remain sidebar/query nodes
  rather than `inboxes` rows; that
  Private Mailbox provisioning and owner/delegate changes atomically synchronize
  backing-Inbox grants; that delegate revocation immediately revokes its grant;
  and that neither arbitrary Inbox membership nor an ancestor, owner, or admin
  bypasses Mailbox authorization, alongside archived-parent promotion.
