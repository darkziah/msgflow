import { describe, expect, test } from "bun:test";
import { Either, Schema } from "effect";
import { TimelineActivitySchema } from "./timeline-schema";

const callActivity = {
	id: "activity-1",
	conversationId: "conversation-1",
	action: "call.quality_reported" as const,
	createdAt: "2026-09-30T12:00:00.000Z",
};

describe("timeline call activity details", () => {
	test("decodes only aggregate, client-visible call details", () => {
		const decoded = Schema.decodeUnknownEither(TimelineActivitySchema)({
			...callActivity,
			actorId: "agent-1",
			pageId: "page-1",
			details: {
				providerCallId: "provider-call-1",
				queueId: "queue-1",
				userId: "user-1",
				agentId: "agent-1",
				pageId: "page-1",
				status: "completed",
				durationSeconds: 120,
				packetLossPercent: 0.4,
				jitterMilliseconds: 9,
			},
		});

		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("call activity did not decode");
		expect(decoded.right).toEqual({
			...callActivity,
			details: {
				status: "completed",
				durationSeconds: 120,
				packetLossPercent: 0.4,
				jitterMilliseconds: 9,
			},
		});
		expect(decoded.right).not.toHaveProperty("actorId");
		expect(decoded.right).not.toHaveProperty("pageId");
		expect(decoded.right.details).not.toHaveProperty("providerCallId");
		expect(decoded.right.details).not.toHaveProperty("queueId");
		expect(decoded.right.details).not.toHaveProperty("userId");
		expect(decoded.right.details).not.toHaveProperty("agentId");
		expect(decoded.right.details).not.toHaveProperty("pageId");
	});

	test("strips raw signaling, media, transcripts, tokens, and raw stats from call details", () => {
		const decoded = Schema.decodeUnknownEither(TimelineActivitySchema)({
			...callActivity,
			details: {
				providerCallId: "provider-call-1",
				durationSeconds: 120,
				sdp: "v=0 sensitive signaling",
				session: { secret: "session" },
				token: "secret-token",
				audio: { url: "private-recording" },
				text: "private transcript",
				rawStats: { candidates: ["private network address"] },
			},
		});

		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("call activity did not decode");
		expect(decoded.right.details).toEqual({ durationSeconds: 120 });
	});

	test("retains generic details for existing non-call actions", () => {
		const decoded = Schema.decodeUnknownEither(TimelineActivitySchema)({
			...callActivity,
			action: "conversation.updated",
			actorId: "agent-1",
			details: { changed: { status: "archived" } },
		});

		expect(Either.isRight(decoded)).toBeTrue();
		if (!Either.isRight(decoded))
			throw new Error("generic activity did not decode");
		expect(decoded.right.details).toEqual({ changed: { status: "archived" } });
		expect("actorId" in decoded.right).toBeTrue();
		if (!("actorId" in decoded.right))
			throw new Error("generic activity lost actor ID");
		expect(decoded.right.actorId).toBe("agent-1");
	});
});
