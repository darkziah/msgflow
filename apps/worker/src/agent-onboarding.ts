import {
	type AuthEnv,
	createAuth,
	createSetupAuth,
	hasAuthEmailSender,
	isValidUsername,
	sendAuthEmail,
} from "@msgflow/auth";
import { drizzle } from "drizzle-orm/d1";
import { RESERVED_PRIVATE_LOCAL_PARTS } from "./email-address";
import { requireOwnerAccess } from "./access";

export class OnboardingError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 401 | 403 | 409 | 503 = 400,
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

export async function createAgentInvitation(
	env: AuthEnv,
	actorId: string,
	workspaceId: string,
	rawEmail: string,
	rawUsername: string,
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
	const username = rawUsername.trim();
	if (!isValidUsername(username) || RESERVED_PRIVATE_LOCAL_PARTS.has(username))
		throw new OnboardingError(
			"Choose a valid, non-reserved immutable username",
		);
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
	const expiresAt = now + 48 * 60 * 60 * 1000;
	await env.DB.prepare(
		`UPDATE agent_invitations SET revoked_at=expires_at, cooldown_until=expires_at+86400000
 WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=?`,
	)
		.bind(now)
		.run();
	const blocked = await env.DB.prepare(
		`SELECT id FROM agent_invitations WHERE accepted_at IS NULL
 AND (lower(email)=? OR reserved_username=?)
 AND (revoked_at IS NULL OR cooldown_until>?) LIMIT 1`,
	)
		.bind(email, username, now)
		.first();
	if (blocked)
		throw new OnboardingError(
			"Recovery email or username is already reserved by an active invitation",
			409,
		);
	try {
		await env.DB.prepare(
			`INSERT INTO agent_invitations (id,token_hash,workspace_id,email,reserved_username,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)`,
		)
		.bind(
			id,
			await hashToken(token),
			workspaceId,
			email,
			username,
			actorId,
			expiresAt,
			now,
		)
		.run();
	} catch {
		throw new OnboardingError(
			"Recovery email or username is already reserved by an active invitation",
			409,
		);
	}
	const url = new URL("/login", env.BETTER_AUTH_URL);
	url.searchParams.set("invite", token);
	let delivery: "copy_link" | "email_sent" | "email_delivery_failed" =
		"copy_link";
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
		username,
		workspaceId,
		expiresAt,
		invitationUrl: url.href,
		delivery,
	};
}

/** Revocation is available only before acceptance; the reservation cools down for one day. */
export async function revokeAgentInvitation(
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
	const now = Date.now();
	const result = await env.DB.prepare(
		`UPDATE agent_invitations SET revoked_at=?, cooldown_until=?
 WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL
 RETURNING id,cooldown_until`,
	)
		.bind(now, now + 24 * 60 * 60 * 1000, invitationId, workspaceId)
		.first<{ id: string; cooldown_until: number }>();
	if (!result)
		throw new OnboardingError("Invitation is already accepted, revoked, or unavailable", 409);
	return { id: result.id, cooldownUntil: result.cooldown_until };
}

/** Reserves the capability before credential creation. Never accepts caller email/workspace/role. */
export async function registerInvitedAgent(
	env: AuthEnv,
	token: string,
	password: string,
) {
	if (password.length < 8 || password.length > 128)
		throw new OnboardingError("Password must contain 8–128 characters");
	const hash = await hashToken(token);
	const invite = await env.DB.prepare(
		`SELECT email,reserved_username FROM agent_invitations WHERE token_hash=? AND claimed_at IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
	)
		.bind(hash, Date.now())
		.first<{ email: string; reserved_username: string }>();
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
			body: { email: invite.email, name: invite.reserved_username, password },
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
	return {
		verification: await requestAccountVerification(
			env,
			invite.email,
			`/login?invite=${token}`,
		),
		membership: "pending_verification" as const,
	};
}

/** Trigger inserts membership in the same SQLite transaction as single-use acceptance. */
export async function acceptAgentInvitation(
	env: AuthEnv,
	token: string,
	actorId: string,
) {
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
				await hashToken(token),
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
