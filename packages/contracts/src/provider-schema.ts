import { Schema } from "effect";
import { AttachmentSchema } from "./timeline-schema";

const NullableString = Schema.NullOr(Schema.String);

/** Meta's Messenger webhook allows provider extensions at every level. */
export const MessengerWebhookEnvelopeSchema = Schema.Struct({
	object: Schema.optionalWith(Schema.String, { exact: true }),
	entry: Schema.Array(
		Schema.Struct({
			id: Schema.optionalWith(Schema.String, { exact: true }),
			messaging: Schema.optionalWith(
				Schema.Array(
					Schema.Struct({
						sender: Schema.optionalWith(
							Schema.Struct({ id: Schema.optionalWith(Schema.String, { exact: true }) }),
							{ exact: true },
						),
						recipient: Schema.optionalWith(
							Schema.Struct({ id: Schema.optionalWith(Schema.String, { exact: true }) }),
							{ exact: true },
						),
						timestamp: Schema.optionalWith(Schema.Number, { exact: true }),
						message: Schema.optionalWith(
							Schema.Struct({
								mid: Schema.optionalWith(Schema.String, { exact: true }),
								text: Schema.optionalWith(Schema.String, { exact: true }),
								attachments: Schema.optionalWith(
									Schema.Array(
										Schema.Struct({
											type: Schema.optionalWith(Schema.String, { exact: true }),
											payload: Schema.optionalWith(
												Schema.Struct({ url: Schema.optionalWith(Schema.String, { exact: true }) }),
												{ exact: true },
											),
										}),
									),
									{ exact: true },
								),
							}),
							{ exact: true },
						),
					}),
				),
				{ exact: true },
			),
		}),
	),
});

/** Subset of Graph's response used after a send attempt. */
export const FacebookGraphSendResponseSchema = Schema.Struct({
	recipient_id: Schema.optionalWith(Schema.String, { exact: true }),
	message_id: Schema.optionalWith(Schema.String, { exact: true }),
	error: Schema.optionalWith(
		Schema.Struct({
			message: Schema.optionalWith(Schema.String, { exact: true }),
			code: Schema.optionalWith(Schema.Number, { exact: true }),
			error_subcode: Schema.optionalWith(Schema.Number, { exact: true }),
		}),
		{ exact: true },
	),
});

/** Parsed inbound fields consumed by email normalization. */
export const ParsedEmailSchema = Schema.Struct({
	from: Schema.String,
	to: Schema.String,
	subject: Schema.String,
	messageId: NullableString,
	inReplyTo: NullableString,
	references: Schema.NullOr(Schema.Array(Schema.String)),
	text: Schema.String,
	attachments: Schema.Array(AttachmentSchema),
	mailbox: Schema.String,
	receivedAt: Schema.String,
});