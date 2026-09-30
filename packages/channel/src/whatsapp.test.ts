import { afterEach, describe, expect, test } from "bun:test";
import {
	normalizeWhatsAppWebhook,
	WHATSAPP_GRAPH_VERSION,
	whatsappAdapter,
} from "./whatsapp";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function webhookFor(value: Record<string, unknown>) {
	return {
		object: "whatsapp_business_account",
		entry: [{ changes: [{ value }] }],
	};
}

function validWebhook() {
	return webhookFor({
		metadata: { phone_number_id: "phone-123" },
		contacts: [
			{ wa_id: "15550000000", profile: { name: "Other contact" } },
			{ wa_id: "15551234567", profile: { name: "Ada" } },
		],
		messages: [
			{
				id: "wamid.inbound",
				from: "15551234567",
				timestamp: "1710000000",
				type: "text",
				text: { body: "Hello WhatsApp" },
			},
		],
	});
}

const context = {
	whatsapp: { accessToken: "secret-token", phoneNumberId: "phone-123" },
};

describe("WhatsApp Cloud API inbound normalization", () => {
	test("normalizes only valid text messages into the canonical wa conversation", () => {
		expect(normalizeWhatsAppWebhook(validWebhook())).toEqual([
			{
				conversationId: "wa:phone-123:15551234567",
				channel: "whatsapp",
				providerMessageId: "wamid.inbound",
				senderId: "15551234567",
				text: "Hello WhatsApp",
				createdAt: "2024-03-09T16:00:00.000Z",
				payload: {
					phoneNumberId: "phone-123",
					waId: "15551234567",
					profileName: "Ada",
				},
				attachments: [],
			},
		]);
	});

	test("ignores status-only, unsupported, and malformed WhatsApp webhook events", () => {
		const statusOnly = webhookFor({
			metadata: { phone_number_id: "phone-123" },
			statuses: [{ id: "wamid.status" }],
		});
		const unsupported = webhookFor({
			metadata: { phone_number_id: "phone-123" },
			messages: [
				{
					id: "wamid.image",
					from: "15551234567",
					timestamp: "1710000000",
					type: "image",
				},
			],
		});
		const malformed = webhookFor({
			metadata: { phone_number_id: "phone-123" },
			messages: [
				{
					id: "wamid.text",
					from: "15551234567",
					timestamp: "1710000000",
					type: "text",
				},
			],
		});

		expect(normalizeWhatsAppWebhook(statusOnly)).toEqual([]);
		expect(normalizeWhatsAppWebhook(unsupported)).toEqual([]);
		expect(normalizeWhatsAppWebhook(malformed)).toEqual([]);
		expect(normalizeWhatsAppWebhook({ object: "page", entry: [] })).toEqual([]);
	});
});

describe("WhatsApp Cloud API outbound text sends", () => {
	test("posts the exact text payload with bearer authorization outside the URL", async () => {
		let request: Request | undefined;
		globalThis.fetch = async (input, init) => {
			request = new Request(input, init);
			return Response.json({ messages: [{ id: "wamid.outbound" }] });
		};

		await expect(
			whatsappAdapter.sendOutbound(context, {
				to: "15551234567",
				text: "Hello",
			}),
		).resolves.toEqual({ ok: true, providerMessageId: "wamid.outbound" });
		expect(request?.url).toBe(
			`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/phone-123/messages`,
		);
		expect(request?.headers.get("authorization")).toBe("Bearer secret-token");
		expect(request?.url).not.toContain("secret-token");
		expect(request?.method).toBe("POST");
		expect(request?.headers.get("content-type")).toContain("application/json");
		expect(await request?.json()).toEqual({
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: "15551234567",
			type: "text",
			text: { body: "Hello", preview_url: false },
		});
	});

	test("rejects unsupported attachments, empty text, and text above Meta's 4096-character limit", async () => {
		let calls = 0;
		globalThis.fetch = async () => {
			calls += 1;
			return Response.json({ messages: [{ id: "unexpected" }] });
		};

		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "   " }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "definitive",
			error: "empty message",
		});
		await expect(
			whatsappAdapter.sendOutbound(context, {
				to: "1",
				text: "x".repeat(4097),
			}),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "definitive",
			error: "message exceeds 4096 characters",
		});
		await expect(
			whatsappAdapter.sendOutbound(context, {
				to: "1",
				text: "text",
				attachments: [
					{
						id: "a",
						key: "a",
						url: "https://example.test/a",
						name: "a.png",
						size: 1,
						type: "image/png",
					},
				],
			}),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "definitive",
			error: "WhatsApp attachments are not supported",
		});
		expect(calls).toBe(0);
	});

	test("treats network and successful non-JSON or malformed acknowledgements as uncertain", async () => {
		globalThis.fetch = async () => {
			throw new Error("offline");
		};
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "uncertain",
		});

		globalThis.fetch = async () => new Response("not json", { status: 200 });
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "uncertain",
		});

		globalThis.fetch = async () => Response.json({ messages: [] });
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "uncertain",
		});
	});

	test("treats client and Graph validation errors as definitive", async () => {
		globalThis.fetch = async () =>
			Response.json(
				{ error: { message: "outside the 24-hour window", code: 131047 } },
				{ status: 400 },
			);
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "definitive",
			error: "whatsapp graph api error: outside the 24-hour window",
		});

		globalThis.fetch = async () => new Response("bad request", { status: 400 });
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "definitive",
		});
	});

	test("treats 5xx gateway responses as uncertain", async () => {
		globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
		await expect(
			whatsappAdapter.sendOutbound(context, { to: "1", text: "text" }),
		).resolves.toMatchObject({
			ok: false,
			failureKind: "uncertain",
		});
	});
});
