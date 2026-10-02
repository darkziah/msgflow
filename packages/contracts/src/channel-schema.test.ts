import { Either, Schema } from "effect";
import {
	WhatsAppChannelCreateRequestSchema,
	WhatsAppChannelUpdateRequestSchema,
} from "./channel-schema";

const input = {
	phoneNumberId: "phone-123",
	displayName: "Support WhatsApp",
	accessToken: "system-user-token",
	inboxId: "inbox-123",
	metaAppId: "meta-app-123",
};

describe("WhatsApp channel request schemas", () => {
	test("accepts only client-controlled create fields and trims them", () => {
		const decoded = Schema.decodeUnknownEither(
			WhatsAppChannelCreateRequestSchema,
		)({
			phoneNumberId: "  phone-123  ",
			displayName: "  Support WhatsApp  ",
			accessToken: "  system-user-token  ",
			inboxId: "  inbox-123  ",
			metaAppId: "  meta-app-123  ",
			workspaceId: "server-owned",
			status: "active",
		});
		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("create request did not decode");
		expect(decoded.right).toEqual(input);
	});

	test("rejects blank required create fields", () => {
		expect(
			Schema.decodeUnknownEither(WhatsAppChannelCreateRequestSchema)({
				...input,
				phoneNumberId: "   ",
			}),
		).toMatchObject({ _tag: "Left" });
	});

	test("permits only optional display name and token on update", () => {
		const decoded = Schema.decodeUnknownEither(
			WhatsAppChannelUpdateRequestSchema,
		)({
			displayName: "  Renamed support  ",
			accessToken: "  rotated-token  ",
			phoneNumberId: "immutable-phone",
			metaAppId: "immutable-meta-app",
			workspaceId: "server-owned",
			status: "active",
			inboxId: "immutable-inbox",
		});
		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("update request did not decode");
		expect(decoded.right).toEqual({
			displayName: "Renamed support",
			accessToken: "rotated-token",
		});
	});
});
