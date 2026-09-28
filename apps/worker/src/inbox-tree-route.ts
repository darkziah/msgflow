import type { InboxTreeMoveRequest } from "@msgflow/contracts";
import { inboxes } from "@msgflow/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { requireWorkspaceAccess } from "./access";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { moveInboxInTree } from "./manage";

/**
 * Route/service seam for the versioned navigation-tree endpoint. The request
 * contains an optional sibling anchor rather than a client-controlled order.
 */
export async function handleInboxTreeMove(
	env: Env,
	workspaceId: string,
	sourceId: string,
	body: InboxTreeMoveRequest,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireWorkspaceAccess(db, workspaceId, actorUserId);
	const rows = await db
		.select({
			id: inboxes.id,
			parentInboxId: inboxes.parentInboxId,
			sortOrder: inboxes.sortOrder,
			visibilityType: inboxes.visibilityType,
		})
		.from(inboxes)
		.where(eq(inboxes.workspaceId, workspaceId))
		.all();
	if (!rows.some((row) => row.id === sourceId)) {
		throw new ManageError("inbox not found", 404);
	}
	const parent = body.parentInboxId
		? rows.find((row) => row.id === body.parentInboxId)
		: null;
	if (body.parentInboxId && !parent) {
		throw new ManageError("parent inbox not found", 404);
	}
	if (parent?.visibilityType === "system") {
		throw new ManageError("system inboxes cannot be parents", 409);
	}
	const siblings = rows
		.filter(
			(row) => row.parentInboxId === body.parentInboxId && row.id !== sourceId,
		)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
	let sortOrder = siblings.length;
	if (body.beforeInboxId) {
		const before = siblings.find((row) => row.id === body.beforeInboxId);
		if (!before) {
			throw new ManageError(
				"before inbox must be a sibling in the destination group",
				409,
			);
		}
		sortOrder = siblings.indexOf(before);
	}
	await moveInboxInTree(
		env,
		workspaceId,
		{
			inboxId: sourceId,
			parentInboxId: body.parentInboxId,
			expectedTreeVersion: body.expectedTreeVersion,
			sortOrder,
		},
		actorUserId,
	);
}
