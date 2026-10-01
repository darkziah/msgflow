import type {
	MetaAppCreateRequest,
	MetaAppSummary,
	MetaAppUpdateRequest,
	MetaAppWebhookSetup,
} from "@msgflow/contracts";
import { channels, metaApps } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
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
): Promise<MetaAppWebhookSetup> {
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
	const webhookVerifyToken = generateWebhookVerifyToken();
	const webhookVerifyTokenHash = await sha256Hex(webhookVerifyToken);
	try {
		await db
			.insert(metaApps)
			.values({
				id,
				workspaceId,
				displayName: input.displayName,
				appId: input.appId,
				appSecret,
				webhookVerifyTokenHash,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	} catch {
		throw new ManageError("a Meta App with this App ID already exists", 409);
	}
	return {
		metaApp: {
			id,
			displayName: input.displayName,
			appId: input.appId,
			hasSecret: true,
			createdAt: now,
			updatedAt: now,
		},
		webhookVerifyToken,
	};
}

/** Hashes the dashboard-supplied token; plaintext never reaches D1. */
export async function hashWebhookVerifyToken(value: string): Promise<string> {
	return sha256Hex(value);
}

export async function updateMetaApp(
	env: Env,
	workspaceId: string,
	id: string,
	input: MetaAppUpdateRequest,
	actorUserId: string,
): Promise<MetaAppSummary> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select()
		.from(metaApps)
		.where(and(eq(metaApps.id, id), eq(metaApps.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("Meta App not found", 404);
	const set: Partial<typeof metaApps.$inferInsert> = {
		updatedAt: new Date().toISOString(),
	};
	if (input.displayName !== undefined) set.displayName = input.displayName;
	if (input.appSecret !== undefined) {
		try {
			set.appSecret = await encryptChannelToken(
				input.appSecret,
				env.CHANNEL_TOKEN_ENCRYPTION_KEY,
			);
		} catch {
			throw new ManageError("Meta App secret encryption is unavailable", 503);
		}
	}
	await db
		.update(metaApps)
		.set(set)
		.where(and(eq(metaApps.id, id), eq(metaApps.workspaceId, workspaceId)))
		.run();
	return {
		id: existing.id,
		displayName: set.displayName ?? existing.displayName,
		appId: existing.appId,
		hasSecret: true,
		createdAt: existing.createdAt,
		updatedAt: set.updatedAt ?? existing.updatedAt,
	};
}

/** Replaces an unrecoverable hashed token and returns the new plaintext once. */
export async function recreateMetaAppWebhookToken(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<MetaAppWebhookSetup> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select({ id: metaApps.id, displayName: metaApps.displayName, appId: metaApps.appId, appSecret: metaApps.appSecret, createdAt: metaApps.createdAt })
		.from(metaApps)
		.where(and(eq(metaApps.id, id), eq(metaApps.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("Meta App not found", 404);
	const webhookVerifyToken = generateWebhookVerifyToken();
	const updatedAt = new Date().toISOString();
	await db
		.update(metaApps)
		.set({
			webhookVerifyTokenHash: await sha256Hex(webhookVerifyToken),
			webhookSubscriptionConfirmedAt: null,
			updatedAt,
		})
		.where(eq(metaApps.id, id))
		.run();
	return {
		metaApp: {
			id: existing.id,
			displayName: existing.displayName,
			appId: existing.appId,
			hasSecret: existing.appSecret.length > 0,
			createdAt: existing.createdAt,
			updatedAt,
		},
		webhookVerifyToken,
	};
}

/**
 * The Meta dashboard exposes no safe, authoritative subscription-state read for
 * this flow. An Owner must attest only after Meta verifies the callback and the
 * App's webhook subscription includes `calls`; App ID presence is insufficient.
 */
export async function confirmMetaAppWebhookSubscription(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const now = new Date().toISOString();
	const result = await db
		.update(metaApps)
		.set({ webhookSubscriptionConfirmedAt: now, updatedAt: now })
		.where(and(eq(metaApps.id, id), eq(metaApps.workspaceId, workspaceId)))
		.run();
	if (!result.meta.changes) throw new ManageError("Meta App not found", 404);
}

/** Page history is retained: disconnect/remove Page Channels before deleting. */
export async function deleteMetaApp(
	env: Env,
	workspaceId: string,
	id: string,
	actorUserId: string,
): Promise<void> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const existing = await db
		.select({ id: metaApps.id })
		.from(metaApps)
		.where(and(eq(metaApps.id, id), eq(metaApps.workspaceId, workspaceId)))
		.get();
	if (!existing) throw new ManageError("Meta App not found", 404);
	const pageChannel = await db
		.select({ id: channels.id })
		.from(channels)
		.where(eq(channels.metaAppId, id))
		.get();
	if (pageChannel) {
		throw new ManageError(
			"disconnect or remove all Page Channels before deleting this Meta App",
			409,
		);
	}
	await db.delete(metaApps).where(eq(metaApps.id, id)).run();
}

function generateWebhookVerifyToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
