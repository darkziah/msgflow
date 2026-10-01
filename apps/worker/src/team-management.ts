import type { AuthEnv } from "@msgflow/auth";
import type {
	TeamManagementSummary,
	TeamMemberSummary,
} from "@msgflow/contracts";
import {
	agentInvitations,
	inboxMembers,
	inboxes,
	mailboxes,
	teamMembers,
	teams,
	user,
	workspaceMembers,
} from "@msgflow/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { requireWorkspaceAccess } from "./access";
import { ManageError } from "./errors";

type WorkspaceRole = "owner" | "admin" | "member";

/** Compatibility wrapper for the existing GET route. */
export async function listWorkspaceTeam(
	env: AuthEnv,
	actorId: string,
	workspaceId: string,
): Promise<TeamManagementSummary> {
	return getTeamManagement(env, workspaceId, actorId);
}

/** Explicit workspace-scoped team read model; it never exposes private content. */
export async function getTeamManagement(
	env: AuthEnv,
	workspaceId: string,
	actorId: string,
): Promise<TeamManagementSummary> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, actorId);
	const members = await db
		.select({
			id: user.id,
			name: user.name,
			username: user.username,
			email: user.email,
			emailVerified: user.emailVerified,
			role: workspaceMembers.role,
			joinedAt: workspaceMembers.createdAt,
		})
		.from(workspaceMembers)
		.innerJoin(user, eq(workspaceMembers.userId, user.id))
		.where(eq(workspaceMembers.workspaceId, workspaceId))
		.orderBy(asc(workspaceMembers.createdAt), asc(user.id))
		.all();
	const memberIds = members.map((member) => member.id);
	const [teamRows, privateMailboxRows] = await Promise.all([
		memberIds.length === 0
			? Promise.resolve([])
			: db
					.select({
						userId: teamMembers.userId,
						teamId: teams.id,
						name: teams.name,
					})
					.from(teamMembers)
					.innerJoin(teams, eq(teamMembers.teamId, teams.id))
					.where(
						and(
							eq(teams.workspaceId, workspaceId),
							inArray(teamMembers.userId, memberIds),
						),
					)
					.orderBy(asc(teams.name), asc(teams.id))
					.all(),
		memberIds.length === 0
			? Promise.resolve([])
			: db
					.select({
						ownerUserId: mailboxes.ownerUserId,
						canonicalAddress: mailboxes.canonicalAddress,
						isEnabled: mailboxes.isEnabled,
						isSendEnabled: mailboxes.isSendEnabled,
					})
					.from(mailboxes)
					.where(
						and(
							eq(mailboxes.workspaceId, workspaceId),
							eq(mailboxes.type, "private"),
							inArray(mailboxes.ownerUserId, memberIds),
						),
					)
					.orderBy(asc(mailboxes.canonicalAddress))
					.all(),
	]);
	const teamNamesByUserId = new Map<string, string[]>();
	const teamIdsByUserId = new Map<string, string[]>();
	for (const row of teamRows) {
		teamNamesByUserId.set(row.userId, [
			...(teamNamesByUserId.get(row.userId) ?? []),
			row.name,
		]);
		teamIdsByUserId.set(row.userId, [
			...(teamIdsByUserId.get(row.userId) ?? []),
			row.teamId,
		]);
	}
	const directGrantRows =
		memberIds.length === 0
			? []
			: await db
					.select({
						userId: inboxMembers.userId,
						inboxId: inboxMembers.inboxId,
					})
					.from(inboxMembers)
					.innerJoin(inboxes, eq(inboxMembers.inboxId, inboxes.id))
					.where(
						and(
							eq(inboxes.workspaceId, workspaceId),
							eq(inboxes.visibilityType, "shared"),
							inArray(inboxMembers.userId, memberIds),
						),
					)
					.all();
	const directInboxIdsByUserId = new Map<string, string[]>();
	for (const row of directGrantRows)
		directInboxIdsByUserId.set(row.userId, [
			...(directInboxIdsByUserId.get(row.userId) ?? []),
			row.inboxId,
		]);
	const canManage = access.isAdmin;
	const accessOptions = canManage
		? await Promise.all([
				db
					.select({ id: teams.id, name: teams.name })
					.from(teams)
					.where(eq(teams.workspaceId, workspaceId))
					.orderBy(asc(teams.name), asc(teams.id))
					.all(),
				db
					.select({ id: inboxes.id, name: inboxes.name })
					.from(inboxes)
					.where(
						and(
							eq(inboxes.workspaceId, workspaceId),
							eq(inboxes.visibilityType, "shared"),
							eq(inboxes.isArchived, false),
						),
					)
					.orderBy(asc(inboxes.name), asc(inboxes.id))
					.all(),
			])
		: ([[], []] as [
				Array<{ id: string; name: string }>,
				Array<{ id: string; name: string }>,
			]);
	const privateMailboxesByUserId = new Map<
		string,
		TeamMemberSummary["privateMailboxes"]
	>();
	for (const row of privateMailboxRows) {
		if (row.ownerUserId)
			privateMailboxesByUserId.set(row.ownerUserId, [
				...(privateMailboxesByUserId.get(row.ownerUserId) ?? []),
				{
					canonicalAddress: row.canonicalAddress,
					isEnabled: row.isEnabled,
					isSendEnabled: row.isSendEnabled,
				},
			]);
	}
	const ownerCount = members.filter((member) => member.role === "owner").length;
	const invitations = canManage
		? await db
				.select({
					id: agentInvitations.id,
					email: agentInvitations.email,
					username: agentInvitations.reservedUsername,
					invitedByName: user.name,
					createdAt: agentInvitations.createdAt,
					expiresAt: agentInvitations.expiresAt,
					revokedAt: agentInvitations.revokedAt,
					claimedAt: agentInvitations.claimedAt,
					acceptedAt: agentInvitations.acceptedAt,
					userId: agentInvitations.userId,
				})
				.from(agentInvitations)
				.innerJoin(user, eq(agentInvitations.invitedBy, user.id))
				.where(
					and(
						eq(agentInvitations.workspaceId, workspaceId),
						isNull(agentInvitations.acceptedAt),
					),
				)
				.orderBy(asc(agentInvitations.createdAt), asc(agentInvitations.id))
				.all()
		: [];
	const inviteeIds = invitations.flatMap((invitation) =>
		invitation.userId ? [invitation.userId] : [],
	);
	const inviteeRows =
		inviteeIds.length === 0
			? []
			: await db
					.select({ id: user.id, emailVerified: user.emailVerified })
					.from(user)
					.where(inArray(user.id, inviteeIds))
					.all();
	const inviteeVerification = new Map(
		inviteeRows.map((invitee) => [invitee.id, invitee.emailVerified]),
	);
	const now = Date.now();
	return {
		canManage,
		canManageOwners: access.role === "owner",
		accessOptions: {
			teams: accessOptions[0],
			directGrantInboxes: accessOptions[1],
		},
		members: members.map((member) => ({
			...member,
			teamNames: teamNamesByUserId.get(member.id) ?? [],
			teamIds: teamIdsByUserId.get(member.id) ?? [],
			directInboxIds: directInboxIdsByUserId.get(member.id) ?? [],
			privateMailboxes: privateMailboxesByUserId.get(member.id) ?? [],
			canChangeRole: access.role === "owner",
			canRemove:
				member.id !== actorId &&
				(access.role === "owner" ||
					(access.role === "admin" && member.role === "member")) &&
				(member.role !== "owner" || ownerCount > 1),
		})),
		invitations: invitations.map((invitation) => {
			const lifecycle =
				invitation.revokedAt !== null
					? "revoked"
					: invitation.expiresAt <= now
						? "expired"
						: invitation.userId && !inviteeVerification.get(invitation.userId)
							? "awaiting_email_verification"
							: "awaiting_activation";
			return {
				id: invitation.id,
				email: invitation.email,
				username: invitation.username,
				invitedByName: invitation.invitedByName,
				createdAt: invitation.createdAt,
				expiresAt: invitation.expiresAt,
				lifecycle,
				canDelete:
					access.isAdmin &&
					invitation.acceptedAt === null &&
					((invitation.userId === null && invitation.claimedAt === null) ||
						lifecycle === "awaiting_email_verification"),
				canResend:
					access.isAdmin &&
					invitation.userId === null &&
					invitation.claimedAt === null &&
					invitation.acceptedAt === null &&
					lifecycle === "awaiting_activation",
			};
		}),
	};
}

/** Replaces Team memberships and direct grants for shared Inbox visibility. */
export async function updateWorkspaceMemberAccess(
	env: AuthEnv,
	workspaceId: string,
	actorId: string,
	targetUserId: string,
	input: { teamIds: readonly string[]; inboxIds: readonly string[] },
): Promise<{ member: TeamMemberSummary }> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, actorId);
	if (!access.isAdmin)
		throw new ManageError(
			"workspace owner or administrator role is required for this action",
			403,
		);
	if (!(await findMember(db, workspaceId, targetUserId)))
		throw new ManageError("workspace member not found", 404);
	const teamIds = [...new Set(input.teamIds)];
	const inboxIds = [...new Set(input.inboxIds)];
	const [validTeams, validInboxes] = await Promise.all([
		teamIds.length
			? db
					.select({ id: teams.id })
					.from(teams)
					.where(
						and(eq(teams.workspaceId, workspaceId), inArray(teams.id, teamIds)),
					)
					.all()
			: [],
		inboxIds.length
			? db
					.select({ id: inboxes.id })
					.from(inboxes)
					.where(
						and(
							eq(inboxes.workspaceId, workspaceId),
							eq(inboxes.visibilityType, "shared"),
							eq(inboxes.isArchived, false),
							inArray(inboxes.id, inboxIds),
						),
					)
					.all()
			: [],
	]);
	if (validTeams.length !== teamIds.length)
		throw new ManageError(
			"one or more teams do not belong to this workspace",
			404,
		);
	if (validInboxes.length !== inboxIds.length)
		throw new ManageError("one or more shared inboxes are unavailable", 404);
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(
			"DELETE FROM team_members WHERE user_id=? AND team_id IN (SELECT id FROM teams WHERE workspace_id=?)",
		).bind(targetUserId, workspaceId),
		env.DB.prepare(
			"DELETE FROM inbox_members WHERE user_id=? AND inbox_id IN (SELECT id FROM inboxes WHERE workspace_id=? AND visibility_type='shared')",
		).bind(targetUserId, workspaceId),
		...teamIds.map((teamId) =>
			env.DB.prepare(
				"INSERT INTO team_members (id,team_id,user_id,role,created_at) VALUES (?,?,?,?,?)",
			).bind(crypto.randomUUID(), teamId, targetUserId, "member", now),
		),
		...inboxIds.map((inboxId) =>
			env.DB.prepare(
				"INSERT INTO inbox_members (id,inbox_id,user_id) VALUES (?,?,?)",
			).bind(crypto.randomUUID(), inboxId, targetUserId),
		),
	]);
	const member = (
		await getTeamManagement(env, workspaceId, actorId)
	).members.find((row) => row.id === targetUserId);
	if (!member) throw new ManageError("workspace member not found", 404);
	return { member };
}

export async function updateWorkspaceMemberRole(
	env: AuthEnv,
	workspaceId: string,
	actorId: string,
	targetUserId: string,
	role: WorkspaceRole,
): Promise<{ member: TeamMemberSummary }> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, actorId);
	const target = await findMember(db, workspaceId, targetUserId);
	if (!target) throw new ManageError("workspace member not found", 404);
	if (access.role !== "owner")
		throw new ManageError(
			"workspace owner role is required for this action",
			403,
		);
	if (target.role === "owner" && role !== "owner") {
		const owners = await countOwners(db, workspaceId);
		if (owners <= 1)
			throw new ManageError("a workspace must retain at least one owner", 409);
	}
	try {
		await env.DB.prepare(
			"UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?",
		)
			.bind(role, workspaceId, targetUserId)
			.run();
	} catch (error) {
		throwFinalOwnerInvariant(error);
		throw error;
	}
	const member = (
		await getTeamManagement(env, workspaceId, actorId)
	).members.find((row) => row.id === targetUserId);
	if (!member) throw new ManageError("workspace member not found", 404);
	return { member };
}

export async function offboardWorkspaceMember(
	env: AuthEnv,
	workspaceId: string,
	actorId: string,
	targetUserId: string,
	confirmation: string,
): Promise<{ success: true }> {
	const db = drizzle(env.DB);
	const access = await requireWorkspaceAccess(db, workspaceId, actorId);
	const target = await findMember(db, workspaceId, targetUserId);
	if (!target) throw new ManageError("workspace member not found", 404);
	if (targetUserId === actorId)
		throw new ManageError("you cannot remove yourself from a workspace", 409);
	if (
		access.role === "member" ||
		(access.role === "admin" && target.role !== "member")
	) {
		throw new ManageError(
			"insufficient role to remove this workspace member",
			403,
		);
	}
	if (target.role === "owner" && (await countOwners(db, workspaceId)) <= 1) {
		throw new ManageError("a workspace must retain at least one owner", 409);
	}
	const confirmationIdentifier = target.username ?? target.email.toLowerCase();
	if (confirmation !== confirmationIdentifier)
		throw new ManageError("confirmation does not match the target member", 400);
	const privateMailboxes = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(
			and(
				eq(mailboxes.workspaceId, workspaceId),
				eq(mailboxes.type, "private"),
				eq(mailboxes.ownerUserId, targetUserId),
			),
		)
		.all();
	const now = new Date().toISOString();
	try {
		await env.DB.batch([
			env.DB.prepare(
				"DELETE FROM team_members WHERE user_id=? AND team_id IN (SELECT id FROM teams WHERE workspace_id=?)",
			).bind(targetUserId, workspaceId),
			env.DB.prepare(
				"DELETE FROM inbox_members WHERE user_id=? AND inbox_id IN (SELECT id FROM inboxes WHERE workspace_id=?)",
			).bind(targetUserId, workspaceId),
			env.DB.prepare(
				"DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
			).bind(workspaceId, targetUserId),
			env.DB.prepare(
				"UPDATE mailboxes SET is_enabled=0, is_send_enabled=0, updated_at=? WHERE workspace_id=? AND type='private' AND owner_user_id=?",
			).bind(now, workspaceId, targetUserId),
			env.DB.prepare(
				"INSERT INTO workspace_member_offboardings (id,workspace_id,user_id,actor_user_id,prior_role,confirmation_identifier,private_mailboxes_disabled,created_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				crypto.randomUUID(),
				workspaceId,
				targetUserId,
				actorId,
				target.role,
				confirmationIdentifier,
				privateMailboxes.length,
				now,
			),
		]);
	} catch (error) {
		throwFinalOwnerInvariant(error);
		throw error;
	}
	return { success: true };
}

async function findMember(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
) {
	return db
		.select({
			role: workspaceMembers.role,
			username: user.username,
			email: user.email,
		})
		.from(workspaceMembers)
		.innerJoin(user, eq(workspaceMembers.userId, user.id))
		.where(
			and(
				eq(workspaceMembers.workspaceId, workspaceId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.get();
}
async function countOwners(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
) {
	return (
		await db
			.select({ id: workspaceMembers.id })
			.from(workspaceMembers)
			.where(
				and(
					eq(workspaceMembers.workspaceId, workspaceId),
					eq(workspaceMembers.role, "owner"),
				),
			)
			.all()
	).length;
}

/** SQLite triggers close the final-owner race between validation and mutation. */
function throwFinalOwnerInvariant(error: unknown): void {
	if (
		error instanceof Error &&
		error.message.includes("a workspace must retain at least one owner")
	) {
		throw new ManageError("a workspace must retain at least one owner", 409);
	}
}
