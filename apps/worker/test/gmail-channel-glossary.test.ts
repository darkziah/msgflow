import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("glossary reserves Mailbox for Cloudflare and names Gmail Account separately", () => {
	const glossary = readFileSync(
		join(import.meta.dir, "..", "..", "..", "CONTEXT.md"),
		"utf8",
	);
	expect(glossary).toContain("**Gmail Account**:");
	expect(glossary).toContain(
		"It is not a Cloudflare Mailbox, Email Domain, or Reply Identity.",
	);
	expect(glossary).toContain(
		"**Mailbox** remains the Cloudflare logical-email concept",
	);
});
