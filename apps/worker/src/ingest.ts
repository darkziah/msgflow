import type { NormalizedInbound } from "@msgflow/channel";
import type { Message } from "@msgflow/contracts";
import { parseConversationId } from "@msgflow/contracts";
import {
	channels,
	contactIdentities,
	contacts,
	conversations,
	conversationTags,
	inboxChannels,
	inboxes,
	processedMessages,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { evaluateRules } from "./rules";
import { getOrCreateWorkspace } from "./workspace";
import { decryptChannelToken } from "./channel-token-crypto";
import { copyProviderImages } from "./attachments";

const DEFAULT_INBOX_NAMES: Record<string, string> = {
	facebook_page: "Facebook Support",
	email: "Support",
};

interface FacebookProfile {
	displayName: string | null;
	avatarUrl: string | null;
}

/**
 * Fetch a Messenger user's profile (name + avatar) from the Graph API.
 * Meta webhook messaging events carry only the PSID — the name must be
 * resolved separately. Best-effort: any failure returns null so ingest
 * never breaks because a name lookup failed. Channels without a page
 * access token (lazily-created, never connected) simply skip this.
 */
async function fetchFacebookProfile(
	psid: string,
	accessToken: string,
): Promise<FacebookProfile | null> {
	try {
		const url =
			`https://graph.facebook.com/v21.0/${encodeURIComponent(psid)}` +
			`?fields=name,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
		if (!response.ok) return null;
		const data = (await response.json()) as {
			name?: string;
			picture?: { data?: { url?: string } };
			error?: { message?: string };
		};
		if (data.error) return null;
		return {
			displayName: data.name ?? null,
			avatarUrl: data.picture?.data?.url ?? null,
		};
	} catch {
		return null;
	}
}

/**
 * Ingest routing (ADR 0009): resolve workspace → channel → contact identity →
 * default inbox, ensure the conversation metadata row exists in D1, evaluate
 * rules (reroute/assign/tag), then forward the canonical Message to the
 * Conversation DO (which owns the timeline and mirrors the summary to D1).
 *
 * Single-tenant bootstrap: a "default" workspace is created lazily; the
 * workspace_members/teams RBAC wiring is a later phase.
 */
export async function routeInbound(
	env: Env,
	inbound: NormalizedInbound,
): Promise<void> {
	// Provider-hosted Messenger media is copied before the canonical message is
	// created. Broken/unsupported provider URLs are ignored by the copier, while
	// a text-less image remains valid when at least one copy succeeds.
	const attachments = [
		...inbound.attachments,
		...(await copyProviderImages(env, inbound.providerAttachments)),
	];
	if (!inbound.text && attachments.length === 0) return;
	const db = drizzle(env.DB);
	const now = new Date().toISOString();

	// Conversation IDs embed the channel instance: fb:{page_id}:{psid} | email:{mailbox}:{thread_key}.
	const parsed = parseConversationId(inbound.conversationId);
	if (!parsed) return;
	const channelType = parsed.channel === "facebook" ? "facebook_page" : "email";

	// 1. Workspace (lazy single-tenant bootstrap).
	const workspace = await getOrCreateWorkspace(db, now);

	// 2. Channel (Page or mailbox) the conversation flows through.
	const channel = await getOrCreateChannel(
		db,
		workspace.id,
		channelType,
		parsed.left,
		now,
	);

	// 3. Contact via its channel identity (PSIDs are Page-scoped → keyed by channel).
	//    Meta webhooks carry only the PSID — resolve the display name/avatar via
	//    the Graph API when the channel has a token (best-effort, never fatal).
	let profile: FacebookProfile | null = null;
	if (channelType === "facebook_page" && channel.accessToken) {
		try {
			profile = await fetchFacebookProfile(
				inbound.senderId,
				await decryptChannelToken(
					channel.accessToken,
					env.CHANNEL_TOKEN_ENCRYPTION_KEY,
				),
			);
		} catch {
			// Profile resolution is best-effort. Ingest remains available while a
			// credential is missing, legacy plaintext, or cannot be decrypted.
		}
	}
	const contact = await getOrCreateContact(
		db,
		workspace.id,
		channel.id,
		channelType,
		inbound.senderId,
		now,
		profile,
	);

	// 4. Default inbox for the channel (each channel has exactly one default, ADR 0008).
	const inbox = await getOrCreateDefaultInbox(
		db,
		workspace.id,
		channel.id,
		channelType,
		now,
	);

	// 5. Ensure the conversation metadata row exists (D1 is authoritative for it).
	const emailPayload = (inbound.payload ?? {}) as { subject?: string };
	await db
		.insert(conversations)
		.values({
			id: inbound.conversationId,
			workspaceId: workspace.id,
			channelId: channel.id,
			inboxId: inbox.id,
			contactId: contact.id,
			doBindingId: inbound.conversationId,
			subject: channelType === "email" ? (emailPayload.subject ?? null) : null,
			status: "open",
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();

	// 5b. Webhook idempotency (routing spec): rules run BEFORE the DO append,
	// so a replayed provider event could re-run rule side effects (duplicate
	// canned replies, re-tags). Claim the event in processed_messages first —
	// a conflict means it was already routed and we stop here. The DO also
	// dedups the append by providerMessageId, so messages stay single even if
	// this guard and the DO race.
	const messageId = crypto.randomUUID();
	const dedupKey =
		inbound.providerMessageId ??
		syntheticMessageKey(
			inbound.conversationId,
			inbound.createdAt,
			inbound.text,
		);
	const claimed = await db
		.insert(processedMessages)
		.values({
			conversationId: inbound.conversationId,
			providerMessageId: dedupKey,
			messageId,
			processedAt: Date.now(),
		})
		.onConflictDoNothing()
		.run();
	if ((claimed.meta?.changes ?? 1) === 0) {
		return; // duplicate event — already routed (rules + append ran before)
	}

	// 6. Rules (ADR 0009 + routing spec): synchronous pre-append evaluation.
	//    May re-route the conversation (inbox/assignee/status) and apply tags
	//    before the message reaches the DO. stop_processing and skipped logging
	//    are handled inside evaluateRules.
	const existingTags = await db
		.select({ tagId: conversationTags.tagId })
		.from(conversationTags)
		.where(eq(conversationTags.conversationId, inbound.conversationId))
		.all();
	const outcome = await evaluateRules(env, {
		conversationId: inbound.conversationId,
		workspaceId: workspace.id,
		inboxId: inbox.id,
		assigneeId: null,
		status: "open",
		channelType,
		senderEmail: channelType === "email" ? inbound.senderId : null,
		subject: channelType === "email" ? (emailPayload.subject ?? null) : null,
		messageText: inbound.text,
		conversationTagIds: existingTags.map((row) => row.tagId),
	});
	if (
		outcome.inboxId !== inbox.id ||
		outcome.assigneeId !== null ||
		outcome.status !== "open"
	) {
		await db
			.update(conversations)
			.set({
				inboxId: outcome.inboxId,
				assigneeId: outcome.assigneeId,
				status: outcome.status,
				updatedAt: now,
			})
			.where(eq(conversations.id, inbound.conversationId))
			.run();
	}

	// 7. Build the canonical message and forward to the Conversation DO
	//    (single-threaded, authoritative timeline; dedups on providerMessageId).
	const message: Message = {
		id: messageId,
		conversationId: inbound.conversationId,
		kind: "inbound",
		channel: parsed.channel,
		providerMessageId: inbound.providerMessageId,
		senderId: contact.id,
		text: inbound.text,
		payload: inbound.payload,
		attachments,
		createdAt: inbound.createdAt,
	};

	const doId = env.CONVERSATION_DO.idFromName(inbound.conversationId);
	const stub = env.CONVERSATION_DO.get(doId);
	await stub.fetch("https://do/append-message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(message),
	});
}

/**
 * Deterministic fallback dedup key for provider events without a message id
 * (Facebook delivery receipts, some email bounces). Identical replays of the
 * same conversation+timestamp+text produce the same key, so they cannot double
 * rules or messages; distinct real messages stay distinct.
 */
function syntheticMessageKey(
	conversationId: string,
	createdAt: string,
	text: string,
): string {
	let hash = 5381;
	const source = `${conversationId}|${createdAt}|${text}`;
	for (let i = 0; i < source.length; i++) {
		hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
	}
	return `syn:${hash.toString(36)}:${source.length}`;
}

async function getOrCreateChannel(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	channelType: "facebook_page" | "email",
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

async function getOrCreateContact(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	channelId: string,
	channelType: "facebook_page" | "email",
	externalUserId: string,
	now: string,
	profile?: FacebookProfile | null,
): Promise<typeof contacts.$inferSelect> {
	const identity = await db
		.select({ contactId: contactIdentities.contactId })
		.from(contactIdentities)
		.where(
			and(
				eq(contactIdentities.channelId, channelId),
				eq(contactIdentities.externalUserId, externalUserId),
			),
		)
		.get();
	if (identity) {
		const contact = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, identity.contactId))
			.get();
		if (contact) {
			// Fill only missing provider fields when a channel gains a token after
			// the contact was created. A partial Graph response must never erase
			// an already-resolved name or avatar.
			const displayName = contact.displayName ?? profile?.displayName ?? null;
			const avatarUrl = contact.avatarUrl ?? profile?.avatarUrl ?? null;
			if (
				profile &&
				(displayName !== contact.displayName || avatarUrl !== contact.avatarUrl)
			) {
				await db
					.update(contacts)
					.set({
						displayName,
						avatarUrl,
						updatedAt: now,
					})
					.where(eq(contacts.id, contact.id))
					.run();
				return { ...contact, displayName, avatarUrl };
			}
			return contact;
		}
	}

	const contactId = crypto.randomUUID();
	await db
		.insert(contacts)
		.values({
			id: contactId,
			workspaceId,
			displayName:
				channelType === "facebook_page" ? (profile?.displayName ?? null) : null,
			avatarUrl:
				channelType === "facebook_page" ? (profile?.avatarUrl ?? null) : null,
			primaryEmail: channelType === "email" ? externalUserId : null,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await db
		.insert(contactIdentities)
		.values({
			id: crypto.randomUUID(),
			contactId,
			channelId,
			channelType,
			externalUserId,
			createdAt: now,
		})
		.onConflictDoNothing()
		.run();
	const created = await db
		.select()
		.from(contacts)
		.where(eq(contacts.id, contactId))
		.get();
	if (!created) throw new Error("contact bootstrap failed");
	return created;
}

async function getOrCreateDefaultInbox(
	db: ReturnType<typeof drizzle>,
	workspaceId: string,
	channelId: string,
	channelType: "facebook_page" | "email",
	now: string,
): Promise<typeof inboxes.$inferSelect> {
	// 1. Existing default link for this channel wins (covers re-ingest).
	//    Archived inboxes are skipped — they cannot receive new default-channel
	//    routing (routing spec), so an archived default falls through to the
	//    shared/name-reuse/create paths below.
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

	// 2. Shared inbox: reuse an inbox another channel of the same type already
	//    feeds (e.g. one "Facebook Support" for every Page), so channels of a
	//    type share a queue unless a rule routes elsewhere (ADR 0008). Prefer
	//    the inbox linked to the most channels of this type.
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
	const inboxIds = [...new Set(shared.map((row) => row.inbox.id))];
	if (inboxIds.length > 0) {
		// Most-linked inbox of this type becomes the new channel's default.
		const counts = new Map<string, number>();
		for (const id of inboxIds) counts.set(id, (counts.get(id) ?? 0) + 1);
		let bestId = inboxIds[0];
		for (const id of inboxIds) {
			const best = bestId ?? "";
			if ((counts.get(id) ?? 0) > (counts.get(best) ?? 0)) bestId = id;
		}
		const best = shared.find((row) => row.inbox.id === bestId);
		if (best) {
			await db
				.insert(inboxChannels)
				.values({
					id: crypto.randomUUID(),
					inboxId: best.inbox.id,
					channelId,
					isDefault: true,
				})
				.onConflictDoNothing()
				.run();
			return best.inbox;
		}
	}

	// 3. Reuse an existing inbox with the default name (an admin may have
	//    created a "General" inbox before the first message arrived). Name
	//    uniqueness is enforced in manage.ts, so creating a duplicate here
	//    would fail — this path makes the admin-created inbox the default.
	const named = await db
		.select()
		.from(inboxes)
		.where(
			and(
				eq(inboxes.workspaceId, workspaceId),
				eq(inboxes.name, DEFAULT_INBOX_NAMES[channelType] ?? "Inbox"),
				eq(inboxes.isArchived, false),
			),
		)
		.get();
	if (named) {
		await db
			.insert(inboxChannels)
			.values({
				id: crypto.randomUUID(),
				inboxId: named.id,
				channelId,
				isDefault: true,
			})
			.onConflictDoNothing()
			.run();
		return named;
	}

	// 4. First channel of its type in this workspace — create the shared inbox.
	const inboxId = crypto.randomUUID();
	await db
		.insert(inboxes)
		.values({
			id: inboxId,
			workspaceId,
			name: DEFAULT_INBOX_NAMES[channelType] ?? "Inbox",
			createdAt: now,
			updatedAt: Date.now(),
		})
		.run();
	await db
		.insert(inboxChannels)
		.values({ id: crypto.randomUUID(), inboxId, channelId, isDefault: true })
		.run();
	const created = await db
		.select()
		.from(inboxes)
		.where(eq(inboxes.id, inboxId))
		.get();
	if (!created) throw new Error("inbox bootstrap failed");
	return created;
}
