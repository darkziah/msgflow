import { channels, inboxChannels, inboxes } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

const DEFAULT_INBOX_NAMES: Record<"facebook_page" | "email", string> = {
	facebook_page: "Facebook Support",
	email: "Support",
};

type Db = ReturnType<typeof drizzle>;
type ChannelType = "facebook_page" | "email";

/** Create or reuse a workspace channel instance by its provider external id. */
export async function getOrCreateChannel(
	db: Db,
	workspaceId: string,
	channelType: ChannelType,
	externalId: string,
	now: string,
): Promise<typeof channels.$inferSelect> {
	const existing = await db
		.select()
		.from(channels)
		.where(
			and(
				eq(channels.workspaceId, workspaceId),
				eq(channels.externalId, externalId),
			),
		)
		.get();
	if (existing) return existing;

	await db
		.insert(channels)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			type: channelType,
			displayName: externalId,
			externalId,
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	const created = await db
		.select()
		.from(channels)
		.where(
			and(
				eq(channels.workspaceId, workspaceId),
				eq(channels.externalId, externalId),
			),
		)
		.get();
	if (!created) throw new Error("channel bootstrap failed");
	return created;
}

/**
 * Ensure a channel has an active default inbox. Channels of the same type share
 * the most-used inbox by default; this matches lazy inbound provisioning.
 */
export async function getOrCreateDefaultInbox(
	db: Db,
	workspaceId: string,
	channelId: string,
	channelType: ChannelType,
	now: string,
): Promise<typeof inboxes.$inferSelect> {
	const linked = await db
		.select({ inbox: inboxes })
		.from(inboxChannels)
		.innerJoin(inboxes, eq(inboxChannels.inboxId, inboxes.id))
		.where(
			and(
				eq(inboxChannels.channelId, channelId),
				eq(inboxChannels.isDefault, true),
				eq(inboxes.isArchived, false),
			),
		)
		.get();
	if (linked) return linked.inbox;

	const shared = await db
		.select({ inbox: inboxes })
		.from(inboxChannels)
		.innerJoin(inboxes, eq(inboxChannels.inboxId, inboxes.id))
		.innerJoin(channels, eq(inboxChannels.channelId, channels.id))
		.where(
			and(
				eq(channels.workspaceId, workspaceId),
				eq(channels.type, channelType),
				eq(inboxes.isArchived, false),
			),
		)
		.all();
	const counts = new Map<string, number>();
	for (const row of shared) {
		counts.set(row.inbox.id, (counts.get(row.inbox.id) ?? 0) + 1);
	}
	let sharedInbox: typeof inboxes.$inferSelect | null = null;
	for (const row of shared) {
		if (!sharedInbox || (counts.get(row.inbox.id) ?? 0) > (counts.get(sharedInbox.id) ?? 0)) {
			sharedInbox = row.inbox;
		}
	}
	if (sharedInbox) {
		await db
			.insert(inboxChannels)
			.values({
				id: crypto.randomUUID(),
				inboxId: sharedInbox.id,
				channelId,
				isDefault: true,
			})
			.onConflictDoNothing()
			.run();
		return sharedInbox;
	}

	const named = await db
		.select()
		.from(inboxes)
		.where(
			and(
				eq(inboxes.workspaceId, workspaceId),
				eq(inboxes.name, DEFAULT_INBOX_NAMES[channelType]),
				eq(inboxes.isArchived, false),
			),
		)
		.get();
	if (named) {
		await db
			.insert(inboxChannels)
			.values({ id: crypto.randomUUID(), inboxId: named.id, channelId, isDefault: true })
			.onConflictDoNothing()
			.run();
		return named;
	}

	const inboxId = crypto.randomUUID();
	await db
		.insert(inboxes)
		.values({
			id: inboxId,
			workspaceId,
			name: DEFAULT_INBOX_NAMES[channelType],
			createdAt: now,
			updatedAt: Date.now(),
		})
		.run();
	await db
		.insert(inboxChannels)
		.values({ id: crypto.randomUUID(), inboxId, channelId, isDefault: true })
		.run();
	const created = await db.select().from(inboxes).where(eq(inboxes.id, inboxId)).get();
	if (!created) throw new Error("inbox bootstrap failed");
	return created;
}
