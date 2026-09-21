import { eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SCHEDULED_MAX_ATTEMPTS, scheduledMessages } from "@msgflow/db";
import type { Env } from "./env";
import { sendOutbound } from "./outbound";

/**
 * Send-later cron (per ADR 0013): one Cloudflare Cron Trigger (every minute)
 * selects due scheduled_messages rows and reuses the live send path. Success
 * deletes the row; transient failures bump `attempts` and retry next tick;
 * SCHEDULED_MAX_ATTEMPTS failures drop the row with an error log so a
 * permanently failing send (e.g. revoked Page token) stops retrying.
 *
 * The message id equals the row id, so a retry after a crash mid-send is
 * deduplicated by the DO instead of double-sending to the provider.
 */
export async function handleScheduled(env: Env): Promise<void> {
	const db = drizzle(env.DB);
	const now = new Date().toISOString();

	const due = await db
		.select()
		.from(scheduledMessages)
		.where(lte(scheduledMessages.sendAt, now))
		.all();

	for (const row of due) {
		const result = await sendOutbound(env, {
			conversationId: row.conversationId,
			text: row.text,
			senderId: row.createdBy ?? "system",
			clientMessageId: row.id,
		});

		if (result.ok) {
			await db
				.delete(scheduledMessages)
				.where(eq(scheduledMessages.id, row.id))
				.run();
			continue;
		}

		const attempts = row.attempts + 1;
		if (attempts >= SCHEDULED_MAX_ATTEMPTS) {
			console.error(
				`scheduled message ${row.id} dropped after ${attempts} attempts: ${result.error}`,
			);
			await db
				.delete(scheduledMessages)
				.where(eq(scheduledMessages.id, row.id))
				.run();
		} else {
			await db
				.update(scheduledMessages)
				.set({ attempts })
				.where(eq(scheduledMessages.id, row.id))
				.run();
		}
	}
}
