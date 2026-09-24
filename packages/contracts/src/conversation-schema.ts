import { Schema } from "effect";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const NonEmptyText = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(10_000));

/** Public DTO for POST /api/conversations/:id/messages. */
export const SendMessageRequestSchema = Schema.Struct({
	text: Schema.String.pipe(Schema.maxLength(10_000)),
	attachments: Schema.optionalWith(Schema.Array(Schema.Unknown), { exact: true }),
	subject: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(998)), {
		exact: true,
	}),
	sendAt: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(64)), {
		exact: true,
	}),
	clientMessageId: Schema.optionalWith(Identifier, { exact: true }),
});

/** Public DTO for POST /api/conversations/:id/comments. */
export const CreateCommentRequestSchema = Schema.Struct({
	text: NonEmptyText,
	mentions: Schema.optionalWith(
		Schema.Array(Identifier).pipe(Schema.maxItems(20)),
		{ exact: true },
	),
});

/** Public DTO for POST /api/conversations/:id/read. */
export const MarkReadRequestSchema = Schema.Struct({
	lastReadSeq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

/** Public DTO for PATCH /api/conversations/:id. */
export const ConversationUpdateRequestSchema = Schema.Struct({
	status: Schema.optionalWith(Schema.Literal("open", "archived"), {
		exact: true,
	}),
	assigneeId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
	snoozedUntil: Schema.optionalWith(Schema.NullOr(Schema.String.pipe(Schema.maxLength(64))), {
		exact: true,
	}),
	inboxId: Schema.optionalWith(Identifier, { exact: true }),
});

/** Public DTO for POST /api/conversations/:id/tags. */
export const ConversationTagRequestSchema = Schema.Struct({ tagId: Identifier });


