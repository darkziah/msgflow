# ADR 0024: Multi-workspace product model

**Status:** Accepted

## Context

The initial deployment model in ADR 0023 allowed exactly one Workspace for an
installation. MsgFlow already scopes most product data through `workspaces` and
`workspace_members`, and the client already presents a membership switcher, but
creation and several legacy API paths still assume one tenant.

The product now needs a second isolated Workspace in the same Worker, D1,
Durable Object, and R2 deployment. This is application multi-tenancy, not a
second Cloudflare installation.

## Decisions

### Installation setup and Workspace creation

- First-use setup remains a durable singleton. It creates exactly one initial
  Owner, Workspace, Team, and Shared Inbox before normal application traffic is
  enabled; it is never reused for later Workspace creation.
- A verified Owner may create another Workspace through the authenticated
  product flow. The creator becomes that Workspace's Owner.
- Creation takes a Workspace name, globally unique normalized slug, initial
  Team name, and initial Shared Inbox name. Those rows and the creator's
  Workspace, Team, and Inbox memberships are created atomically.
- Creation never copies data from the source Workspace. Channels, domains,
  mailboxes, agents, teams, inboxes, rules, tags, views, conversations, and
  audit history start independent.
- Workspace deletion, rename, archive, billing, seat limits, cross-workspace
  templates, reports, and public/self-service Workspace signup are out of scope
  for this phase.

### Identity and authorization

- Better Auth remains the installation-wide identity/session system. Its User
  represents an Agent; it does not grant Workspace access by itself.
- An Agent may hold memberships in multiple Workspaces. Username and verified
  recovery email remain globally unique and immutable; roles, teams, inbox
  access, invitations, mailboxes, channels, contacts, conversations, rules,
  tags, views, and audit data are Workspace-scoped.
- Every authenticated API and WebSocket operation must derive an explicit
  Workspace from a validated path/query/request field or an authorized target
  resource. It must not silently select the first/default membership.
- A client-selected Workspace is never authorization. Each resource lookup is
  constrained to the requested Workspace and verified membership before D1,
  Durable Object, R2, or provider access.
- The browser route validates `?workspace=<id>` only against
  `GET /api/workspaces`. If the parameter is absent or stale, the route
  replace-navigates to the deterministic first authorized membership. This is
  client URL canonicalization, not a backend default-Workspace fallback.
- After canonicalization, the explicit Workspace ID accompanies every
  Workspace-scoped request and navigation, including settings, rules, and
  conversations. No backend, API, or service may infer a Workspace from an
  Agent's first/default membership. Browser storage can be a last-used hint
  only.

### Supersession of legacy default-Workspace bootstrap

This ADR supersedes only the conflicting default-Workspace bootstrap portions
of earlier accepted ADRs:

- In ADR 0017's **Workspace-scoped API + access model**, the statement that a
  Workspace with zero members bootstraps its first accessor as owner and the
  statement that `GET /api/workspaces` claims the default Workspace for a fresh
  signup are superseded.
- In ADR 0018's **Workspace authorization**, the statement that a legacy lazy
  `default` Workspace with no `workspace_members` rows bootstraps its first
  authenticated accessor as owner and the instruction to resolve
  `requireDefaultWorkspaceAccess` for legacy APIs are superseded.

ADR 0017's route/resource workspace scoping and role requirements, and ADR
0018's session validation, membership checks, resource scoping, and role model
remain accepted. The authoritative replacement policy is that only browser URL
canonicalization may choose the deterministic first *authorized* membership;
every backend, API, and service operation requires an explicit authorized
Workspace and may not create or infer membership from a default/first Workspace.

### Provider identities and ingress

- Provider identities that select a tenant without a logged-in Agent must be
  installation-global and unambiguous. Email domains, mailbox addresses, and
  Meta App IDs cannot be claimed by multiple Workspaces.
- Messenger and email ingress resolve their Workspace only through persisted
  provider identity. They never accept a caller-provided Workspace identifier.
- Existing global email-domain and mailbox-address uniqueness remains required.
  Meta App ID uniqueness must be installation-wide before multi-workspace
  creation is exposed.

### Final authorization route audit

This is a source-level inventory of the Worker entry points and browser call
sites. “Pass” means the listed derivation and fence are present in source; it
does **not** claim live HTTP-route coverage.

| Route class | Workspace source / authorization | Resource fence | Status |
| --- | --- | --- | --- |
| Public health, Better Auth, and initial setup | No tenant is selected. Setup is the one durable first-use transaction. | Setup claim and atomic initial Owner/Workspace/Team/Inbox creation. | Pass — intentionally unscoped bootstrap/auth. |
| Workspace discovery and creation (`workspaceApi`) | `GET /api/workspaces` lists session memberships. `POST` takes a validated `sourceWorkspaceId`; service requires the session Agent to be a verified Owner there. | New Workspace and its initial rows are created atomically; no source data is copied. | Pass. |
| Workspace-path management routes | `/api/workspaces/:workspaceId/*` derives the ID from the path and session identity; services require membership, with owner/admin checks for configuration mutations. | Nested channels, Meta Apps, email domains, mailboxes, inboxes, teams, views, tags, rules, and canned replies are queried/mutated with that Workspace ID. | Pass. |
| Conversations, comments, notifications, drafts, generic attachments, and outbound | Explicit `workspaceId` is required in query, JSON body, or form data and is checked against the session membership before work. | Conversation/readability, target inbox/tag, notification, draft, attachment, mailbox, and D1 writes are constrained to the same Workspace before Durable Object or R2 access. | Pass. |
| Email API and private-email attachments | Workspace path where available; otherwise required query/form `workspaceId`, then session membership. | Mailbox-specific access and conversation readability additionally fence context, uploads/downloads, ingress audit/replay, and send-as data. | Pass. |
| Invitations/onboarding | Invitation create/revoke uses path Workspace plus authenticated actor; register/accept use the opaque invitation capability and accept session. | Invitation service binds the token and membership operation to its persisted Workspace; no default membership lookup. | Pass. |
| Meta OAuth | Start uses path Workspace, session Owner authorization, and Workspace-scoped Meta App and inbox. Subsequent page list/connect use an opaque persisted OAuth session bound to actor and Workspace; callback consumes its state nonce. | Meta App/inbox lookups include Workspace; page connection uses the persisted session binding rather than a browser-selected Workspace. | Pass. |
| Conversation WebSocket | Required `conversationId` and `workspaceId` query parameters plus authenticated session membership. | The conversation is read in that Workspace before resolving the globally derivable Conversation DO name. | Pass. |
| Messenger webhook | Opaque `metaAppId` path plus Meta verify-token/signature validation; no caller Workspace field. | Persisted Meta App/channel identity resolves the Workspace; Meta App ID and provider identities are installation-global/unambiguous. | Pass. |
| Cloudflare Email ingress and scheduled/internal work | Ingress resolves from persisted recipient mailbox/address; scheduled and internal paths use persisted records, not an Agent default. | Mailbox, email-ingress, conversation, and outbound records carry and query their Workspace scope. | Pass. |
| Browser routing and query/call sites | `index.tsx` validates `?workspace=` only against `GET /api/workspaces`, then replace-navigates to an authorized deterministic membership. API helpers require/pass an explicit Workspace ID for scoped calls and WebSocket URLs. | Workspace-sensitive query keys and child props include the active Workspace; backend remains the authorization authority. | Pass — canonicalization only, not a backend fallback. |
| Default-Workspace invariant | Production source has no `requireDefaultWorkspaceAccess` or `defaultWorkspaceId` use; the sensitive handler regression asserts explicit scope. The only first-row helper (`getConfiguredWorkspace`) has no source caller. | No production route/service may infer the first/default membership. | Pass for reachable routes — source audit; no additional regression added. |

## Consequences

- ADR 0023's prohibition on a second-Workspace creation flow is superseded.
  Its deployment-neutral configuration, first-use claim, and operator recovery
  decisions remain in force.
- Legacy default-Workspace routes must be migrated or retired rather than
  choosing an arbitrary membership.
- Tests must exercise a single Agent in two Workspaces for every tenant-bound
  route, conversation/DO access, attachment access, notification, provider
  ingress, and outbound path.
