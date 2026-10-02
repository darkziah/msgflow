import { outboundIntents } from "@msgflow/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { replayEmailIngress } from "./email-ingress";
import type { Env } from "./env";
import { reconcileProviderSent } from "./outbound";
/** Internal cron only: reconciliation never crosses a provider boundary. */
export async function maintainEmail(
	env: Env,
): Promise<{ replayed: number; reconciled: number }> {
	// Replay failure must not block outbound reconciliation.
	const replay = await replayEmailIngress(env).catch(() => ({ processed: 0 }));
	const db = drizzle(env.DB);
	const stale = new Date(Date.now() - 300000).toISOString();
	await db
		.update(outboundIntents)
		.set({
			status: "uncertain",
			lastError: "dispatch acknowledgement missing; automatic resend fenced",
			updatedAt: new Date().toISOString(),
		})
		.where(
			and(
				eq(outboundIntents.status, "sending"),
				lt(outboundIntents.updatedAt, stale),
			),
		)
		.run();
	const pending = await db
		.select()
		.from(outboundIntents)
		.where(sql`${outboundIntents.status} = 'provider_sent' OR (
		 ${outboundIntents.status} = 'accepted' AND EXISTS (
		 SELECT 1 FROM email_outbound_metadata em WHERE em.intent_id = ${outboundIntents.id})
		 AND NOT EXISTS (SELECT 1 FROM email_canonical_messages cm
		 WHERE cm.id = ${outboundIntents.id} AND cm.projected_at IS NOT NULL))`)
		.orderBy(outboundIntents.updatedAt)
		.limit(20)
		.all();
	let reconciled = 0;
	for (const intent of pending) {
		try {
			if ((await reconcileProviderSent(env, intent)).ok) reconciled++;
		} catch {
			/* Preserve state for next bounded sweep. */
		}
	}
	return { replayed: replay.processed, reconciled };
}
/** Read-only retention candidates. Purging requires separate operator approval;
 * never delete retained mail/history implicitly while the pilot policy evolves. */
export async function emailRetentionCandidates(
	env: Env,
	workspaceId: string,
	before: string,
): Promise<{ id: string; rawObjectKey: string }[]> {
	const rows = await env.DB.prepare(
		"SELECT id,raw_object_key FROM email_ingress WHERE workspace_id=? AND state='processed' AND received_at<? ORDER BY received_at LIMIT 100",
	)
		.bind(workspaceId, before)
		.all<{ id: string; raw_object_key: string }>();
	return rows.results.map((row) => ({
		id: row.id,
		rawObjectKey: row.raw_object_key,
	}));
}
export async function emailOperationalCounts(
	env: Env,
	workspaceId: string,
): Promise<Record<string, number>> {
	const rows = await env.DB.prepare(
		"SELECT state,count(*) AS total FROM email_ingress WHERE workspace_id=? GROUP BY state",
	)
		.bind(workspaceId)
		.all<{ state: string; total: number }>();
	return Object.fromEntries(rows.results.map((row) => [row.state, row.total]));
}
