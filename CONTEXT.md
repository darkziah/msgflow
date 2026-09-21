# MsgFlow — Unified Inbox

A unified inbox for Yehey Japan's business Pages: Front/Missive-style handling of Facebook Messenger and email conversations in one place, with real-time delivery to agents viewing a conversation.

## Language

**Conversation**:
A single dialogue thread with one Contact across exactly one Channel. The unit shown in the inbox list, and the unit a Durable Object owns.
_Avoid_: thread (that's the Gmail-side storage concept)

**Message**:
Customer-facing content in a Conversation's timeline — either inbound (Contact → agent) or outbound (agent → Contact). Carries a channel-specific payload.
_Avoid_: using "message" for internal notes or system events

**Comment**:
A team-only note inside a Conversation, invisible to the Contact. Supports @mentions. A sibling of Message, never a kind of Message.
_Avoid_: internal message, note

**Activity**:
A system-generated record of a change to a Conversation (assigned, tag added, snoozed, status changed). Rendered separately from the Message/Comment timeline.

**Inbox**:
A team/queue grouping that holds Conversations. Every Conversation belongs to exactly one Inbox; each Channel (Page or mailbox) has a default Inbox, overridable by rules.
_Avoid_: queue, folder

**Assignee**:
The single Agent accountable for a Conversation. A Conversation has at most one Assignee; null means unassigned.
_Avoid_: owner

**Status**:
A Conversation's lifecycle state — open (actionable) or archived (removed from active views). Snoozing is orthogonal to status.
_Avoid_: closed (use archived)

**Snooze**:
Hiding an open Conversation from the active view until a chosen time (`snoozed_until`).

**Rule**:
A saved if-then applied automatically to an inbound Conversation: routing actions (set Inbox, set Assignee) or additive actions (tag, notify, set priority).

**Tag**:
A workspace-level label applied to a Conversation for categorization and filtering — shared (workspace-wide) or private (per-Agent). A Conversation can carry many Tags.

**Agent**:
A Yehey staff member who reads and replies to Conversations in the inbox. The auth-side concept is Better-auth's "user".
_Avoid_: user, teammate

**Contact**:
The human on the other end of a Conversation. May hold multiple channel identities (Facebook PSID, email address).

**Channel**:
The medium a Conversation flows through — Facebook Messenger or email. A Conversation belongs to exactly one Channel.

**Page**:
A Facebook business Page (the business-side identity for Facebook conversations). The email analogue is a mailbox/account (e.g. support@yehey.com).

## Relationships

- A **Conversation** belongs to exactly one **Channel** and one **Contact**.
- A **Conversation** contains an ordered timeline of **Messages** and **Comments**.
- A **Conversation** belongs to exactly one **Inbox** and has at most one **Assignee**.
- A **Conversation** carries many **Tags**.
- A **Message** is either inbound or outbound.
- A **Contact** may hold multiple channel identities across **Channels**.
- A **Page** (or mailbox) hosts many **Conversations**.
- An **Inbox** groups many **Conversations**.
- An **Agent** replies to **Messages** and posts **Comments** in **Conversations**.

## Example dialogue

> **Dev:** "When an agent posts an internal note, is that a Message?"
> **Domain expert:** "No — that's a Comment. Messages are customer-facing only; a Comment must never leave the app through a channel adapter."

## Flagged ambiguities

- "message" was used loosely to mean both customer-facing content and anything in the timeline — resolved: **Message** is customer-facing only; **Comment** and **Activity** are siblings, not kinds of Message.
- "agent" / "user" / "teammate" were used interchangeably — resolved: **Agent** is the domain term; Better-auth's "user" maps to **Agent**.
- "owner" vs "assignee" — resolved: **Assignee** (Front's term); a Conversation has at most one.
- "closed" vs "archived" — resolved: **archived**; following Front, there is no distinct "closed" state.
- "company" tag type and tag nesting (`parent_id`) — deferred to Phase 2 (needs workspaces). Now implemented: `tags.visibility` (company/shared/private) + `parent_tag_id` in the Phase 2 schema (migration 0003).
