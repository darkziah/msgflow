import { describe, expect, test } from "bun:test";
import { isValidUsername } from "./username-policy";

describe("isValidUsername", () => {
	test("accepts normalized private-mailbox local-parts", () => {
		expect(isValidUsername("agent-01")).toBe(true);
		expect(isValidUsername("support.team")).toBe(true);
	});

	test("rejects non-normalized or ambiguous local-parts", () => {
		for (const value of [
			"Agent",
			"agent+tag",
			"agent_01",
			"agent..one",
			".agent",
			"agent.",
			"ag",
			"a".repeat(31),
			"代理人",
		]) {
			expect(isValidUsername(value)).toBe(false);
		}
	});
});
