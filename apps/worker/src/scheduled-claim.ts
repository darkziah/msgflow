import type { Env } from "./env";

// Longer than a Worker invocation, but finite so a crashed cron run can be
// recovered. A recovered sending intent is made uncertain, never re-sent.
export const SCHEDULED_CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Atomic compare-and-set lease; safe for overlapping Cron Trigger invocations. */
export async function claimScheduledMessage(
	env: Env,
	id: string,
	now: string,
	claimToken: string,
): Promise<boolean> {
	const leaseExpiredAt = new Date(
		new Date(now).getTime() - SCHEDULED_CLAIM_LEASE_MS,
	).toISOString();
	const result = await env.DB
		.prepare(
			`UPDATE scheduled_messages
		 SET claim_token = ?, claimed_at = ?
		 WHERE id = ? AND send_at <= ?
		   AND (claim_token IS NULL OR claimed_at < ?)`,
		)
		.bind(claimToken, now, id, now, leaseExpiredAt)
		.run();
	return result.meta.changes === 1;
}
