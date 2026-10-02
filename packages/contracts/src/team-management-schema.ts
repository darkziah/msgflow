import { Schema } from "effect";

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const Role = Schema.Literal("owner", "admin", "member");

export const UpdateWorkspaceMemberRoleRequestSchema = Schema.Struct({
	role: Role,
});
export type UpdateWorkspaceMemberRoleRequest = Schema.Schema.Type<
	typeof UpdateWorkspaceMemberRoleRequestSchema
>;

/** Replaces the member's workspace-scoped Team and direct shared-Inbox grants. */
export const UpdateWorkspaceMemberAccessRequestSchema = Schema.Struct({
	teamIds: Schema.Array(Id).pipe(Schema.maxItems(100)),
	inboxIds: Schema.Array(Id).pipe(Schema.maxItems(100)),
});
export type UpdateWorkspaceMemberAccessRequest = Schema.Schema.Type<
	typeof UpdateWorkspaceMemberAccessRequestSchema
>;

export const OffboardWorkspaceMemberRequestSchema = Schema.Struct({
	confirmation: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(254)),
});
export type OffboardWorkspaceMemberRequest = Schema.Schema.Type<
	typeof OffboardWorkspaceMemberRequestSchema
>;

export interface TeamMemberSummary {
	id: string;
	name: string;
	username: string | null;
	email: string;
	emailVerified: boolean;
	role: "owner" | "admin" | "member";
	joinedAt: string;
	teamIds: string[];
	teamNames: string[];
	directInboxIds: string[];
	privateMailboxes: Array<{
		canonicalAddress: string;
		isEnabled: boolean;
		isSendEnabled: boolean;
	}>;
	canChangeRole: boolean;
	canRemove: boolean;
}

export type InvitationLifecycle =
	| "awaiting_activation"
	| "awaiting_email_verification"
	| "expired"
	| "revoked";

export interface TeamInvitationSummary {
	id: string;
	email: string;
	username: string | null;
	invitedByName: string;
	createdAt: number;
	expiresAt: number;
	lifecycle: InvitationLifecycle;
	canDelete: boolean;
	canResend: boolean;
}

export interface TeamManagementSummary {
	canManage: boolean;
	canManageOwners: boolean;
	accessOptions: {
		teams: Array<{ id: string; name: string }>;
		directGrantInboxes: Array<{ id: string; name: string }>;
	};
	members: TeamMemberSummary[];
	invitations: TeamInvitationSummary[];
}

export { Id as WorkspaceMemberIdSchema };
