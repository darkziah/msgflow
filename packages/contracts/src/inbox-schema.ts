import { Schema } from "effect";

export const INBOX_ICON_KEYS = [
	"inbox",
	"headphones",
	"receipt-text",
	"badge-dollar-sign",
	"briefcase",
] as const;

export const INBOX_ASSIGNMENT_STRATEGIES = [
	"manual",
	"round_robin",
	"least_busy",
] as const;

export const INBOX_COLOR_PRESETS = [
	"#3B82F6",
	"#22C55E",
	"#A855F7",
	"#F97316",
	"#EAB308",
	"#EF4444",
	"#14B8A6",
	"#64748B",
] as const;

const InboxName = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120));
const InboxDescription = Schema.Trim.pipe(Schema.maxLength(1_000));
const InboxColor = Schema.String.pipe(Schema.pattern(/^#[0-9A-Fa-f]{6}$/));
const InboxId = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));

/**
 * Public create DTO for POST /api/(workspaces/:workspaceId/)?inboxes.
 *
 * Schema.Struct strips unknown properties. This deliberately preserves the
 * legacy endpoint's permissive unknown-key behavior while ensuring only these
 * decoded fields can reach the service. Server-owned IDs, workspace ownership,
 * membership, defaults, lifecycle state, and timestamps are not accepted.
 */
export const InboxCreateRequestSchema = Schema.Struct({
	name: InboxName,
	description: Schema.optionalWith(Schema.NullOr(InboxDescription), {
		exact: true,
	}),
	color: Schema.optionalWith(InboxColor, { exact: true }),
	icon: Schema.optionalWith(Schema.NullOr(Schema.Literal(...INBOX_ICON_KEYS)), {
		exact: true,
	}),
	teamId: Schema.optionalWith(Schema.NullOr(InboxId), { exact: true }),
	assignmentStrategy: Schema.optionalWith(
		Schema.Literal(...INBOX_ASSIGNMENT_STRATEGIES),
		{ exact: true },
	),
	channelIds: Schema.optionalWith(Schema.Array(InboxId), { exact: true }),
});

export type InboxCreateRequest = Schema.Schema.Type<
	typeof InboxCreateRequestSchema
>;

export type InboxIconKey = (typeof INBOX_ICON_KEYS)[number];
export type InboxAssignmentStrategy =
	(typeof INBOX_ASSIGNMENT_STRATEGIES)[number];
