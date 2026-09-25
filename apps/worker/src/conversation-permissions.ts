import { conversations, workspaceMembers } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { getConversation } from "./queries";

/** Re-check current grants for durable projections and hibernated sockets. */
export async function canReadConversation(
	env: Env,
	userId: string,
	conversationId: string,
	workspaceId?: string,
): Promise<boolean> {
	const db = drizzle(env.DB);
	const row = await db
		.select({ workspaceId: conversations.workspaceId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.get();
	if (!row || (workspaceId && row.workspaceId !== workspaceId)) return false;
	const member = await db
		.select({ id: workspaceMembers.id })
		.from(workspaceMembers)
		.where(
			and(
				eq(workspaceMembers.workspaceId, row.workspaceId),
				eq(workspaceMembers.userId, userId),
			),
		)
		.get();
	if (!member) return false;
	return !!(await getConversation(
		env,
		userId,
		conversationId,
		row.workspaceId,
	));
}

export async function filterReadableNotifications<
	T extends { conversationId: string; workspaceId: string },
>(env: Env, userId: string, workspaceId: string, rows: T[]): Promise<T[]> {
	const permissions = new Map<string, boolean>();
	const allowed: T[] = [];
	for (const row of rows) {
		if (row.workspaceId !== workspaceId) continue;
		let readable = permissions.get(row.conversationId);
		if (readable === undefined) {
			readable = await canReadConversation(
				env,
				userId,
				row.conversationId,
				workspaceId,
			);
			permissions.set(row.conversationId, readable);
		}
		if (readable) allowed.push(row);
	}
	return allowed;
}
