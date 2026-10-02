import { outboundIntents } from "@msgflow/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";

/** Record provider handoff only; delivery events need a future queue binding. */
export async function recordProviderAccepted(
	env: Env,
	intentId: string,
	providerMessageId: string | null,
	acceptedAt = new Date().toISOString(),
): Promise<void> {
	await drizzle(env.DB)
		.update(outboundIntents)
		.set({
			status: "provider_sent",
			providerMessageId,
			providerSentAt: acceptedAt,
			updatedAt: acceptedAt,
		})
		.where(eq(outboundIntents.id, intentId))
		.run();
}
