import type {
	OffboardWorkspaceMemberRequest,
	TeamInvitationSummary,
	TeamManagementSummary,
	TeamMemberSummary,
	UpdateWorkspaceMemberAccessRequest,
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
		expiresAt: number;
		delivery: "email_sent" | "email_delivery_failed";
	};
};
export type DeleteInvitationResponse = {
	success: true;
	data: { id: string };
};
export type ResendInvitationResponse = InvitationCreateResponse;
export type UpdateMemberRoleResponse = {
	success: true;
	data: { member: TeamMemberSummary };
};
export type UpdateMemberAccessResponse = UpdateMemberRoleResponse;
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
		return request<InvitationCreateResponse>(
			`${workspacePath(workspaceId)}/invitations`,
			{
				method: "POST",
				body: JSON.stringify({ email, username }),
			},
		);
	},
	deleteInvitation(workspaceId: string, invitationId: string) {
		return request<DeleteInvitationResponse>(
			`${workspacePath(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
			{ method: "DELETE" },
		);
	},
	resendInvitation(workspaceId: string, invitationId: string) {
		return request<ResendInvitationResponse>(
			`${workspacePath(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
			{ method: "POST" },
		);
	},
	updateMemberRole(
		workspaceId: string,
		userId: string,
		body: UpdateWorkspaceMemberRoleRequest,
	) {
		return request<UpdateMemberRoleResponse>(
			`${memberPath(workspaceId, userId)}/role`,
			{
				method: "PATCH",
				body: JSON.stringify(body),
			},
		);
	},
	updateMemberAccess(
		workspaceId: string,
		userId: string,
		body: UpdateWorkspaceMemberAccessRequest,
	) {
		return request<UpdateMemberAccessResponse>(
			`${memberPath(workspaceId, userId)}/access`,
			{ method: "PUT", body: JSON.stringify(body) },
		);
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
