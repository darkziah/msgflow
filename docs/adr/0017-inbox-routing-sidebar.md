# ADR 0017: Inbox Routing & Left Sidebar

Status: Accepted

Date: 2026-09-19

## Context

MsgFlow needed a Front/Missive-style message segregation model: channels feed a
default (General) inbox, routing rules move conversations into dedicated queues
(Billing, Sales Leads, Technical Support, VIP), and a left sidebar navigates the
queues. The Phase 2 schema (ADR 0008/0009) already had inboxes, inbox_channels,
rules, and rule_execution_log; this ADR extends them with the routing/sidebar
surface (migration 0004).

## Decisions

### Inboxes gain presentation + lifecycle fields

`inboxes` adds `description`, `color` (validated `#RRGGBB`), `icon` (controlled
icon-library key only — `inbox`, `headphones`, `receipt-text`,
`badge-dollar-sign`, `briefcase`; never uploaded files), `sort_order`
(workspace-level default order, admin-only drag), `is_archived`, and
`updated_at` (Unix ms — the routing spec's new columns use ms; older TEXT ISO
columns are untouched). `name` is unique per workspace (enforced in code, no
DB index — forward-only migration safety on existing databases).

### Exactly one default inbox per channel

Migration 0004 adds a partial unique index on `inbox_channels(channel_id)`
WHERE `is_default = 1`, after a guard-UPDATE that collapses any legacy
duplicate defaults (keeping the earliest link). `is_default` itself already
existed (0003) — it is NOT re-added. Default replacement (`POST
.../channels/:channelId/default-inbox`) runs as an atomic `db.batch`:
demote-all, then promote the target. Archived inboxes can never become a
default; archiving or unlinking a channel's only default is rejected (409)
until a replacement exists. Ingest skips archived inboxes when resolving the
default and reuses an existing inbox with the default name before creating one.

### Rules engine hardens

`rules.stop_processing` (default false) halts evaluation after a matching rule.
Every candidate evaluation is logged (`matched` | `skipped` | `error`) —
previously only matched/error were logged. Action targets are validated
against the workspace: `move_inbox` rejects archived/foreign inboxes,
`assign_user`/`assign_team`/tags/canned replies must belong to the workspace.
Conditions support a new `tags` field (conversation tag ids; the seed's VIP
rule uses it). Canned replies cannot recurse: outbound sends never re-enter
`routeInbound`.

### Webhook idempotency for rule side effects

Rules run BEFORE the DO append, so a replayed webhook could re-run rule side
effects (duplicate canned replies). Ingest claims a `processed_messages` row
(PK `conversation_id + provider_message_id`, synthetic deterministic key when
the provider event lacks an id) before rules; a conflict skips rules and the
append. The DO's own providerMessageId dedup remains the backstop for messages.

### Workspace-scoped API + access model

New routes under `/api/workspaces/:workspaceId/*` (sidebar, inboxes CRUD,
archive, channel links, default-inbox, reorder, sidebar-preferences, teams,
views). Access: the session user must be a `workspace_members` row; a
workspace with zero members bootstraps its first accessor as owner (keeps the
lazy single-tenant 'default' workspace working). Inbox/rules configuration
requires owner/admin; reads require membership. `GET /api/workspaces` claims
the default workspace for a fresh signup so the client always has a workspace
id (the bootstrap otherwise only runs on workspace-scoped calls).

### Sidebar

The sidebar is a read shape: sections (Inbox, Assigned to me, Teams, Tags,
Views), groups (Facebook/Email by channel type, teams, parent tags), stable
item ids (`system:*`, `inbox:*`, `tag:*`, `view:*`), counts, permissions, and
the user's preferences. Virtual queues (All Messages, Assigned to me,
Unassigned, Snoozed, Closed) are queries, never `inboxes` rows — Closed maps
to `status='archived'` and Snoozed to `snoozed_until` in the future (the
domain has open|archived only, ADR 0008). Visibility is workspace-scoped (all
non-archived inboxes render for members, matching the conversation list's read
model); archived inboxes stay visible only when the user has an open
conversation assigned inside them (never-remove rule). Personal preferences
(collapse/pin/hide/local order) live in `user_sidebar_preferences` — section
keys are validated separately from item ids — and never touch shared routing.

## Consequences

- The system never leaves an active channel without a default inbox; the
  partial unique index backstops the application logic.
- Duplicate webhooks cannot duplicate messages or rule side effects.
- Unit tests (apps/worker/test/routing.test.ts, `bun test`) cover
  default-inbox uniqueness, archived validation, rule priority /
  stop_processing / skipped logging, and workspace permission boundaries on a
  real Miniflare D1 with the full migration chain.
- Integration coverage lives in `bun run smoke-routing` (requires a running
  dev worker on a fresh local D1 — the bootstrap makes the first signup the
  owner, so a stale dev DB 403s new users).