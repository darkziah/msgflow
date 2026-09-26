import type { MetaAppCreateRequest, MetaAppSummary } from "@msgflow/contracts";
import { metaApps } from "@msgflow/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { requireOwnerAccess } from "./access";
import { encryptChannelToken } from "./channel-token-crypto";
import type { Env } from "./env";
import { ManageError } from "./errors";

export async function listMetaApps(
	env: Env,
	workspaceId: string,
	actorUserId: string,
): Promise<MetaAppSummary[]> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const rows = await db
		.select({
			id: metaApps.id,
			displayName: metaApps.displayName,
			appId: metaApps.appId,
			appSecret: metaApps.appSecret,
			createdAt: metaApps.createdAt,
			updatedAt: metaApps.updatedAt,
		})
		.from(metaApps)
		.where(eq(metaApps.workspaceId, workspaceId))
		.all();
	return rows.map((row) => ({
		id: row.id,
		displayName: row.displayName,
		appId: row.appId,
		hasSecret: row.appSecret.length > 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}));
}

export async function createMetaApp(
	env: Env,
	workspaceId: string,
	input: MetaAppCreateRequest,
	actorUserId: string,
): Promise<MetaAppSummary> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	let appSecret: string;
	try {
		appSecret = await encryptChannelToken(
			input.appSecret,
			env.CHANNEL_TOKEN_ENCRYPTION_KEY,
		);
	} catch {
		throw new ManageError("Meta App secret encryption is unavailable", 503);
	}
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	try {
		await db
			.insert(metaApps)
			.values({
				id,
				workspaceId,
				displayName: input.displayName,
				appId: input.appId,
				appSecret,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	} catch {
		throw new ManageError("a Meta App with this App ID already exists", 409);
	}
	return {
		id,
		displayName: input.displayName,
		appId: input.appId,
		hasSecret: true,
		createdAt: now,
		updatedAt: now,
	};
}
