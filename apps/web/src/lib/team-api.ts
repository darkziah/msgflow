import type {
	OffboardWorkspaceMemberRequest,
	TeamInvitationSummary,
	TeamManagementSummary,
	TeamMemberSummary,
	UpdateWorkspaceMemberRoleRequest,
} from "@msgflow/contracts";
import { request } from "./api";

const workspacePath = (workspaceId: string) =>
	`/api/workspaces/${encodeURIComponent(workspaceId)}`;
const memberPath = (workspaceId: string, userId: string) =>
	`${workspacePath(workspaceId)}/members/${encodeURIComponent(userId)}`;

export type TeamResponse = { team: TeamManagementSummary };
export type InvitationCreateResponse = {
	success: true;
	data: {
		invitationUrl: string;
		expiresAt: number;
		delivery: "copy_link" | "email_sent" | "email_delivery_failed";
	};
};
export type RevokeInvitationResponse = {
	success: true;
	data: { id: string; cooldownUntil: number };
};
export type UpdateMemberRoleResponse = {
	success: true;
	data: { member: TeamMemberSummary };
};
export type OffboardMemberResponse = {
	success: true;
	data: { success: true };
};

/** Workspace-scoped team transport. Server capability flags authorize the UI. */
export const teamApi = {
	get(workspaceId: string) {
		return request<TeamResponse>(`${workspacePath(workspaceId)}/team`);
	},
	createInvitation(workspaceId: string, email: string, username: string) {
		return request<InvitationCreateResponse>(`${workspacePath(workspaceId)}/invitations`, {
			method: "POST",
			body: JSON.stringify({ email, username }),
		});
	},
	revokeInvitation(workspaceId: string, invitationId: string) {
		return request<RevokeInvitationResponse>(
			`${workspacePath(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
			{ method: "DELETE" },
		);
	},
	updateMemberRole(
		workspaceId: string,
		userId: string,
		body: UpdateWorkspaceMemberRoleRequest,
	) {
		return request<UpdateMemberRoleResponse>(`${memberPath(workspaceId, userId)}/role`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	},
	offboardMember(
		workspaceId: string,
		userId: string,
		body: OffboardWorkspaceMemberRequest,
	) {
		return request<OffboardMemberResponse>(memberPath(workspaceId, userId), {
			method: "DELETE",
			body: JSON.stringify(body),
		});
	},
};

export type { TeamInvitationSummary };
