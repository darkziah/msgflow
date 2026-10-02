import { Schema } from "effect";
const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
export const EmailDomainVerifyRequestSchema = Schema.Struct({
	routingConfirmed: Schema.Boolean,
	sendingConfirmed: Schema.Boolean,
	dkimSelector: Schema.optionalWith(
		Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9-]{1,63}$/)),
		{ exact: true },
	),
});
export const EmailProvisionRequestSchema = Schema.Struct({
	emailDomainId: Id,
	userIds: Schema.Array(Id).pipe(Schema.maxItems(100)),
	excludeUserIds: Schema.optionalWith(
		Schema.Array(Id).pipe(Schema.maxItems(100)),
		{ exact: true },
	),
});
export const AssignUsernameRequestSchema = Schema.Struct({
	username: Schema.String.pipe(
		Schema.minLength(3),
		Schema.maxLength(30),
		Schema.pattern(/^(?!.*\.\.)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
	),
});
