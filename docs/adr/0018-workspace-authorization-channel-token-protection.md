# ADR 0018: Workspace Authorization & Channel-Token Protection

Status: Accepted

Date: 2026-09-22

## Context

Workspace-scoped routing introduced shared resources and channel credentials in
D1. A session alone is not authorization to name a workspace or manage its
inboxes. Channel access and refresh tokens are provider credentials and must
not be stored as plaintext D1 values.

## Decisions

### Workspace authorization

Every workspace-scoped route requires an authenticated session and validates
that the session user belongs to the path's workspace. Every resource lookup
and mutation is additionally constrained to that workspace; a path parameter
is never authorization by itself.

`owner`, `admin`, and `member` are workspace roles. Members may read and work
within the workspace; owner/admin is required for shared configuration,
including inbox and channel configuration, routing rules, shared ordering, and
member management. A legacy lazy `default` workspace with no
`workspace_members` rows bootstraps its first authenticated accessor as
`owner`; after the first membership exists, normal membership checks apply.

Legacy default-workspace APIs use the same authorization seam: they resolve
`requireDefaultWorkspaceAccess` after session validation, then pass that
workspace to service-layer lookups and writes. This includes tags, canned
replies, and channel connection state; foreign or missing resource IDs use the
existing resource-not-found response rather than crossing workspace boundaries.

### Channel credentials at rest

D1 channel `access_token` and `refresh_token` values, and future equivalent
provider credential fields, are encrypted before persistence. The Worker uses
Web Crypto AES-GCM with a fresh 96-bit IV for every value. Stored values use
the versioned form:

```
enc:v1:<base64url-iv>:<base64url-ciphertext>
```

The 32-byte base64url AES key is supplied only through the
`CHANNEL_TOKEN_ENCRYPTION_KEY` Worker secret. It is never stored in D1,
returned by an API, committed, or logged. Tokens are decrypted only inside the
Worker immediately before a provider call. API responses expose connection
state such as `hasToken`, never token material.

This policy covers channel OAuth/access credentials, not independently managed
Worker secrets such as the Messenger app secret, webhook verification secret,
or Better Auth secret. Those remain Worker secrets rather than D1 data.

### Legacy plaintext-token migration

Existing non-null plaintext token rows are migrated in a controlled, idempotent
backfill after `CHANNEL_TOKEN_ENCRYPTION_KEY` is configured. The backfill
processes rows in batches, leaves values already prefixed `enc:v1:` unchanged,
encrypts each legacy value with a newly generated IV, and writes only the
versioned ciphertext. It must not emit token values in logs or migration
output.

After the backfill, readers reject plaintext or unknown token versions rather
than silently using them. A migration report may contain row counts and
identifiers, but no credential material. The old key must remain available
until all rows have been re-encrypted when key rotation is introduced.

## Consequences

- Cross-workspace resource access is denied even when an authenticated user
  guesses an identifier.
- Channel credentials in D1 are protected at rest with authenticated
  encryption and a format that supports future versions and key rotation.
- Deploying this policy requires setting the Worker secret and completing the
  legacy backfill before plaintext reads are disabled.
