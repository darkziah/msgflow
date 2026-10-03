# ADR 0028: Gmail Channel

## Status

Accepted for phased implementation.

## Decision

Gmail is a distinct `gmail` Channel backed by exactly one Gmail Account connected through OAuth. It is separate from the Cloudflare Email Service, logical Mailboxes, Email Domains, and Reply Identities governed by ADR 0014.

A Gmail Conversation maps one Gmail `threadId` within one Gmail Channel to one MsgFlow Conversation. Gmail OAuth credentials and sync state are stored only in Gmail-specific persistence, not generic channel credential fields.

## Consequences

- Existing Cloudflare `email` Channels and logical Mailboxes retain their current behavior and terminology.
- Gmail account identity, delegation, message references, OAuth sessions, and provider thread IDs have Gmail-specific durable constraints.
- This ADR defines the product boundary only; operator setup and external-provider configuration are intentionally outside this phase.
