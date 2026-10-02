# Deploy MsgFlow to a new Cloudflare account

This runbook creates a greenfield MsgFlow installation. It does not reuse or modify any existing Worker, D1 database, R2 bucket, DNS zone, domain, user, mailbox, or data.

## 1. Confirm the target account

1. Enable Workers Paid. The `EMAIL` binding requires it.
2. Authenticate Wrangler and select the target account explicitly:

   ```sh
   cd apps/worker
   bunx wrangler whoami
   ```

3. Record the target account ID in the operator-managed deployment configuration. Do not commit it.
4. Choose a dedicated application hostname and a dedicated mail subdomain. Use an apex domain only with an approved migration plan.

## 2. Create isolated resources

Use the `msgflow` slug unless the operator has approved another unique name.

```sh
cd apps/worker
bunx wrangler d1 create msgflow
bunx wrangler r2 bucket create msgflow-attachments
bunx wrangler r2 bucket create msgflow-email-archive
```

Read each result back in the Cloudflare dashboard. The two R2 buckets have different purposes:

- `msgflow-attachments`: public Messenger-image attachment bucket, with its own public custom domain.
- `msgflow-email-archive`: private raw-MIME/email-attachment archive. Never attach a public custom domain.

Do not reuse a similarly named database or bucket by inference.

## 3. Prepare deployment configuration

Copy `apps/worker/wrangler.toml` to an uncommitted operator configuration such as `apps/worker/wrangler.deploy.toml`. Fill in only the target-account values:

- `account_id`
- D1 `database_id`
- public `ATTACHMENT_PUBLIC_BASE_URL` (no trailing slash)
- `BETTER_AUTH_URL`
- exact comma-separated `BETTER_AUTH_TRUSTED_ORIGINS`

Keep names, IDs, origins, hostnames, and sender addresses out of committed source. The generic committed configuration intentionally contains no deployment-specific domain or account.

Add the deployment secrets through Wrangler after the first Workers.dev deployment. Never put their values in a config file, terminal history, ticket, or chat:

```sh
bunx wrangler secret put BETTER_AUTH_SECRET --config wrangler.deploy.toml
bunx wrangler secret put MESSENGER_APP_SECRET --config wrangler.deploy.toml
bunx wrangler secret put MESSENGER_VERIFY_TOKEN --config wrangler.deploy.toml
bunx wrangler secret put CHANNEL_TOKEN_ENCRYPTION_KEY --config wrangler.deploy.toml
```

Verify only secret names:

```sh
bunx wrangler secret list --config wrangler.deploy.toml
```

## 4. Apply the fresh D1 migration chain

Apply every SQL migration exactly once, in numeric order, to the new D1 database. Do not delete, regenerate, or selectively skip the chain.

```sh
for migration in ../../packages/db/migrations/*.sql; do
  bunx wrangler d1 execute msgflow --remote --file="$migration" --config wrangler.deploy.toml
done
```

Then use read-only D1 queries to confirm the auth, workspace, mailbox, invitation, and audit tables exist. The initial user/workspace counts must be zero.

## 5. Build and smoke-deploy at Workers.dev

```sh
cd ../..
bun run build
cd apps/worker
bunx wrangler deploy --dry-run --config wrangler.deploy.toml
bunx wrangler deploy --config wrangler.deploy.toml
```

Confirm the Workers.dev `/health` endpoint returns successfully. This only proves the Worker bundle and bindings; it does not prove custom DNS, auth email, inbound routing, or email sending.

## 6. Configure authentication mail

In Cloudflare Email Sending, verify the technical authentication sender domain/address. Set `AUTH_EMAIL_FROM` as an operator-managed non-secret variable and redeploy. Verify a recovery-email message and password-reset message reach an external inbox before claiming the initial Owner.

`AUTH_EMAIL_FROM` is deployment infrastructure, not a Workspace Email Domain.

## 7. Attach public hostnames

1. Attach the final Worker application hostname.
2. Attach the public custom domain only to the Messenger attachment bucket.
3. Update the deployment configuration's Better Auth URL/origins and attachment base URL.
4. Redeploy with the same target configuration.
5. Verify DNS, `/health`, login cookies, and the attachment URL separately.

## 8. Complete first-use setup

At the final app hostname, create the initial Owner, Workspace, Team, and Shared Inbox. Until this completes, normal login/inbox/settings access remains server-side blocked. A partially claimed setup is recovered only by the authenticated local operator procedure; do not expose a public reset path.

## 9. Onboard Email Domains in the app

An Owner or verified Workspace Administrator adds each controlled domain/subdomain as a database-managed Email Domain. MsgFlow does not write DNS, Email Routing, Email Sending, or Queue subscriptions.

For each domain:

1. The operator performs the Cloudflare dashboard/DNS actions and records exact evidence.
2. The Owner/Admin records the operator confirmations and runs MsgFlow's readiness checks.
3. Send a one-time inbound test to the temporary verification recipient.
4. Verify outbound with a temporary sender and received confirmation code.
5. Only then activate exact Mailbox addresses. Inbound and send-as readiness remain independent.

Use `email-domain-pilot.md` for the detailed mail acceptance matrix. Unknown and disabled recipients must remain rejected; no catch-all archive is created.

## 10. Release checks

Before production use, record evidence for:

- Workers.dev and final-hostname `/health`
- initial Owner recovery email and password recovery
- D1 migration integrity and empty greenfield baseline
- private/public R2 separation
- inbound and outbound Email Domain readiness for each approved domain
- private mailbox isolation, shared-inbox access, delegation revocation, and disabled-address rejection

Provider acceptance is not delivery. Without configured lifecycle-event ingestion, display outbound status as provider-accepted or uncertain only.
