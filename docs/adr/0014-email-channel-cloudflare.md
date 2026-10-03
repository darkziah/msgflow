# Email channel: Cloudflare Email Service

This ADR continues to govern the Cloudflare Email Service and logical Mailbox channel only. Inbound: Email Routing delivers mail to the Worker's `email()` handler as an `EmailMessage`, which the channel adapter parses (MIME) and normalizes. Outbound: the Worker sends via the `send_email` binding (`EMAIL.send()`) — in-process, no API keys, SPF/DKIM/DMARC handled automatically for domains on Cloudflare DNS. The separate Gmail Channel is governed by ADR 0028.

Trade-offs accepted: Workers Paid plan (~$5/mo; ~3,000 emails/month included, then ~$0.35/1,000); Email Routing is not a browsable mailbox; and there is no provider threadId, so threading is derived from In-Reply-To / References / Message-ID headers — the email conversation ID is our own derived thread key, not a Gmail thread ID.
