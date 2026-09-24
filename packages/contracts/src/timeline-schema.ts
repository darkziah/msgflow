import { Schema } from "effect";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const Timestamp = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64));
const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const AttachmentSchema = Schema.Struct({
	id: Identifier,
	key: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_024)),
	type: Schema.Literal("image/jpeg", "image/png", "image/gif", "image/webp"),
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
export const TimelineActivityDetailsSchema = JsonRecord;

export const TimelineMessageSchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	kind: Schema.Literal("inbound", "outbound"),
	channel: Schema.Literal("facebook", "email"),
	providerMessageId: Schema.NullOr(Identifier),
	senderId: Identifier,
	text: Schema.String.pipe(Schema.maxLength(10_000)),
	payload: TimelinePayloadSchema,
	attachments: TimelineAttachmentsSchema,
	createdAt: Timestamp,
	seq: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
		exact: true,
	}),
});

export const TimelineCommentSchema = Schema.Struct({
	id: Identifier,
	conversationId: Identifier,
	authorId: Identifier,
	text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(10_000)),
	mentions: TimelineMentionsSchema,
	createdAt: Timestamp,
});

export const TimelineActivitySchema = Schema.Struct({
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

export const ConversationUpdatedEventSchema = Schema.Struct({
	type: Schema.Literal("conversation-updated"),
	patch: JsonRecord,
});

export const WebSocketClientEventSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal("draft:opened") }),
	Schema.Struct({ type: Schema.Literal("draft:closed") }),
	Schema.Struct({ type: Schema.Literal("typing"), isTyping: Schema.optionalWith(Schema.Boolean, { exact: true }) }),
);
