# Authentication username and onboarding boundary

MsgFlow uses the installed Better Auth native `username` plugin (`displayUsername: false`, `immutableUsername: true`). Usernames must already be lower-case ASCII: 3–30 letters/digits/dots/hyphens, no leading/trailing/repeated dots, no underscores. Setup and invitation signup reject operational/shared names: `postmaster`, `abuse`, `admin`, `administrator`, `root`, `hostmaster`, `webmaster`, `security`, `mailer-daemon`, `noreply`, `no-reply`, `support`, `sales`.

Migration 0010 permits a valid NULL → username assignment for historical users but rejects subsequent changes. Existing users keep nullable usernames and email/password sign-in. Sign-in is deliberately **not globally verification-gated**: enabling Better Auth `requireEmailVerification` globally would silently lock out historical users. Instead, owner invitation creation requires a verified owner, invitation acceptance requires a verified matching recovery email, and private mailbox provisioning must retain its existing verified-email/immutable-username gate. No onboarding action grants mailbox access.

## Sender and Better Auth endpoints

Configure an operator-approved Cloudflare structured `EMAIL` send binding, `AUTH_EMAIL_FROM` (a sender address authorized for that binding), and `BETTER_AUTH_URL` (the public application origin). `BETTER_AUTH_TRUSTED_ORIGINS` remains necessary for split-origin development. MsgFlow never creates sending domains or DNS records.

`packages/auth/src/index.ts` passes real supported callbacks to Better Auth:

New account setup, invitation acceptance, and password reset accept passwords
from 8 through 128 characters. Each password-creation or password-change flow
requires a matching confirmation field. MsgFlow does not impose composition
rules such as requiring a symbol, digit, or mixed case.

- `emailVerification.sendVerificationEmail` uses `EMAIL.send({ from, to, subject, text })`; verification links expire after one hour. Initial Owner verification establishes a session and continues the owner through channel setup instead of returning them to login. Invitation acceptance is distinct: the invitation capability delivered to the recipient's recovery email is its proof of mailbox control and marks a new invitee verified when they set their password.
- `emailAndPassword.sendResetPassword` sends only for users whose recovery email is already verified. Reset links expire after one hour. Unknown and unverified requests get the same generic Better Auth response, not an assertion that email was delivered.
- `revokeSessionsOnPasswordReset: true`; Better Auth creates, validates, and consumes reset tokens and hashes the replacement password. After a successful reset, MsgFlow returns the Agent to sign in with the new password rather than creating a session automatically. The application never writes credential hashes.

Mounted Better Auth routes include `POST /api/auth/send-verification-email`, `GET /api/auth/verify-email`, `POST /api/auth/request-password-reset`, and `POST /api/auth/reset-password`. The login page supports resend, reset requests, and the reset callback's `?token=...`. A sender accepted a send request does not prove delivery or verification. Missing sender configuration leaves these capabilities unavailable rather than silently pretending delivery succeeded.

Failed sign-in attempts are rate-limited by account identifier and source IP: five
failures in 15 minutes trigger a 15-minute cooldown. Every failure and cooldown
uses the same generic invalid-credentials response.

## Initial Workspace Owner setup

Generic public signup stays disabled. On a fresh installation, `/login` uses server-backed setup state to render the mandatory initial Owner setup wizard instead of a sign-in form. After initial setup completes, `/login` exposes only sign-in, password recovery, and invitation acceptance; it never exposes a public first-workspace setup link. A direct `/setup` visit after completion redirects an authenticated Agent to `/` and everyone else to `/login`; it never reveals whether an installation was newly initialized. `POST /api/setup/owner` atomically claims first use only if both workspaces and memberships are empty, calls the server-only Better Auth `signUpEmail`, then creates the workspace, owner membership, initial team/inbox and their memberships in a D1 batch. Better Auth auto-sign-in is disabled for signup, and its synthetic duplicate-user response is checked against the actual created row before linking anything.

Setup returns `verification: pending_sender_configuration | verification_sent | verification_delivery_failed`. The owner account is initially unverified. The UI stays on a clear pending-verification result rather than silently entering the inbox. After the operator configures the sender, use **Resend verification** on `/login`, with the recovery email rather than username. The verification link establishes a session and resumes the owner at channel setup. The pending owner can sign in but cannot invite agents or provision private mailboxes until verified. If the durable initial setup claim exists but is incomplete, `/login` shows only a neutral `Setup is being completed. Contact your administrator.` state; recovery is a local authenticated operator procedure with no public retry or reset control.

A failure after account creation retains the singleton setup claim; an operator must inspect and complete/remediate it. Do not delete the claim merely to retry setup or permit a different owner to seize the installation.

## Owner invitations

Mount `onboardingApi` from `apps/worker/src/onboarding-api.ts` at `/api` **before blanket session middleware**; it applies its own session checks where needed. Apply migration `0015_agent_onboarding.sql`, including both triggers. The companion Drizzle definition is `packages/db/src/agent-onboarding-schema.ts` (schema exports/journal integration belongs to the migration integrator).

| Endpoint | Authorization and body |
| --- | --- |
| `POST /api/workspaces/:workspaceId/invitations` | Verified workspace owner/admin session; `{ email }`; every accepted invitation creates the `member` role |
| `POST /api/invitations/accept` | New invitee: valid invitation capability plus `{ token, username, password }`; existing Agent: signed-in matching account plus `{ token }` |

Responses use `{ success: true, data: ... }` or `{ success: false, error }`. Invitation creation returns `id`, `email`, `workspaceId`, `expiresAt`, and `delivery: email_sent | email_delivery_failed`; it never returns the invitation capability or URL to the browser. The delivered email names the inviting Workspace and inviter, states that acceptance grants Member access, gives the seven-day expiry, and tells unexpected recipients to ignore it. Invitation creation and resend are rate-limited: each invitation may be resent at most once per minute, and a Workspace may send at most 100 invitation emails in a rolling 24-hour period; limit failures return a neutral retry-later result. New-Agent acceptance is permitted only for a capability sent by MsgFlow to the invitation's recovery email, so a failed sender configuration or failed delivery must be remediated and resent rather than bypassed with a copied link. A resend replaces the stored token digest and expiry, invalidating every prior link. Only a SHA-256 token digest is persisted. Invitations expire after seven days.

The login page handles `?invite=...` without a separate public route. A valid capability can fetch a display-safe preview—Workspace name, masked recovery email, expiry, and invitation state—before sign-in; invalid or expired capabilities receive one generic error. Before any account action, the invitation screen shows the Workspace name and a masked recovery email. A new invitee selects an available immutable Username, enters a password, and confirms that password. A mismatch or unavailable Username is an inline validation result and leaves the invitation usable for correction. The email and Workspace are taken solely from the invitation. A conditional D1 claim permits only one credential creation attempt after the Username and password confirmation pass validation. In the same guarded acceptance transaction, the delivered invitation capability proves recovery-email control, marks the new account verified, assigns the selected Username, creates the Workspace membership, establishes a session, and redirects to that Workspace. If the recovery email already belongs to an Agent, the page offers only sign-in with that exact invited email and password, followed by an explicit `Join workspace` confirmation; it does not offer username sign-in in this flow, and the invitation stays active until that confirmation. An Agent already in the invited Workspace sees `You already have access`; viewing that stale invitation does not consume or modify it. Acceptance also marks the matching recovery email verified, but never changes an existing Agent's password or username.

Acceptance is a single guarded SQLite transaction. It rejects expired, already accepted, or mismatched acceptance; for a new invitee it creates the Better Auth credential, marks the account verified, validates and assigns the selected available Username, inserts only the invited Workspace's `member` role, and consumes the capability. A membership insertion failure rolls the transaction back. Parallel acceptance cannot consume twice. Caller-supplied email, Workspace, or role cannot override the stored scope.

Better Auth credentials and the invitation claim are not one cross-service transaction. On ambiguous signup failure the claim is retained, preventing duplicate credential attempts. If the account exists, the recipient can verify/sign in and accept. Otherwise ask the owner for a fresh invitation; expired invitations likewise require replacement. No public unassigned signup or implicit owner promotion is enabled.

## Verification evidence

`apps/worker/test/agent-onboarding.test.ts` runs real Better Auth APIs and Miniflare D1 with only email delivery mocked: verification callbacks, pending membership, concurrent acceptance, expiry, wrong identity/workspace, immutable usernames, generic signup denial (existing setup tests), recovery reset-token consumption/session revocation, and route boundary checks. These tests do not send real email; production sender authorization and deliverability still require an operator-approved smoke test.
