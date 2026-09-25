import { describe, expect, test } from "bun:test";
import {
	EmailDomainCreateRequestSchema,
	EmailDomainStateUpdateRequestSchema,
	MailboxDelegateRequestSchema,
	MailboxStateUpdateRequestSchema,
} from "@msgflow/contracts";
import { decodeJsonBody } from "../src/validation";

function request(body: string): Request {
	return new Request("https://worker.test", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
}

describe("mailbox Effect HTTP request schemas", () => {
	test("accepts bounded Unicode domain input for service IDNA canonicalization", async () => {
		const decoded = await decodeJsonBody(
			request('{"canonicalDomain":"  bücher.example  "}'),
			EmailDomainCreateRequestSchema,
		);
		expect(decoded).toEqual({
			ok: true,
			value: { canonicalDomain: "bücher.example" },
		});
	});

	test("rejects malformed readiness, mailbox state, and delegate request bodies", async () => {
		await expect(
			decodeJsonBody(
				request('{"inboundState":"invalid"}'),
				EmailDomainStateUpdateRequestSchema,
			),
		).resolves.toEqual({ ok: false, error: "invalid request body" });
		await expect(
			decodeJsonBody(
				request('{"isEnabled":"true"}'),
				MailboxStateUpdateRequestSchema,
			),
		).resolves.toEqual({ ok: false, error: "invalid request body" });
		await expect(
			decodeJsonBody(request('{"userId":false}'), MailboxDelegateRequestSchema),
		).resolves.toEqual({ ok: false, error: "invalid request body" });
	});
});
