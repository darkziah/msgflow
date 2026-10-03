import { Schema } from "effect";

const Identifier = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(255));
const BackfillDays = Schema.Number.pipe(Schema.int(), Schema.between(1, 90));

/** Client-controlled fields used to begin a Gmail OAuth connection. */
export const GmailOAuthStartRequestSchema = Schema.Struct({
	inboxId: Identifier,
	accessMode: Schema.Literal("private", "shared"),
	teamId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
	backfillDays: Schema.optionalWith(BackfillDays, { exact: true }),
});

/** Client-controlled delegate identity; account and workspace come from the route. */
export const GmailDelegateRequestSchema = Schema.Struct({
	userId: Identifier,
});

/** Optional bounded resync window. */
export const GmailResyncRequestSchema = Schema.Struct({
	backfillDays: Schema.optionalWith(BackfillDays, { exact: true }),
});

/** Gmail-specific archive behavior; it never affects Cloudflare mailboxes. */
export const GmailArchiveOptionsRequestSchema = Schema.Struct({
	archiveRemovesInboxLabel: Schema.Boolean,
});

/** Bounded Pub/Sub push envelope before its encoded payload is processed. */
export const GmailPubSubEnvelopeSchema = Schema.Struct({
	message: Schema.Struct({
		messageId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255)),
		data: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(16_384)),
	}),
	subscription: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_024)),
});

export type GmailOAuthStartRequest = Schema.Schema.Type<typeof GmailOAuthStartRequestSchema>;
export type GmailDelegateRequest = Schema.Schema.Type<typeof GmailDelegateRequestSchema>;
export type GmailResyncRequest = Schema.Schema.Type<typeof GmailResyncRequestSchema>;
export type GmailArchiveOptionsRequest = Schema.Schema.Type<
	typeof GmailArchiveOptionsRequestSchema
>;
export type GmailPubSubEnvelope = Schema.Schema.Type<typeof GmailPubSubEnvelopeSchema>;
