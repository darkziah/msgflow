import {
	type AuthEnv,
	createAuth,
	createSetupAuth,
	hasAuthEmailSender,
	isValidUsername,
	sendAuthEmail,
} from "@msgflow/auth";
import { drizzle } from "drizzle-orm/d1";
import { requireOwnerAccess } from "./access";

export class OnboardingError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503 = 400,
	) {
		super(message);
	}
}
export type VerificationDelivery =
	| "pending_sender_configuration"
	| "verification_sent"
	| "verification_delivery_failed";

export async function requestAccountVerification(
	env: AuthEnv,
	email: string,
	callbackURL = "/login",
): Promise<VerificationDelivery> {
	if (!hasAuthEmailSender(env)) return "pending_sender_configuration";
	try {
		await createAuth(env).api.sendVerificationEmail({
			body: { email, callbackURL },
		});
		return "verification_sent";
	} catch {
		return "verification_delivery_failed";
	}
}

async function hashToken(token: string) {
	if (!/^[a-f0-9]{64}$/.test(token))
		throw new OnboardingError("Invalid invitation", 400);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export async function previewAgentInvitation(env: AuthEnv, token: string) {
	const invitation =
		await env.DB.prepare(`SELECT invitation.email, invitation.expires_at, workspace.name AS workspace_name
	FROM agent_invitations invitation JOIN workspaces workspace ON workspace.id=invitation.workspace_id
	WHERE invitation.token_hash=? AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL AND invitation.expires_at>?`)
			.bind(await hashToken(token), Date.now())
			.first<{ email: string; expires_at: number; workspace_name: string }>();
	if (!invitation)
		throw new OnboardingError("Invitation is invalid or expired", 404);
	const [local = "", domain = ""] = invitation.email.split("@");
	if (!local || !domain) throw new OnboardingError("Invitation is invalid or expired", 404);
	return {
		workspaceName: invitation.workspace_name,
		email: `${local.slice(0, 1)}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`,
		expiresAt: invitation.expires_at,
		state: "active" as const,
	};
}

export async function createAgentInvitation(
	env: AuthEnv,
	actorId: string,
	workspaceId: string,
	rawEmail: string,
) {
	try {
		await requireOwnerAccess(drizzle(env.DB), workspaceId, actorId);
	} catch {
		throw new OnboardingError(
			"A verified Workspace Owner or Administrator is required",
			403,
		);
	}
	const email = rawEmail.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new OnboardingError("Invalid recovery email");
	if (!env.BETTER_AUTH_URL)
		throw new OnboardingError(
			"Configure BETTER_AUTH_URL before inviting agents",
			503,
		);
	const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const id = crypto.randomUUID();
	const now = Date.now();
	const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
	await env.DB.prepare(
		`UPDATE agent_invitations SET revoked_at=?
	 WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=?`,
	)
		.bind(now, now)
		.run();
	try {
		await env.DB.prepare(
			`INSERT INTO agent_invitations (id,token_hash,workspace_id,email,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?)`,
		)
			.bind(
				id,
				await hashToken(token),
				workspaceId,
				email,
				actorId,
				expiresAt,
				now,
			)
			.run();
	} catch {
		throw new OnboardingError(
			"An active invitation already exists for this email in this workspace",
			409,
		);
	}
	const url = new URL("/login", env.BETTER_AUTH_URL);
	url.searchParams.set("invite", token);
	let delivery: "pending_sender_configuration" | "email_sent" | "email_delivery_failed" =
		"pending_sender_configuration";
	if (hasAuthEmailSender(env)) {
		try {
			await sendAuthEmail(
				env,
				email,
				"Your MsgFlow workspace invitation",
				url.href,
			);
			delivery = "email_sent";
		} catch {
			delivery = "email_delivery_failed";
		}
	}
	return {
		id,
		email,
		workspaceId,
		expiresAt,
		delivery,
	};
}

/**
 * Removes an unclaimed invitation, or an account that was created from it but
 * has not verified email or joined any Workspace. A claimed account that has
 * progressed further must be handled through normal Workspace offboarding.
 */
export async function deleteAgentInvitation(
	env: AuthEnv,
	actorId: string,
	workspaceId: string,
	invitationId: string,
) {
	try {
		await requireOwnerAccess(drizzle(env.DB), workspaceId, actorId);
	} catch {
		throw new OnboardingError(
			"A verified Workspace Owner or Administrator is required",
			403,
		);
	}
	const invitation = await env.DB.prepare(
		`SELECT invitation.user_id AS user_id, user.email_verified AS email_verified
		 FROM agent_invitations invitation
		 LEFT JOIN user ON user.id=invitation.user_id
		 WHERE invitation.id=? AND invitation.workspace_id=? AND invitation.accepted_at IS NULL`,
	)
		.bind(invitationId, workspaceId)
		.first<{ user_id: string | null; email_verified: number | null }>();
	if (!invitation)
		throw new OnboardingError("Invitation is accepted or unavailable", 409);

	if (!invitation.user_id) {
		const result = await env.DB.prepare(
			`DELETE FROM agent_invitations
			 WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND claimed_at IS NULL AND user_id IS NULL
			 RETURNING id`,
		)
			.bind(invitationId, workspaceId)
			.first<{ id: string }>();
		if (!result)
			throw new OnboardingError("Invitation is claimed or unavailable", 409);
		return { id: result.id };
	}

	if (invitation.email_verified) {
		throw new OnboardingError(
			"Account is verified and must be offboarded from its workspace",
			409,
		);
	}
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE agent_invitations SET user_id=NULL WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND user_id=?",
		).bind(invitationId, workspaceId, invitation.user_id),
		env.DB.prepare(
			"DELETE FROM user WHERE id=? AND email_verified=0 AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id=?)",
		).bind(invitation.user_id, invitation.user_id),
		env.DB.prepare(
			"DELETE FROM agent_invitations WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND user_id IS NULL",
		).bind(invitationId, workspaceId),
	]);
	const remaining = await env.DB.prepare(
		"SELECT (SELECT count(*) FROM user WHERE id=?) AS users, (SELECT count(*) FROM agent_invitations WHERE id=? AND workspace_id=?) AS invitations",
	)
		.bind(invitation.user_id, invitationId, workspaceId)
		.first<{ users: number; invitations: number }>();
	if (remaining?.users !== 0 || remaining?.invitations !== 0)
		throw new OnboardingError(
			"Account is no longer eligible for deletion",
			409,
		);
	return { id: invitationId };
}

/** Reissues an unclaimed active invitation because the original capability is not recoverable. */
export async function resendAgentInvitation(
	env: AuthEnv,
	actorId: string,
	workspaceId: string,
	invitationId: string,
) {
	try {
		await requireOwnerAccess(drizzle(env.DB), workspaceId, actorId);
	} catch {
		throw new OnboardingError(
			"A verified Workspace Owner or Administrator is required",
			403,
		);
	}
	const invitation = await env.DB.prepare(
		`SELECT email FROM agent_invitations
 WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND claimed_at IS NULL AND user_id IS NULL AND revoked_at IS NULL AND expires_at>?`,
	)
		.bind(invitationId, workspaceId, Date.now())
		.first<{ email: string }>();
	if (!invitation)
		throw new OnboardingError(
			"Invitation is claimed, expired, or unavailable",
			409,
		);
	if (!env.BETTER_AUTH_URL)
		throw new OnboardingError(
			"Configure BETTER_AUTH_URL before inviting agents",
			503,
		);
	const now = Date.now();
	const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
	const replaced = await env.DB.prepare(
		`UPDATE agent_invitations SET token_hash=?, expires_at=?, invited_by=?, created_at=?
		 WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND claimed_at IS NULL AND user_id IS NULL AND revoked_at IS NULL AND expires_at>?
		 RETURNING id,email,workspace_id`,
	)
		.bind(await hashToken(token), expiresAt, actorId, now, invitationId, workspaceId, now)
		.first<{ id: string; email: string; workspace_id: string }>();
	if (!replaced)
		throw new OnboardingError("Invitation is claimed, expired, or unavailable", 409);
	const url = new URL("/login", env.BETTER_AUTH_URL);
	url.searchParams.set("invite", token);
	let delivery: "pending_sender_configuration" | "email_sent" | "email_delivery_failed" = "pending_sender_configuration";
	if (hasAuthEmailSender(env)) {
		try {
			await sendAuthEmail(env, replaced.email, "Your MsgFlow workspace invitation", url.href);
			delivery = "email_sent";
		} catch {
			delivery = "email_delivery_failed";
		}
	}
	return { id: replaced.id, email: replaced.email, workspaceId: replaced.workspace_id, expiresAt, delivery };
}

/** Reserves the capability before credential creation. Never accepts caller email/workspace/role. */
export async function registerInvitedAgent(
	env: AuthEnv,
	token: string,
	username: string,
	password: string,
) {
	if (password.length < 8 || password.length > 128)
		throw new OnboardingError("Password must contain 8–128 characters");
	if (!isValidUsername(username))
		throw new OnboardingError("Invalid username");
	const hash = await hashToken(token);
	const invite = await env.DB.prepare(
		`SELECT email FROM agent_invitations WHERE token_hash=? AND claimed_at IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
	)
		.bind(hash, Date.now())
		.first<{ email: string }>();
	if (!invite)
		throw new OnboardingError("Invitation expired or already claimed", 409);
	// Existing accounts must sign in and use accept; never reset their credentials through an invite.
	if (
		await env.DB.prepare("SELECT id FROM user WHERE lower(email)=?")
			.bind(invite.email)
			.first()
	)
		throw new OnboardingError(
			"Account already exists. Sign in, verify your email, then accept this invitation",
			409,
		);
	const claim = await env.DB.prepare(
		`UPDATE agent_invitations SET claimed_at=? WHERE token_hash=? AND claimed_at IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
	)
		.bind(Date.now(), hash, Date.now())
		.run();
	if (claim.meta.changes !== 1)
		throw new OnboardingError("Invitation already claimed", 409);
	let userId: string;
	try {
		const result = await createSetupAuth(env).api.signUpEmail({
			body: { email: invite.email, name: username, username, password },
		});
		userId = result.user.id;
		// Better Auth intentionally returns a synthetic user for duplicate signup. Do not trust it.
		const actual = await env.DB.prepare(
			"SELECT id FROM user WHERE id=? AND lower(email)=?",
		)
			.bind(userId, invite.email)
			.first();
		if (!actual) throw new Error("Account creation did not complete");
		await env.DB.prepare(
			"UPDATE agent_invitations SET user_id=? WHERE token_hash=?",
		)
			.bind(userId, hash)
			.run();
	} catch {
		// Credential creation spans Better Auth writes: retain the claim on ambiguous failure.
		throw new OnboardingError(
			"Account creation could not finish. Sign in if your account exists, or ask the owner for a new invitation",
			409,
		);
	}
	await acceptAgentInvitation(env, token, userId);
	return { membership: "joined" as const };
}

/** Trigger inserts membership in the same SQLite transaction as single-use acceptance. */
export async function acceptAgentInvitation(
	env: AuthEnv,
	token: string,
	actorId: string,
) {
	const hash = await hashToken(token);
	// The invitation email is the verification factor. Existing accounts can
	// therefore accept after they sign in, without a separate email loop.
	await env.DB.prepare(
		`UPDATE user SET email_verified=1 WHERE id=?
		 AND EXISTS (SELECT 1 FROM agent_invitations WHERE token_hash=?
			AND lower(email)=lower(user.email) AND accepted_at IS NULL
			AND revoked_at IS NULL AND expires_at>?)`,
	)
		.bind(actorId, hash, Date.now())
		.run();
	const result =
		await env.DB.prepare(`UPDATE agent_invitations SET user_id=?, accepted_at=?
 WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?
 AND (user_id IS NULL OR user_id=?)
 AND EXISTS (SELECT 1 FROM user WHERE id=? AND lower(email)=agent_invitations.email AND email_verified=1)
 AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=agent_invitations.workspace_id AND user_id=?)
 RETURNING workspace_id`)
			.bind(
				actorId,
				Date.now(),
				hash,
				Date.now(),
				actorId,
				actorId,
				actorId,
			)
			.first<{ workspace_id: string }>();
	if (!result)
		throw new OnboardingError(
			"Invitation expired, revoked, consumed, or account email is not verified/matching",
			403,
		);
	return { workspaceId: result.workspace_id };
}
