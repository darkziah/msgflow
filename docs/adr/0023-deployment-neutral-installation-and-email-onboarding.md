# ADR 0023: Deployment-neutral installation and controlled email onboarding

**Status:** Accepted

## Context

MsgFlow must deploy as an independent installation into a technical operator's
Cloudflare account. It must not depend on Yehey-specific Cloudflare account
IDs, resource names, application hosts, or email domains. Each installation
initially serves one Workspace created by an explicit first-use owner claim.

The installation needs a safe path for username-based Agent invitations,
private mailbox activation, and reusable Cloudflare Email Domain onboarding.
Cloudflare Email Routing, Email Sending, DNS records, and Queue event
subscriptions remain external operator configuration; a successful DNS lookup
is not proof that email works.

This decision supersedes the following narrow parts of ADR 0021:

- the fixed `inbox-test.yeheyremit.jp` pilot-domain restriction;
- owner-only email-domain/mailbox lifecycle and invitation authority;
- invitee-selected username assignment during registration.

It also narrows the single-installation operational model without removing the
internal workspace scope used for authorization.

## Decisions

### Deployment boundary

- The product has no source-code dependency on a particular Cloudflare account,
  resource name, hostname, or email domain.
- A technical operator deploys each installation manually with Wrangler first.
  They create dedicated Worker, D1, Durable Object, public attachment R2, and
  private email-archive R2 resources in the target Cloudflare account.
- `msgflow` is the default resource slug. Real account IDs, resource IDs,
  application origins, domains, and secrets belong only to that deployment's
  operator configuration, not committed application defaults.
- The operator validates the Worker at its temporary Workers.dev address, then
  attaches the final application hostname and configures Better Auth origins
  before first-use setup.
- The target account must have Workers Paid/Email Sending entitlement available.
  An auth-mail sender domain is configured by the technical operator before the
  first Owner setup; it is separate from Workspace Email Domains.
- The first rollout is greenfield in a new Cloudflare account. It does not
  change an existing Yehey deployment, its data, DNS, bindings, or resources.

### First use and roles

- Before first-use setup completes, normal application access is server-side
  gated. A durable singleton claim permits exactly one initial Owner setup.
- A partial claim is repaired only by an authenticated local operator recovery
  procedure that preserves the original claim; there is no public reset route.
- Each installation initially has one Workspace and no second-workspace
  creation flow.
- A Workspace may have multiple Owners and multiple Administrators.
- Owners alone may promote/demote Owners and every mutation preserves at least
  one Owner. Administrators may offboard members; Owners may offboard
  Administrators or other Owners while preserving at least one Owner.
- Owners and Administrators may create/revoke invitations and administer Email
  Domain/Mailbox lifecycle. Neither role gains private-Mailbox content or
  send-as authority merely through its workspace role. A Private Mailbox owner
  alone may grant/revoke delegates; delegates may read and work its
  Conversations but reply only through their own authorized Reply Identity.

### Invitations and Agent identity

- An invitation contains one canonical recovery email and one Owner/Admin
  selected reserved Username. It lasts 48 hours and grants `member` on
  acceptance.
- There is at most one active invitation for a recovery email or Username
  across MsgFlow.
- The recipient creates or connects their account, verifies the recovery email,
  and signs in. Invitation acceptance atomically assigns the reserved Username
  and workspace membership only if the account has no Username and no existing
  membership in that Workspace.
- Username reservation remains on the invitation until acceptance. An expired
  or revoked invitation enters a one-day cooldown before the Username can be
  reused.
- Revocation is only for unaccepted invitations. Later removal is auditable
  offboarding that preserves history and disables private Mailboxes.
- An Agent has one unique immutable verified recovery email and one immutable
  Username in this deployment model.

### Email Domains and Mailboxes

- Any Cloudflare-controlled domain or subdomain may be onboarded for the
  installation; it is deployment data, not source configuration. Each Email
  Domain belongs to one Workspace and is suspension-only during the initial
  deployment.
- Use a dedicated subdomain by default. Onboarding an apex domain that already
  receives mail requires a separately approved migration plan.
- For each Email Domain, the Cloudflare operator configures one catch-all Email
  Routing rule to the MsgFlow Worker. MsgFlow accepts only exact enabled
  Mailboxes and explicitly rejects unknown or disabled recipients.
- MsgFlow does not write DNS, Cloudflare routes, sending-domain configuration,
  or Queue subscriptions. It stores public DNS observations and explicit
  operator confirmations.
- Inbound and outbound readiness are independent. Each requires DNS evidence,
  Cloudflare operator confirmation, and a successful live test.
- Inbound testing uses a one-time random recipient and records a
  domain-verification result only. Outbound testing uses a one-time correlated
  sender to an operator-supplied destination; the operator enters the received
  random code before outbound readiness is recorded.
- A private mailbox may be activated only after its Agent accepts the
  invitation, verifies their recovery email, has signed in at least once, and
  an Administrator or Owner explicitly chooses an inbound-ready domain and
  confirms the exact address. Send-as is enabled only when that domain is also
  outbound-ready.
- Additional private addresses are separate later activations. Published
  Mailbox addresses are immutable and disable-only; aliases, forwarding,
  renames, and deletion are out of scope.

### Delivery observability and retention

- Email Sending Queue event subscriptions are optional for the first deployment.
  Without them, provider acceptance is never shown as delivery.
- Public Messenger attachments and private email raw MIME/attachments use
  separate R2 buckets. The private archive has no public domain.
- Until approved automated retention jobs exist, retention is a documented
  manual operator procedure; the product does not claim automatic expiry.

## Consequences

- Deployment instructions can be followed by a technical operator in a new
  Cloudflare account without inheriting another system's resources or domains.
- The Add Domain wizard is reusable while Cloudflare side effects remain
  reviewable and operator-controlled.
- Database migrations must add transactional invitation reservations/cooldowns,
  role-safe offboarding, domain verification-test state, and deployment-neutral
  configuration paths without deleting legacy data.
- Existing code and documents that hardcode Yehey deployment values or conflict
  with these role/invitation rules must be migrated before this policy is
  reported as implemented.
