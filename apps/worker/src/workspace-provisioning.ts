import type { WorkspaceCreateRequest } from "@msgflow/contracts";
import type { Env } from "./env";

export interface ProvisionedWorkspace {
	workspaceId: string;
	teamId: string;
	inboxId: string;
	createdAt: string;
}

export interface ProvisionWorkspaceOptions {
	afterStatements?: (
		provisioned: ProvisionedWorkspace,
	) => D1PreparedStatement[];
}

/**
 * Creates the minimal independent tenant graph in one D1 transaction. It is
 * shared by first-use setup and later Owner-led Workspace creation.
 */
export async function provisionWorkspace(
	env: Env,
	actorUserId: string,
	input: WorkspaceCreateRequest,
	options: ProvisionWorkspaceOptions = {},
): Promise<ProvisionedWorkspace> {
	const workspaceId = crypto.randomUUID();
	const teamId = crypto.randomUUID();
	const inboxId = crypto.randomUUID();
	const now = new Date().toISOString();

	const statements = [
		env.DB.prepare(
			"INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		).bind(workspaceId, input.workspaceName, input.workspaceSlug, now, now),
		env.DB.prepare(
			"INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
		).bind(crypto.randomUUID(), workspaceId, actorUserId, now),
		env.DB.prepare(
			"INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
		).bind(teamId, workspaceId, input.initialTeamName, now),
		env.DB.prepare(
			"INSERT INTO team_members (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
		).bind(crypto.randomUUID(), teamId, actorUserId, now),
		env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, team_id, name, color, sort_order, is_archived, assignment_strategy, created_at) VALUES (?, ?, ?, ?, '#64748B', 0, 0, 'manual', ?)",
		).bind(inboxId, workspaceId, teamId, input.initialInboxName, now),
		env.DB.prepare(
			"INSERT INTO inbox_members (id, inbox_id, user_id) VALUES (?, ?, ?)",
		).bind(crypto.randomUUID(), inboxId, actorUserId),
		...(options.afterStatements?.({
			workspaceId,
			teamId,
			inboxId,
			createdAt: now,
		}) ?? []),
	];
	await env.DB.batch(statements);

	return { workspaceId, teamId, inboxId, createdAt: now };
}
