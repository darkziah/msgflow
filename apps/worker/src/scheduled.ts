import { and, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SCHEDULED_MAX_ATTEMPTS, scheduledMessages } from "@msgflow/db";
import type { Env } from "./env";
import { sendOutbound } from "./outbound";
import { reviveDueSnoozes } from "./snooze";
import { claimScheduledMessage } from "./scheduled-claim";
import { parseStoredAttachments } from "./persistence";

export { reviveDueSnoozes } from "./snooze";
export { claimScheduledMessage, SCHEDULED_CLAIM_LEASE_MS } from "./scheduled-claim";

/** Send-later cron with compare-and-set claims before every provider dispatch. */
export async function handleScheduled(env: Env): Promise<void> {
	const now = new Date().toISOString();
	await reviveDueSnoozes(env, now);
	await deliverScheduledMessages(env, now);
}

export async function deliverScheduledMessages(env: Env, now: string): Promise<void> {
	const db = drizzle(env.DB);
	const due = await db.select().from(scheduledMessages).where(lte(scheduledMessages.sendAt, now)).all();
	for (const row of due) {
		const claimToken = crypto.randomUUID();
		if (!(await claimScheduledMessage(env, row.id, now, claimToken))) continue;

		const result = await sendOutbound(env, {
			conversationId: row.conversationId,
			text: row.text,
			attachments: parseStoredAttachments(row.attachmentsJson),
			senderId: row.createdBy ?? "system",
			clientMessageId: row.id,
		}, { allowQueued: true, retryDefinitiveFailure: true });

		if (result.ok || !result.retryable) {
			// Success, a provider/DO uncertainty, or an already-fenced intent must
			// leave the cron queue. The durable intent remains for reconciliation.
			await db.delete(scheduledMessages).where(and(eq(scheduledMessages.id, row.id), eq(scheduledMessages.claimToken, claimToken))).run();
			continue;
		}

		const attempts = row.attempts + 1;
		if (attempts >= SCHEDULED_MAX_ATTEMPTS) {
			console.error(`scheduled message ${row.id} stopped after ${attempts} definitive failures: ${result.error}`);
			await db.delete(scheduledMessages).where(and(eq(scheduledMessages.id, row.id), eq(scheduledMessages.claimToken, claimToken))).run();
		} else {
			await db.update(scheduledMessages).set({ attempts, claimToken: null, claimedAt: null }).where(and(eq(scheduledMessages.id, row.id), eq(scheduledMessages.claimToken, claimToken))).run();
		}
	}
}
