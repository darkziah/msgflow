# ADR 0020: R2-backed public Messenger image attachments

- **Status:** Accepted
- **Date:** 2026-09-22

## Decision

MsgFlow stores image attachments in a Cloudflare R2 bucket bound to the ingress
Worker as `ATTACHMENTS`. Objects receive immutable UUID keys and are served from
a separately configured public custom domain. The Worker runtime variable
`ATTACHMENT_PUBLIC_BASE_URL` supplies that domain and must not include a trailing
slash.

Only JPEG, PNG, GIF, and WebP are accepted. An image is limited to 10 MiB and a
message may carry at most five images. Browser uploads use the authenticated
`POST /api/attachments` multipart endpoint; clients never receive R2 credentials
or a direct-upload capability. Metadata returned by that endpoint is the shared
`Attachment` contract.

Inbound Messenger provider URLs are copied through the Worker into R2 before a
canonical message is appended. Unsupported or unavailable provider content is
ignored rather than breaking message ingest. Outbound Messenger uses the public
R2 URL.

Email raw MIME and attachments are not covered by this ADR. They require
private, authorization-gated storage under ADR 0021.

Attachments are serialized into both `outbound_intents` and `scheduled_messages`
so retries and send-later work retain their immutable payload.

## Consequences

- The R2 bucket, public custom-domain mapping, and Worker variable are manual
  Cloudflare deployment configuration. This repository deliberately uses named
  placeholders and does not assert that either has been provisioned.
- Public URLs are appropriate for the selected architecture; objects must be
  treated as customer content with unguessable immutable keys.
- Non-image Messenger files and comments remain unsupported by design.
