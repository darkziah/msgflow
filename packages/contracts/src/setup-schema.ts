import { Schema } from "effect";

const Name = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(120));
const Email = Schema.Trim.pipe(Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), Schema.maxLength(254));
const Password = Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128));
// This is intentionally not trimmed/lowercased: owners must submit the exact
// canonical private-mailbox-compatible identifier they intend to reserve.
const Username = Schema.String.pipe(
	Schema.minLength(3),
	Schema.maxLength(30),
	Schema.pattern(/^(?!.*\.\.)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
);
const WorkspaceSlug = Schema.String.pipe(
	Schema.minLength(3),
	Schema.maxLength(63),
	Schema.pattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
);

/** Public body for the one-time, first-use Workspace Owner setup route. */
export const OwnerSetupRequestSchema = Schema.Struct({
	email: Email,
	password: Password,
	username: Username,
	workspaceName: Name,
	workspaceSlug: WorkspaceSlug,
	initialTeamName: Name,
	initialInboxName: Name,
});

export type OwnerSetupRequest = Schema.Schema.Type<typeof OwnerSetupRequestSchema>;
