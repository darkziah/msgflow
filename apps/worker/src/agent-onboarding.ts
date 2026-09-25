import {
	type AuthEnv,
	createAuth,
	createSetupAuth,
	hasAuthEmailSender,
	isValidUsername,
	sendAuthEmail,
} from "@msgflow/auth";
import { RESERVED_PRIVATE_LOCAL_PARTS } from "./email-address";

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
) {
	const owner = await env.DB.prepare(
		`SELECT u.email_verified FROM workspace_members m JOIN user u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND m.role='owner'`,
	)
		.bind(workspaceId, actorId)
		.first<{ email_verified: number }>();
	if (owner?.email_verified !== 1)
		throw new OnboardingError("A verified Workspace Owner is required", 403);
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
	const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
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
			Date.now(),
		)
		.run();
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
		workspaceId,
		expiresAt,
		invitationUrl: url.href,
		delivery,
	};
}

/** Reserves the capability before credential creation. Never accepts caller email/workspace/role. */
export async function registerInvitedAgent(
	env: AuthEnv,
	token: string,
	username: string,
	password: string,
) {
	if (!isValidUsername(username) || RESERVED_PRIVATE_LOCAL_PARTS.has(username))
		throw new OnboardingError(
			"Choose a valid, non-reserved immutable username",
		);
	if (password.length < 8 || password.length > 128)
		throw new OnboardingError("Password must contain 8–128 characters");
	const hash = await hashToken(token);
	const invite = await env.DB.prepare(
		`SELECT email FROM agent_invitations WHERE token_hash=? AND claimed_at IS NULL AND accepted_at IS NULL AND expires_at>?`,
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
		`UPDATE agent_invitations SET claimed_at=? WHERE token_hash=? AND claimed_at IS NULL AND accepted_at IS NULL AND expires_at>?`,
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
 WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?
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
			"Invitation expired, consumed, or account email is not verified/matching",
			403,
		);
	return { workspaceId: result.workspace_id };
}
