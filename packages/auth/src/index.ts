import * as schema from "@msgflow/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { isValidUsername } from "./username-policy";

export interface AuthEnv {
	DB: D1Database;
	EMAIL?: SendEmail;
	AUTH_EMAIL_FROM?: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL?: string;
	/**
	 * Comma-separated origins allowed for cookie/bearer auth requests, e.g.
	 * "http://localhost:5174,https://inbox.example.com". Required when the web app
	 * is served from a different origin than the Worker (dev proxy, split
	 * hosting) — better-auth rejects cross-origin requests otherwise.
	 */
	BETTER_AUTH_TRUSTED_ORIGINS?: string;
}

/**
 * Create a Better Auth instance bound to the request's env. Password accounts
 * retain a verified recovery email, while the native username plugin supplies a
 * normalized, immutable alternative sign-in identifier.
 */
export function createAuth(env: AuthEnv) {
	return createAuthWithSignup(env, true);
}

/**
 * Server-only instance for the guarded initial setup route. Never mount its
 * handler: its only caller is the Worker after it wins the D1 setup claim.
 */
export function createSetupAuth(env: AuthEnv) {
	return createAuthWithSignup(env, false);
}

function createAuthWithSignup(env: AuthEnv, disableSignUp: boolean) {
	const db = drizzle(env.DB);
	return betterAuth({
		appName: "MsgFlow",
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		emailAndPassword: {
			enabled: true,
			// Only createAuth() is mounted publicly. createSetupAuth() exists solely
			// for the Worker-owned, D1-claimed first-use route.
			disableSignUp,
			autoSignIn: false,
			// Historical users keep sign-in; sensitive onboarding gates verification.
			requireEmailVerification: false,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: hasAuthEmailSender(env)
				? async ({ user, url }) => {
						if (!user.emailVerified) return;
						await sendAuthEmail(
							env,
							user.email,
							"Reset your MsgFlow password",
							url,
						);
					}
				: undefined,
		},
		emailVerification: {
			sendOnSignUp: false,
			autoSignInAfterVerification: false,
			expiresIn: 3600,
			sendVerificationEmail: hasAuthEmailSender(env)
				? async ({ user, url }) => {
						await sendAuthEmail(
							env,
							user.email,
							"Verify your MsgFlow recovery email",
							url,
						);
					}
				: undefined,
		},
		trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS
			? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
			: undefined,
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		plugins: [
			username({
				displayUsername: false,
				immutableUsername: true,
				usernameValidator: isValidUsername,
			}),
		],
	});
}

export function hasAuthEmailSender(env: AuthEnv): boolean {
	return (
		!!env.EMAIL &&
		!!env.AUTH_EMAIL_FROM &&
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.AUTH_EMAIL_FROM)
	);
}

export async function sendAuthEmail(
	env: AuthEnv,
	to: string,
	subject: string,
	url: string,
) {
	if (!hasAuthEmailSender(env) || !env.EMAIL || !env.AUTH_EMAIL_FROM)
		throw new Error("Authentication email sender is not configured");
	await env.EMAIL.send({
		from: env.AUTH_EMAIL_FROM,
		to,
		subject,
		text: `${subject}\n\n${url}\n\nIf you did not request this, ignore this email.`,
	});
}

export { isValidUsername } from "./username-policy";
export type Auth = ReturnType<typeof createAuth>;
