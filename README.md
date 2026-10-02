# MsgFlow — Unified Inbox

A unified inbox for business Pages — Front/Missive-style handling of Facebook Messenger and email conversations in one place, with real-time delivery to agents viewing a conversation.

## Stack

- **Monorepo**: Bun workspaces + Turborepo + Biome
- **Runtime**: Cloudflare Workers (wrangler), Durable Objects (one per conversation), D1 (SQLite), WebSocket Hibernation API
- **Backend**: Hono — a single ingress Worker that also exports the Conversation Durable Object
- **Frontend**: React 19 + Vite + TanStack Router + TanStack Query + Tailwind v4
- **Auth**: Better-auth via `better-auth-cloudflare` + Drizzle + D1 (cookie sessions)
- **Channels**: Facebook Messenger (webhook + signature verification) and Cloudflare Email Service (inbound `email()` handler + outbound `send_email` binding)

## Package structure

```
apps/
  web/        # inbox UI (Front/Missive-style)
  worker/     # single ingress Worker (Hono) — exports ConversationDO
packages/
  contracts/  # types, Effect Schema boundary contracts, event envelopes, conversation IDs
  db/         # D1 schema + migrations + query helpers (Drizzle)
  channel/    # channel-agnostic message model + Facebook/email adapters
  auth/       # Better-auth config + RBAC + user/workspace context
  ui/         # design-system + inbox primitives
docs/adr/     # architecture decision records (0001–0019)
CONTEXT.md    # domain glossary
```

## Design

Domain vocabulary and architecture decisions live in [CONTEXT.md](./CONTEXT.md) and [docs/adr/](./docs/adr/). The load-bearing decisions:

- **DO/D1 dual authority**: the Durable Object owns the live message timeline; D1 owns cross-conversation metadata (status, assignee, snooze, inbox, tags). Messages sync DO→D1 (summary); metadata relays D1→DO (broadcast).
- **Real-time scope**: the open thread is real-time via the DO WebSocket (Hibernation); the inbox list polls D1 (~3–5s). No cross-DO push in Phase 1.
- **Front-style organization**: single Assignee, open/archived status, Unassigned as a filter (not an inbox), snooze orthogonal to status.
- **Rules engine**: synchronous pre-append evaluation in the Worker; routing first-match-wins, additive actions all-apply.

## Commands

```bash
bun install
bun run dev        # all workspaces
bun run build
bun run lint
bun run test
bun run format
```

## Email-domain pilot

Use the [operator runbook](./docs/runbooks/email-domain-pilot.md) for approval gates,
DNS scope, authentication sender configuration, fresh and populated migration
rehearsals, recovery, retention and the manual live-test matrix. The pilot uses
explicit workspace-owned private/shared mailboxes, private R2 email storage, durable
D1 email records and actor-scoped drafts. Provider acceptance is **not delivery**.

Cloudflare Email Service is beta; structured sending requires Workers Paid and has
a 5 MiB total encoded-message limit. Confirm account entitlement and exact pilot
subdomain records in the dashboard. Catch-all zone scope remains unverified until
operator inspection; no apex DNS changes or deployment are implied by this code.

Run `bun run --cwd packages/db build` after source schema changes. Apply the ordered
SQL chain through `0016_email_drafts.sql` only after backup and legacy mapping
review; do not reset a populated database. Live DNS/provider and two-client browser
acceptance remain manual gates.

## Messenger image attachments deployment configuration

Attachments use R2 through the Worker binding `ATTACHMENTS`. Before deployment,
create the bucket, replace the clearly named `bucket_name` placeholder in
`apps/worker/wrangler.toml`, map its public custom domain, and set the Worker
runtime variable `ATTACHMENT_PUBLIC_BASE_URL` to that HTTPS domain **without a
trailing slash**. This is manual Cloudflare configuration; no bucket or domain
is provisioned by this repository. MsgFlow accepts JPEG, PNG, GIF, and WebP only,
up to 10 MiB each and five images per message.

## Production release configuration

Before a production release, replace `REPLACE_WITH_D1_DATABASE_ID` and the
local-development R2 bucket name `msgflow-local-attachments` in
`apps/worker/wrangler.toml` with approved production resource identifiers. Do
not deploy while either local placeholder is unchanged. The attachment HTTPS
custom domain is deployment configuration: map it to the R2 bucket outside this
repository, then provide its origin (without a trailing slash) as
`ATTACHMENT_PUBLIC_BASE_URL`.

From `apps/worker`, set the production secrets interactively:

```bash
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put MESSENGER_APP_SECRET
bunx wrangler secret put MESSENGER_VERIFY_TOKEN
bunx wrangler secret put CHANNEL_TOKEN_ENCRYPTION_KEY
```

Set `ATTACHMENT_PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, and
`BETTER_AUTH_TRUSTED_ORIGINS` as non-secret Worker runtime variables in the
deployment environment, not in repository source configuration.
`ATTACHMENT_PUBLIC_BASE_URL` is the HTTPS custom attachment origin without a
trailing slash. `BETTER_AUTH_TRUSTED_ORIGINS` must include the exact HTTPS
web-app origin. Set `BETTER_AUTH_URL` to the HTTPS origin that serves Better
Auth; it equals the web-app origin only when the Worker is served there directly.
