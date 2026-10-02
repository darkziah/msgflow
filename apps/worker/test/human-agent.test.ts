import { describe, expect, test } from "bun:test";
import {
	HUMAN_AGENT_WINDOW_MS,
	isHumanAgentWindow,
	STANDARD_MESSAGING_WINDOW_MS,
} from "../src/outbound";

describe("Human Agent eligibility", () => {
	const now = Date.parse("2026-10-01T12:00:00.000Z");

	test("allows manual support replies from 24 hours through seven days after an inbound message", () => {
		expect(
			isHumanAgentWindow(
				new Date(now - STANDARD_MESSAGING_WINDOW_MS).toISOString(),
				now,
			),
		).toBe(true);
		expect(
			isHumanAgentWindow(
				new Date(now - HUMAN_AGENT_WINDOW_MS).toISOString(),
				now,
			),
		).toBe(true);
	});

	test("rejects absent, malformed, newer-than-24-hour, future, and expired customer messages", () => {
		expect(isHumanAgentWindow(null, now)).toBe(false);
		expect(isHumanAgentWindow("not-a-date", now)).toBe(false);
		expect(
			isHumanAgentWindow(
				new Date(now - STANDARD_MESSAGING_WINDOW_MS + 1).toISOString(),
				now,
			),
		).toBe(false);
		expect(isHumanAgentWindow(new Date(now + 1).toISOString(), now)).toBe(
			false,
		);
		expect(
			isHumanAgentWindow(
				new Date(now - HUMAN_AGENT_WINDOW_MS - 1).toISOString(),
				now,
			),
		).toBe(false);
	});
});
