import { Schema } from "effect";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
// Domains are canonicalized by the service. Keep the HTTP boundary permissive
// enough for Unicode/IDNA input while bounding request size.
const CanonicalDomain = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(253));
const LocalPart = Schema.Trim.pipe(
	Schema.pattern(/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/),
	Schema.maxLength(64),
);

export const EmailDomainCreateRequestSchema = Schema.Struct({
	canonicalDomain: CanonicalDomain,
});

export const EmailDomainStateUpdateRequestSchema = Schema.Struct({
	inboundState: Schema.optionalWith(Schema.Literal("pending", "ready", "suspended"), { exact: true }),
	outboundState: Schema.optionalWith(Schema.Literal("pending", "ready", "suspended"), { exact: true }),
	operatorConfirmed: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export const PrivateMailboxCreateRequestSchema = Schema.Struct({
	ownerUserId: Identifier,
	emailDomainId: Identifier,
});

export const SharedMailboxCreateRequestSchema = Schema.Struct({
	emailDomainId: Identifier,
	localPart: LocalPart,
	inboxId: Identifier,
	teamId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
});

export const MailboxDelegateRequestSchema = Schema.Struct({ userId: Identifier });

export const MailboxStateUpdateRequestSchema = Schema.Struct({
	isEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
	isSendEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export type EmailDomainCreateRequest = Schema.Schema.Type<typeof EmailDomainCreateRequestSchema>;
export type EmailDomainStateUpdateRequest = Schema.Schema.Type<typeof EmailDomainStateUpdateRequestSchema>;
export type PrivateMailboxCreateRequest = Schema.Schema.Type<typeof PrivateMailboxCreateRequestSchema>;
export type SharedMailboxCreateRequest = Schema.Schema.Type<typeof SharedMailboxCreateRequestSchema>;
export type MailboxStateUpdateRequest = Schema.Schema.Type<typeof MailboxStateUpdateRequestSchema>;
export type MailboxDelegateRequest = Schema.Schema.Type<typeof MailboxDelegateRequestSchema>;
