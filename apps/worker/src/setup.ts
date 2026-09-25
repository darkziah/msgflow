import { createSetupAuth, isValidUsername } from "@msgflow/auth";
import type { OwnerSetupRequest } from "@msgflow/contracts";
import {
	requestAccountVerification,
	type VerificationDelivery,
} from "./agent-onboarding";
import { RESERVED_PRIVATE_LOCAL_PARTS } from "./email-address";
import type { Env } from "./env";

export class OwnerSetupError extends Error {
	public readonly status: 400 | 409 | 500;

	constructor(message: string, status: 400 | 409 | 500 = 400) {
		super(message);
		this.status = status;
	}
}

function isConcurrentClaimFailure(cause: unknown): boolean {
	const message =
		cause instanceof Error
			? cause.message.toLowerCase()
			: String(cause).toLowerCase();
	return (
		message.includes("database is locked") ||
		message.includes("sqlite_busy") ||
		message.includes("constraint failed")
	);
}

export interface OwnerSetupResult {
	workspaceId: string;
	teamId: string;
	inboxId: string;
	userId: string;
	verification: VerificationDelivery;
}

/**
 * Claims first use before asking Better Auth to create credentials. The claim is
 * permanent: it serializes the one permitted owner creation and leaves an audit
 * marker rather than falling back to legacy lazy ownership.
 */
export async function setupInitialOwner(
	env: Env,
	input: OwnerSetupRequest,
): Promise<OwnerSetupResult> {
	if (
		!isValidUsername(input.username) ||
		RESERVED_PRIVATE_LOCAL_PARTS.has(input.username)
	) {
		throw new OwnerSetupError(
			"username is reserved for operational or shared use",
			400,
		);
	}

	const now = new Date().toISOString();
	const email = input.email.toLowerCase();
	try {
		const claimed = await env.DB.prepare(
			`INSERT INTO workspace_setup_claim (id, email, claimed_at)
			 SELECT 1, ?, ?
			 WHERE NOT EXISTS (SELECT 1 FROM workspaces)
			   AND NOT EXISTS (SELECT 1 FROM workspace_members)
			 ON CONFLICT(id) DO NOTHING`,
		)
			.bind(email, now)
			.run();
		if ((claimed.meta.changes ?? 0) !== 1) {
			throw new OwnerSetupError(
				"initial workspace setup has already been claimed",
				409,
			);
		}
	} catch (cause) {
		if (cause instanceof OwnerSetupError) throw cause;
		// SQLite/D1 can surface a competing singleton insert as a lock rather than
		// an ON CONFLICT result. Fail closed before Better Auth is called, so the
		// losing contender never creates an account outside the durable claim.
		if (isConcurrentClaimFailure(cause)) {
			throw new OwnerSetupError(
				"initial workspace setup has already been claimed",
				409,
			);
		}
		throw new OwnerSetupError("unable to claim initial workspace setup", 500);
	}

	let userId: string;
	try {
		// Better Auth's documented server API performs its own password hashing and
		// credential-account creation. This instance is never mounted as a handler.
		const created = await createSetupAuth(env).api.signUpEmail({
			body: {
				name: input.username,
				email,
				password: input.password,
				username: input.username,
				rememberMe: false,
			},
		});
		userId = created.user.id;
		if (
			!(await env.DB.prepare("SELECT id FROM user WHERE id=? AND email=?")
				.bind(userId, email)
				.first())
		) {
			throw new Error(
				"An account already exists for this email; operator setup is required",
			);
		}
	} catch (cause) {
		// D1 cannot wrap Better Auth's separate writes. Retain the claim if an
		// account exists after an ambiguous failure; never let another owner seize it.
		await env.DB.prepare(
			"DELETE FROM workspace_setup_claim WHERE id = 1 AND email = ? AND NOT EXISTS (SELECT 1 FROM user WHERE email = ?)",
		)
			.bind(email, email)
			.run();
		throw new OwnerSetupError(
			cause instanceof Error ? cause.message : "unable to create owner account",
			400,
		);
	}

	const workspaceId = crypto.randomUUID();
	const teamId = crypto.randomUUID();
	const inboxId = crypto.randomUUID();
	try {
		// D1 batch is transactional: no partially configured workspace can become
		// visible. If D1 fails, the retained claim + account make the failure
		// inspectable rather than allowing another caller to seize ownership.
		await env.DB.batch([
			env.DB.prepare(
				"UPDATE workspace_setup_claim SET user_id = ? WHERE id = 1",
			).bind(userId),
			env.DB.prepare(
				"INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			).bind(workspaceId, input.workspaceName, input.workspaceSlug, now, now),
			env.DB.prepare(
				"INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
			).bind(crypto.randomUUID(), workspaceId, userId, now),
			env.DB.prepare(
				"INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
			).bind(teamId, workspaceId, input.initialTeamName, now),
			env.DB.prepare(
				"INSERT INTO team_members (id, team_id, user_id, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
			).bind(crypto.randomUUID(), teamId, userId, now),
			env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, team_id, name, color, sort_order, is_archived, assignment_strategy, created_at) VALUES (?, ?, ?, ?, '#64748B', 0, 0, 'manual', ?)",
			).bind(inboxId, workspaceId, teamId, input.initialInboxName, now),
			env.DB.prepare(
				"INSERT INTO inbox_members (id, inbox_id, user_id) VALUES (?, ?, ?)",
			).bind(crypto.randomUUID(), inboxId, userId),
			env.DB.prepare(
				"UPDATE workspace_setup_claim SET workspace_id = ?, completed_at = ? WHERE id = 1",
			).bind(workspaceId, now),
		]);
	} catch (_cause) {
		throw new OwnerSetupError(
			"owner account was created but workspace setup could not finish; operator recovery is required",
			500,
		);
	}

	return {
		workspaceId,
		teamId,
		inboxId,
		userId,
		verification: await requestAccountVerification(env, email),
	};
}
