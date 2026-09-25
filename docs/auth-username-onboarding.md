# Authentication username and onboarding boundary

MsgFlow uses the installed Better Auth native `username` plugin (`displayUsername: false`, `immutableUsername: true`). Usernames must already be lower-case ASCII: 3–30 letters/digits/dots/hyphens, no leading/trailing/repeated dots, no underscores. Setup and invitation signup reject operational/shared names: `postmaster`, `abuse`, `admin`, `administrator`, `root`, `hostmaster`, `webmaster`, `security`, `mailer-daemon`, `noreply`, `no-reply`, `support`, `sales`.

Migration 0010 permits a valid NULL → username assignment for historical users but rejects subsequent changes. Existing users keep nullable usernames and email/password sign-in. Sign-in is deliberately **not globally verification-gated**: enabling Better Auth `requireEmailVerification` globally would silently lock out historical users. Instead, owner invitation creation requires a verified owner, invitation acceptance requires a verified matching recovery email, and private mailbox provisioning must retain its existing verified-email/immutable-username gate. No onboarding action grants mailbox access.

## Sender and Better Auth endpoints

Configure an operator-approved Cloudflare structured `EMAIL` send binding, `AUTH_EMAIL_FROM` (a sender address authorized for that binding), and `BETTER_AUTH_URL` (the public application origin). `BETTER_AUTH_TRUSTED_ORIGINS` remains necessary for split-origin development. MsgFlow never creates sending domains or DNS records.

`packages/auth/src/index.ts` passes real supported callbacks to Better Auth:

- `emailVerification.sendVerificationEmail` uses `EMAIL.send({ from, to, subject, text })`; verification links expire after one hour. Verification does not automatically sign in.
- `emailAndPassword.sendResetPassword` sends only for users whose recovery email is already verified. Unknown and unverified requests get the same generic Better Auth response, not an assertion that email was delivered.
- `revokeSessionsOnPasswordReset: true`; Better Auth creates, validates, and consumes reset tokens and hashes the replacement password. The application never writes credential hashes.

Mounted Better Auth routes include `POST /api/auth/send-verification-email`, `GET /api/auth/verify-email`, `POST /api/auth/request-password-reset`, and `POST /api/auth/reset-password`. The login page supports resend, reset requests, and the reset callback's `?token=...`. A sender accepted a send request does not prove delivery or verification. Missing sender configuration leaves these capabilities unavailable rather than silently pretending delivery succeeded.

## Initial Workspace Owner setup

Generic public signup stays disabled. `POST /api/setup/owner` atomically claims first use only if both workspaces and memberships are empty, calls the server-only Better Auth `signUpEmail`, then creates the workspace, owner membership, initial team/inbox and their memberships in a D1 batch. Better Auth auto-sign-in is disabled for signup, and its synthetic duplicate-user response is checked against the actual created row before linking anything.

Setup returns `verification: pending_sender_configuration | verification_sent | verification_delivery_failed`. The owner account is initially unverified. The UI stays on a clear pending-verification result rather than silently entering the inbox. After the operator configures the sender, use **Resend verification** on `/login`, with the recovery email rather than username. The pending owner can sign in but cannot invite agents or provision private mailboxes until verified.

A failure after account creation retains the singleton setup claim; an operator must inspect and complete/remediate it. Do not delete the claim merely to retry setup or permit a different owner to seize the installation.

## Owner invitations

Mount `onboardingApi` from `apps/worker/src/onboarding-api.ts` at `/api` **before blanket session middleware**; it applies its own session checks where needed. Apply migration `0015_agent_onboarding.sql`, including both triggers. The companion Drizzle definition is `packages/db/src/agent-onboarding-schema.ts` (schema exports/journal integration belongs to the migration integrator).

| Endpoint | Authorization and body |
| --- | --- |
| `POST /api/workspaces/:workspaceId/invitations` | Verified workspace owner session; `{ email }` |
| `POST /api/invitations/register` | Valid invitation capability; `{ token, username, password }` |
| `POST /api/invitations/accept` | Signed-in, verified matching account; `{ token }` |

Responses use `{ success: true, data: ... }` or `{ success: false, error }`. Owner creation returns `id`, `email`, `workspaceId`, `expiresAt`, `invitationUrl`, and `delivery: email_sent | copy_link | email_delivery_failed`. The owner can copy the invitation URL even with no sender configured or a failed send. The URL contains a secret capability, never a password; share only with its intended recipient and do not log it. Only a SHA-256 token digest is persisted. Invitations expire after 48 hours.

The login page handles `?invite=...` without a separate public route. New invitees select their immutable username/password; the email and workspace are taken solely from the invitation. A conditional D1 claim permits only one credential creation attempt. It creates no membership until the recipient verifies their recovery email and signs in to accept. The verification callback preserves the invitation URL. Existing accounts must sign in and accept; invitation signup never changes their password or username.

Acceptance is a single guarded SQLite update. The migration's BEFORE trigger rejects expired, already accepted, or unverified/mismatched acceptance; its AFTER trigger inserts only the invited workspace's `member` role in that same transaction. A membership insertion failure rolls acceptance back. Parallel acceptance cannot consume twice. Caller-supplied email, workspace, and role cannot override the stored scope.

Better Auth credentials and the invitation claim are not one cross-service transaction. On ambiguous signup failure the claim is retained, preventing duplicate credential attempts. If the account exists, the recipient can verify/sign in and accept. Otherwise ask the owner for a fresh invitation; expired invitations likewise require replacement. No public unassigned signup or implicit owner promotion is enabled.

## Verification evidence

`apps/worker/test/agent-onboarding.test.ts` runs real Better Auth APIs and Miniflare D1 with only email delivery mocked: verification callbacks, pending membership, concurrent acceptance, expiry, wrong identity/workspace, immutable usernames, generic signup denial (existing setup tests), recovery reset-token consumption/session revocation, and route boundary checks. These tests do not send real email; production sender authorization and deliverability still require an operator-approved smoke test.
