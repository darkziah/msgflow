import { describe, expect, test } from "bun:test";
import { buildRawMessage, normalizeReplySubject } from "../src/gmail-outbound";

describe("Gmail outbound RFC 5322 construction", () => {
	test("builds a CRLF reply with normalized subject and threading headers", () => {
		const raw = buildRawMessage({
			from: "support@example.test",
			to: "customer@example.test",
			subject: normalizeReplySubject(" RE: Re: Question "),
			text: "One\nTwo",
			inReplyTo: "<latest@example.test>",
			references: ["<root@example.test>", "<latest@example.test>"],
			intentId: "intent-1",
		});
		expect(raw).toBe(
			"From: support@example.test\r\n" +
				"To: customer@example.test\r\n" +
				"Subject: Re: Question\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n" +
				"In-Reply-To: <latest@example.test>\r\n" +
				"References: <root@example.test> <latest@example.test>\r\n" +
				"X-MsgFlow-Intent: intent-1\r\n\r\nOne\r\nTwo",
		);
	});

	test("rejects CRLF injection in RFC headers", () => {
		expect(() =>
			buildRawMessage({
				from: "support@example.test",
				to: "customer@example.test",
				subject: "Question\r\nBcc: attacker@example.test",
				text: "Hello",
				references: [],
			}),
		).toThrow("invalid RFC header");
	});
});
