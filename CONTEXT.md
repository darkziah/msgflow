# MsgFlow — Unified Inbox

A unified inbox for business Pages: Front/Missive-style handling of Facebook Messenger and email conversations in one place, with real-time delivery to agents viewing a conversation.

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
A team/queue grouping that holds Conversations. Every Conversation belongs to exactly one Inbox; each Channel (Page or Mailbox) has a default Inbox, overridable by rules. A shared Inbox is either public to all Workspace members or restricted to explicitly granted Agents/Teams; a newly accepted Agent receives public shared-Inbox access only.
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
A Yehey staff member with a stable Username and one unique immutable verified recovery email who reads and replies to Conversations in the inbox. The auth-side concept is Better-auth's "user".
_Avoid_: user, teammate

**Workspace**:
The single tenant created during first-use setup for one MsgFlow installation. It owns its Agents, Teams, Inboxes, Email Domains, and Mailboxes; additional Workspace creation is unavailable in the initial deployment model.
_Avoid_: account, organization

**Workspace Owner**:
The Agent who completes the installation's sole first-use setup for a Workspace, or a later Agent promoted to the owner role. A Workspace may have multiple Workspace Owners. First-use setup creates the initial Team and Shared Inbox before any Email Domain can be onboarded. Only a Workspace Owner may promote or demote an Owner; every role change must preserve at least one Owner. Until first-use setup completes, only the owner-setup endpoint is available: normal API/authentication paths, Messenger verification/ingest, and inbound email are rejected server-side; a partial setup enters operator recovery rather than allowing another claimant. Recovery is a local authenticated operator procedure that repairs the existing claim without deleting or reassigning it. Alongside Workspace Administrators, a Workspace Owner may administer domain and Mailbox lifecycle; ownership does not grant private Mailbox content access.
_Avoid_: mailbox owner

**Workspace Administrator**:
An Agent granted the Workspace `admin` role. A Workspace Administrator with a verified recovery email may administer domain and Mailbox/Channel lifecycle metadata, including activating an eligible Agent's Private Mailbox, may manage public/restricted Shared Inbox access, and may offboard member Agents, but receives no implicit access to private Mailbox content or send-as authority.
_Avoid_: Private Mailbox delegate, mailbox owner

**Username**:
An immutable, globally unique, normalized application login identifier selected and reserved by a Workspace Owner when inviting an Agent. It is an alternative to verified email/password sign-in and derives eligible private Mailbox local-parts; it is not a mail authorization credential.
_Avoid_: Google identity, mailbox credential

**Agent Invitation**:
A 48-hour, revocable capability issued by a Workspace Owner or Workspace Administrator to one recovery email and one reserved Username. Only one active Agent Invitation may exist for a recovery email or a Username across MsgFlow. The recipient uses it to create or connect a verified Agent account, verify the recovery email, and sign in. Acceptance is allowed only for an account with no Username and no membership in the invited Workspace; it atomically assigns the reserved Username and joins the Agent to that Workspace as a member. It does not itself provision a Private Mailbox. Revocation applies only before acceptance; later removal uses an auditable offboarding action. An expired or revoked reservation enters a one-day cooldown before the Username is available for reuse. Issuance and revocation are auditable lifecycle actions.
_Avoid_: user account, mailbox grant

**Contact**:
The human on the other end of a Conversation. May hold multiple channel identities (Facebook PSID, email address).

**Channel**:
The transport identity a Conversation flows through — a Facebook Messenger Page or an email Mailbox. A Conversation belongs to exactly one Channel. A Channel is connected explicitly only after first-use setup; it is never created by webhook ingress or a legacy route. Every Channel has one default Inbox, though an Inbox may hold multiple Channels.

**Page**:
A Facebook business Page (the business-side identity for Facebook conversations), represented by one Facebook Messenger Channel rather than an Email Domain or Mailbox. A verified Workspace Owner or Administrator connects it through the post-setup Channel wizard by selecting an installation-level Meta App connection, then selecting its existing Shared Inbox and Page through Facebook Login for Business. An installation may register multiple Meta Apps; each App ID and encrypted App secret is reusable only by its own Page Channels, while Page access tokens remain per Channel. While a Meta App is in development mode, the connecting person must be its Meta developer/tester and only Meta-authorized Pages are selectable; App Review/verification is not required for that developer-only connection. MsgFlow validates the selected Page token and requests its Page-level Messenger subscription before persisting the encrypted token. Tokens and App secrets are never returned after connection. The email analogue is a Mailbox (e.g. support@example.com).

**Mailbox**:
A logical MsgFlow email identity at one canonical address with an ASCII, case-insensitive local-part, either private to an Agent or shared with explicitly authorized Agents. Each Mailbox is represented by one email Channel that routes to its default Inbox. It is not an IMAP, POP, or Google mailbox, is explicitly assigned rather than automatically provisioned, and unknown or disabled addresses reject inbound mail; plus addressing is not enabled. Its published address is immutable, and disabling it preserves history while stopping send-as and rejecting new inbound mail; operational local-parts are reserved from private assignment. One inbound email addressed to multiple Mailboxes creates a separate Conversation per receiving Mailbox in the initial deployment. Its private/shared type is immutable in the initial deployment; any future type transfer must be an Owner-confirmed audited migration that states the newly authorized audience.
_Avoid_: email account, Google mailbox

**Private Mailbox**:
A Mailbox owned by one Agent whose local-part exactly equals their immutable Username and whose content and send-as authority are available only to that Agent; explicit delegates may read, search, and work its Conversations (including archive, snooze, spam, move, tag, and assignment) but reply only from their own authorized Reply Identity and comment only as themselves. Delegation grants/revocations take effect immediately and are audited with private-content access. It has its own private Inbox. Workspace administrators have no implicit access and cannot alter private-content permissions during the pilot. A Workspace Owner or Workspace Administrator activates it by choosing one inbound-ready Email Domain and explicitly confirming the exact resulting address, only after the Agent has accepted their invitation, verified their recovery email, and successfully signed in at least once. Activation enables inbound mail; it enables send-as only when the selected Email Domain is independently outbound-ready. The Agent may receive additional Private Mailboxes through separate later activations on other inbound-ready Email Domains. Deactivating its owner disables the Mailbox without transferring its history.
_Avoid_: personal inbox

**Shared Mailbox**:
A Mailbox linked to one shared Inbox and optionally one Team; several Shared Mailboxes may route to the same shared Inbox. Its shared Inbox is restricted by default and must be deliberately made public. Active Team members receive its read, reply, and send-as authority until their membership is removed, at which point that authority ends immediately while the shared history remains available to the remaining authorized Agents.
_Avoid_: group alias, distribution list

**Reply Identity**:
The active Mailbox selected as a Message's sender; it defaults to the Mailbox that received the Conversation but may be an explicitly authorized private or shared Mailbox without moving the Conversation.
_Avoid_: conversation owner, channel reassignment

**Thread Bridge**:
An explicit, auditable link from an outbound Message's Reply Identity to its source Conversation, allowing a later RFC-threaded reply received at that identity to rejoin the source Conversation without merging unrelated mailboxes.
_Avoid_: subject matching, contact-based merge

**Email Domain**:
An admin-managed, verified email domain or subdomain owned by exactly one Workspace, with independent inbound and outbound readiness; it cannot be transferred between Workspaces during the pilot, and its suspension blocks both directions. It cannot be deleted in the initial deployment model because suspension preserves its history and audit trail. An Email Domain is deployment-specific configuration, never a source-code constant. A dedicated subdomain is the default onboarding target; an apex domain that already receives mail requires a separately approved migration plan. A verified domain routes inbound mail through one Cloudflare catch-all rule to MsgFlow, which accepts only exact enabled Mailboxes. DNS evidence and Cloudflare operator confirmations are prerequisites; readiness also requires a successful independent live inbound or outbound test, respectively. Inbound testing uses a one-time random verification recipient and records only a domain-verification result, never a Conversation or Mailbox message. Outbound testing sends a one-time correlated verification email to an operator-supplied external destination; its sender is not a usable Mailbox or Reply Identity, and its random confirmation code must be entered in MsgFlow before outbound readiness is recorded. MsgFlow records public DNS evidence and operator confirmations but never changes Cloudflare DNS, routing rules, sending-domain configuration, or event subscriptions.
_Avoid_: Google Workspace domain, shared DNS zone

## Relationships

- A **Conversation** belongs to exactly one **Channel** and one **Contact**.
- A **Conversation** contains an ordered timeline of **Messages** and **Comments**.
- A **Conversation** belongs to exactly one **Inbox** and has at most one **Assignee**.
- A **Conversation** carries many **Tags**.
- A **Message** is either inbound or outbound.
- A **Contact** may hold multiple channel identities across **Channels**.
- A **Page** (or mailbox) hosts many **Conversations**.
- A **Mailbox** hosts many email **Conversations**.
- A **Mailbox** is represented by one email **Channel**, which has one default **Inbox**.
- A **Private Mailbox** has one owning **Agent** and zero or more explicitly granted delegate **Agents**.
- A **Shared Mailbox** belongs to one **Inbox** and may be available to one **Team**.
- An **Email Domain** belongs to exactly one **Workspace** and hosts many **Mailboxes**.
- A **Conversation** has one receiving **Mailbox** and each outbound **Message** has one **Reply Identity**.
- An **Inbox** groups many **Conversations**.
- An **Agent** replies to **Messages** and posts **Comments** in **Conversations**.
- An **Agent** has exactly one stable **Username**.
- An **Agent Invitation** reserves one **Username** for one recovery email until it is accepted, expires, or is revoked; expired or revoked reservations remain unavailable for one day before reuse.
- A **Workspace Owner** administers one **Workspace** without implicit access to its **Private Mailboxes**.

## Runtime boundary contracts

- Use `effect/Schema` from the `effect` package for new runtime validation and
  serialization contracts. Put browser/Worker-safe schemas in
  `@msgflow/contracts`; do not add the deprecated `@effect/schema` package.
- Decode untrusted HTTP JSON once with `decodeJsonBody()` in
  `apps/worker/src/validation.ts`, then pass only decoded client-controlled
  fields to existing services. Keep server-generated IDs, workspace/actor
  ownership, delivery state, authorization, encryption, and business rules out
  of public DTOs.
- Drizzle/D1 remain the source of truth for relational tables, migrations,
  constraints, and queries. Use Effect schemas for untrusted boundaries and
  durable flexible JSON/event shapes, not as generated public database-insert
  payloads.
- Version Durable Object and persisted JSON contracts before changing shapes
  that survive deployments. Provider ingress schemas must tolerate extensions
  while validating the fields MsgFlow actually consumes.
- Preserve existing API status/error behavior with parity tests when migrating a
  route. See `docs/adr/0022-effect-schema-boundaries.md` and
  `docs/effect-schema-rollout.md` for the rollout inventory and conventions.

## Example dialogue

> **Dev:** "When an agent posts an internal note, is that a Message?"
> **Domain expert:** "No — that's a Comment. Messages are customer-facing only; a Comment must never leave the app through a channel adapter."

## Flagged ambiguities

- "message" was used loosely to mean both customer-facing content and anything in the timeline — resolved: **Message** is customer-facing only; **Comment** and **Activity** are siblings, not kinds of Message.
- "agent" / "user" / "teammate" were used interchangeably — resolved: **Agent** is the domain term; Better-auth's "user" maps to **Agent**.
- "owner" vs "assignee" — resolved: **Assignee** (Front's term); a Conversation has at most one.
- "closed" vs "archived" — resolved: **archived**; following Front, there is no distinct "closed" state.
- "company" tag type and tag nesting (`parent_id`) — deferred to Phase 2 (needs workspaces). Now implemented: `tags.visibility` (company/shared/private) + `parent_tag_id` in the Phase 2 schema (migration 0003).
