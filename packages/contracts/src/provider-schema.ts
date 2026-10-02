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

/** Consumed subset of Meta's WhatsApp Cloud API webhook envelope. */
export const WhatsAppWebhookEnvelopeSchema = Schema.Struct({
	object: Schema.Literal("whatsapp_business_account"),
	entry: Schema.Array(
		Schema.Struct({
			changes: Schema.Array(
				Schema.Struct({
					value: Schema.Struct({
						metadata: Schema.optionalWith(
							Schema.Struct({
								phone_number_id: Schema.optionalWith(Schema.String, {
									exact: true,
								}),
							}),
							{ exact: true },
						),
						contacts: Schema.optionalWith(
							Schema.Array(
								Schema.Struct({
									wa_id: Schema.optionalWith(Schema.String, { exact: true }),
									profile: Schema.optionalWith(
										Schema.Struct({
											name: Schema.optionalWith(Schema.String, {
												exact: true,
											}),
										}),
										{ exact: true },
									),
								}),
							),
							{ exact: true },
						),
						messages: Schema.optionalWith(
							Schema.Array(
								Schema.Struct({
									id: Schema.optionalWith(Schema.String, { exact: true }),
									from: Schema.optionalWith(Schema.String, { exact: true }),
									timestamp: Schema.optionalWith(Schema.String, { exact: true }),
									type: Schema.optionalWith(Schema.String, { exact: true }),
									text: Schema.optionalWith(
										Schema.Struct({
											body: Schema.optionalWith(Schema.String, {
												exact: true,
											}),
										}),
										{ exact: true },
									),
								}),
							),
							{ exact: true },
						),
					}),
				}),
			),
		}),
	),
});

/** Consumed subset of Graph's WhatsApp text-send response. */
export const WhatsAppGraphSendResponseSchema = Schema.Struct({
	messages: Schema.optionalWith(
		Schema.Array(
			Schema.Struct({ id: Schema.optionalWith(Schema.String, { exact: true }) }),
		),
		{ exact: true },
	),
	error: Schema.optionalWith(
		Schema.Struct({
			message: Schema.optionalWith(Schema.String, { exact: true }),
			code: Schema.optionalWith(Schema.Number, { exact: true }),
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