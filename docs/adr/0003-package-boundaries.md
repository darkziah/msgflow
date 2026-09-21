# Monorepo package boundaries: two apps + five shared packages

The monorepo is two deployable apps and five shared libraries (scoped `@msgflow/`): `apps/web` (inbox UI), `apps/worker` (the single ingress Worker that exports `ConversationDO`), and `packages/contracts`, `packages/db`, `packages/channel`, `packages/auth`, `packages/ui`.

Two deliberate deviations from the original 9-area plan: (1) the Conversation Durable Object is not its own package — since it is a single Worker, the DO class lives in `apps/worker` with its SQLite storage schema versioned independently of D1; (2) there is no "configuration" package — root tsconfig.json/biome.json/turbo.json suffice until multiple apps need distinct shared presets.

Shared packages compile to `dist/` with `exports` maps (the existing scaffold pattern) so wrangler consumes built JS, never raw workspace TypeScript.
