# Email-domain pilot operator runbook

Status: code integration is not production approval. Live provider delivery, DNS scope,
account entitlements and two-client acceptance remain manual release gates. Do not
change DNS, deploy, provision resources or purge data without separate owner approval.

## Approval and platform gates

- Record the approving owner, Cloudflare account/zone, exact pilot subdomain,
  workspace, Worker, D1, private R2 bucket and rollback contact. No domain in this
  document is an approved deployment target.
- Cloudflare Email Service is beta. The structured Workers sending API requires
  Workers Paid and has a 5 MiB total message limit, including encoded attachments
  and headers. A locally accepted 5 MiB attachment does not fit a 5 MiB encoded
  message. Check current [Email Service docs](https://developers.cloudflare.com/email-service/)
  and the account dashboard before enabling; local mocks prove neither entitlement
  nor arbitrary-recipient sending.
- Routing and Sending are separate configurations. Enroll the exact sending
  subdomain and verify provider-required records. Capture the exact proposed
  MX/TXT/DKIM/DMARC names, values and priorities from the dashboard for owner review.
  Do not infer records from examples, fabricate DKIM values, or replace apex
  Google Workspace/other existing MX, SPF, DKIM or DMARC records.
- **Catch-all scope is unverified until inspected in the zone dashboard.** A route
  label is not proof of subdomain scope. Confirm recipient-domain matching and
  existing zone routes; prefer explicit pilot recipient routes until scope is
  proven. Stop if the dashboard requires apex changes or could intercept non-pilot
  mail. Preserve before/after DNS exports and route screenshots.
- Configure `EMAIL` sending binding and dedicated private `EMAIL_ARCHIVE` R2 binding
  against approved resources (confirm current names in `env.ts`/`wrangler.toml`).
  Never expose email raw MIME or attachments through the public Messenger bucket.

## Authentication and provisioning

Set `AUTH_EMAIL_FROM` to an approved verified sender, `BETTER_AUTH_URL` to the
actual auth origin and `BETTER_AUTH_TRUSTED_ORIGINS` to exact application origins.
Use the secret manager for `BETTER_AUTH_SECRET`; never put credentials in this
runbook, source control or browser chat. Verify recovery-email delivery and reset
links before onboarding. Missing `EMAIL`/`AUTH_EMAIL_FROM` disables auth mail;
username login does not remove the verified recovery-email requirement for setup
and invitation acceptance. Historical sign-in is not universally verification-gated.
See [username onboarding](../auth-username-onboarding.md).

Owner setup establishes the workspace, initial team/inbox and pending domain plan;
it does not grant a working email address. Provision explicit private mailboxes for
immutable usernames, and shared `support` mailboxes with explicit inbox/team grants.
A workspace owner/admin has no implicit private content or send-as permission.
Keep DNS verification separate from owner confirmation and lifecycle activation;
check inbound readiness, outbound readiness, enabled and send-enabled independently.

## Migrations: fresh and populated databases

1. Stop concurrent migration/deployment work. Identify the exact database and inspect
   its applied migration ledger, schema and row counts. Export a restorable D1
   backup and retain the associated private R2 objects; rehearse restore to a new
   isolated database. Do not delete, reset or regenerate the existing migration chain.
2. Fresh database: apply all SQL files in `packages/db/migrations` in numeric order
   through the latest numbered migration, exactly once. Use the configured Wrangler
   migration directory and ledger, or an explicitly recorded ordered SQL procedure;
   never mix mechanisms without reconciling already-applied files.
3. Populated database: rehearse on a backup first. Early migration `0003` rebuilds
   legacy tables and is not a blanket guarantee of a lossless upgrade. Compare
   contacts, channels, conversations, memberships, message summaries and references
   before/after. Apply only missing migrations, not the entire chain again.
4. Review an explicit legacy mapping: workspace, canonical domain/full address,
   existing email channel ID, default inbox, private owner or shared grants. Resolve
   duplicate/case-colliding addresses and username collisions with owners. Do not
   infer mailbox ownership from a legacy `channels.type = 'email'` row or username
   derived from a display name. Preserve IDs and history. Migration 0013 provisions
   transport on new mailbox insert and rejects default-inbox collisions; it does
   not backfill every existing mailbox. Reconcile pre-existing transport explicitly.
5. `0014` adds durable canonical messages, private attachment metadata, immutable
   outbound metadata, routing commits/identity bridges and ingress leases;
   `0015` adds invitation acceptance triggers; `0016` adds actor-scoped drafts;
   `0017` adds immutable send/identity/bridge audit triggers.
   SQL triggers and composite foreign keys are required, not optional ORM features.
   The journal must name each actual SQL file. Before future schema generation,
   include the new source modules in Drizzle's schema input and reconcile snapshots;
   never accept a generated drop/recreate diff blindly.
6. Run `PRAGMA foreign_key_check;` and `PRAGMA integrity_check;`, compare inventory
   counts and test legacy conversation access on the rehearsal copy. Keep the backup
   until owner acceptance. Rollback means disabling pilot routing/sending and
   restoring an approved consistent backup if necessary, not deleting new mail or
   blindly running reverse DDL.

## Failure handling and operations

Unknown/disabled envelope recipients are rejected rather than lazily provisioned.
For accepted recipients, raw MIME and canonical D1 records allow retryable processing
and DO projection recovery. Retain the original object key and SHA-256; never edit
raw MIME to make a replay pass. Inspect MIME only in an authorized private context.

The internal replay sweep selects stored/failed/expired-processing ingress, at most
20 per call, with fewer than 10 attempts unless an exact ID is supplied. It excludes
quarantined rows. Inspect error, permissions, raw-object existence/hash, lease and
canonical/projected records before using an authorized replay path. An explicit
replay by a mailbox-authorized actor can release a specific quarantine for one
attempt; unchanged invalid content quarantines again. Never edit raw MIME, mass-update
states or clear dedupe/routing records. Unsupported attachments quarantine the entire
message rather than silently omitting files. The pilot also quarantines parsed text
over 256 KiB UTF-8, retaining the original raw message without truncation.

`accepted` means provider handoff, **not delivered**. Delivery/bounce-event ingestion
is not established by a successful send response. Preserve the provider ID, stable
submission UUID and immutable command. A stale `sending` intent becomes `uncertain`;
inspect provider logs, recipient evidence and local canonical records before an
operator decision. Never automatically resend uncertain mail, mint a new UUID to
bypass the fence, or mark it delivered because DO projection succeeded. Legacy
`provider_sent`/`delivered` names are not proof of real delivery. Accepted-intent
reconciliation repairs local projection without crossing the provider boundary.

Read-only diagnostic examples (bind `:workspace_id`; do not paste customer content
into tickets):

```sql
SELECT state, count(*) AS total FROM email_ingress
WHERE workspace_id = :workspace_id GROUP BY state;
SELECT id, state, attempts, error, lease_until, received_at, processed_at
FROM email_ingress WHERE workspace_id = :workspace_id
ORDER BY received_at DESC LIMIT 100;
SELECT o.id, o.status, o.provider_message_id, o.last_error, o.updated_at
FROM outbound_intents o JOIN conversations c ON c.id = o.conversation_id
WHERE c.workspace_id = :workspace_id ORDER BY o.updated_at DESC LIMIT 100;
SELECT id, ingress_id, conversation_id, routing_done, projected_at
FROM email_canonical_messages WHERE workspace_id = :workspace_id
ORDER BY created_at DESC LIMIT 100;
SELECT action, target_id, actor_user_id, created_at FROM email_audit
WHERE workspace_id = :workspace_id ORDER BY created_at DESC LIMIT 100;
SELECT id, raw_object_key, received_at FROM email_ingress
WHERE workspace_id = :workspace_id AND state = 'processed'
AND received_at < :approved_cutoff ORDER BY received_at LIMIT 100;
```

Retention is manual and separately approved. The retention helper only lists
candidates; it does not purge. Establish legal hold, retention duration, private R2
lifecycle and D1/DO reference handling before any deletion. Preserve immutable audit
history; do not drop its no-delete trigger. No automatic email-history deletion is
approved by this runbook.

## Manual acceptance matrix (record evidence, do not pre-mark passed)

Use two ordinary agents with private mailboxes, a separately authorized shared
`support` mailbox, an owner/admin without private grants, a second approved domain
with overlapping local parts, and two simultaneous browser clients. Use external
mail accounts to prove delivery and capture full headers.

| Case | Required evidence |
| --- | --- |
| Setup/invitation/recovery | Verified recovery recipient, immutable username login, expired/reused invitation rejected; unverified account cannot complete onboarding |
| Private isolation | Agent A cannot list, search, read, download, draft, send or open WS for B; owner/admin also denied without grant |
| Shared support | Authorized teammates read/reply; unrelated member denied; revoke grant while open and before scheduled send |
| Second domain | Same local part maps to distinct mailbox/thread and From; no cross-workspace/domain leakage |
| Two clients | One send intent and one canonical message after double-submit/reload; drafts remain actor-scoped and uncertain UUID survives reload |
| Inbound/threading | External reply has expected Message-ID, In-Reply-To and References; same subject alone does not merge unrelated threads; duplicate raw delivery does not rerun rules |
| MIME/attachments | Unicode, HTML/plain text, PDF/image, malformed/oversized MIME; downloads require authorization and private storage has no public URL |
| Failures | Unknown/disabled recipient rejected; parse quarantine retained; expired lease recovery; DO outage repaired without repeat send; uncertain provider acknowledgement fenced |
| Sender identity | Default reply uses receiving mailbox; any supported private-identity override requires explicit confirmation and authorization of both identities |
| DNS and provider | Exact approved subdomain records resolve; external received headers show expected From, return path, SPF/DKIM/DMARC alignment; apex mail still works |
| Send lifecycle | External receipt is separately evidenced; UI/provider acceptance alone never reported as delivery; suspension/revocation stops future sends |

Release only after recorded owner sign-off. Local build/unit tests are necessary
but cannot substitute for dashboard, DNS, real R2, real sending or browser checks.
