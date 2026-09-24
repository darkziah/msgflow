import type { Activity } from "@msgflow/contracts";
import type { Env } from "./env";

export type ActivityInput = Pick<
	Activity,
	"conversationId" | "action" | "actorId" | "details"
>;

/**
 * Materialize audit attribution in the Worker, then append it to the
 * ConversationDO timeline. Callers provide the authenticated actor (or null
 * for scheduled system work); clients never supply ids or timestamps.
 */
export async function appendActivity(
	env: Env,
	input: ActivityInput,
): Promise<Activity> {
	const activity: Activity = {
		id: crypto.randomUUID(),
		conversationId: input.conversationId,
		action: input.action,
		actorId: input.actorId,
		details: input.details,
		createdAt: new Date().toISOString(),
	};
	const stub = env.CONVERSATION_DO.get(
		env.CONVERSATION_DO.idFromName(activity.conversationId),
	);
	const response = await stub.fetch("https://do/append-activity", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(activity),
	});
	if (!response.ok) throw new Error("activity timeline unavailable");
	return activity;
}
