# ADR 0021: Multi-domain logical mailboxes and reply identities

**Status:** Accepted

MsgFlow treats an email address as a logical Mailbox owned by exactly one
Workspace, not as an IMAP, POP, or Google mailbox. A private Mailbox belongs to
one Agent and explicitly granted delegates; administrators have no implicit
content or send-as access. A shared Mailbox is linked to one Inbox and may be
linked to one Team, whose active members receive read, reply, and send-as
authority. Mailboxes are explicitly assigned rather than automatically
provisioned, use case-insensitive ASCII local-parts, disable plus addressing,
and reject unknown or disabled recipients. An Email Domain remains bound to its
original Workspace for the pilot; it may be suspended but cannot be transferred
without a future dedicated audited migration workflow.

Only a private Mailbox's owner may add or remove its delegates. Workspace
owners and administrators cannot self-grant or alter private-content
permissions; the pilot has no break-glass access feature.

A private Mailbox local-part exactly equals its owner's immutable Username.
Each enabled Email Domain may therefore assign that Username as a distinct
private address; alternate private local-parts and aliases are out of scope.

Agent deactivation disables their private Mailboxes immediately: they reject
new inbound mail and cannot send, but retain their history and audit records.
Private-Mailbox ownership transfer is out of scope.

`postmaster`, `abuse`, `admin`, `administrator`, `root`, `hostmaster`,
`webmaster`, `security`, `mailer-daemon`, `noreply`, and `no-reply` are
reserved on every Email Domain. `support`, `sales`, and comparable business
identities are forbidden for private Mailboxes but may be deliberately created
as Shared Mailboxes after collision checks.

Inbound readiness and outbound readiness are independent Email Domain states.
Inbound processing requires an inbound-ready domain and enabled Mailbox; send-as
also requires an outbound-ready domain, a send-enabled Mailbox, and the actor's
permission. Domain suspension blocks both directions.

All new email-domain, mailbox, ingress, and send records are workspace-scoped
from their first migration. The pilot binds only the current default Workspace
and does not migrate existing Messenger/email history or add workspace-creation
UX.

Published mailbox addresses are immutable for the pilot. Disabling preserves
their history and audit trail while stopping send-as and rejecting new inbound
mail. Aliases, forwarding, and address rename flows are out of scope.

Ingress synchronously persists private raw MIME and an idempotent D1 ingress
record before accepting a message. A failure before either durable record is
created rejects the message. Failures after both records exist enter an
observable, replayable processing state; raw-only orphan rows remain available
for the 90-day raw-MIME retention window.

Original HTML remains only in the private raw-MIME archive. The pilot displays
derived plain text and does not render raw HTML. Any later formatted view must
sanitize server-side and block scripts, forms, remote resources, and unsafe
URLs.

The pilot accepts, stores privately, and exposes downloads for PDF and image
attachments only, with a 5 MiB total-message limit. It rejects unsupported
attachment MIME types and larger messages so every accepted attachment is also
eligible for outbound reply. Downloads use attachment disposition; Office
documents, archives, and executable content remain out of scope pending
malware scanning and a separate policy.

When an enabled Mailbox's archived inbound MIME cannot be parsed, MsgFlow
creates a replayable quarantined ingress record rather than a Conversation. It
is visible only to that Mailbox's authorized readers as a processing failure,
has no rendered body, raises an operations alert, and is never rerouted by
subject, From, or another Mailbox.

Each Conversation retains one receiving Mailbox, while each outbound Message
uses a Reply Identity. The receiving Mailbox is the default Reply Identity, but
an authorized Agent may deliberately select another active private or shared
Mailbox. An outbound RFC Message-ID creates an explicit audited Thread Bridge;
only a subsequent message whose In-Reply-To or References resolves through that
bridge may return to the source Conversation after a Reply Identity override.
Subject and Contact matches never merge mailboxes.

Outbound UI state records `accepted` after provider acceptance. It may advance
to delivered, deferred, bounced, failed, rejected, or complained only from a
Cloudflare Email Sending Queue event subscription scoped to the sending domain;
without an event it remains accepted or unknown and is never presented as
delivered.

Using a private Reply Identity in a shared Conversation requires an explicit
selector action and a first-use-per-conversation confirmation. The resulting
Message, selected From address, and override audit event are visible to every
Agent authorized to read that Conversation.

The first pilot uses `inbox-test.yeheyremit.jp`, configured only as an Email
Routing and Email Sending subdomain after operator review of the generated DNS
records; the existing apex Google Workspace MX records are out of scope. Email
raw MIME and email attachments use private authorization-gated storage, with
90-day raw-MIME retention and 365-day attachment retention. The pilot supports
replies with an authorized From selector only; compose, reply-all, forward,
Cc, and Bcc remain unsupported until their full authorization and audit
semantics are implemented.

The pilot has no self-service mailbox/message deletion or export. Disabling
preserves indexed history and audit records while raw MIME and attachments
expire under their retention periods. A workspace-wide export or legal-deletion
workflow is deferred until it can authorize and audit coordinated D1, Durable
Object, and private-R2 changes.

MsgFlow writes immutable audit events for domain and Mailbox lifecycle changes,
private-delegate and shared-Team grant changes, permission denials, raw-MIME and
attachment downloads, outbound attempts/outcomes, and Reply Identity overrides.
It does not audit ordinary Conversation-list reads; timeline/body access is
audited for private Mailboxes only.

New Agents create a verified email/password account and may sign in with either
that email/password or their Username/password. Existing Agents retain
email/password while a workspace owner explicitly assigns a validated,
immutable Username; no Username is inferred from an email, and Mailbox
provisioning is blocked until assignment. The verified email remains the
account-recovery and administrative-notice contact.

First use is an explicit Workspace Owner setup flow rather than the existing
implicit first-request bootstrap. It establishes the initial owner and required
Workspace configuration without giving that owner private-Mailbox content
access. The wizard creates the Workspace, verifies the owner's email, assigns
the immutable Username and owner role, creates the initial Team and Inbox, and
does not create email transport resources. A separate domain-and-mailbox
onboarding wizard records the pilot domain plan, explicitly creates pending
personal/shared Mailboxes, and stops before Cloudflare changes to present
operator-approved DNS/setup instructions separately.

Only Workspace Owners may start or change domain-and-mailbox onboarding.
Workspace Admins may view verification/readiness state but cannot add domains,
create or suspend Mailboxes, or alter private-Mailbox assignments.

After first-use setup, Workspace Owners invite Agents. Invitees create verified
email/password accounts, select immutable Usernames, and join only the invited
Workspace; public unassigned signup is not available. Private-Mailbox assignment
remains a separate explicit owner action.

MsgFlow never creates or edits Cloudflare DNS, Email Routing rules, sending
domains, or Queue subscriptions. Domain onboarding presents owner-facing,
target-specific instructions and the expected DNS records, stores only the
pending checklist and observed readiness, and requires an operator to approve
the exact dashboard preview before performing the external steps.

MsgFlow automatically records public DNS observations for the expected
subdomain MX, SPF, DKIM, and DMARC records. The owner separately confirms the
dashboard-only routing Worker, sending-domain, and per-domain Queue-subscription
actions; unchecked confirmation alone cannot mark a domain ready.

Outbound email uses Cloudflare's structured Workers binding. MsgFlow persists
the returned provider message ID, uses a `X-MsgFlow-*` header only for app
correlation, and supplies threading through approved `In-Reply-To` and
`References` headers rather than attempting to set platform-controlled
Message-ID or Date headers.

## Implementation qualification for the pilot

The accepted product decisions above remain the target, not a claim that external
configuration or every operational feature is already complete. The application
implements explicit provisioning, private/shared authorization, private MIME/PDF/image
storage, durable ingress replay, structured outbound sending, reply bridges, send-as
audit, server drafts and provider-acceptance UI. Archived invalid MIME or unsupported
attachments are quarantined as a whole rather than partially projected; oversized
transport input is rejected before archival. Parsed text is limited to 256 KiB UTF-8
to keep canonical D1 rows bounded. Operators can explicitly retry an authorized
quarantine; cron never automatically retries poison content.

Automatic 90/365-day deletion, delivery/bounce Queue consumers, proactive alert
delivery and a dedicated Agent-deactivation workflow are not enabled by this change.
Until those gates are implemented and approved, retention requires the runbook's
manual legal-hold/expiry procedure, send state remains accepted/uncertain, operators
must review the operations screen/logs, and offboarding must explicitly disable
mailboxes and revoke grants/membership. This qualification does not silently change
the accepted retention or lifecycle policy. No deployment, DNS/MX change, entitlement,
catch-all scope or external-client threading result is inferred from local tests.

See [pilot runbook](../runbooks/email-domain-pilot.md) for the required approval,
migration, DNS and manual acceptance gates.