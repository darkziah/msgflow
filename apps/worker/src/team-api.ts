import { createAuth } from "@msgflow/auth";
import {
	OffboardWorkspaceMemberRequestSchema,
	UpdateWorkspaceMemberAccessRequestSchema,
	UpdateWorkspaceMemberRoleRequestSchema,
} from "@msgflow/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "./env";
import { ManageError } from "./errors";
import {
	getTeamManagement,
	listWorkspaceTeam,
	offboardWorkspaceMember,
	updateWorkspaceMemberAccess,
	updateWorkspaceMemberRole,
} from "./team-management";
import { decodeJsonBody } from "./validation";

/** Explicit workspace-scoped Team roster; invitation capabilities never leave the service. */
export const teamApi = new Hono<{ Bindings: Env }>();
teamApi.use("*", async (c, next) => {
	c.header("Cache-Control", "private, no-store");
	await next();
});

teamApi.get("/workspaces/:workspaceId/team", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);

	try {
		return c.json({
			team: await listWorkspaceTeam(
				c.env,
				session.user.id,
				c.req.param("workspaceId"),
			),
		});
	} catch (error) {
		return teamError(c, error);
	}
});

teamApi.patch("/workspaces/:workspaceId/members/:userId/role", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);
	const decoded = await decodeJsonBody(
		c.req.raw,
		UpdateWorkspaceMemberRoleRequestSchema,
	);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);

	try {
		const { member } = await updateWorkspaceMemberRole(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			c.req.param("userId"),
			decoded.value.role,
		);
		return c.json({ success: true, data: { member } });
	} catch (error) {
		return teamError(c, error);
	}
});

teamApi.put("/workspaces/:workspaceId/members/:userId/access", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);
	const decoded = await decodeJsonBody(
		c.req.raw,
		UpdateWorkspaceMemberAccessRequestSchema,
	);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		const { member } = await updateWorkspaceMemberAccess(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			c.req.param("userId"),
			decoded.value,
		);
		return c.json({ success: true, data: { member } });
	} catch (error) {
		return teamError(c, error);
	}
});

teamApi.delete("/workspaces/:workspaceId/members/:userId", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);
	const decoded = await decodeJsonBody(
		c.req.raw,
		OffboardWorkspaceMemberRequestSchema,
	);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);

	try {
		await offboardWorkspaceMember(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			c.req.param("userId"),
			decoded.value.confirmation,
		);
		return c.json({ success: true, data: { success: true } });
	} catch (error) {
		return teamError(c, error);
	}
});

teamApi.get("/workspaces/:workspaceId/invitations", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);

	try {
		const { invitations } = await getTeamManagement(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
		);
		return c.json({ success: true, data: { invitations } });
	} catch (error) {
		return teamError(c, error);
	}
});

function teamError(c: Context<{ Bindings: Env }>, error: unknown) {
	if (error instanceof ManageError) {
		return c.json(
			{ success: false, error: error.message },
			error.status as 400 | 403 | 404 | 409,
		);
	}
	console.error("team endpoint error:", error);
	return c.json({ success: false, error: "internal error" }, 500);
}
