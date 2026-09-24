# MsgFlow Production Deployment Readiness Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Prepare the Worker, D1 database, Durable Object, R2 image storage, secrets, and channel integrations for a safe first production deployment without guessing any Cloudflare resource identifiers or exposing credentials.

**Architecture:** Keep the existing one-Worker topology: Hono API/webhooks and `ConversationDO` deploy together; D1 remains relational metadata/notification storage; R2 is reachable only through the Worker and served by a separately configured public custom domain. Treat deployment configuration as explicit environment state: resource IDs/domains are supplied by the operator, Worker secrets are entered through Wrangler’s secret prompt, and no secret or customer token is written to source control.

**Tech Stack:** Bun/Turborepo, Cloudflare Workers, Durable Objects, D1, R2, Wrangler 4, Better-auth, Cloudflare Email Routing, Meta Messenger Graph API.

---

## Current context / assumptions

- Repository: `/Users/dark/Documents/Projects/MsgFlow`, branch `ui-v2-refresh`.
- Current working tree contains substantial uncommitted feature work. Do not discard, reset, rebase, or commit it without the user’s explicit instruction.
- Root verification currently passes: `bun run build`, `bun run lint`, and `bun run test`; the Worker suite reports `33 pass`, `0 fail`, `105 expect() calls`.
- Local D1 has migration `0007_comment_mentions_notifications.sql` applied. The remote D1 is deliberately unconfigured: `apps/worker/wrangler.toml:12` still contains `REPLACE_WITH_D1_DATABASE_ID`.
- The Worker dry-run bundles successfully and recognizes `CONVERSATION_DO`, `EMAIL`, `DB`, and `ATTACHMENTS`; it currently points at the intentionally non-production R2 bucket name `msgflow-local-attachments` (`apps/worker/wrangler.toml:27-31`).
- Migrations `0005_outbound_delivery_intents.sql`, `0006_image_attachments.sql`, and `0007_comment_mentions_notifications.sql` must be applied to remote D1 in order. Do not assume remote has any migration state.
- Existing plaintext channel tokens require a deliberate encrypted backfill before strict encrypted readers are enabled. The deployed Worker must have a valid `CHANNEL_TOKEN_ENCRYPTION_KEY` before any channel credential write/backfill.
- User has manually tested Comment mention picker, notification bell/dropdown, open-conversation action, and read-state behavior.

## Operator inputs required before deployment

Collect these outside chat and do not place values in source files, `.dev.vars`, terminal output, commits, or plan updates:

1. Cloudflare account/project authorization available to Wrangler.
2. Actual D1 database ID for the production `msgflow` database.
3. Production R2 bucket name and public HTTPS attachment domain. The code remains domain-agnostic; this is deployment configuration.
4. Current production public application domain: `msgflow.yeheyremit.jp`. Confirm whether this hostname terminates at the Worker, a static web host with `/api` and `/ws` proxying to the Worker, or both before setting `BETTER_AUTH_URL`; Facebook app/page configuration and email-routing domain(s) remain required. Future deployments must replace it only through deployment configuration, not source changes.
5. Production secret values: `BETTER_AUTH_SECRET`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN`, `CHANNEL_TOKEN_ENCRYPTION_KEY`, and any provider credentials required by existing channel records.
6. An approved maintenance window if existing channels have plaintext credential values that need backfill.

## Step-by-step tasks

### Task 1: Record the deployment contract and reject placeholders

**Objective:** Make the required production values and non-negotiable checks explicit before changing Cloudflare state.

**Files:**
- Modify: `README.md:50-63`
- Modify: `apps/worker/wrangler.toml:9-44`
- Review: `docs/adr/0018-workspace-authorization-channel-token-protection.md`
- Review: `docs/adr/0020-r2-image-attachments.md`

**Step 1: Add a release-configuration section to `README.md`**

Add these exact requirements, using placeholders only:

```markdown
## Production release configuration

Before `wrangler deploy`, replace `REPLACE_WITH_D1_DATABASE_ID` with the real production D1 database ID and replace `msgflow-local-attachments` with the production R2 bucket name. Configure a public HTTPS custom domain for that bucket and set `ATTACHMENT_PUBLIC_BASE_URL` to that domain with no trailing slash.

Set Worker secrets interactively; never commit their values:

```bash
cd apps/worker
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put MESSENGER_APP_SECRET
bunx wrangler secret put MESSENGER_VERIFY_TOKEN
bunx wrangler secret put CHANNEL_TOKEN_ENCRYPTION_KEY
bunx wrangler secret put ATTACHMENT_PUBLIC_BASE_URL
```

Set `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` as production Worker variables. For the current deployment, trusted origins must include `https://msgflow.yeheyremit.jp` exactly; do not hard-code it into application source.
```

**Step 2: Add a placeholder guard comment above each mutable Wrangler value**

The comments must state that deployment is blocked while the placeholder remains. Do not add resource IDs, bucket names, domains, or secrets to the file.

**Step 3: Verify the static configuration is deployable**

Run:

```bash
cd apps/worker
bunx wrangler deploy --dry-run
```

Expected: exit code `0`, and binding output includes `env.DB`, `env.CONVERSATION_DO`, `env.EMAIL`, and `env.ATTACHMENTS`.

**Step 4: Verify no secret-like values were introduced**

Run:

```bash
git diff --check
git diff -- README.md apps/worker/wrangler.toml
```

Expected: clean whitespace check; diff contains only instructions/placeholders, never real secret values or Cloudflare IDs.

**Commit policy:** Do not commit unless the user explicitly requests a commit. If approved, stage only `README.md` and `apps/worker/wrangler.toml` and use `docs: document production deployment configuration`.

### Task 2: Verify the full D1 migration chain before remote application

**Objective:** Prove all migrations apply forward from an empty SQLite database and establish the remote migration order.

**Files:**
- Review: `packages/db/migrations/0001_*.sql` through `packages/db/migrations/0007_comment_mentions_notifications.sql`
- Review: `packages/db/migrations/meta/_journal.json`

**Step 1: Run a fresh-chain migration test**

Run from repository root:

```bash
db="$(mktemp -u /tmp/msgflow-migrations.XXXXXX.sqlite)"
for migration in packages/db/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  sqlite3 "$db" < "$migration" || exit 1
done
sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('outbound_intents','comment_notifications') ORDER BY name;"
```

Expected exactly:

```text
comment_notifications
outbound_intents
```

**Step 2: Inspect remote D1 migration state before writing**

After the operator has set the actual production D1 ID in `apps/worker/wrangler.toml`, run:

```bash
cd apps/worker
bunx wrangler d1 execute msgflow --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected: a successful result. Record which tables already exist; do not infer applied migration numbers solely from table names.

**Step 3: Apply only missing migrations, in numeric order**

For a new/empty remote database, run each command in order:

```bash
cd apps/worker
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0001_initial.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0002_*.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0003_*.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0004_*.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0005_outbound_delivery_intents.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0006_image_attachments.sql
bunx wrangler d1 execute msgflow --remote --file=../../packages/db/migrations/0007_comment_mentions_notifications.sql
```

Replace wildcard commands with each exact discovered filename before running; do not run an already-applied non-idempotent migration against a populated remote database. For a partially initialized remote, inspect each migration’s SQL and apply only the next unapplied file after taking an approved backup/export.

**Step 4: Verify required remote schema**

Run:

```bash
cd apps/worker
bunx wrangler d1 execute msgflow --remote --command "PRAGMA table_info(outbound_intents);"
bunx wrangler d1 execute msgflow --remote --command "PRAGMA table_info(scheduled_messages);"
bunx wrangler d1 execute msgflow --remote --command "PRAGMA table_info(comment_notifications);"
bunx wrangler d1 execute msgflow --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_outbound_intents_status','idx_comment_notifications_comment_user','idx_comment_notifications_user_unread') ORDER BY name;"
```

Expected: `attachments_json` in the first two table layouts; all `comment_notifications` columns from migration 0007; all three named indexes returned.

**Commit policy:** Migration application changes Cloudflare state; it produces no source commit.

### Task 3: Configure production R2 and attachment delivery

**Objective:** Bind the Worker to a real private R2 bucket while serving immutable image objects from a public custom domain.

**Files:**
- Modify: `apps/worker/wrangler.toml:25-31`
- Review: `apps/worker/src/attachments.ts`
- Review: `apps/worker/src/env.ts`
- Review: `docs/adr/0020-r2-image-attachments.md`

**Step 1: Provision external Cloudflare resources manually**

In Cloudflare dashboard/API, create the production bucket and attach its public HTTPS custom domain. Do not enable an unscoped `r2.dev` URL if the product requirement is the custom-domain architecture.

**Step 2: Replace only the R2 bucket placeholder**

Set `bucket_name` in `apps/worker/wrangler.toml` to the approved production bucket name. Do not add an access key or secret—the Worker binding uses Cloudflare’s internal binding.

**Step 3: Enter the public URL as a Worker secret/value**

Run interactively:

```bash
cd apps/worker
bunx wrangler secret put ATTACHMENT_PUBLIC_BASE_URL
```

Enter only the exact public HTTPS base URL with no trailing `/`.

**Step 4: Dry-run binding verification**

Run:

```bash
cd apps/worker
bunx wrangler deploy --dry-run
```

Expected: exit `0`; `env.ATTACHMENTS` is listed with the approved production bucket name.

**Step 5: Post-deploy image smoke test**

Using an authenticated production browser session, send each supported type in a normal Reply: JPEG, PNG, GIF, and WebP. Verify each is visible inline after refresh via the custom HTTPS domain. Attempt a PDF and a file larger than 10 MiB.

Expected: the four image types appear; PDF and oversized file are rejected; Comment mode provides no attachment control; browser devtools/network does not contain R2 credentials.

**Commit policy:** Do not commit production bucket names if the repository’s policy treats them as deployment-specific. If the team approves committing the non-secret bucket name, isolate it in a configuration-only commit.

### Task 4: Configure Worker secrets and encryption safely

**Objective:** Make authentication, Messenger validation, and AES-GCM channel token encryption available to the deployed Worker without exposing secret material.

**Files:**
- Review: `apps/worker/src/env.ts`
- Review: `apps/worker/src/channel-token-crypto.ts`
- Review: `apps/worker/src/outbound.ts`
- Review: `docs/adr/0018-workspace-authorization-channel-token-protection.md`

**Step 1: Generate the encryption key locally without printing it to logs**

Use a secure operator-controlled generator that returns 32 random bytes encoded base64url. Confirm its decoded byte length equals 32 before use. Do not paste the generated value into chat, source, a shell history, or a committed file.

**Step 2: Enter production secrets interactively**

Run once per secret and enter the value only at Wrangler’s prompt:

```bash
cd apps/worker
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put MESSENGER_APP_SECRET
bunx wrangler secret put MESSENGER_VERIFY_TOKEN
bunx wrangler secret put CHANNEL_TOKEN_ENCRYPTION_KEY
```

Expected: Wrangler confirms each secret was uploaded without echoing its value.

**Step 3: Set non-secret production runtime variables**

Set `BETTER_AUTH_URL` to the exact authentication-serving Worker HTTPS URL and `BETTER_AUTH_TRUSTED_ORIGINS` to a comma-separated allowlist containing `https://msgflow.yeheyremit.jp`. If the Worker is served directly at `msgflow.yeheyremit.jp`, both values use that origin; if the web app proxies to another Worker hostname, use the Worker origin for `BETTER_AUTH_URL` while retaining `https://msgflow.yeheyremit.jp` in trusted origins. Never use a wildcard origin.

**Step 4: Backfill legacy plaintext channel credentials before enforcing strict reads**

Write a one-off, operator-reviewed Worker-side migration script only if a remote inventory shows legacy plaintext tokens. It must:

- select only channel credential columns with values not beginning `enc:v1:`;
- decrypt no existing values and never log source values;
- encrypt each plaintext token using the deployed AES-GCM key format;
- update by channel ID with a guard that the stored value still equals the original at write time;
- report only counts of scanned, encrypted, skipped, and conflicted rows;
- be idempotent.

Add a Miniflare test before implementation proving an `enc:v1:` value is not rewritten and plaintext input becomes decryptable using the configured key. Do not add strict plaintext rejection until the backfill has completed and its count is zero.

**Step 5: Verify secret-dependent paths after deploy**

Use a non-production test channel record in the production workspace. Connect/update its credential through the application, then make a provider call from the Worker path. Inspect D1 only for the `enc:v1:` prefix/length, never the actual token. Expected: credential is stored encrypted and outbound provider dispatch can decrypt it internally.

### Task 5: Deploy and validate the Worker/DO release

**Objective:** Deploy the verified bundle with real bindings and exercise the release without falsely treating a successful deploy command as a successful product release.

**Files:**
- Review: `apps/worker/wrangler.toml`
- Review: `apps/worker/src/index.ts`
- Review: `apps/worker/src/scheduled.ts`
- Review: `apps/worker/scripts/smoke.ts` (if present)

**Step 1: Repeat source verification from the repository root**

Run:

```bash
git diff --check
bun run build
bun run lint
bun run test
```

Expected: every command exits `0`; worker test output reports no failures. Treat a test count change as something to inspect, not a success condition by itself.

**Step 2: Deploy only after Tasks 1–4 have passed**

Run:

```bash
cd apps/worker
bunx wrangler deploy
```

Expected: successful deployment and a Worker URL/version. Do not claim production is working until the read-back checks below pass.

**Step 3: Read back binding/version state**

Run the Cloudflare dashboard or Wrangler inspection command appropriate to the account to confirm the deployed Worker has D1, Durable Object, send-email, R2, and minute cron bindings. Compare against `apps/worker/wrangler.toml:9-35`.

Expected: one D1 binding, one `ConversationDO` binding/migration, one send-email binding, one R2 binding, and cron `* * * * *`.

**Step 4: Run post-deploy authenticated product checks**

Perform and record the following against production:

1. Sign in from the production web origin; reload the page; verify session remains valid.
2. Receive one Messenger message containing emoji and one inbound email containing emoji; verify raw emoji renders correctly.
3. Send one Messenger Reply and one email Reply with emoji; verify each arrives externally exactly once.
4. Send JPEG/PNG/GIF/WebP image replies; verify custom-domain URLs load after thread reload.
5. Add a Comment with `@teammate`; verify it does not reach the customer, recipient gets exactly one badge/list notification, click opens the correct conversation, and read state clears only for that recipient.
6. Snooze an open conversation until a near-future time; verify it leaves standard queues, remains in Snoozed, then returns to the normal queue after the scheduled scan.
7. Send a scheduled message and verify cron delivery, intent status, and no duplicate external delivery.

Expected: every check passes. For any ambiguous provider delivery result, inspect `outbound_intents`; do not resend an `uncertain` record automatically.

### Task 6: Release documentation and operational handoff

**Objective:** Leave future operators a concise, truthful record of deployed prerequisites, known limitations, and rollback/reconciliation procedure.

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/production-release.md`
- Modify: `docs/adr/0020-r2-image-attachments.md` only if production configuration changes the architecture decision (not merely its environment values)

**Step 1: Add the runbook**

`docs/runbooks/production-release.md` must contain:

- prerequisite checklist (D1, R2 custom domain, secrets, Email Routing, Meta callback/subscription);
- exact root validation command;
- migration inspection/application order;
- dry-run and deploy commands;
- post-deploy checks from Task 5;
- incident guidance: no automated resend for `outbound_intents.status = 'uncertain'`; reconcile `provider_sent` manually;
- rollback statement: roll back Worker code only after checking D1/DO schema compatibility; migrations are forward-only and are not rolled back by deleting files;
- credential rotation procedure: add new `CHANNEL_TOKEN_ENCRYPTION_KEY` support/backfill strategy before changing the old key, because existing ciphertext is key-bound.

**Step 2: Validate documentation links and repository quality gates**

Run:

```bash
git diff --check
bun run build
bun run lint
bun run test
```

Expected: all commands exit `0`.

**Step 3: Request an explicit release sign-off**

Present only verified outcomes, the real deployed Worker URL/version, remote migration status, configured attachment domain (if safe to disclose), and any failed/blocked QA item. Do not state that production deployment is complete if any prerequisite or check remains unverified.

**Commit policy:** Documentation commit only with explicit user approval; suggested message: `docs: add production release runbook`.

## Tests / validation summary

- Every source/config documentation change: `git diff --check`, `bun run build`, `bun run lint`, `bun run test` from repository root; expected exit status `0`.
- Every migration change: fresh scratch SQLite chain first, then remote schema read-back after application.
- Every secret-dependent feature: use Worker/browser paths and verify stored shapes or outcomes, not secret values.
- Every external side effect: read back the exact target (D1 schema, Worker bindings, R2-hosted image, external Messenger/email delivery) before reporting success.
- If a one-off plaintext-token backfill is needed, use TDD: first add a Miniflare test for skip/encrypt/idempotency behavior, run it and confirm it fails, implement the smallest Worker-side migration helper, rerun it to pass, then run the full suite. Do not commit unless explicitly asked.

## Risks, tradeoffs, and open questions

- **Remote D1 is not configured:** no remote migration or deployment can proceed until the operator supplies a real D1 ID. Never replace the placeholder with a guessed ID.
- **R2 remains externally provisioned:** the bucket and public custom domain must be created/configured by an authorized Cloudflare operator. The repository must not pretend that `msgflow-local-attachments` is production.
- **Encryption-key rotation is not yet a dual-key design:** replacing `CHANNEL_TOKEN_ENCRYPTION_KEY` without a planned decrypt/re-encrypt migration can make existing credentials unusable. Treat rotation as a separately reviewed change.
- **Legacy plaintext credentials may exist:** do not enable strict rejection until an auditable, idempotent backfill has completed successfully.
- **External exactly-once delivery is impossible:** `uncertain` provider outcomes require reconciliation, not automatic retries.
- **Remote migration history may be ambiguous:** inspect the actual remote schema and back up/export before applying any non-additive migration to an existing D1 database.
- **Email and Meta account capabilities are external dependencies:** Email Routing/send-email entitlement, Meta callback verification, page subscription, scopes, and recipient messaging permissions must be confirmed in the relevant dashboards.
- **No automatic commit:** this working tree contains unrelated/in-progress changes; commits are intentionally omitted unless the user explicitly authorizes them.
