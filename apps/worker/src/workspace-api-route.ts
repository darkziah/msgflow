import { createAuth } from "@msgflow/auth";
import { WorkspaceCreateRequestSchema } from "@msgflow/contracts";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { decodeJsonBody } from "./validation";
import { createWorkspace, listWorkspacesForUser } from "./workspace-api";

const WORKSPACE_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Workspace switching and Owner-authorized tenant provisioning. */
export const workspaceApi = new Hono<{ Bindings: Env }>();

workspaceApi.get("/workspaces", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);
	try {
		return c.json({
			workspaces: await listWorkspacesForUser(c.env, session.user.id),
		});
	} catch (err) {
		return workspaceError(c, err);
	}
});

workspaceApi.post("/workspaces", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);

	const sourceWorkspaceId = c.req.query("sourceWorkspaceId");
	if (!sourceWorkspaceId || !WORKSPACE_ID_RE.test(sourceWorkspaceId)) {
		return c.json(
			{ success: false, error: "valid sourceWorkspaceId is required" },
			400,
		);
	}
	const decoded = await decodeJsonBody(c.req.raw, WorkspaceCreateRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);

	try {
		const workspace = await createWorkspace(
			c.env,
			sourceWorkspaceId,
			session.user.id,
			decoded.value,
		);
		return c.json({ workspace }, 201);
	} catch (err) {
		return workspaceError(c, err);
	}
});

function workspaceError(c: Context<{ Bindings: Env }>, err: unknown) {
	if (err instanceof ManageError) {
		return c.json(
			{ success: false, error: err.message },
			err.status as 400 | 403 | 404 | 409,
		);
	}
	console.error("workspace endpoint error:", err);
	return c.json({ success: false, error: "internal error" }, 500);
}
