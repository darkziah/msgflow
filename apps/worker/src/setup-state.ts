import type { Env } from "./env";

/** True only after the single first-use setup transaction has created its graph. */
export async function isInitialSetupComplete(env: Env): Promise<boolean> {
	const claim = await env.DB.prepare(
		"SELECT completed_at FROM workspace_setup_claim WHERE id = 1 AND completed_at IS NOT NULL",
	).first<{ completed_at: string }>();
	return claim !== null;
}
