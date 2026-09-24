import { Schema } from "effect";
import {
	INBOX_ASSIGNMENT_STRATEGIES,
	INBOX_ICON_KEYS,
} from "./inbox-schema";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const Name = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120));
const HexColor = Schema.String.pipe(Schema.pattern(/^#[0-9A-Fa-f]{6}$/));

export const InboxUpdateRequestSchema = Schema.Struct({
	name: Schema.optionalWith(Name, { exact: true }),
	description: Schema.optionalWith(
		Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1_000))),
		{ exact: true },
	),
	color: Schema.optionalWith(HexColor, { exact: true }),
	icon: Schema.optionalWith(Schema.NullOr(Schema.Literal(...INBOX_ICON_KEYS)), {
		exact: true,
	}),
	teamId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
	assignmentStrategy: Schema.optionalWith(
		Schema.Literal(...INBOX_ASSIGNMENT_STRATEGIES),
		{ exact: true },
	),
	isArchived: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export const InboxChannelRequestSchema = Schema.Struct({
	channelId: Identifier,
	isDefault: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export const InboxMemberRequestSchema = Schema.Struct({
	userId: Schema.optionalWith(Identifier, { exact: true }),
});

export const SetDefaultInboxRequestSchema = Schema.Struct({ inboxId: Identifier });

export const InboxReorderRequestSchema = Schema.Struct({
	inboxIds: Schema.Array(Identifier).pipe(Schema.minItems(1)),
});

export const SidebarStringListSchema = Schema.Array(Schema.String);
export const SidebarItemOrderSchema = Schema.Record({
	key: Schema.String,
	value: Schema.Number.pipe(Schema.finite()),
});

export const SidebarPreferencesUpdateSchema = Schema.Struct({
	collapsedSections: Schema.optionalWith(SidebarStringListSchema, {
		exact: true,
	}),
	pinnedItemIds: Schema.optionalWith(SidebarStringListSchema, { exact: true }),
	hiddenItemIds: Schema.optionalWith(SidebarStringListSchema, { exact: true }),
	itemOrder: Schema.optionalWith(SidebarItemOrderSchema, { exact: true },
	),
});

export const SavedFilterCreateRequestSchema = Schema.Struct({
	name: Name,
	filters: Schema.Unknown,
});

export const TagCreateRequestSchema = Schema.Struct({
	name: Name,
	color: Schema.optionalWith(Schema.NullOr(HexColor), { exact: true }),
	visibility: Schema.optionalWith(Schema.Literal("shared", "private"), {
		exact: true,
	}),
	parentTagId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
});

export const TagUpdateRequestSchema = Schema.Struct({
	name: Schema.optionalWith(Name, { exact: true }),
	color: Schema.optionalWith(Schema.NullOr(HexColor), { exact: true }),
	visibility: Schema.optionalWith(Schema.Literal("shared", "private"), {
		exact: true,
	}),
	parentTagId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
});

const RuleConditionSchema = Schema.Struct({
	field: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
	operator: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
	value: Schema.String.pipe(Schema.maxLength(10_000)),
	matchGroup: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

const RuleActionSchema = Schema.Struct({
	actionType: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
	actionValue: Schema.String.pipe(Schema.maxLength(10_000)),
	executionOrder: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export const RuleWriteRequestSchema = Schema.Struct({
	name: Name,
	triggerType: Schema.Literal(
		"message_received",
		"conversation_created",
		"tag_added",
		"manual",
	),
	isActive: Schema.Boolean,
	priority: Schema.Number.pipe(Schema.int()),
	stopProcessing: Schema.optionalWith(Schema.Boolean, { exact: true }),
	inboxId: Schema.optionalWith(Schema.NullOr(Identifier), { exact: true }),
	conditions: Schema.Array(RuleConditionSchema),
	actions: Schema.Array(RuleActionSchema),
});

export const CannedReplyWriteRequestSchema = Schema.Struct({
	name: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120)),
	body: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(10_000)),
});
