import { SCHEDULED_MAX_ATTEMPTS, scheduledMessages } from "@msgflow/db";
import { and, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { type SendParams, sendOutbound } from "./outbound";
import { parseStoredAttachments } from "./persistence";
import { claimScheduledMessage } from "./scheduled-claim";
import { reviveDueSnoozes } from "./snooze";
import { maintainEmail } from "./email-maintenance";

export {
	claimScheduledMessage,
	SCHEDULED_CLAIM_LEASE_MS,
} from "./scheduled-claim";
export { reviveDueSnoozes } from "./snooze";

/** Send-later cron with compare-and-set claims before every provider dispatch. */
export async function handleScheduled(env: Env): Promise<void> {
	const now = new Date().toISOString();
	await reviveDueSnoozes(env, now);
	await maintainEmail(env);
	await deliverScheduledMessages(env, now);
}

export async function deliverScheduledMessages(
	env: Env,
	now: string,
): Promise<void> {
	const db = drizzle(env.DB);
	const due = await db
		.select()
		.from(scheduledMessages)
		.where(lte(scheduledMessages.sendAt, now))
		.all();
	for (const row of due) {
		const claimToken = crypto.randomUUID();
		if (!(await claimScheduledMessage(env, row.id, now, claimToken))) continue;

		const stored = await env.DB.prepare(
			"SELECT command_json FROM outbound_intents WHERE id=?",
		)
			.bind(row.id)
			.first<{ command_json: string | null }>();
		const command = stored?.command_json
			? (JSON.parse(stored.command_json) as Partial<SendParams>)
			: {};
		const result = await sendOutbound(
			env,
			{
				subject: command.subject ?? undefined,
				mailboxId: command.mailboxId ?? undefined,
				confirmPrivateIdentity: command.confirmPrivateIdentity,
				conversationId: row.conversationId,
				text: row.text,
				attachments: parseStoredAttachments(row.attachmentsJson),
				senderId: row.createdBy ?? "system",
				clientMessageId: row.id,
			},
			{ allowQueued: true, retryDefinitiveFailure: true },
		);

		if (result.ok || !result.retryable) {
			// Success, a provider/DO uncertainty, or an already-fenced intent must
			// leave the cron queue. The durable intent remains for reconciliation.
			await db
				.delete(scheduledMessages)
				.where(
					and(
						eq(scheduledMessages.id, row.id),
						eq(scheduledMessages.claimToken, claimToken),
					),
				)
				.run();
			continue;
		}

		const attempts = row.attempts + 1;
		if (attempts >= SCHEDULED_MAX_ATTEMPTS) {
			console.error(
				`scheduled message ${row.id} stopped after ${attempts} definitive failures: ${result.error}`,
			);
			await db
				.delete(scheduledMessages)
				.where(
					and(
						eq(scheduledMessages.id, row.id),
						eq(scheduledMessages.claimToken, claimToken),
					),
				)
				.run();
		} else {
			await db
				.update(scheduledMessages)
				.set({ attempts, claimToken: null, claimedAt: null })
				.where(
					and(
						eq(scheduledMessages.id, row.id),
						eq(scheduledMessages.claimToken, claimToken),
					),
				)
				.run();
		}
	}
}
