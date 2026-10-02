import { describe, expect, test } from "bun:test";
import { sanitizeInboundEmailHtml } from "../src/email-html";

describe("sanitizeInboundEmailHtml", () => {
	test("keeps safe markup and exact inline-image references", async () => {
		const html = await sanitizeInboundEmailHtml(
			'<p>Hello <strong>team</strong></p><img src="cid:logo@example.test" alt="Logo">',
		new Map([["logo@example.test", "/api/email-attachments/attachment-1?inline=1"]]),
		);

		expect(html).toContain("<strong>team</strong>");
		expect(html).toContain('/api/email-attachments/attachment-1?inline=1');
	});

	test("removes executable markup and remote resources", async () => {
		const html = await sanitizeInboundEmailHtml(
			'<script>alert(1)</script><img src="https://tracker.example/pixel"><a href="javascript:alert(1)" onclick="alert(1)">Click</a>',
			new Map(),
		);

		expect(html).not.toContain("script");
		expect(html).not.toContain("tracker.example");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("onclick");
	});
});
