# Gmail Channel operator runbook

Gmail Channels connect an existing Google mailbox to MsgFlow through Google OAuth and the Gmail API. They are not Cloudflare Email Routing, Mailboxes, Email Domains, or Reply Identities. Do not configure Cloudflare Email Routing for a Gmail Channel.

## Scope and safety

- One active Google account may belong to only one active MsgFlow Workspace Gmail Account.
- Disconnect revokes/disables the connection while preserving MsgFlow conversations and Gmail mappings for reconnect.
- OAuth refresh tokens are Worker secrets encrypted at rest in D1. Never place them in `wrangler*.toml`, source, chat, tickets, or logs.
- The Pub/Sub webhook only authenticates and queues history work. It must never fetch Gmail content during a push request.

## 1. Google Cloud project

Create or select the dedicated Google Cloud project, then enable Gmail API and Pub/Sub API.

```sh
gcloud config set project YOUR_GOOGLE_PROJECT_ID
gcloud services enable gmail.googleapis.com pubsub.googleapis.com
```

Use a production OAuth consent screen. Add the production MsgFlow domain, support address, privacy policy, and terms. Request only these scopes:

- `openid`
- `email`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`

`gmail.modify` is used for message/history/watch access and the opt-in future archive behavior; MsgFlow does not synchronize drafts, deletion, read state, general labels, CC, or BCC.

Restricted Gmail scopes normally require Google verification before broad production use. Testing-mode refresh tokens can expire after seven days, so do not rely on Testing mode for production mailboxes.

## 2. OAuth client

Create a Web application OAuth client in Google Cloud Console. Register exactly this redirect URI:

```text
https://YOUR_MSGFLOW_DOMAIN/api/gmail-oauth/callback
```

The URI must be the public Worker origin and must exactly match `GOOGLE_OAUTH_REDIRECT_URI`. Do not use wildcard redirect URIs.

## 3. Pub/Sub topic and authenticated push subscription

Create the topic and permit Gmail's publisher service account:

```sh
gcloud pubsub topics create msgflow-gmail
gcloud pubsub topics add-iam-policy-binding msgflow-gmail \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

Create a dedicated service account for Pub/Sub push authentication:

```sh
gcloud iam service-accounts create msgflow-gmail-push \
  --display-name="MsgFlow Gmail Pub/Sub push"
```

Create an authenticated push subscription. The endpoint and OIDC audience must be identical:

```sh
gcloud pubsub subscriptions create msgflow-gmail-push \
  --topic=msgflow-gmail \
  --push-endpoint="https://YOUR_MSGFLOW_DOMAIN/webhooks/gmail/pubsub" \
  --push-auth-service-account="msgflow-gmail-push@YOUR_GOOGLE_PROJECT_ID.iam.gserviceaccount.com" \
  --push-auth-token-audience="https://YOUR_MSGFLOW_DOMAIN/webhooks/gmail/pubsub"
```

The Worker verifies the JWT issuer, audience, verified service-account email, expiry, and Google signing key. An invalid request returns 401/400; a missing configuration returns 503.

## 4. Worker configuration

Set values with Wrangler secrets after the Worker exists. Values must never be committed.

```sh
cd apps/worker
bunx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.deploy.toml
bunx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.deploy.toml
bunx wrangler secret put GOOGLE_OAUTH_REDIRECT_URI --config wrangler.deploy.toml
bunx wrangler secret put GOOGLE_PUBSUB_AUDIENCE --config wrangler.deploy.toml
bunx wrangler secret put GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL --config wrangler.deploy.toml
bunx wrangler secret put GOOGLE_PUBSUB_TOPIC --config wrangler.deploy.toml
bunx wrangler secret list --config wrangler.deploy.toml
```

Set these values:

```text
GOOGLE_OAUTH_REDIRECT_URI=https://YOUR_MSGFLOW_DOMAIN/api/gmail-oauth/callback
GOOGLE_PUBSUB_AUDIENCE=https://YOUR_MSGFLOW_DOMAIN/webhooks/gmail/pubsub
GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL=msgflow-gmail-push@YOUR_GOOGLE_PROJECT_ID.iam.gserviceaccount.com
GOOGLE_PUBSUB_TOPIC=projects/YOUR_GOOGLE_PROJECT_ID/topics/msgflow-gmail
```

Verify secret names only. Never print their values.

Apply the D1 migration chain before deploying a Worker that uses Gmail tables. An existing D1 database without Wrangler migration history requires a schema-baseline reconciliation; do not blindly apply every historical migration to an already-populated database.

## 5. Acceptance test

1. Deploy the Worker and verify `GET /health` at Workers.dev and the production hostname.
2. In MsgFlow Settings → Channels, connect a non-critical Gmail account to a test Inbox.
3. Complete Google OAuth and verify the browser returns to Settings → Channels.
4. Confirm the Gmail row shows the address and `Sync: idle` after backfill finishes.
5. Send an email into the Gmail Inbox. Confirm it is projected once into MsgFlow.
6. Reply in MsgFlow. Confirm the message is sent by the connected Gmail account and remains in the Gmail thread.
7. Confirm the Pub/Sub subscription has successful deliveries and the minute scheduler advances Gmail history work.
8. Disconnect the test channel. Confirm new Gmail sync/send stops while the existing MsgFlow conversations remain. Reconnect and verify the existing channel/history is reused.

## 6. Failure handling and rollback

- `reconnect_required`: reconnect the same channel through Settings. Do not create a replacement channel for the same disconnected account.
- OAuth/push configuration errors: correct the Worker secret or Google Cloud configuration, then reconnect/renew the affected channel.
- Pub/Sub delivery errors: verify the endpoint, service account, OIDC audience, topic publisher grant, and Worker health. Do not weaken JWT validation.
- Rollback: disconnect Gmail channels first to stop provider access, then roll back the Worker. Do not remove Gmail migrations; they are forward-only and retain durable conversation mappings.
- Suspected credential exposure: revoke the affected Google grant, rotate Worker secrets, and reconnect affected channels. Do not copy token values into incident notes.
