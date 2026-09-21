# Auth: Better-auth via better-auth-cloudflare, Drizzle on D1

Authentication uses Better-auth integrated through `better-auth-cloudflare` on Hono, with cookie-based sessions stored in D1. Better-auth's `user`/`session`/`account` tables live in D1 alongside the app's tables.

D1 is accessed through Drizzle ORM + drizzle-kit for both the app's tables (`packages/db`) and Better-auth (Drizzle adapter) — one schema file and one migration flow rather than two query layers. Drizzle was chosen over raw/native D1 SQL for end-to-end types across strict-TS packages and a mature migration story.

Phase 1 login is email + password for Yehey's own agents (no agent SSO; the Gmail-channel OAuth is a separate service-level credential held by the Worker). The Worker validates the WebSocket handshake via `getSession` before forwarding the upgrade to the DO; the DO trusts the Worker and never re-verifies. RBAC in Phase 1 is a minimal admin/member role to gate destructive ops.
