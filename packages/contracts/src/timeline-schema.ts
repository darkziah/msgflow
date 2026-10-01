import { Schema } from "effect";

const Identifier = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(255),
);
const Timestamp = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64));
const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const AttachmentSchema = Schema.Struct({
	id: Identifier,
	key: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_024)),
	type: Schema.Literal(
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"application/pdf",
	),
	url: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4_096)),
	name: Schema.String.pipe(Schema.maxLength(255)),
	size: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

/** JSON values persisted by the conversation Durable Object. */
export const TimelinePayloadSchema = Schema.Unknown;
export const TimelineAttachmentsSchema = Schema.Array(AttachmentSchema);
export const TimelineMentionsSchema = Schema.Array(Identifier).pipe(
	Schema.maxItems(20),
);
/** Details for non-call audit records, retained for existing timeline actions. */
export const TimelineActivityDetailsSchema = JsonRecord;

const CallActivityActionSchema = Schema.Literal(
	"call.received",
	"call.ringing",
	"call.offered",
	"call.accepted",
	"call.rejected",
	"call.terminated",
	"call.timed_out",
	"call.no_agent_reply",
	"call.failed",
	"call.media_updated",
	"call.quality_reported",
);

/**
 * Aggregate-only, client-visible call audit fields. Raw signaling, media,
 * transcript, token, session, and WebRTC stats must never cross this boundary.
 */
export const CallActivityDetailsSchema = Schema.Struct({
	reason: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(255)), {
		exact: true,
	}),
	status: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(255)), {
		exact: true,
	}),
	durationSeconds: Schema.optionalWith(
		Schema.Number.pipe(Schema.int(), Schema.between(0, 86_400)),
		{ exact: true },
	),
	packetLossPercent: Schema.optionalWith(
		Schema.Number.pipe(Schema.between(0, 100)),
		{
			exact: true,
		},
	),
	jitterMilliseconds: Schema.optionalWith(
		Schema.Number.pipe(Schema.between(0, 10_000)),
		{ exact: true },
	),
});

export const TimelineMessageSchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	kind: Schema.Literal("inbound", "outbound"),
	channel: Schema.Literal("facebook", "email", "whatsapp"),
	providerMessageId: Schema.NullOr(Identifier),
	senderId: Identifier,
	text: Schema.String.pipe(Schema.maxLength(5 * 1024 * 1024)),
	payload: TimelinePayloadSchema,
	attachments: TimelineAttachmentsSchema,
	createdAt: Timestamp,
	seq: Schema.optionalWith(
		Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
		{
			exact: true,
		},
	),
});

export const TimelineCommentSchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	authorId: Identifier,
	text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(10_000)),
	mentions: TimelineMentionsSchema,
	createdAt: Timestamp,
});

const GenericTimelineActivitySchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	action: Schema.Literal(
		"conversation.updated",
		"tag.added",
		"tag.removed",
		"snooze.expired",
	),
	actorId: Schema.NullOr(Identifier),
	details: TimelineActivityDetailsSchema,
	createdAt: Timestamp,
});

const CallTimelineActivitySchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	action: CallActivityActionSchema,
	details: CallActivityDetailsSchema,
	createdAt: Timestamp,
});

/**
 * Call activities decode through a strict allow-list; generic details remain
 * available only to the pre-existing non-call activity actions.
 */
export const TimelineActivitySchema = Schema.Union(
	GenericTimelineActivitySchema,
	CallTimelineActivitySchema,
);

export const ConversationUpdatedEventSchema = Schema.Struct({
	type: Schema.Literal("conversation-updated"),
	patch: JsonRecord,
});

export const WebSocketClientEventSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal("draft:opened") }),
	Schema.Struct({ type: Schema.Literal("draft:closed") }),
	Schema.Struct({
		type: Schema.Literal("typing"),
		isTyping: Schema.optionalWith(Schema.Boolean, { exact: true }),
	}),
);
