import { Schema } from "effect";

const ShortName = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120));
const ClientActionId = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(128),
	Schema.pattern(/^[A-Za-z0-9._:-]+$/),
);
const DurationSeconds = Schema.Number.pipe(Schema.int(), Schema.between(1, 50));

/** The explicit opt-in state an authenticated Agent may set for Page calls. */
export const CallPresenceUpdateRequestSchema = Schema.Struct({
	status: Schema.Literal("available", "away"),
});
export type CallPresenceUpdateRequest = Schema.Schema.Type<
	typeof CallPresenceUpdateRequestSchema
>;

/** Client-controlled fields for a Ring Group; scope and membership are route-authorized. */
export const RingGroupConfigurationSchema = Schema.Struct({
	name: ShortName,
	strategy: Schema.Literal("simultaneous", "round_robin"),
});
export type RingGroupConfiguration = Schema.Schema.Type<
	typeof RingGroupConfigurationSchema
>;

/** One ordered Queue stage; queue and Ring Group identities are server-resolved. */
export const CallQueueStageConfigurationSchema = Schema.Struct({
	stageOrder: Schema.Number.pipe(Schema.int(), Schema.between(0, 49)),
	ringDurationSeconds: DurationSeconds,
});
export type CallQueueStageConfiguration = Schema.Schema.Type<
	typeof CallQueueStageConfigurationSchema
>;

/** Browser answer material for the authorized live Call Session. */
export const CallAcceptRequestSchema = Schema.Struct({
	offerSdp: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000)),
	clientActionId: Schema.optionalWith(ClientActionId, { exact: true }),
});
export type CallAcceptRequest = Schema.Schema.Type<
	typeof CallAcceptRequestSchema
>;

export const CallRejectRequestSchema = Schema.Struct({
	reason: Schema.optionalWith(Schema.Literal("declined", "unavailable"), {
		exact: true,
	}),
	clientActionId: Schema.optionalWith(ClientActionId, { exact: true }),
});
export type CallRejectRequest = Schema.Schema.Type<
	typeof CallRejectRequestSchema
>;

export const CallTerminateRequestSchema = Schema.Struct({
	reason: Schema.optionalWith(
		Schema.Literal("agent_hangup", "connection_lost", "technical_error"),
		{ exact: true },
	),
	clientActionId: Schema.optionalWith(ClientActionId, { exact: true }),
});
export type CallTerminateRequest = Schema.Schema.Type<
	typeof CallTerminateRequestSchema
>;

/** A deliberately small, aggregate-only quality report; raw WebRTC stats stay client-side. */
export const CallMetricsRequestSchema = Schema.Struct({
	durationSeconds: Schema.Number.pipe(Schema.int(), Schema.between(0, 86_400)),
	packetLossPercent: Schema.Number.pipe(Schema.between(0, 100)),
	jitterMilliseconds: Schema.Number.pipe(Schema.between(0, 10_000)),
	clientActionId: Schema.optionalWith(ClientActionId, { exact: true }),
});
export type CallMetricsRequest = Schema.Schema.Type<
	typeof CallMetricsRequestSchema
>;

// Short request/configuration names keep route modules concise while the
// longer exports remain explicit at the public contracts boundary.
export const CallPresenceRequestSchema = CallPresenceUpdateRequestSchema;
export type CallPresenceRequest = CallPresenceUpdateRequest;
export const RingGroupConfigSchema = RingGroupConfigurationSchema;
export type RingGroupConfig = RingGroupConfiguration;
export const CallQueueStageConfigSchema = CallQueueStageConfigurationSchema;
export type CallQueueStageConfig = CallQueueStageConfiguration;
export const AcceptCallRequestSchema = CallAcceptRequestSchema;
export type AcceptCallRequest = CallAcceptRequest;
export const RejectCallRequestSchema = CallRejectRequestSchema;
export type RejectCallRequest = CallRejectRequest;
export const TerminateCallRequestSchema = CallTerminateRequestSchema;
export type TerminateCallRequest = CallTerminateRequest;
export const MetricsCallRequestSchema = CallMetricsRequestSchema;
export type MetricsCallRequest = CallMetricsRequest;
