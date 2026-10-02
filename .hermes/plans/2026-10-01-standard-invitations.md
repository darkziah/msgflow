# Standard invitation onboarding implementation plan

> For Hermes: execute with focused implementation and review.

Goal: replace MsgFlow's reserved-username, two-stage invitation onboarding with email-only, seven-day standard invitations while keeping first-use setup mandatory and public signup disabled.

Architecture: retain Better Auth for credentials/sessions and D1 as the invitation authority. Add a migration to remove active username reservation semantics and permit email uniqueness per Workspace. The Worker owns secure token preview, creation, resend, acceptance, delivery limits, and session redirects; the React login route chooses fresh-install setup versus invitation/sign-in flows from a server-backed setup state.

Tasks:
1. Add runtime contracts, D1 migration/schema updates, and service-level invitation behavior/tests: email-only create, seven-day expiration, per-Workspace email uniqueness, resend replacement/rate limit, safe preview, new-account username/password confirmation acceptance that verifies and joins, and existing-account explicit acceptance that verifies and joins.
2. Update onboarding Hono routes and email content. Never return capability URLs. Add token-preview endpoint and setup-state endpoint. Preserve generic invalid/expired responses.
3. Update initial setup/auth behavior: server-backed login setup mode, no public first-workspace link after completion, password confirmation, verification redirect/session continuation, and completed `/setup` redirects.
4. Replace Team Settings invite dialog with email-only submit and email-delivery result; remove username reservation/link-copy UI. Update invitation roster wording/actions.
5. Replace login invitation activation UI with safe preview, workspace/masked email, username/password/confirmation for new agents, locked invited-email sign-in plus Join confirmation for existing agents, and redirects to the invited Workspace.
6. Add focused Worker/React tests and run worker tests serialized, web Vitest tests, root type-check/lint/build/format check, diff check, and Wrangler dry-run.
