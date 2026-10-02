import { Schema } from "effect";

const Identifier = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(255),
);
const NonEmptyText = Schema.Trim.pipe(
	Schema.minLength(1),
	Schema.maxLength(10_000),
);

/** Public DTO for POST /api/conversations/:id/messages. */
export const SendMessageRequestSchema = Schema.Struct({
	/** Explicit authorized workspace scope for the send operation. */
	workspaceId: Identifier,
	draftRevision: Schema.optionalWith(
		Schema.Number.pipe(
			Schema.int(),
			Schema.nonNegative(),
			Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
		),
		{ exact: true },
	),
	text: Schema.String.pipe(Schema.maxLength(10_000)),
	attachments: Schema.optionalWith(Schema.Array(Schema.Unknown), {
		exact: true,
	}),
	subject: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(998)), {
		exact: true,
	}),
	sendAt: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(64)), {
		exact: true,
	}),
	clientMessageId: Schema.optionalWith(
		Identifier.pipe(Schema.pattern(/^[A-Za-z0-9._:-]+$/)),
		{ exact: true },
	),
	mailboxId: Schema.optionalWith(Identifier, { exact: true }),
	confirmPrivateIdentity: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

/** Public DTO for a new outbound email conversation. */
export const ComposeEmailRequestSchema = Schema.Struct({
	to: Schema.String.pipe(Schema.minLength(3), Schema.maxLength(320)),
	subject: Schema.String.pipe(Schema.maxLength(998)),
	text: Schema.String.pipe(Schema.maxLength(10_000)),
	mailboxId: Identifier,
	clientMessageId: Schema.optionalWith(
		Identifier.pipe(Schema.pattern(/^[A-Za-z0-9._:-]+$/)),
		{ exact: true },
	),
});

/** Draft content is scoped by the request query, not stored in its payload. */
export const EmailDraftRequestSchema = Schema.Struct({
	draftRevision: Schema.optionalWith(
		Schema.Number.pipe(
			Schema.int(),
			Schema.nonNegative(),
			Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
		),
		{ exact: true },
	),
	text: Schema.String.pipe(Schema.maxLength(10_000)),
	attachments: Schema.optionalWith(Schema.Array(Schema.Unknown), {
		exact: true,
	}),
	subject: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(998)), {
		exact: true,
	}),
	sendAt: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(64)), {
		exact: true,
	}),
	clientMessageId: Schema.optionalWith(
		Identifier.pipe(Schema.pattern(/^[A-Za-z0-9._:-]+$/)),
		{ exact: true },
	),
	mailboxId: Schema.optionalWith(Identifier, { exact: true }),
	confirmPrivateIdentity: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

/** Public DTO for POST /api/conversations/:id/comments. */
export const CreateCommentRequestSchema = Schema.Struct({
	workspaceId: Identifier,
	text: NonEmptyText,
	mentions: Schema.optionalWith(
		Schema.Array(Identifier).pipe(Schema.maxItems(20)),
		{ exact: true },
	),
});

/** Public DTO for POST /api/conversations/:id/read. */
export const MarkReadRequestSchema = Schema.Struct({
	workspaceId: Identifier,
	lastReadSeq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

/** Public DTO for PATCH /api/conversations/:id. */
export const ConversationUpdateRequestSchema = Schema.Struct({
	workspaceId: Identifier,
	status: Schema.optionalWith(Schema.Literal("open", "archived"), {
		exact: true,
	}),
	assigneeId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
	snoozedUntil: Schema.optionalWith(
		Schema.NullOr(Schema.String.pipe(Schema.maxLength(64))),
		{
			exact: true,
		},
	),
	inboxId: Schema.optionalWith(Identifier, { exact: true }),
});

/** Public DTO for POST /api/conversations/:id/tags. */
export const ConversationTagRequestSchema = Schema.Struct({
	tagId: Identifier,
});
