import { and, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { conversations } from "@msgflow/db";
import { appendActivity } from "./activity";
import type { Env } from "./env";

/**
 * Clear due snoozes from D1. Snooze is conversation metadata, so revival is a
 * scheduled-Worker concern rather than a Durable Object alarm (ADR 0004).
 */
export async function reviveDueSnoozes(env: Env, now: string): Promise<number> {
	const db = drizzle(env.DB);
	const due = await db
		.select({ id: conversations.id, snoozedUntil: conversations.snoozedUntil })
		.from(conversations)
		.where(
			and(
				eq(conversations.status, "open"),
				lte(conversations.snoozedUntil, now),
			),
		)
		.all();
	if (due.length === 0) return 0;

	await db
		.update(conversations)
		.set({ snoozedUntil: null, updatedAt: now })
		.where(
			and(
				eq(conversations.status, "open"),
				lte(conversations.snoozedUntil, now),
			),
		)
		.run();
	await Promise.all(
		due.map((conversation) =>
			appendActivity(env, {
				conversationId: conversation.id,
				action: "snooze.expired",
				actorId: null,
				details: { snoozedUntil: conversation.snoozedUntil },
			}),
		),
	);
	return due.length;
}
