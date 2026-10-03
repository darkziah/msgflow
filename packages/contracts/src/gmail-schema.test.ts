import { Either, Schema } from "effect";
import {
	GmailOAuthStartRequestSchema,
	GmailPubSubEnvelopeSchema,
} from "./gmail-schema";

describe("Gmail channel schemas", () => {
	test("accepts only client-controlled OAuth start fields", () => {
		const decoded = Schema.decodeUnknownEither(GmailOAuthStartRequestSchema)({
			inboxId: "inbox-support",
			accessMode: "shared",
			teamId: null,
			backfillDays: 30,
			refreshToken: "server-owned-secret",
		});
		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded)) throw new Error("OAuth start request did not decode");
		expect(decoded.right).toEqual({
			inboxId: "inbox-support",
			accessMode: "shared",
			teamId: null,
			backfillDays: 30,
		});
		expect(decoded.right).not.toHaveProperty("refreshToken");
	});

	test("enforces Pub/Sub envelope bounds", () => {
		const valid = Schema.decodeUnknownEither(GmailPubSubEnvelopeSchema)({
			message: { messageId: "pubsub-1", data: "eyJlbWFpbEFkZHJlc3MiOiJhQGIuY29tIn0=" },
			subscription: "projects/msgflow/subscriptions/gmail",
		});
		expect(Either.isRight(valid)).toBeTrue();
		expect(
			Schema.decodeUnknownEither(GmailPubSubEnvelopeSchema)({
				message: { messageId: "pubsub-1", data: "x".repeat(16_385) },
				subscription: "projects/msgflow/subscriptions/gmail",
			}),
		).toMatchObject({ _tag: "Left" });
	});
});
