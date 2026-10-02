import { afterEach, describe, expect, test } from "bun:test";
import { facebookAdapter } from "./facebook";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Messenger human-agent sends", () => {
	test("uses Meta's HUMAN_AGENT message tag only when requested by the Worker", async () => {
		const bodies: unknown[] = [];
		globalThis.fetch = async (_input, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({
				recipient_id: "psid",
				message_id: `mid-${bodies.length}`,
			});
		};

		const sent = await facebookAdapter.sendOutbound(
			{ pageAccessToken: "page-token" },
			{
				to: "psid",
				text: "A human support reply",
				humanAgent: true,
				attachments: [
					{
						id: "image-1",
						key: "image-1",
						url: "https://example.test/image.png",
						name: "image.png",
						size: 1,
						type: "image/png",
					},
				],
			},
		);

		expect(sent).toEqual({ ok: true, providerMessageId: "mid-2" });
		expect(bodies).toEqual([
			{
				recipient: { id: "psid" },
				message: { text: "A human support reply" },
				messaging_type: "MESSAGE_TAG",
				tag: "HUMAN_AGENT",
			},
			{
				recipient: { id: "psid" },
				message: {
					attachment: {
						type: "image",
						payload: {
							url: "https://example.test/image.png",
							is_reusable: true,
						},
					},
				},
				messaging_type: "MESSAGE_TAG",
				tag: "HUMAN_AGENT",
			},
		]);
	});
});
