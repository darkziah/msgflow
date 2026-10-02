import { type AuthEnv, createAuth } from "@msgflow/auth";
import { Schema } from "effect";
import { Hono } from "hono";
import {
	acceptAgentInvitation,
	createAgentInvitation,
	deleteAgentInvitation,
	OnboardingError,
	previewAgentInvitation,
	registerInvitedAgent,
	resendAgentInvitation,
} from "./agent-onboarding";
import { decodeJsonBody } from "./validation";

const token = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const signup = Schema.Struct({
	token,
	password: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
	confirmation: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
});
const invite = Schema.Struct({
	email: Schema.String.pipe(Schema.maxLength(254)),
	username: Schema.String.pipe(Schema.maxLength(30)),
});
const accept = Schema.Struct({ token });

/** Mount at /api before any blanket session middleware; register is capability-guarded. */
export const onboardingApi = new Hono<{ Bindings: AuthEnv }>();
onboardingApi.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	const origin = c.req.header("origin");
	const allowed = [
		new URL(c.req.url).origin,
		...(c.env.BETTER_AUTH_URL ? [new URL(c.env.BETTER_AUTH_URL).origin] : []),
		...(c.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",").map((v) => v.trim()) ??
			[]),
	];
	if (origin && !allowed.includes(origin))
		return c.json({ success: false, error: "Untrusted origin" }, 403);
	await next();
});
onboardingApi.onError((error, c) =>
	c.json(
		{
			success: false,
			error:
				error instanceof OnboardingError
					? error.message
					: "Onboarding could not complete",
		},
		error instanceof OnboardingError ? error.status : 500,
	),
);
onboardingApi.get("/invitations/preview", async (c) => {
	const raw = c.req.query("token");
	if (!raw || !/^[a-f0-9]{64}$/.test(raw))
		return c.json(
			{ success: false, error: "Invitation is invalid or expired" },
			404,
		);
	return c.json({
		success: true,
		data: await previewAgentInvitation(c.env, raw),
	});
});
onboardingApi.post("/workspaces/:workspaceId/invitations", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session)
		return c.json({ success: false, error: "Authentication required" }, 401);
	const body = await decodeJsonBody(c.req.raw, invite);
	if (!body.ok) return c.json({ success: false, error: body.error }, 400);
	return c.json(
		{
			success: true,
			data: await createAgentInvitation(
				c.env,
				session.user.id,
				c.req.param("workspaceId"),
				body.value.email,
				body.value.username,
			),
		},
		201,
	);
});
onboardingApi.post("/invitations/register", async (c) => {
	const body = await decodeJsonBody(c.req.raw, signup);
	if (!body.ok) return c.json({ success: false, error: body.error }, 400);
	if (body.value.password !== body.value.confirmation)
		return c.json({ success: false, error: "Passwords do not match" }, 400);
	return c.json(
		{
			success: true,
			data: await registerInvitedAgent(
				c.env,
				body.value.token,
				body.value.password,
			),
		},
		201,
	);
});
onboardingApi.delete(
	"/workspaces/:workspaceId/invitations/:invitationId",
	async (c) => {
		const session = await createAuth(c.env).api.getSession({
			headers: c.req.raw.headers,
		});
		if (!session)
			return c.json({ success: false, error: "Authentication required" }, 401);
		return c.json({
			success: true,
			data: await deleteAgentInvitation(
				c.env,
				session.user.id,
				c.req.param("workspaceId"),
				c.req.param("invitationId"),
			),
		});
	},
);
onboardingApi.post(
	"/workspaces/:workspaceId/invitations/:invitationId/resend",
	async (c) => {
		const session = await createAuth(c.env).api.getSession({
			headers: c.req.raw.headers,
		});
		if (!session)
			return c.json({ success: false, error: "Authentication required" }, 401);
		return c.json({
			success: true,
			data: await resendAgentInvitation(
				c.env,
				session.user.id,
				c.req.param("workspaceId"),
				c.req.param("invitationId"),
			),
		});
	},
);
onboardingApi.post("/invitations/accept", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session)
		return c.json({ success: false, error: "Authentication required" }, 401);
	const body = await decodeJsonBody(c.req.raw, accept);
	if (!body.ok) return c.json({ success: false, error: body.error }, 400);
	return c.json({
		success: true,
		data: await acceptAgentInvitation(c.env, body.value.token, session.user.id),
	});
});
