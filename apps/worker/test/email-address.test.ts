import { expect, test } from "bun:test";
import {
	canonicalAddress,
	normalizeEmailDomain,
	normalizeLocalPart,
} from "../src/email-address";
import { ManageError } from "../src/errors";

test("normalizes IDNA domains and lowercase ASCII local parts", () => {
	expect(normalizeEmailDomain("BÜCHER.example.")).toBe("xn--bcher-kva.example");
	expect(normalizeLocalPart("Abila.Jireh", "private")).toBe("abila.jireh");
	expect(canonicalAddress("SUPPORT", "INBOX-TEST.example.com")).toBe(
		"support@inbox-test.example.com",
	);
});

test("rejects ambiguous, unsupported, and reserved private local parts", () => {
	for (const value of ["support", "postmaster", "ab+ila", "a..b", "éclair"]) {
		expect(() => normalizeLocalPart(value, "private")).toThrow(ManageError);
	}
});
