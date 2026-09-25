import { and, asc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { workspaceMembers, workspaces } from "@msgflow/db";
import type { WorkspaceSummary } from "@msgflow/contracts";
import { ManageError } from "./errors";

/**
 * Workspace access control for the inbox-routing/sidebar surface.
 *
 * Model (matches the routing spec):
 * - Workspace owners/admins can create, edit, reorder, archive, connect
 *   channels, and configure routing for shared inboxes.
 * - Inbox members can work conversations in an inbox but cannot change its
 *   routing/configuration.
 * - The session user must belong to the requested workspace before any read
 *   or write.
 *
 * Access is always derived from an explicit workspace_members row. Initial
 * ownership is created only by the first-use setup transaction.
 */

export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkspaceAccess {
	workspaceId: string;
	role: WorkspaceRole;
	isAdmin: boolean;
}

export async function getWorkspaceAccess(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<WorkspaceAccess | null> {
	const workspace = await db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
	if (!workspace) return null;

	const membership = await db
		.select({ role: workspaceMembers.role })
		.from(workspaceMembers)
		.where(
			and(
				eq(workspaceMembers.workspaceId, workspaceId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.get();
	if (membership) {
		return {
			workspaceId,
			role: membership.role,
			isAdmin: membership.role === "owner" || membership.role === "admin",
		};
	}
	return null;
}

/** Explicit membership is required for every workspace-scoped route. */
export async function requireWorkspaceAccess(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<WorkspaceAccess> {
	const access = await getWorkspaceAccess(db, workspaceId, userId);
	if (!access) {
		throw new ManageError("you are not a member of this workspace", 403);
	}
	return access;
}

/** Email-domain and mailbox configuration changes require a workspace owner. */
export async function requireOwnerAccess(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<WorkspaceAccess> {
	const access = await requireWorkspaceAccess(db, workspaceId, userId);
	if (access.role !== "owner") {
		throw new ManageError(
			"workspace owner role is required for this action",
			403,
		);
	}
	return access;
}

/** Shared-inbox configuration changes require owner/admin. */
export async function requireAdminAccess(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<WorkspaceAccess> {
	const access = await requireWorkspaceAccess(db, workspaceId, userId);
	if (!access.isAdmin) {
		throw new ManageError(
			"workspace owner or admin role is required for this action",
			403,
		);
	}
	return access;
}

/** Workspaces the user is a member of (sidebar workspace switcher). */
export async function listUserWorkspaces(
	db: ReturnType<typeof drizzle>,
	userId: string,
): Promise<WorkspaceSummary[]> {
	const rows = await db
		.select({
			id: workspaces.id,
			name: workspaces.name,
			slug: workspaces.slug,
			role: workspaceMembers.role,
		})
		.from(workspaceMembers)
		.innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
		.where(eq(workspaceMembers.userId, userId))
		.all();
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		slug: row.slug,
		role: row.role,
	}));
}

/** True when the user is an active member of the workspace (rule assign targets). */
export async function userBelongsToWorkspace(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	userId: string,
): Promise<boolean> {
	const row = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(
			and(
				eq(workspaceMembers.workspaceId, workspaceId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.get();
	return !!row;
}

/** Resolve the legacy default workspace and require membership before access. */
export async function requireDefaultWorkspaceAccess(
	db: ReturnType<typeof drizzle>,
	userId: string,
): Promise<WorkspaceAccess> {
	// Legacy endpoints choose an existing membership, never create a workspace
	// as a read side effect. First-use setup may use a non-default slug.
	const memberships = await db
		.select({ id: workspaces.id, slug: workspaces.slug })
		.from(workspaceMembers)
		.innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
		.where(eq(workspaceMembers.userId, userId))
		.orderBy(asc(workspaces.createdAt), asc(workspaces.id))
		.all();
	const workspace =
		memberships.find((row) => row.slug === "default") ?? memberships[0];
	if (!workspace)
		throw new ManageError("you are not a member of this workspace", 403);
	return requireWorkspaceAccess(db, workspace.id, userId);
}
