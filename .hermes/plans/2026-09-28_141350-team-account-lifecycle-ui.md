# Team and Account Lifecycle UI Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Deliver a clean, professional Team settings experience for inviting, activating, managing, and safely offboarding agents, alongside cohesive invitation activation, email verification, password-reset, and account-removal flows.

**Architecture:** This plan is a dependent vertical slice of `.hermes/plans/2026-09-28_141036-multi-workspace-product.md`: implement that plan’s ADR/provisioning/explicit-workspace authorization work first, then add a workspace-scoped team-management service and HTTP surface that exposes only role-authorized, non-secret member and invitation state. Build one URL-addressable `Team` Settings section for the authenticated owner/admin workflow, plus a dedicated public account-flow presentation layer for existing Better Auth and invitation endpoints; retain the current endpoints, query parameters, and security model rather than creating alternative credential flows. “Deletion” is an audited offboarding operation—not a hard deletion of Better Auth users, mailboxes, Conversations, Durable Object timelines, or raw email—because ADR 0023 requires history preservation and immediate private-mailbox disablement.

**Tech stack:** Bun workspaces, React 19, Vite, TanStack Router/Query, Tailwind v4, local shadcn/Radix components, Hono, Cloudflare D1 + Drizzle, Better Auth, Effect Schema, Miniflare-backed Worker tests, Vitest.

---

## Current context / assumptions

- This repository is `MsgFlow`, a Front/Missive-style unified inbox. `README.md` identifies React/Vite/TanStack Router for `apps/web`, Cloudflare Worker/Hono/D1 for `apps/worker`, Better Auth for credentials, and `packages/contracts` as the shared HTTP contract boundary.
- The current app already has local shadcn primitives, a warm-neutral token theme (`apps/web/src/index.css`), a global `TooltipProvider` (`apps/web/src/routes/__root.tsx`), web Vitest (`apps/web/package.json`), and auth UI coverage in `apps/web/src/routes/-auth-flow.test.tsx`.
- The only current invitation UI is `Invitation()` in `apps/web/src/components/email-admin.tsx:1003`; it is a collapsed `<details>` form inside Email Admin. It creates an invitation and exposes the sensitive URL, but cannot list/revoke invitations or manage active people.
- Current invitation API behavior is real and must be preserved: `POST /api/workspaces/:workspaceId/invitations`, `POST /api/invitations/register`, `POST /api/invitations/accept`, and `DELETE /api/workspaces/:workspaceId/invitations/:invitationId` in `apps/worker/src/onboarding-api.ts`. Invitation URLs use `/login?invite=<opaque capability>` and must never be logged, stored in UI state beyond the current mutation result, or returned by future list endpoints.
- `apps/web/src/routes/login.tsx` currently combines normal login, `?invite=`, verification resend, password reset request, and `?token=` password reset. It must preserve username-or-email login, all password constraints (8–128), `autoComplete` values, generic reset wording, and the exact existing server calls.
- `apps/worker/src/agent-onboarding.ts` reserves the invited recovery email and immutable username, creates credentials only with the invite capability, sends verification when configured, and atomically adds workspace membership after verified acceptance. The Team UI must model those server-owned states; it must not infer successful email delivery or activate a person from client state.
- The multi-workspace product plan is a prerequisite. Its ADR 0024 changes the product from one Workspace per installation to many isolated Workspaces per installation, makes the URL-selected `workspaceId` authoritative, and removes all first/default-workspace fallbacks. Every route, React Query key, mutation, and navigation below must use that explicit authorized workspace; do not implement a temporary default-workspace Team page.
- ADR 0023 is authoritative over ADR 0021 where they conflict: both Owners and Administrators may invite/revoke and administer lifecycle; only Owners can promote/demote Owners and every individual Workspace must retain at least one Owner. A verified recovery email and a first sign-in are prerequisites for private mailbox activation, but team membership does not itself create a mailbox.
- “Delete user” in this plan means **Remove from this workspace**. Per `docs/adr/0023-deployment-neutral-installation-and-email-onboarding.md:80` and `docs/adr/0021-multi-domain-logical-mailboxes.md:24-26`, the operation retains history/audit records and disables owned private mailboxes in the selected Workspace. It must not remove the global Better Auth account, global immutable recovery email/username, memberships in another Workspace, or a global session that may authorize another Workspace. There is no approved self-service hard account delete, mailbox delete, message delete, or data export scope.
- The existing workspace code currently has no user lifecycle API: `api.listUsers()` is a global legacy list and returns insufficient member/role/invitation state. Do not repurpose it; add explicit workspace-scoped endpoints.
- The working tree is already dirty, including Worker Meta App work. Do not reset, reformat wholesale, stage, or commit pre-existing changes. Before each commit run `git diff -- <touched paths>`; stage only explicit paths/hunks belonging to this feature.

## UX specification (do not improvise)

1. **Settings information architecture:** Add **Team** immediately after **Workspace** and before **Inboxes** in `apps/web/src/routes/settings.tsx`; give it a URL section id of `team`. `/settings?workspace=<authorized-id>&section=team` must be direct-load, refresh, Back/Forward, and role safe. The `workspace` search parameter is resolved/validated by the multi-workspace plan; Settings must preserve it in all Team/Rules/settings navigation. The Settings section nav should show Team to workspace members; privileged controls appear only for Owner/Admin based on the server-provided `canManage` flag.
2. **Team landing:** A calm, list-first operational surface, not a dashboard. Header: “Team”, explanatory sentence, visible active/pending count, and a primary **Invite teammate** button only when allowed. Below: segmented list controls **Active** and **Invitations**; do not use browser `confirm`, native `<details>`, raw inputs, bespoke color utilities, or an overloaded domain/mailbox UI.
3. **Active member rows:** Each row shows avatar initials/image, display name (fallback immutable username), recovery email, role badge, verification status, joined date, owned private-address summary (or “No private mailbox”), and teams. Rows have a compact kebab menu only when the actor may change that person. Role options must explain their scope: Member works assigned conversations; Admin manages workspace configuration but does not gain private-mailbox access; Owner controls ownership. Do not show actions the API will deny.
4. **Invitation rows:** Show recovery email, reserved username, inviter, created/expiry time, and one of: **Awaiting activation** (not claimed), **Account created — verify email** (claimed), **Expired**, or **Revoked**. Never reveal a token or invitation URL from a list response. Only the newly created invitation success panel may display a one-time copy control for its sensitive URL. Active unaccepted invitations have a destructive **Revoke invitation** action and an explanation that the username enters a one-day cooldown.
5. **Invite dialog:** A shadcn `Dialog` with recovery-email and reserved-username fields. Explain that both are immutable, that the recipient receives the activation link at the given email, and that membership and private mailbox access are not granted until verification/acceptance. Submit uses the existing invitation API. Success state identifies `email_sent`, `copy_link`, and `email_delivery_failed` without claiming inbox delivery; it has a `Copy invitation link` button and an explicit Close button. Clear the form and sensitive success URL on close.
6. **Offboarding dialog:** The action label is **Remove from workspace**, not Delete. The irreversible confirmation dialog identifies the member and enumerates the actual effects: loss of authorization in this workspace on the next request, removal from this workspace’s teams/inboxes, private-mailbox inbound/send disablement in this workspace, and retained history. It explicitly says other Workspace memberships are unaffected. It requires a typed exact username (fallback email if username is null) before enabling the final destructive button. The current user cannot remove themselves from the only workspace owner position; the final Owner cannot be removed or demoted.
7. **Public activation experience:** Keep `GET /login?invite=<token>` as the stable deep link, but render it as a focused three-state activation flow rather than a generic sign-in card: (a) create password, (b) check/verify recovery email, (c) sign in and join workspace. The email itself is not client-editable or exposed from the token; the page must say it was sent to the invite’s recovery email. Existing accounts see a sign-in-first variant. Do not call registration automatically, do not expose the invite token in visible copy, and do not log it.
8. **Verification and reset:** Login starts with a simple “Sign in” form; “Forgot password?” opens an in-page recovery state for a recovery email, submits Better Auth’s existing reset request, then always returns the existing generic non-enumerating result. The reset-token state has a new-password + confirm-password pair and blocks submission until equal and 8–128 characters; Better Auth remains the sole token/password authority. Verification resend remains available when a recovery email has been entered and preserves the invite callback URL.
9. **Accessibility/responsiveness:** Dialogs and menus use shadcn components with titles/descriptions, Escape/focus restoration, labelled icon buttons/tooltips, visible focus rings, and destructive controls that are not color-only. The Team table/list becomes stacked cards below 768px; desktop controls never overflow Settings’ content column. Test at 390px, 768px, 1024px, and 1440px.

---

## Step-by-step tasks

### Task 0: Complete and verify the multi-workspace prerequisite

**Objective:** Establish an explicit active Workspace and eliminate default-tenant behavior before Team lifecycle work can safely begin.

**Plan dependency:** Execute Tasks 1–8 of `.hermes/plans/2026-09-28_141036-multi-workspace-product.md` first. This Team plan must not be started against the current `requireDefaultWorkspaceAccess()` / first-membership behavior.

**Required acceptance evidence:**

```bash
cd apps/worker && bun test --max-concurrency=1 test/workspace-provisioning.test.ts test/multi-workspace-ingress.test.ts test/routing.test.ts test/conversation-permissions.test.ts
bun --cwd apps/web test -- -workspace-switching.test.tsx CreateWorkspaceDialog.test.tsx
bun run lint
bun run build
```

**Expected:** all commands exit 0, the active authorized Workspace comes from the URL, API/resource/DO authorization is tenant-scoped, and no production call site silently selects the first/default membership. Record ADR 0024’s completed route audit before beginning Task 1 below.

### Task 1: Record the accepted lifecycle contract and establish red tests

**Objective:** Define the exact member, invitation, role, and offboarding behavior before adding a UI or endpoint.

**Files:**
- Create: `apps/worker/test/team-management.test.ts`
- Create: `apps/web/src/components/settings/TeamSettingsSection.test.tsx`
- Modify: `apps/web/src/routes/-auth-flow.test.tsx`

**Step 1: Add failing Worker service tests.**

Build the test fixture from the same Miniflare/D1 helper already used by `apps/worker/test/agent-onboarding.test.ts`; do not invent a second database harness. Add tests for these exact cases:

```ts
describe("team management", () => {
  it("returns only members and invitations scoped to the authorized workspace", async () => {
    // Seed one actor/member/invitation in workspace-a and matching hidden rows in workspace-b.
    // Assert workspace-b email, name, member id, and invitation id are absent.
  });

  it("allows a verified owner or admin to create and revoke an unaccepted invitation", async () => {
    // Assert the returned invitation list item has no invitationUrl or token field.
    // Assert revocation records a 24-hour cooldown and active=false state.
  });

  it("allows only owners to promote or demote owner memberships", async () => {
    // Admin promotion attempt must reject 403; Owner promotion succeeds.
  });

  it("rejects removal or demotion of the final owner", async () => {
    // Assert 409 and that all membership/mailbox rows are unchanged.
  });

  it("offboards a permitted member from only the selected workspace", async () => {
    // Seed the target in workspace-a and workspace-b. Assert only their
    // workspace-a team/inbox/membership rows are gone; global sessions and
    // workspace-b membership remain; owned workspace-a private mailbox has
    // is_enabled=0 and is_send_enabled=0; user, conversations, and audit rows remain.
  });

  it("does not let an admin remove an owner or another admin", async () => {
    // Assert 403 for each target role.
  });
});
```

**Step 2: Add failing web behavior tests.**

Mock the future `teamApi` module, render `TeamSettingsSection`, and assert the required accessible behavior:

```tsx
it("opens a named invite dialog and clears the sensitive link when closed", async () => {
  render(<TeamSettingsSection workspaceId="workspace-a" canManage />);
  await user.click(screen.getByRole("button", { name: "Invite teammate" }));
  expect(screen.getByRole("dialog", { name: "Invite teammate" })).toBeVisible();
  // Resolve create with delivery: "copy_link" and a URL, then assert Copy invitation link.
  // Close dialog, reopen it, and assert the URL input/status is absent.
});

it("requires the exact identifier before enabling Remove from workspace", async () => {
  render(<TeamSettingsSection workspaceId="workspace-a" canManage />);
  await user.click(screen.getByRole("button", { name: "Manage Alex" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from workspace" }));
  expect(screen.getByRole("button", { name: "Remove Alex from workspace" })).toBeDisabled();
  await user.type(screen.getByLabelText("Type alex to confirm"), "alex");
  expect(screen.getByRole("button", { name: "Remove Alex from workspace" })).toBeEnabled();
});
```

Extend `apps/web/src/routes/-auth-flow.test.tsx` with failing tests for invite activation, reset confirmation mismatch, and recovery request generic message. Mock existing `authClient` functions only; do not change their request payload assertions.

**Step 3: Run the red phase.**

```bash
bun --cwd apps/worker test test/team-management.test.ts --max-concurrency=1
bun --cwd apps/web test -- TeamSettingsSection.test.tsx -auth-flow.test.tsx
```

**Expected:** Both commands fail because the team service/components do not exist or the expected accessible lifecycle UI is absent. The failure must be an asserted missing behavior, not a missing test environment.

**Step 4: Commit test-only scaffolding after it has a stable import boundary.**

Do not commit tests that cannot compile after the next task’s named public module stubs are added. Once imports resolve, keep the behavior assertions failing until their task’s implementation.

```bash
git add apps/worker/test/team-management.test.ts apps/web/src/components/settings/TeamSettingsSection.test.tsx apps/web/src/routes/-auth-flow.test.tsx
git commit -m "test: define team account lifecycle contracts"
```

### Task 2: Add the shared team-management contracts without exposing secrets

**Objective:** Create typed request/response shapes that make the UI and Worker agree on lifecycle state while keeping invitation capabilities server-only.

**Files:**
- Create: `packages/contracts/src/team-management-schema.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/worker/test/team-management.test.ts`

**Step 1: Export these exact public types and Effect schemas.**

Create `packages/contracts/src/team-management-schema.ts` with only client-controlled payload schemas and explicit response types. Use `Schema.Struct`/`Schema.Literal`, validate IDs as bounded non-empty strings, and keep all list response records as TypeScript interfaces because they are server-produced.

```ts
import { Schema } from "effect";

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const Role = Schema.Literal("owner", "admin", "member");

export const UpdateWorkspaceMemberRoleRequestSchema = Schema.Struct({ role: Role });
export type UpdateWorkspaceMemberRoleRequest = Schema.Schema.Type<
  typeof UpdateWorkspaceMemberRoleRequestSchema
>;

export const OffboardWorkspaceMemberRequestSchema = Schema.Struct({
  confirmation: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(254)),
});
export type OffboardWorkspaceMemberRequest = Schema.Schema.Type<
  typeof OffboardWorkspaceMemberRequestSchema
>;

export interface TeamMemberSummary {
  id: string;
  name: string;
  username: string | null;
  email: string;
  emailVerified: boolean;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  teamNames: string[];
  privateMailboxes: Array<{
    canonicalAddress: string;
    isEnabled: boolean;
    isSendEnabled: boolean;
  }>;
  canChangeRole: boolean;
  canRemove: boolean;
}

export type InvitationLifecycle =
  | "awaiting_activation"
  | "awaiting_email_verification"
  | "expired"
  | "revoked";

export interface TeamInvitationSummary {
  id: string;
  email: string;
  username: string | null;
  invitedByName: string;
  createdAt: number;
  expiresAt: number;
  lifecycle: InvitationLifecycle;
  canRevoke: boolean;
}

export interface TeamManagementSummary {
  canManage: boolean;
  canManageOwners: boolean;
  members: TeamMemberSummary[];
  invitations: TeamInvitationSummary[];
}

export { Id as WorkspaceMemberIdSchema };
```

Export the module from `packages/contracts/src/index.ts` using the existing barrel-file style.

**Step 2: Build contracts before Worker type-checking.**

```bash
bun --cwd packages/contracts run build
bun --cwd apps/worker run type-check
```

**Expected:** Both commands exit 0. No contract contains an invitation token, `tokenHash`, `invitationUrl`, `account.password`, session token, or unscoped mailbox content.

**Step 3: Commit.**

```bash
git add packages/contracts/src/team-management-schema.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): define team lifecycle responses"
```

### Task 3: Implement authorization-safe team lifecycle service and durable audit

**Objective:** Centralize team listing, role mutation, invitation visibility, and non-destructive offboarding so every route shares the same authorization and invariants.

**Files:**
- Create: `apps/worker/src/team-management.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/NNNN_team_member_offboarding.sql` (allocate `NNNN` only after the multi-workspace plan’s provider-identity migration and any concurrent Meta App work are merged; inspect `packages/db/migrations/meta/_journal.json` first)
- Modify: `packages/db/migrations/meta/_journal.json`
- Test: `apps/worker/test/team-management.test.ts`

**Step 1: Add an append-only offboarding audit table.**

Use a forward-only migration; do not delete or regenerate migrations. The SQL must preserve the existing user identity and create a workspace-scoped immutable record:

```sql
CREATE TABLE workspace_member_offboardings (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  prior_role TEXT NOT NULL CHECK (prior_role IN ('owner', 'admin', 'member')),
  confirmation_identifier TEXT NOT NULL,
  private_mailboxes_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_workspace_member_offboardings_workspace_time
ON workspace_member_offboardings(workspace_id, created_at);
```

Add the matching Drizzle `workspaceMemberOffboardings` definition in `packages/db/src/schema.ts`; use `onDelete: "restrict"` for all identity/history references. Add it to the project’s schema export path.

**Step 2: Write the service with no route concerns.**

Create `apps/worker/src/team-management.ts` with these exported functions:

```ts
export async function getTeamManagement(
  env: AuthEnv,
  workspaceId: string,
  actorId: string,
): Promise<TeamManagementSummary>;

export async function updateWorkspaceMemberRole(
  env: AuthEnv,
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  role: "owner" | "admin" | "member",
): Promise<{ member: TeamMemberSummary }>;

export async function offboardWorkspaceMember(
  env: AuthEnv,
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  confirmation: string,
): Promise<{ success: true }>;
```

Implementation rules:

- Call the explicit `requireWorkspaceAccess()` created by the multi-workspace plan before exposing any summary. `canManage` is true only when the actor is an Owner or Admin; `canManageOwners` is true only for an Owner. Members receive only active member records that they are allowed to see; invitations must be an empty array for non-managers. Never call `requireDefaultWorkspaceAccess()` or derive a Workspace from a user’s first membership.
- Query users through `workspace_members` joined to `user`, then batch-load `team_members → teams` and owned private `mailboxes`; never loop N+1 queries and never return mailbox delegates, raw MIME, or private timeline data.
- List only invitations from the requested workspace. Derive lifecycle at query time from `revoked_at`, `expires_at <= Date.now()`, and `claimed_at`; list response never includes raw token, token hash, invitation URL, or delivery status.
- Role mutation requires a current Owner. Reject unknown/foreign targets with 404, self-demotion/self-removal when it would leave no Owner, and any state that would result in zero Owner rows with 409. An Admin must receive 403 even if the desired target role is `member`.
- Offboarding allows an Owner to remove any target while preserving one Owner in the selected Workspace; an Admin may remove only a `member`. Reject self-removal, a target outside the requested Workspace, and confirmation values that do not exactly equal the target’s username or, when username is null, normalized recovery email.
- Run all D1 mutations in a single `env.DB.batch()` only after all authorization/ownership/count/confirmation checks pass: delete target `team_members`, `inbox_members`, and `workspace_members` constrained to the requested Workspace; set target-owned private mailboxes **in that Workspace** to `is_enabled=0`, `is_send_enabled=0`, `updated_at=<now>`; append exactly one offboarding audit row. Do **not** delete Better Auth sessions (they are installation-global and may authorize another Workspace), the `user`, `account`, conversations, messages, raw objects, email audit, mailbox rows, or any membership/resource outside the requested Workspace. Subsequent requests must re-authorize against `workspace_members` and return 403 for the removed Workspace.
- Invalidate/revoke private mailbox delegates through the existing mailbox authorization path if a later service represents them separately; do not create a second grant model. The change must not let an Owner/Admin read private content.

**Step 3: Execute the red-to-green Worker tests.**

```bash
bun --cwd packages/db run build
bun --cwd packages/contracts run build
bun --cwd apps/worker test test/team-management.test.ts --max-concurrency=1
```

**Expected:** The focused suite passes every role, cross-workspace, final-owner, session-revocation, mailbox-disablement, and preservation assertion.

**Step 4: Verify the migration on an empty scratch SQLite database.**

Use the repository’s migration validation method; create a temporary database only, apply the ordered migration chain including the new migration, then inspect:

```bash
sqlite3 "$SCRATCH_DB" ".schema workspace_member_offboardings"
sqlite3 "$SCRATCH_DB" "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workspace_member_offboardings_workspace_time';"
```

**Expected:** The table definition includes the three `RESTRICT` foreign keys and the index query returns exactly `idx_workspace_member_offboardings_workspace_time`.

**Step 5: Commit.**

```bash
git add apps/worker/src/team-management.ts apps/worker/test/team-management.test.ts packages/db/src/schema.ts packages/db/migrations/NNNN_team_member_offboarding.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(worker): add audited workspace member offboarding"
```

Replace `NNNN` in the command with the actual allocated migration filename; do not stage a concurrent person’s migration.

### Task 4: Mount typed team-management API routes and preserve invitation semantics

**Objective:** Expose the service through session-authenticated, workspace-scoped routes without duplicating authentication/validation logic.

**Files:**
- Create: `apps/worker/src/team-management-api.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/src/lib/team-api.ts` (create in Task 5; do not add web code in this task)
- Test: `apps/worker/test/team-management.test.ts`

**Step 1: Add the Hono router.**

Create `apps/worker/src/team-management-api.ts` using the same `createAuth(env).api.getSession`, `Cache-Control: no-store`, trusted-origin handling, `decodeJsonBody`, and `{ success, data }` envelope as `apps/worker/src/onboarding-api.ts`. Implement exactly:

```text
GET    /workspaces/:workspaceId/team
PATCH  /workspaces/:workspaceId/members/:userId/role
DELETE /workspaces/:workspaceId/members/:userId
GET    /workspaces/:workspaceId/invitations
```

The GET team response may include invitations for managers, so the final invitations GET may delegate to the same service and return `{ invitations }`; it exists only to support a later paginated view without changing the Team page contract. It still returns no secret capability fields.

The PATCH route decodes `UpdateWorkspaceMemberRoleRequestSchema`. The DELETE route decodes `OffboardWorkspaceMemberRequestSchema` (a JSON body is intentional because it carries the typed confirmation value). Convert service authorization errors to the project’s `{ success: false, error }` status envelope. Do not return raw database errors.

**Step 2: Mount routes before blanket application middleware only if their router performs its own session check.**

In `apps/worker/src/index.ts`, mount the router under `/api` alongside `onboardingApi`; do not mount it below a route that changes its request body or error envelope. Add no global user-management authorization bypass, default-workspace compatibility path, or `workspaceId` fallback inferred from the actor.

**Step 3: Extend route-boundary tests.**

Add HTTP tests proving:

- no session → 401;
- session from another workspace → 403/404 without data leakage;
- normal member GET returns no invitations and mutating calls return 403;
- Admin cannot call owner-role mutation or remove an Owner/Admin;
- unknown keys in request bodies are stripped by Effect Schema and cannot set actor/workspace/target/mailbox state;
- response serialization contains no `token`, `tokenHash`, `invitationUrl`, `password`, `session`, `accessToken`, or `rawObjectKey` key.

**Step 4: Run focused checks.**

```bash
bun --cwd packages/contracts run build
bun --cwd apps/worker test test/team-management.test.ts --max-concurrency=1
bun --cwd apps/worker run type-check
```

**Expected:** All commands exit 0.

**Step 5: Commit.**

```bash
git add apps/worker/src/team-management-api.ts apps/worker/src/index.ts apps/worker/test/team-management.test.ts
git commit -m "feat(api): expose workspace team lifecycle controls"
```

### Task 5: Add the typed Team client and Settings routing

**Objective:** Make Team a stable Settings section with typed API calls and no global/unscoped user list dependence.

**Files:**
- Create: `apps/web/src/lib/team-api.ts`
- Modify: `apps/web/src/routes/settings.tsx`
- Modify: `apps/web/src/routes/-settings.contract.test.tsx`
- Test: `apps/web/src/components/settings/TeamSettingsSection.test.tsx`

**Step 1: Create a typed client.**

Create `apps/web/src/lib/team-api.ts` using the existing exported `request` helper from `apps/web/src/lib/api.ts`:

```ts
import type {
  TeamManagementSummary,
  UpdateWorkspaceMemberRoleRequest,
} from "@msgflow/contracts";
import { request } from "./api";

const workspacePath = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}`;

export const teamApi = {
  get(workspaceId: string) {
    return request<{ success: true; data: TeamManagementSummary }>(
      `${workspacePath(workspaceId)}/team`,
    );
  },
  updateRole(workspaceId: string, userId: string, body: UpdateWorkspaceMemberRoleRequest) {
    return request<{ success: true; data: { member: TeamManagementSummary["members"][number] } }>(
      `${workspacePath(workspaceId)}/members/${encodeURIComponent(userId)}/role`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },
  remove(workspaceId: string, userId: string, confirmation: string) {
    return request<{ success: true; data: { success: true } }>(
      `${workspacePath(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE", body: JSON.stringify({ confirmation }) },
    );
  },
  revokeInvitation(workspaceId: string, invitationId: string) {
    return request<{ success: true; data: { id: string; cooldownUntil: number } }>(
      `${workspacePath(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    );
  },
};
```

**Step 2: Add typed Settings search state.**

In `apps/web/src/routes/settings.tsx`, extend the existing section union and ordered section data exactly as follows. Take `workspaceId` from the URL-validated active Workspace state introduced by the multi-workspace plan; preserve it when selecting `team` and when closing/navigating away from Settings:

```ts
type SettingsTab =
  | "overview"
  | "team"
  | "email"
  | "inboxes"
  | "channels"
  | "tags"
  | "automation";

{ id: "team", label: "Team", detail: "People, invitations, and access", icon: UsersRound },
```

Use the existing route’s TanStack Router search validation pattern (inspect it before editing; it may have changed on the active branch) so `section=team` is valid, invalid sections fall back to the first authorized section, and tab changes update the URL instead of only local state. Do not add another page route or a Settings-local workspace selection.

**Step 3: Make the test pass.**

Expand `apps/web/src/routes/-settings.contract.test.tsx` to prove `/settings?section=team` selects Team and the section selector updates URL search state. Do not assert implementation class names.

```bash
bun --cwd apps/web test -- -settings.contract.test.tsx TeamSettingsSection.test.tsx
bun --cwd apps/web run build
```

**Expected:** The Team routing/client tests pass and the web build exits 0.

**Step 4: Commit.**

```bash
git add apps/web/src/lib/team-api.ts apps/web/src/routes/settings.tsx apps/web/src/routes/-settings.contract.test.tsx apps/web/src/components/settings/TeamSettingsSection.test.tsx
git commit -m "feat(web): add team settings route and client"
```

### Task 6: Build the Team Settings section and invitation controls

**Objective:** Replace the hidden Email Admin invitation control with the complete people/invitation management UI specified above.

**Files:**
- Create: `apps/web/src/components/settings/TeamSettingsSection.tsx`
- Modify: `apps/web/src/routes/settings.tsx`
- Modify: `apps/web/src/components/email-admin.tsx`
- Modify: `apps/web/src/components/settings/TeamSettingsSection.test.tsx`

**Step 1: Compose the section from existing local primitives.**

Use `Tabs`, `Card`, `Avatar`, `Badge`, `Button`, `Dialog`, `DropdownMenu`, `Field`, `Input`, `Alert`, `Skeleton`, `Empty`, `Tooltip`, and `Separator` from `apps/web/src/components/ui/`. Query with key `['team-management', workspaceId]`, enabled only when `workspaceId` exists, and invalidate that exact key after invitation creation, revocation, role change, or removal.

Required component boundaries:

```text
TeamSettingsSection
├── TeamSummaryHeader
├── InviteTeammateDialog
├── TeamMembersPanel
│   ├── TeamMemberRow
│   ├── ChangeRoleDialog (or labelled menu + final confirmation Dialog)
│   └── RemoveMemberDialog
└── TeamInvitationsPanel
    ├── InvitationRow
    └── RevokeInvitationDialog
```

Keep helper components in the same file until a second caller exists. Do not split a design system prematurely.

**Step 2: Use the current invite API for creation; remove the old duplicate UI.**

Call `emailAdminApi.invite(workspaceId, email.trim(), username.trim())` only from the new dialog. On success, show delivery wording exactly:

```text
email_sent: "Invitation submitted for delivery. It expires <local date>."
copy_link: "Email delivery is not configured. Share this link securely; it expires <local date>."
email_delivery_failed: "Email delivery failed. Share this link securely; it expires <local date>."
```

Use `navigator.clipboard.writeText()` only after an explicit `Copy invitation link` click and show a local “Copied” status. If Clipboard API rejects, select a read-only input with the URL for manual copy; do not auto-copy or log it. Clear this success object when Dialog `onOpenChange(false)` fires.

Delete only the `Invitation` function and its invocation from `apps/web/src/components/email-admin.tsx` after searching imports/usages and confirming no other path uses it. Do not delete `email-admin.tsx` or unrelated mail lifecycle UI.

**Step 3: Make all current red tests green.**

```bash
bun --cwd apps/web test -- TeamSettingsSection.test.tsx -settings.contract.test.tsx
bun --cwd apps/web run build
bun run lint
```

**Expected:** All tests/build/lint exit 0. Assertions must cover: loading/error/empty states; no invite button for `canManage=false`; invite success wording and one-time copy; no URL/token in invitation list; revoke confirmation; role actions limited by flags; and typed confirmation before removal.

**Step 4: Commit.**

```bash
git add apps/web/src/components/settings/TeamSettingsSection.tsx apps/web/src/components/settings/TeamSettingsSection.test.tsx apps/web/src/routes/settings.tsx apps/web/src/components/email-admin.tsx
git commit -m "feat(web): add professional team and invitation management"
```

### Task 7: Refactor login into focused sign-in, activation, verification, and recovery states

**Objective:** Improve the account lifecycle UI without changing Better Auth/invitation security behavior.

**Files:**
- Create: `apps/web/src/components/auth/AccountFlowShell.tsx`
- Modify: `apps/web/src/routes/login.tsx`
- Modify: `apps/web/src/routes/-auth-flow.test.tsx`

**Step 1: Write the remaining failing behavior tests.**

Add tests for:

- `?invite=` renders “Activate your account”, does not render a visible token, and presents create-password before sign-in/accept;
- create-password success displays “Check your recovery email” and does not say membership has already been granted;
- request-reset state submits only a recovery email to `authClient.requestPasswordReset` and renders the generic non-enumerating result for both a resolved error-free call and a user-not-found-equivalent response;
- `?token=` has New password and Confirm new password fields; mismatch prevents `authClient.resetPassword`; matching 8+ character fields submit the original token and new password;
- resend verification uses an invite-preserving callback URL when an invite is present;
- normal email-or-username sign-in remains unchanged.

**Step 2: Create a presentational shell.**

`AccountFlowShell.tsx` must be a display-only component with this API:

```ts
export function AccountFlowShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  // Render the existing MsgFlow mark, one max-w-md Card, and supplied content.
}
```

It owns no auth mutation, URL parsing, token, password, or navigation state. Use semantic design tokens and existing shadcn Card/Field/Button/Alert; retain the restrained warm-neutral style already used by the app. No external font, image, or animation dependency is needed.

**Step 3: Recompose `Login` as a finite local mode.**

In `apps/web/src/routes/login.tsx`, derive initial mode from query parameters in this priority order: `resetToken` → `activation` → `sign-in`. A `recovery` mode is reached only from the normal sign-in footer. Preserve `next` handling, `router.invalidate()`, and `/` navigation after successful authentication/acceptance.

Rules:

- activation creation calls the existing `POST invitations/register` with `{ token: invitation, password }`, then moves only local UI to verification-pending; it must not call `/invitations/accept` until successful sign-in;
- existing-account activation retains a clear “Sign in to join” path and calls existing `/invitations/accept` only after a normal successful Better Auth sign-in;
- reset confirmation is client-only UX validation; submit exactly `{ token: resetToken, newPassword: password }` to Better Auth and then return to sign-in after success;
- recovery request calls the existing `authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/login` })`, always describes result as a requested/submitted link, never as delivered or an account-existence confirmation;
- set all password fields to `type="password"`, `minLength={8}`, `maxLength={128}`, and correct `autoComplete`; clear passwords on success/unmount-like mode transition;
- do not alter server-side sender configuration, Better Auth token lifecycle, account-password storage, or invite capability format.

**Step 4: Run the TDD green phase.**

```bash
bun --cwd apps/web test -- -auth-flow.test.tsx
bun --cwd apps/web run build
bun run lint
```

**Expected:** All commands exit 0; existing setup tests remain green.

**Step 5: Commit.**

```bash
git add apps/web/src/components/auth/AccountFlowShell.tsx apps/web/src/routes/login.tsx apps/web/src/routes/-auth-flow.test.tsx
git commit -m "feat(web): refine activation and account recovery flows"
```

### Task 8: Add manual workflow evidence and run complete validation

**Objective:** Verify that the integrated UI, Worker semantics, and live responsive interaction match the plan without claiming email delivery from local tests.

**Files:**
- Modify only files required by real defects found during this task.

**Step 1: Run all automated gates.**

```bash
bun --cwd packages/contracts run build
bun --cwd apps/worker test --max-concurrency=1
bun --cwd apps/web test
bun run test
bun run lint
bun run build
```

**Expected:** Every command exits 0. If a root command is blocked by unrelated pre-existing Meta App changes, run the focused Worker/web commands, identify the exact failing command/file, and do not change unrelated code just to claim green.

**Step 2: Start the local stack and verify gate endpoints.**

```bash
bun run dev
```

In a second terminal after the stack reports readiness:

```bash
curl -i http://localhost:8787/health
curl -i http://localhost:5173/setup
```

**Expected:** Both return HTTP 200. Do not use local simulated email delivery as evidence that a real invitation, verification, or reset message reached an inbox.

**Step 3: Run the authenticated browser acceptance pass.**

Use one Owner, one Admin, one Member, and one pending invitation fixture. At 390px, 768px, 1024px, and 1440px verify:

1. `/settings?workspace=<workspace-a>&section=team` loads directly, refreshes, returns through browser history, and shows no horizontal overflow. Switching to Workspace B clears Workspace A Team Query data before B renders; a stale/unauthorized workspace URL falls back through the multi-workspace route guard without leaking A data.
2. Owner can invite, copy a one-time link, view status, revoke a pending invitation, promote/demote ownership while another Owner exists, and remove a Member; Owner cannot remove/demote the final Owner.
3. Admin can invite/revoke and remove a Member, but cannot alter ownership or remove Admin/Owner. Member sees no privileged actions and server rejects manually replayed mutation requests.
4. Activation link renders the three-state flow; credential creation does not claim membership; verification copy is accurate; successful verified sign-in accepts the invitation exactly once.
5. Normal sign-in accepts email/username; resend verification preserves invitation return path; recovery/reset path keeps generic non-enumerating copy; mismatched reset confirmation cannot submit; successful reset redirects to normal sign-in.
6. After removal, target membership is absent only in the selected Workspace UI/API, their private mailbox in that Workspace is disabled, and existing conversations/history still render for authorized remaining users. The target’s other Workspace membership/session remains usable; a request for the removed Workspace receives 403 and cannot show stale cached content. No private mailbox content becomes visible to Owner/Admin solely due to offboarding.
7. Keyboard: Tab order/focus indicators work, Escape closes every Dialog/menu, dialogs restore focus to trigger, and all icon-only actions announce an accessible label.

**Step 4: Inspect scope before any final commit.**

```bash
git diff --check
git diff --stat
git status --short
```

**Expected:** no whitespace errors; only intentional team/account lifecycle paths are staged. Do not run root `bun run format` because it is a write command and the working tree was already dirty; if formatting is needed, run Biome only on files modified by this feature, inspect the diff, and rerun the gates.

**Step 5: Commit only verified fixes, if any.**

```bash
git add <only-files-fixed-in-this-task>
git commit -m "test: verify team account lifecycle workflows"
```

---

## Tests / validation summary

- Every code task follows red → minimal implementation → green before its commit.
- Service coverage in `apps/worker/test/team-management.test.ts` must verify tenant isolation, role boundaries, final-owner protection **per Workspace**, team/inbox membership removal limited to the selected Workspace, private-mailbox disablement limited to the selected Workspace, continued authorization in a second Workspace, and intentional preservation of Better Auth user/session/history/audit rows.
- HTTP tests must prove no invitation capability, credential, session, token hash, or private storage key escapes list endpoints.
- Web Vitest coverage must test controls by accessible role/name, not snapshots or Tailwind class strings: settings deep link, management permissions, invite/copy/revoke behavior, typed removal confirmation, activation branches, verification resend, reset mismatch, reset success, and generic recovery wording.
- Minimum automated gate: `bun --cwd packages/contracts run build`, `bun --cwd apps/worker test --max-concurrency=1`, `bun --cwd apps/web test`, `bun run test`, `bun run lint`, and `bun run build`.
- Manual browser verification at 390px, 768px, 1024px, and 1440px is required because unit tests cannot prove responsive overflow, overlay focus restoration, or live session revocation. Real email delivery/verification remains an operator-approved production/manual test; local send acceptance is not delivery evidence.

## Risks, tradeoffs, and open questions

- The current auth/onboarding documentation has drift: `docs/auth-username-onboarding.md` describes an older invitee-selected username shape, while the current API/service and ADR 0023 use Owner/Admin-reserved usernames. This plan follows the current implementation + ADR 0023. Before implementation, amend that document in a separate documentation commit so operators do not act on stale endpoint payloads.
- The plan deliberately does not implement hard account deletion. Hard deletion conflicts with ADR 0021/0023’s retained history, audit, mailbox, and private-storage requirements and would require a separately approved coordinated D1/DO/R2 legal-deletion design.
- A removed person’s Better Auth user and global session can remain valid for other Workspace contexts; only the selected Workspace membership and resources are revoked/disabled, and every request must re-authorize that membership. If product policy instead requires installation-wide account disablement, it needs a new `user` lifecycle state, Better Auth integration audit, and a distinct ADR—do not smuggle it into this UI work.
- Invitation email delivery is best effort. `email_sent` means the Worker accepted a send request, not inbox delivery; retain copy-link recovery wording and never show a delivery guarantee.
- The current project’s `workspace_members.user_id` and `team_members.user_id` have cascade foreign keys, but hard user deletion would cascade data that the policy requires to preserve. The offboarding design avoids invoking that cascade and must not delete installation-global Better Auth sessions, because the multi-workspace plan explicitly permits one Agent to operate in many Workspaces.
- Settings currently contains substantial separate functionality and may have uncommitted changes. Integrate Team through a narrow component/section change and hunk-stage shared settings files; do not rewrite the Settings shell as part of this work.
- Product decision still needed later: whether team membership should grant specific Inbox memberships by default. This plan removes existing explicit team/inbox membership during offboarding but does not change how they are granted, because current conversation read authorization is workspace-scoped and inbox-grant rollout remains separate.
