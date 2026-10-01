import { describe, expect, test } from "bun:test";
import { normalizeFacebookCallingWebhook } from "./facebook-calling";

const pageId = "106378625516323";
const callId = "c_M5YPhGE5jm0L_PMQdScLlYJlR7tU_f0rgXiTQ";
const consumerPsid = "5275811702471834";

function webhook(calls: unknown[], entry: Record<string, unknown> = {}) {
	return {
		object: "page",
		entry: [{ id: pageId, time: 1_671_644_824, calls, ...entry }],
	};
}

describe("Messenger Business Calling webhook normalization", () => {
	test("normalizes an actual connect calls webhook and requires its from PSID", () => {
		const [event] = normalizeFacebookCallingWebhook(
			webhook([
				{
					id: callId,
					to: pageId,
					from: consumerPsid,
					event: "connect",
					timestamp: 1_671_644_824,
					call_direction: "user_initiated",
				},
			]),
		);

		expect(event).toEqual({
			id: `fb-call:${pageId}:${callId}:connect:timestamp:1671644824000`,
			pageId,
			providerCallId: callId,
			event: "connect",
			endpointPsid: consumerPsid,
			direction: "user_initiated",
			timestamp: new Date(1_671_644_824_000).toISOString(),
		});
		expect(normalizeFacebookCallingWebhook(webhook([{ id: callId, event: "connect" }]))).toEqual([]);
	});

	test("normalizes actual call_status, media_update, and terminate lifecycle webhooks", () => {
		const [status] = normalizeFacebookCallingWebhook(
			webhook([
				{
					id: callId,
					event: "call_status",
					timestamp: 1_671_644_824_000,
					recipient_id: consumerPsid,
					call_status: "ringing",
				},
			]),
		);
		expect(status).toMatchObject({
			event: "call_status",
			endpointPsid: consumerPsid,
			timestamp: new Date(1_671_644_824_000).toISOString(),
		});

		const [mediaUpdate] = normalizeFacebookCallingWebhook(
			webhook([
				{
					id: callId,
					event: "media_update",
					timestamp: 1_671_644_824,
					session: { version: 1, sdp_renegotiation: { sdp_type: "offer", sdp: "secret-sdp" } },
				},
			]),
		);
		expect(mediaUpdate).toEqual({
			id: `fb-call:${pageId}:${callId}:media_update:timestamp:1671644824000`,
			pageId,
			providerCallId: callId,
			event: "media_update",
			timestamp: new Date(1_671_644_824_000).toISOString(),
		});

		const [terminated] = normalizeFacebookCallingWebhook(
			webhook([
				{
					id: callId,
					event: "terminate",
					status: "Completed",
					start_time: 1_671_644_824,
					end_time: 1_671_644_944,
					duration: 120,
				},
			]),
		);
		expect(terminated).toMatchObject({
			event: "terminate",
			timestamp: new Date(1_671_644_824_000).toISOString(),
		});
		expect(terminated).not.toHaveProperty("endpointPsid");
	});

	test("allows call_status and terminate events without consumer PSIDs", () => {
		const events = normalizeFacebookCallingWebhook(
			webhook([
				{ id: "status-call", event: "call_status", timestamp: 1_671_644_824 },
				{ id: "terminate-call", event: "terminate", timestamp: 1_671_644_824 },
			]),
		);
		expect(events).toHaveLength(2);
		expect(events.every((event) => event.endpointPsid === undefined)).toBe(true);
	});

	test("uses valid call timestamps before entry time and supports Unix seconds and milliseconds", () => {
		const [seconds, milliseconds, entryFallback] = normalizeFacebookCallingWebhook(
			webhook([
				{ id: "seconds", event: "terminate", timestamp: 1_671_644_824 },
				{ id: "milliseconds", event: "terminate", timestamp: 1_671_644_824_000 },
				{ id: "entry-time", event: "terminate", timestamp: "invalid" },
			]),
		);
		const expected = new Date(1_671_644_824_000).toISOString();
		expect(seconds.timestamp).toBe(expected);
		expect(milliseconds.timestamp).toBe(expected);
		expect(entryFallback.timestamp).toBe(expected);
		expect(seconds.id).toBe(`fb-call:${pageId}:seconds:terminate:timestamp:1671644824000`);
		expect(milliseconds.id).toBe(`fb-call:${pageId}:milliseconds:terminate:timestamp:1671644824000`);
	});

	test("uses provider lifecycle identity and nullable timestamp when no valid time is supplied", () => {
		const raw = {
			object: "page",
			entry: [
				{ id: pageId, calls: [{ id: callId, event: "terminate" }] },
				{ id: "second-page", calls: [{ id: "second-call", event: "terminate" }] },
			],
		};
		const events = normalizeFacebookCallingWebhook(raw);
		expect(events).toEqual(normalizeFacebookCallingWebhook(raw));
		expect(events[0]).toMatchObject({
			id: `fb-call:${pageId}:${callId}:terminate:lifecycle`,
			timestamp: null,
		});
		expect(events[1].id).toBe("fb-call:second-page:second-call:terminate:lifecycle");
	});

	test("collapses duplicate no-timestamp lifecycle records to the same replay-safe ID", () => {
		const raw = {
			object: "page",
			entry: [
				{
					id: pageId,
					calls: [
						{ id: callId, event: "terminate" },
						{ id: callId, event: "terminate" },
					],
				},
			],
		};
		const events = normalizeFacebookCallingWebhook(raw);

		expect(events).toEqual(normalizeFacebookCallingWebhook(raw));
		expect(events.map((event) => event.id)).toEqual([
			`fb-call:${pageId}:${callId}:terminate:lifecycle`,
			`fb-call:${pageId}:${callId}:terminate:lifecycle`,
		]);
		expect(new Set(events.map((event) => event.id)).size).toBe(1);
	});

	test("collapses same-timestamp duplicate lifecycle records to the same replay-safe ID", () => {
		const raw = webhook([
			{ id: callId, event: "terminate", timestamp: 1_671_644_824 },
			{ id: callId, event: "terminate", timestamp: 1_671_644_824 },
		]);
		const events = normalizeFacebookCallingWebhook(raw);

		expect(events).toEqual(normalizeFacebookCallingWebhook(raw));
		expect(events.map((event) => event.id)).toEqual([
			`fb-call:${pageId}:${callId}:terminate:timestamp:1671644824000`,
			`fb-call:${pageId}:${callId}:terminate:timestamp:1671644824000`,
		]);
		expect(new Set(events.map((event) => event.id)).size).toBe(1);
	});

	test("ignores unknown lifecycle events, missing identifiers, and ordinary messaging webhooks", () => {
		expect(normalizeFacebookCallingWebhook(webhook([{ id: callId, event: "unknown" }]))).toEqual([]);
		expect(normalizeFacebookCallingWebhook(webhook([{ event: "terminate" }]))).toEqual([]);
		expect(
			normalizeFacebookCallingWebhook({ object: "page", entry: [{ calls: [{ id: callId, event: "terminate" }] }] }),
		).toEqual([]);
		expect(
			normalizeFacebookCallingWebhook({
				object: "page",
				entry: [{ id: pageId, messaging: [{ sender: { id: consumerPsid }, message: { text: "hello" } }] }],
			}),
		).toEqual([]);
		expect(normalizeFacebookCallingWebhook({ object: "page", entry: [{ id: pageId, calls: [] }] })).toEqual([]);
	});
});
