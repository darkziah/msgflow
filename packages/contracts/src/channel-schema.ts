import { Schema } from "effect";

const ChannelAccessToken = Schema.Trim.pipe(
	Schema.minLength(1),
	Schema.maxLength(8_192),
);

/**
 * Public DTO for POST /api/channels/:id/token.
 *
 * The token is normalized before the service encrypts it. Unknown properties
 * are stripped; channel identity, workspace ownership, and credential state
 * are derived by the authenticated Worker and cannot be supplied by a client.
 */
export const ChannelConnectRequestSchema = Schema.Struct({
	accessToken: ChannelAccessToken,
});

export type ChannelConnectRequest = Schema.Schema.Type<
	typeof ChannelConnectRequestSchema
>;

/** Initial Messenger channel setup; the Worker derives ownership and status. */
export const FacebookChannelCreateRequestSchema = Schema.Struct({
	pageId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	// OAuth supplies a Page name; manual token setup derives it from Graph.
	displayName: Schema.optional(
		Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	),
	accessToken: ChannelAccessToken,
	inboxId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	metaAppId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
});

export type FacebookChannelCreateRequest = Schema.Schema.Type<
	typeof FacebookChannelCreateRequestSchema
>;

/** Installation-level Meta App credential supplied by a verified Owner/Admin. */
export const MetaAppCreateRequestSchema = Schema.Struct({
	displayName: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	appId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	appSecret: ChannelAccessToken,
});

export type MetaAppCreateRequest = Schema.Schema.Type<typeof MetaAppCreateRequestSchema>;

/** App ID is immutable: changing it requires a new Meta App/dashboard setup. */
export const MetaAppUpdateRequestSchema = Schema.Struct({
	displayName: Schema.optional(
		Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	),
	appSecret: Schema.optional(ChannelAccessToken),
});

export type MetaAppUpdateRequest = Schema.Schema.Type<typeof MetaAppUpdateRequestSchema>;

export const MetaOAuthStartRequestSchema = Schema.Struct({
	metaAppId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
	inboxId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(128)),
});

export type MetaOAuthStartRequest = Schema.Schema.Type<
	typeof MetaOAuthStartRequestSchema
>;
