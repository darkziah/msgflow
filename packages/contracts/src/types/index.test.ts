import { Either, Schema } from "effect";
import {
	parseConversationId,
	WhatsAppGraphSendResponseSchema,
	WhatsAppWebhookEnvelopeSchema,
	whatsappConversationId,
} from "../index";

describe("WhatsApp canonical conversation IDs", () => {
	test("mints and parses the canonical wa conversation ID", () => {
		const id = whatsappConversationId("phone-123", "15551234567");
		expect(id).toBe("wa:phone-123:15551234567");
		expect(parseConversationId(id)).toEqual({
			channel: "whatsapp",
			left: "phone-123",
			right: "15551234567",
		});
	});

	test("rejects malformed and noncanonical wa IDs", () => {
		expect(parseConversationId("wa:")).toBeNull();
		expect(parseConversationId("wa:phone-123")).toBeNull();
		expect(parseConversationId("wa::15551234567")).toBeNull();
		expect(parseConversationId("wa:phone-123:")).toBeNull();
		expect(parseConversationId("whatsapp:phone-123:15551234567")).toBeNull();
	});
});

describe("WhatsApp provider schemas", () => {
	test("decodes only inbound fields consumed by normalization", () => {
		const decoded = Schema.decodeUnknownEither(WhatsAppWebhookEnvelopeSchema)({
			object: "whatsapp_business_account",
			entry: [
				{
					changes: [
						{
							value: {
								metadata: { phone_number_id: "phone-123", ignored: true },
								contacts: [{ wa_id: "15551234567", profile: { name: "Ada" } }],
								messages: [
									{
										id: "wamid.abc",
										from: "15551234567",
										timestamp: "1710000000",
										type: "text",
										text: { body: "Hello", ignored: true },
									},
								],
								statuses: [{ id: "ignored-status" }],
							},
						},
					],
				},
			],
		});
		expect(Either.isRight(decoded)).toBeTrue();
	});

	test("decodes the consumed Graph send response fields", () => {
		expect(
			Schema.decodeUnknownEither(WhatsAppGraphSendResponseSchema)({
				messages: [{ id: "wamid.abc", ignored: true }],
				error: { message: "outside window", code: 131047, ignored: true },
			}),
		).toMatchObject({ _tag: "Right" });
	});
});
