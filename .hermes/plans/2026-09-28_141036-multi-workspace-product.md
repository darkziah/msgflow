# Multi-Workspace Product Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let an authorized MsgFlow agent create and operate a second isolated Workspace within one Worker/D1 deployment, while preserving strict tenant boundaries for API, realtime, Messenger, and email data.

**Architecture:** Keep the existing shared deployment and `workspaces` table; this is application multi-tenancy, not a new Cloudflare environment. Replace the installation singleton from “one Workspace ever” to “one initial setup only.” A reusable workspace-provisioning service creates the Workspace, first Team, first Shared Inbox, and creator Owner membership atomically. Client state and every authenticated request carry an explicit active `workspaceId`; provider ingress resolves its Workspace only from globally unique connected identities.

**Tech Stack:** Bun/Turborepo, Hono Worker, Cloudflare D1 + Durable Objects, Drizzle, Better Auth, React/TanStack Query/Router, Effect Schema, Biome, Miniflare tests.

---

## Product decisions to lock before implementation

This plan assumes the following narrowly scoped v1 policy:

1. The first-use setup still creates exactly one initial Workspace and gates all normal traffic until it completes. It is not reused to create later Workspaces.
2. An authenticated **Workspace Owner** may create another Workspace from the workspace picker. The creator is Owner of the new Workspace. There is no public/self-serve sign-up or public create-workspace endpoint in this phase.
3. A single Agent may be a member of many Workspaces. Their existing global immutable username and recovery email stay global; role, teams, inbox access, invitations, private mailboxes, channels, contacts, conversations, tags, rules, and audit records are Workspace-scoped.
4. Creation takes: Workspace name, globally unique normalized slug, initial Team name, and initial Shared Inbox name. It does not copy channels, domains, mailboxes, agents, rules, tags, views, inboxes, or data from the current Workspace.
5. A Workspace cannot be deleted in this phase. Renaming, archiving/suspension, billing, seat limits, cross-workspace templates, and cross-workspace reporting are explicitly out of scope.
6. The active Workspace is URL-addressable rather than local-storage-only. Use `?workspace=<id>` at first to avoid a route-tree migration; validate it against `/api/workspaces`, replace an absent/invalid value with the first membership, and preserve it when navigating to settings/rules/conversations.

Before coding, record these decisions in a new ADR that supersedes the one-workspace portions of `CONTEXT.md` and ADR 0023. If self-service tenant signup is required instead, stop after that ADR: it requires an installation-level entitlement/administrator model and a separate account-creation threat model.

## Current findings

- The database already models workspace ownership for most application entities: `packages/db/src/schema.ts:26-866` scopes teams, channels, inboxes, conversations, email domains/mailboxes, sidebar preferences, and notifications.
- The web app already lists and switches memberships in `apps/web/src/routes/index.tsx:71-88` and `apps/web/src/components/layout/AppTopBar.tsx:81-112`, but the picker explicitly says creation is unavailable.
- `setupInitialOwner()` deliberately blocks all later Workspace creation through a singleton `workspace_setup_claim` and `NOT EXISTS (SELECT 1 FROM workspaces)` in `apps/worker/src/setup.ts:44-159`.
- 44 Worker call sites still select a user’s first/default membership via `requireDefaultWorkspaceAccess()` or `defaultWorkspaceId()` (`apps/worker/src/index.ts`, plus `apps/worker/src/email-api.ts`). In a multi-workspace product these routes can silently read/write the wrong tenant.
- Email domains and mailbox addresses are already globally unique (`packages/db/src/schema.ts:605-675`), which is required for routing provider ingress safely. Meta App IDs are only unique per Workspace and must become installation-unique because the webhook path identifies the App, not a logged-in Workspace.

## Task 1: Add the multi-workspace decision and scope tests

**Objective:** Make the tenant model, creator authority, and out-of-scope lifecycle explicit before changing behavior.

**Files:**
- Create: `docs/adr/0024-multi-workspace-product.md`
- Modify: `CONTEXT.md:47-52`
- Modify: `docs/adr/0023-deployment-neutral-installation-and-email-onboarding.md:48-64`
- Test: `apps/worker/test/setup.test.ts`

**Steps:**
1. Write ADR 0024 with the six decisions above, including global-vs-Workspace identity ownership and ingress identity uniqueness.
2. Amend the glossary so Workspace is a tenant within an installation, not “the single tenant,” and distinguish initial installation setup from later Workspace provisioning.
3. Mark ADR 0023’s “no second-workspace creation flow” as superseded by ADR 0024 without changing its deployment-neutral or initial-claim rules.
4. Add an initial regression asserting that initial setup remains a singleton even after later Workspace creation support exists.

**Verification:** `cd apps/worker && bun test --max-concurrency=1 test/setup.test.ts` passes.

## Task 2: Extract atomic Workspace provisioning

**Objective:** Make first-use and subsequent creation share one tested graph constructor without allowing partial tenant state.

**Files:**
- Create: `apps/worker/src/workspace-provisioning.ts`
- Modify: `apps/worker/src/setup.ts:127-159`
- Modify: `apps/worker/src/workspace-api.ts`
- Modify: `packages/contracts/src/*workspace*.ts` (locate canonical workspace contracts; do not duplicate types)
- Test: `apps/worker/test/setup.test.ts`
- Test: create `apps/worker/test/workspace-provisioning.test.ts`

**Steps:**
1. Define a public `WorkspaceCreateRequestSchema` in `@msgflow/contracts` with bounded trimmed names and the existing canonical slug validation. Exclude IDs, actor ID, role, and state.
2. Implement one internal provisioner that mints IDs and uses one `env.DB.batch` to insert: workspace, creator owner membership, initial team, creator team-admin membership, initial shared inbox, and creator inbox membership.
3. Keep the initial claim, Better Auth account creation, and verification delivery in `setup.ts`; after account creation call the provisioner, then complete `workspace_setup_claim` only for first use.
4. Add a second creation entry point that accepts an existing actor ID and does not touch the singleton claim or Better Auth.
5. Fail closed on duplicate slug and map the unique constraint to the existing stable 409 error envelope. On failure, verify none of the graph rows are committed.

**Acceptance tests:**
- first setup creates its original graph and one completed claim;
- a later Workspace creates the same graph but does not change the completed claim;
- concurrent equal-slug creation returns exactly one success;
- a failed graph insert leaves no orphan workspace/team/inbox/membership;
- the creator is owner only in the newly created Workspace, and no current Workspace resources are copied.

## Task 3: Add an explicit create-workspace API with owner authorization

**Objective:** Expose provisioning only to a verified Owner and make the response usable by the picker.

**Files:**
- Modify: `apps/worker/src/access.ts`
- Modify: `apps/worker/src/workspace-api.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/validation.ts` only if the existing decoder lacks required handling
- Test: `apps/worker/test/workspace-provisioning.test.ts`
- Test: `apps/worker/test/routing.test.ts`

**Steps:**
1. Add `POST /api/workspaces`, decode the contract once with `decodeJsonBody`, require an authenticated session, and require the actor to be a verified Owner of an explicitly supplied source/current Workspace ID. Do not infer authority from their first membership.
2. Return the new `WorkspaceSummary` plus initial Team/Inbox IDs, with HTTP 201.
3. Use a purpose-named `requireWorkspaceOwnerAccess()` helper. Do not broaden `requireOwnerAccess()` if its email-domain semantics are intentionally different; keep all role checks centralized in `access.ts`.
4. Return 400 for malformed input, 403 for member/admin/non-member or unverified owner, and 409 for a slug conflict. Do not leak whether a foreign Workspace exists.
5. Update `GET /api/workspaces` ordering to deterministic `created_at, id` and make every returned role derive from `workspace_members`.

**Acceptance tests:** owner creates; admin/member/outsider fail; duplicated slug fails; user sees both memberships after success; no unauthenticated create; the source Workspace ID cannot be used as an authorization bypass.

## Task 4: Eliminate implicit default-workspace selection from authenticated APIs

**Objective:** Ensure an Agent active in two Workspaces can never read or mutate the first membership by accident.

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/email-api.ts`
- Modify: `apps/worker/src/access.ts`
- Modify: `apps/worker/src/queries.ts`, `manage.ts`, and service modules only where an explicit workspace parameter is currently missing
- Modify: `packages/contracts/src/*` only for an intentional public request/query contract change
- Test: `apps/worker/test/routing.test.ts`
- Test: `apps/worker/test/conversation-permissions.test.ts`
- Test: `apps/worker/test/mailboxes.test.ts`

**Steps:**
1. Inventory every `requireDefaultWorkspaceAccess()` and `defaultWorkspaceId()` call before editing. Classify each handler as already workspace-path scoped, conversation-resource scoped, or legacy collection route.
2. Convert collection/configuration routes to canonical `/api/workspaces/:workspaceId/...` routes. For conversation endpoints, accept `workspaceId` in the query/body where required and validate it by joining the target conversation to the authorized Workspace before resolving a DO.
3. Migrate frontend callers in the same task; avoid temporary server fallbacks that choose a default Workspace.
4. Retire or make legacy unscoped routes return a documented 400/410 after all internal callers migrate. Do not keep a silent “first/default membership” compatibility behavior.
5. Remove `requireDefaultWorkspaceAccess()` and `defaultWorkspaceId()` only after search confirms there are no production call sites. Preserve a small explicit helper only if a route can prove a Workspace from a resource lookup before its operation.
6. Scope WebSocket authorization to the requested conversation’s Workspace membership before resolving the Conversation DO; a globally derivable DO name is never authorization.

**Acceptance tests:** for the same signed-in Agent in Workspace A and B, every list/detail/timeline/send/comment/read/update/tag/rule/inbox/mailbox/draft/attachment/notification path rejects a foreign target and operates only in the requested tenant. Include a regression for switching from B to A so React Query and WebSocket data cannot show B content.

## Task 5: Fence provider ingress and provider identities globally

**Objective:** Keep webhook and email delivery tenant-safe without relying on browser-selected Workspace state.

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0022_multi_workspace_provider_identity.sql` (use the next actual migration number after inspecting the journal at implementation time)
- Modify: `apps/worker/src/webhook.ts`, `ingest.ts`, `email-transport.ts`, `meta-apps.ts`, and `meta-oauth.ts` as indicated by the route audit
- Test: `apps/worker/test/email-ingress*.test.ts`
- Test: add `apps/worker/test/multi-workspace-ingress.test.ts`

**Steps:**
1. Keep `email_domains.canonical_domain` and `mailboxes.canonical_address` globally unique; add tests proving a second Workspace cannot claim either.
2. Change Meta App uniqueness to installation-global `app_id` (or create a global installation Meta-App registry if the product needs an App shared across Workspaces later). For v1, one Meta App belongs to one Workspace and the same App ID cannot be registered twice.
3. Inspect every identity lookup used by Messenger webhook verification, POST signature validation, Page subscription, email recipient resolution, outbound reply identity, attachment download, and scheduled sends. Each must establish its Workspace from stored globally unique provider identity and carry that scope through every D1 lookup.
4. Make migration SQL forward-only, preserve existing data, hand-check the generated SQLite rebuild/unique-index SQL, and test the full migration chain on a fresh scratch database before applying it anywhere.
5. Do not make the inbound email handler accept a caller-supplied workspace identifier; exact recipient/mailbox lookup remains authoritative.

**Acceptance tests:** duplicate domain/address/App ID fail across Workspaces; a webhook for A cannot select a Page/channel/conversation from B; an email to A’s mailbox creates/updates only A data; unknown recipients cannot establish a Workspace; a scheduled outbound operation cannot send after its tenant/mailbox grant is revoked.

## Task 6: Make the active Workspace URL-driven and add workspace creation UX

**Objective:** Add a small, explicit creation flow to the existing workspace picker without redesigning the inbox shell.

**Files:**
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/layout/AppTopBar.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/routes/settings.tsx`, `rules.tsx`, and other route callers that currently omit Workspace context
- Create: `apps/web/src/components/workspace/CreateWorkspaceDialog.tsx`
- Test: create `apps/web/src/routes/-workspace-switching.test.tsx`
- Test: create `apps/web/src/components/workspace/CreateWorkspaceDialog.test.tsx`

**Steps:**
1. Extend the root inbox search validator with `workspace?: string` and derive active Workspace only from the validated membership list. On absent/invalid value, `replace` the URL with the first authorized Workspace; do not trust stale `localStorage`.
2. Keep `localStorage` only as an optional last-used hint if desired, never as authority. Clear conversation selection and workspace-scoped query caches synchronously when the Workspace changes.
3. Preserve `workspace` while navigating to settings/rules and make each page receive it from route state, not from a new global mutable singleton.
4. In the existing picker Dialog, show “Create workspace” only to an Owner. Open a focused Dialog/form requesting the four creation fields; validate client-side for feedback, submit through the new API, invalidate `['workspaces']`, then navigate directly into the returned Workspace URL.
5. Keep failure inline in the dialog (slug conflict, authorization, or validation); do not optimistically display a Workspace before the API response.
6. Key notifications and all workspace-sensitive React Query data by `workspaceId`. Clear/close a selected conversation if it does not belong to the next active Workspace.

**Acceptance tests:** direct URL entry to an authorized Workspace works; unauthorized/stale IDs do not render tenant content; switch clears filters and selected conversation; owner can create and lands in the initial empty Inbox; member cannot see the create control; failed create leaves picker/data unchanged.

## Task 7: Complete the authorization and query audit

**Objective:** Verify the multi-workspace implementation is comprehensive rather than a picker layered over default-tenant backend behavior.

**Files:**
- Modify only paths found by the audit in `apps/worker/src/`, `packages/contracts/`, and `apps/web/src/`
- Test: extend focused Worker and web test files from Tasks 3–6
- Modify: `docs/adr/0024-multi-workspace-product.md` with the final audit table

**Steps:**
1. Search for all `workspaceId`, `workspaces`, `workspace_members`, `defaultWorkspace`, `requireDefaultWorkspaceAccess`, `localStorage.getItem("msgflow.workspaceId")`, and unkeyed React Query calls containing conversations, users, tags, channels, notifications, attachments, or drafts.
2. Trace every public Hono route to its service and D1 query; document whether the Workspace comes from a path, a validated request field, a target-resource join, or provider identity. Resolve every “implicit/default” result before declaring the migration complete.
3. Verify every D1 lookup that accepts an ID constrains it to Workspace membership, and every DO/WebSocket/attachment route authorizes before it resolves an external durable/resource identifier.
4. Add the audit results and any deliberately retained non-workspace global entities (Better Auth account, username, recovery email) to ADR 0024.

## Task 8: Verify migrations, tests, build, and a two-workspace smoke path

**Objective:** Prove the product behavior from persisted D1 state through the web UI.

**Files:**
- No planned application changes; amend tests/docs only for failures discovered in prior tasks.

**Steps:**
1. Apply the complete migration chain in lexical order to a fresh local D1 state; inspect `PRAGMA index_list(meta_apps)`, email-domain/mailbox unique indexes, and relevant foreign keys with `sqlite3`.
2. Run focused test suites while iterating, always serialized: `cd apps/worker && bun test --max-concurrency=1 test/setup.test.ts test/workspace-provisioning.test.ts test/multi-workspace-ingress.test.ts test/routing.test.ts test/conversation-permissions.test.ts`.
3. Run the complete Worker suite: `cd apps/worker && bun test --max-concurrency=1`.
4. Run web tests and repo checks: `bun run test`, `bun run lint`, `bun run build`. Format only changed files with Biome; do not run root `bun run format` if it would rewrite unrelated working-tree changes.
5. Run `cd apps/worker && bunx wrangler deploy --dry-run` after rebuilding contracts. Confirm bindings are unchanged and no deployment-specific resource is added.
6. Manual local smoke: initial owner setup → create Workspace B → confirm A and B each have independent initial Inbox/Team → create data in each → switch in the URL/picker → attempt A IDs while active in B and confirm 403/404 → confirm inbound route identity resolves only its owning Workspace.

## Risks and mitigations

- **Silent cross-tenant data leakage:** the largest risk is existing legacy routes that select the first membership. Remove implicit selection rather than maintaining it, and test every route class with two Workspaces.
- **Provider identity collision:** email address/domain and Meta App/Page lookup must be globally unambiguous. Add database constraints and ingress tests before exposing creation.
- **Existing local/remote data:** changing an index or rebuilding a SQLite table can fail if duplicate identity data exists. Inspect production candidates and migration SQL before remote application; do not delete or regenerate migrations.
- **Stale browser state:** local storage and unscoped cache keys can reveal data after switching. URL validation, workspace-keyed query keys, cache removal, and selection reset are mandatory.
- **Scope growth:** public organization signup, billing, tenant deletion, cross-workspace templates, and an installation super-admin model should be separate ADRs/phases, not slipped into this change.
