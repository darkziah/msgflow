export type FacebookCallingLifecycleEvent =
	| "connect"
	| "call_status"
	| "media_update"
	| "terminate";

/** @deprecated Use FacebookCallingLifecycleEvent. */
export type FacebookCallingAction = FacebookCallingLifecycleEvent;

export type FacebookCallingDirection = "business_initiated" | "user_initiated";

export interface NormalizedFacebookCallingWebhook {
	/** Stable replay-safe ID derived from Meta's call identity and webhook time. */
	id: string;
	pageId: string;
	providerCallId: string;
	event: FacebookCallingLifecycleEvent;
	/** Present when the lifecycle webhook identifies the consumer endpoint. */
	endpointPsid?: string;
	/** Present when Meta supplies a supported call direction. */
	direction?: FacebookCallingDirection;
	/** ISO-8601 webhook time, or null when neither call nor entry has a valid Unix time. */
	timestamp: string | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function eventFrom(value: unknown): FacebookCallingLifecycleEvent | null {
	return value === "connect" ||
		value === "call_status" ||
		value === "media_update" ||
		value === "terminate"
		? value
		: null;
}

function directionFrom(value: unknown): FacebookCallingDirection | undefined {
	return value === "business_initiated" || value === "user_initiated" ? value : undefined;
}

function epochMilliseconds(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
		return null;
	}

	const milliseconds = value > 100_000_000_000 ? value : value * 1_000;
	return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function timestampFrom(call: UnknownRecord, entry: UnknownRecord): number | null {
	return epochMilliseconds(call.timestamp) ?? epochMilliseconds(entry.time);
}

function endpointPsidFrom(call: UnknownRecord, event: FacebookCallingLifecycleEvent): string | undefined {
	if (event === "connect") return nonEmptyString(call.from) ? call.from : undefined;
	return nonEmptyString(call.recipient_id) ? call.recipient_id : undefined;
}

function providerEventIdentifier(call: UnknownRecord, timestampMilliseconds: number | null): string {
	// Meta's immutable lifecycle identifier takes precedence. Array position is a
	// delivery artifact, not provider identity, and changes when Meta re-batches.
	if (nonEmptyString(call.event_id)) return `event:${call.event_id}`;
	if (nonEmptyString(call.eventId)) return `event:${call.eventId}`;
	if (timestampMilliseconds !== null) return `timestamp:${timestampMilliseconds}`;
	// Some call lifecycle deliveries omit an event timestamp/id. Collapse those
	// to one call-lifecycle key so replay/re-batching cannot start another session.
	return "lifecycle";
}

function normalizeCall(
	pageId: string,
	entry: UnknownRecord,
	call: unknown,
): NormalizedFacebookCallingWebhook | null {
	if (!isRecord(call) || !nonEmptyString(call.id)) return null;

	const event = eventFrom(call.event);
	if (!event) return null;

	const endpointPsid = endpointPsidFrom(call, event);
	// Meta's connect webhook defines `from` as the caller PSID; it is required to accept an incoming call.
	if (event === "connect" && !endpointPsid) return null;
	const direction = directionFrom(call.call_direction);

	const timestampMilliseconds = timestampFrom(call, entry);
	const timestamp = timestampMilliseconds === null ? null : new Date(timestampMilliseconds).toISOString();
	const idSuffix = providerEventIdentifier(call, timestampMilliseconds);

	return {
		id: `fb-call:${pageId}:${call.id}:${event}:${idSuffix}`,
		pageId,
		providerCallId: call.id,
		event,
		...(endpointPsid === undefined ? {} : { endpointPsid }),
		...(direction === undefined ? {} : { direction }),
		timestamp,
	};
}

/**
 * Normalizes Meta Messenger Business Calling Page `entry[].calls[]` lifecycle
 * webhooks. SDP/session data and other raw signalling fields are intentionally omitted.
 */
export function normalizeFacebookCallingWebhook(raw: unknown): NormalizedFacebookCallingWebhook[] {
	if (!isRecord(raw) || raw.object !== "page" || !Array.isArray(raw.entry)) return [];

	const results: NormalizedFacebookCallingWebhook[] = [];
	for (const entry of raw.entry) {
		if (!isRecord(entry) || !nonEmptyString(entry.id) || !Array.isArray(entry.calls)) continue;
		for (const call of entry.calls) {
			const normalized = normalizeCall(entry.id, entry, call);
			if (normalized) results.push(normalized);
		}
	}
	return results;
}

/** Short alias for callers that use the provider's “call” terminology. */
export const normalizeFacebookCallWebhook = normalizeFacebookCallingWebhook;
