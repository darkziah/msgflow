# Monorepo tooling: Bun + Turborepo + Biome, Workers runtime

We repurposed the stock "bhvr" starter (Bun + Hono + Vite + React + TanStack) as the base for MsgFlow. The production server runtime is Cloudflare Workers (wrangler): Durable Objects and D1 only exist under Workers, so the scaffold's Bun-monolith `server/` package is replaced by wrangler-deployed Workers, and the local loop moves from `bun --watch` to `wrangler dev`.

Bun is retained as the package manager and local tooling over the initially-preferred pnpm, because every other Yehey project runs Bun and the scaffold is already Bun-wired — pnpm would add a second toolchain with no benefit. Turborepo orchestrates builds; Biome handles lint/format (no ESLint).
