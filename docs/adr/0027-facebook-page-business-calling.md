# ADR 0027: Facebook Page Business Calling

**Status:** Accepted

## Context

A Facebook Messenger Page Channel needs to support Meta Messenger Business
Calling for customer-initiated business calls without treating a live call as a
Conversation, Message, or generic real-time socket. The feature must preserve
MsgFlow's Workspace authorization, Team-based routing, auditability, and
existing channel boundary while meeting Meta's 60-second incoming-call accept
deadline.

The initial scope is deliberately narrow: it applies only to active Facebook
Page Channels and only to browser-based, audio-only calls initiated by a
consumer. It does not extend WhatsApp, introduce PSTN/SIP connectivity, or
make MsgFlow a media relay or recorder.

## Decision

- Business Calling is available only for an active `facebook_page` Channel. It
  is not available for inactive Pages, email Channels, or WhatsApp Channels.
- A consumer initiates an audio-only call to the Page. An authorized Agent
  accepts in the browser and the consumer and Agent establish the WebRTC media
  connection directly; MsgFlow does not hold, relay, or record audio media.
- A **Call Queue** is a Workspace-owned, Team-bound ordered waiting set for an
  incoming call to exactly one active Facebook Page Channel. It contains
  ordered Ring Group stages with bounded durations, selects eligible Agents
  through those stages, and is not an Inbox, Conversation queue, or persistent
  replacement for an Inbox. A Page Channel has at most one active/enabled Queue
  relationship as a product concept.
- A **Ring Group** is a Workspace-owned, Team-scoped subset of eligible Agents
  that a Call Queue offers an incoming call to, using simultaneous or
  round-robin selection. Ring Group order applies only to round-robin selection;
  Call Queue stage order controls escalation.
- **Call Presence** is an Agent's current, Workspace-scoped ability to receive
  Page calls. D1 persists the Agent's explicit opt-in state (`available`,
  `away`, or `offline`) and heartbeat expiry; the Workspace Call Dispatch
  Durable Object owns actual live authenticated sockets. Eligibility requires
  available state, a non-expired heartbeat, matching Team and Ring Group
  membership, and a live socket; socket close makes the Agent offline
  immediately. Presence is transient operational state, not an Inbox permission,
  Conversation assignment, or a durable Agent availability promise.
- **Call Activity** is an immutable audit/timeline record of a call lifecycle
  event, attached to a resolved or explicitly created Conversation. A separate
  lifecycle audit model exists in D1. Call Activities are rendered separately
  from Messages and Comments, are never Messages, and their details cannot
  contain audio, raw SDP or raw WebRTC stats, tokens, or customer-visible call
  text.
- D1 is authoritative for Call Queue and Ring Group configuration, the separate
  lifecycle audit model, webhook and action idempotency, and durable Call
  Presence state.
- A Call Session Durable Object owns exactly one live call: its call state,
  offer/accept progression, bounded queue timer, and per-call coordination.
  A Workspace Call Dispatch Durable Object owns Workspace-wide live call socket
  registration and dispatch to eligible Agents; it does not own individual call
  state.
- Aggregate Ring Group stage durations plus all transition and retry overhead
  must never exceed 50 seconds. This leaves a 10-second operational margin
  before Meta's 60-second accept deadline; expired, declined, cancelled, and
  unavailable calls are resolved without attempting a late accept.
- The initial release has no call recording, SIP/PSTN integration, server-side
  media termination, media proxy, media storage, transcription, or audio
  holding/streaming by MsgFlow.

## Consequences

- Page call configuration and call audit history are Workspace-scoped D1 data;
  all configuration and call actions require the same explicit Workspace
  authorization discipline as other Page Channel operations.
- Live coordination is split by scope: the Workspace Call Dispatch Durable
  Object can find and notify eligible connected Agents, while one Call Session
  Durable Object serializes each individual call's decision and deadline.
- Queue and offer paths must enforce that aggregate stage durations plus
  transition and retry overhead remain within 50 seconds rather than relying on
  Meta's full deadline. They must be idempotent because provider callbacks,
  browser reconnects, and Agent actions can be retried.
- Agents need available Call Presence, a non-expired heartbeat, matching Team
  and Ring Group membership, and a live authenticated Dispatch DO socket to
  receive an offer. Socket loss makes an Agent offline immediately without
  changing Workspace membership or Inbox permissions.
- Product surfaces render immutable Call Activity separately from Messages and
  Comments, attached to a resolved or explicitly created Conversation. Call
  lifecycle events must not be sent through Messenger as customer-facing
  content or be counted as Messages; Activity details must exclude audio, raw
  SDP/raw WebRTC stats, tokens, and customer-visible call text. The separate D1
  lifecycle audit model remains authoritative for audit history.
- Browser WebRTC support and Meta Business Calling eligibility are runtime
  prerequisites. Calls degrade to an unavailable or expired outcome rather than
  falling back to recording, SIP, audio relaying, or a WhatsApp implementation.

## Rejected alternatives

- **Treating calls as synthetic Messages or Conversations:** rejected because a
  call is an operational session, not customer-facing message content, and its
  lifecycle needs distinct audit and UI semantics.
- **Using an Inbox as the call queue:** rejected because Inboxes route and group
  Conversations; call offer order, presence, and the provider deadline require
  a separate Team-backed queue model.
- **One Workspace-level Durable Object for every call:** rejected because a
  single global call coordinator would couple independent call state and timers.
  Per-call Call Session Durable Objects isolate call serialization while the
  Workspace Call Dispatch Durable Object retains only Workspace-wide sockets.
- **Allowing the full Meta 60 seconds for internal queueing:** rejected because
  network, provider, and browser latency leave no safe margin to complete an
  accept action.
- **Recording, proxying, holding, or terminating media in MsgFlow:** rejected
  because the approved model is browser WebRTC with no MsgFlow audio media
  plane.
- **Extending the model to WhatsApp, video, consumer-initiated outbound calls,
  or SIP/PSTN:** rejected as out of scope for the approved Facebook Page,
  consumer-initiated, audio-only model.
