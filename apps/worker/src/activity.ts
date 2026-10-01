import {
	type Activity,
	type CallActivity,
	CallActivityDetailsSchema,
	type GenericActivity,
} from "@msgflow/contracts";
import { Either, Schema } from "effect";
import type { Env } from "./env";

/**
 * Worker-only audit attribution. Call records accept internal detail data, but
 * only the public allow-list is materialized before leaving the Worker.
 */
type GenericActivityInput = Pick<
	GenericActivity,
	"conversationId" | "action" | "actorId" | "details"
>;
type CallActivityInput = {
	conversationId: string;
	action: CallActivity["action"];
	actorId: string | null;
	details: unknown;
};
export type ActivityInput = GenericActivityInput | CallActivityInput;

export function isCallActivityAction(
	action: Activity["action"],
): action is CallActivity["action"] {
	return action.startsWith("call.");
}

export function isCallActivity(activity: Activity): activity is CallActivity {
	return isCallActivityAction(activity.action);
}

function isCallActivityInput(input: ActivityInput): input is CallActivityInput {
	return isCallActivityAction(input.action);
}

/**
 * Materialize audit attribution in the Worker, then append it to the
 * ConversationDO timeline. Callers provide the authenticated actor (or null
 * for scheduled system work); clients never supply ids or timestamps.
 */
export async function appendActivity(
	env: Env,
	input: ActivityInput,
): Promise<Activity> {
	const base = {
		id: crypto.randomUUID(),
		conversationId: input.conversationId,
		createdAt: new Date().toISOString(),
	};
	const activity: Activity = isCallActivityInput(input)
		? materializeCallActivity(base, input)
		: { ...base, ...input };
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

function materializeCallActivity(
	base: Pick<CallActivity, "id" | "conversationId" | "createdAt">,
	input: CallActivityInput,
): CallActivity {
	const decoded = Schema.decodeUnknownEither(CallActivityDetailsSchema)(
		input.details,
	);
	if (Either.isLeft(decoded)) throw new Error("invalid call activity details");
	return { ...base, action: input.action, details: decoded.right };
}
