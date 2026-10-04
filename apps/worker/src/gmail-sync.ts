import {
	channels,
	gmailAccounts,
	gmailMessageRefs,
	gmailSyncRequests,
} from "@msgflow/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import type { GmailMessage } from "./gmail-api";
import { GmailApi, GmailApiError } from "./gmail-api";
import { routeInbound } from "./ingest";

const MAX_BACKFILL_THREADS = 5_000;
const SYNC_LEASE_MS = 10 * 60 * 1000;
const GMAIL_ID = /^[A-Za-z0-9_-]+$/;

export type GmailBackfillResult = {
	threads: number;
	messages: number;
	truncated: boolean;
};

class LostGmailSyncLeaseError extends Error {}

/** Runs initial snapshots durably from the existing minute cron, never OAuth's redirect request. */
export async function backfillPendingGmailInboxes(env: Env): Promise<void> {
	const db = drizzle(env.DB);
	const pending = await db
		.select({ channelId: gmailAccounts.channelId })
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
				or(
					eq(gmailAccounts.syncState, "idle"),
					eq(gmailAccounts.syncState, "error"),
				),
				isNull(gmailAccounts.lastSyncedAt),
			),
		)
		.all();
	for (const account of pending) {
		try {
			await backfillGmailInbox(env, account.channelId);
		} catch (error) {
			// A competing cron or a reconnect state is expected. The owning run stores
			// controlled error state; cron must continue with other accounts.
			if (!(error instanceof LostGmailSyncLeaseError))
				console.error("Gmail initial sync failed");
		}
	}
}

export async function reconcilePendingGmailHistory(env: Env): Promise<void> {
	const pending = await drizzle(env.DB)
		.select({
			channelId: gmailSyncRequests.channelId,
			requestedHistoryId: gmailSyncRequests.requestedHistoryId,
		})
		.from(gmailSyncRequests)
		.innerJoin(channels, eq(gmailSyncRequests.channelId, channels.id))
		.where(and(eq(channels.type, "gmail"), eq(channels.status, "active")))
		.all();
	for (const request of pending) {
		try {
			await reconcileGmailHistory(
				env,
				request.channelId,
				request.requestedHistoryId,
			);
			// Delete only the exact request we consumed. A concurrent Pub/Sub delivery
			// can upsert a newer cursor while Gmail is being reconciled.
			await env.DB.prepare(
				"DELETE FROM gmail_sync_requests WHERE channel_id=? AND requested_history_id=?",
			)
				.bind(request.channelId, request.requestedHistoryId)
				.run();
		} catch (error) {
			if (!(error instanceof LostGmailSyncLeaseError))
				console.error("Gmail pending history sync failed");
		}
	}
}

/** Renews active Gmail watches before their seven-day provider expiry. */
export async function renewExpiringGmailWatches(env: Env): Promise<void> {
	if (!env.GOOGLE_PUBSUB_TOPIC) return;
	const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	const accounts = await drizzle(env.DB)
		.select({ channelId: gmailAccounts.channelId })
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
				or(
					isNull(gmailAccounts.watchExpirationAt),
					sql`${gmailAccounts.watchExpirationAt} < ${threshold}`,
				),
			),
		)
		.all();
	for (const account of accounts) {
		try {
			await renewGmailWatch(env, account.channelId, env.GOOGLE_PUBSUB_TOPIC);
		} catch (error) {
			if (!(error instanceof LostGmailSyncLeaseError))
				console.error("Gmail watch renewal failed");
		}
	}
}

async function renewGmailWatch(
	env: Env,
	channelId: string,
	topicName: string,
): Promise<void> {
	const claimToken = crypto.randomUUID();
	const now = new Date().toISOString();
	const expired = new Date(Date.now() - SYNC_LEASE_MS).toISOString();
	const claim = await env.DB.prepare(
		`UPDATE gmail_accounts SET sync_claim_token=?, sync_claimed_at=?, sync_state='syncing', updated_at=?
		 WHERE channel_id=? AND (sync_claim_token IS NULL OR sync_claimed_at < ?)
		 AND sync_state <> 'reconnect_required'`,
	)
		.bind(claimToken, now, now, channelId, expired)
		.run();
	if (claim.meta.changes !== 1)
		throw new LostGmailSyncLeaseError(
			"Gmail sync is already running or requires reconnection",
		);
	try {
		const gmail = await GmailApi.forChannel(env, channelId, claimToken);
		const watch = await gmail.watch(topicName);
		const expirationAt = new Date(Number(watch.expiration)).toISOString();
		if (Number.isNaN(new Date(expirationAt).valueOf()))
			throw new GmailApiError("Gmail returned an invalid watch", "definitive");
		const result = await env.DB.prepare(
			"UPDATE gmail_accounts SET watch_expiration_at=?, history_id=CASE WHEN history_id IS NULL THEN ? ELSE history_id END, sync_state='idle', last_error=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(
				expirationAt,
				watch.historyId,
				new Date().toISOString(),
				channelId,
				claimToken,
			)
			.run();
		if (result.meta.changes !== 1)
			throw new LostGmailSyncLeaseError("Gmail watch lease was lost");
	} catch (error) {
		if (!(error instanceof LostGmailSyncLeaseError)) {
			await env.DB.prepare(
				"UPDATE gmail_accounts SET sync_state=CASE WHEN sync_state='reconnect_required' THEN sync_state ELSE 'error' END, last_error='Gmail watch renewal failed', updated_at=? WHERE channel_id=? AND sync_claim_token=?",
			)
				.bind(new Date().toISOString(), channelId, claimToken)
				.run();
			throw error;
		}
	} finally {
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_claim_token=NULL, sync_claimed_at=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(new Date().toISOString(), channelId, claimToken)
			.run();
	}
}

export type GmailHistorySyncResult = {
	messages: number;
	recovered: boolean;
};

/** Reconciles a stored Gmail history cursor; requested IDs only trigger work. */
export async function reconcileGmailHistory(
	env: Env,
	channelId: string,
	_requestedHistoryId?: string,
): Promise<GmailHistorySyncResult> {
	const db = drizzle(env.DB);
	const account = await db
		.select({
			email: gmailAccounts.email,
			historyId: gmailAccounts.historyId,
			backfillDays: gmailAccounts.backfillDays,
		})
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(gmailAccounts.channelId, channelId),
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
			),
		)
		.get();
	if (!account) throw new Error("Gmail channel is unavailable");
	if (!account.historyId) {
		await backfillGmailInbox(env, channelId);
		return { messages: 0, recovered: true };
	}
	const claimToken = crypto.randomUUID();
	const now = new Date().toISOString();
	const expired = new Date(Date.now() - SYNC_LEASE_MS).toISOString();
	const claim = await env.DB.prepare(
		`UPDATE gmail_accounts SET sync_claim_token=?, sync_claimed_at=?, sync_state='syncing', updated_at=?
		 WHERE channel_id=? AND (sync_claim_token IS NULL OR sync_claimed_at < ?)
		 AND sync_state <> 'reconnect_required'`,
	)
		.bind(claimToken, now, now, channelId, expired)
		.run();
	if (claim.meta.changes !== 1)
		throw new LostGmailSyncLeaseError(
			"Gmail sync is already running or requires reconnection",
		);
	let recover = false;
	try {
		const gmail = await GmailApi.forChannel(env, channelId, claimToken);
		const cutoff = Date.now() - account.backfillDays * 86_400_000;
		let pageToken: string | undefined;
		let messages = 0;
		do {
			await renewLease(env, channelId, claimToken);
			const page = await gmail.listHistory(account.historyId, pageToken);
			const threadIds = new Set<string>();
			for (const event of page.history)
				for (const added of event.messagesAdded)
					if (isGmailId(added.id) && isGmailId(added.threadId))
						threadIds.add(added.threadId);
			for (const threadId of threadIds) {
				const projected = await projectGmailThread({
					env,
					db,
					gmail,
					channelId,
					claimToken,
					threadId,
					accountEmail: account.email,
					cutoff,
				});
				messages += projected?.messages ?? 0;
			}
			const pageCursor =
				greatestHistoryId(page.history.map((event) => event.id)) ??
				(!page.nextPageToken ? page.historyId : null);
			if (pageCursor)
				await commitHistoryCursor(
					env,
					channelId,
					claimToken,
					account.historyId,
					pageCursor,
				);
			pageToken = page.nextPageToken ?? undefined;
		} while (pageToken);
		await renewLease(env, channelId, claimToken);
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_state='idle', last_synced_at=?, last_error=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(
				new Date().toISOString(),
				new Date().toISOString(),
				channelId,
				claimToken,
			)
			.run();
		return { messages, recovered: false };
	} catch (error) {
		if (error instanceof GmailApiError && error.kind === "historyExpired") {
			recover = true;
			await env.DB.prepare(
				"UPDATE gmail_accounts SET history_id=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
			)
				.bind(new Date().toISOString(), channelId, claimToken)
				.run();
		} else if (!(error instanceof LostGmailSyncLeaseError)) {
			await env.DB.prepare(
				"UPDATE gmail_accounts SET sync_state=CASE WHEN sync_state='reconnect_required' THEN sync_state ELSE 'error' END, last_error='Gmail history sync failed', updated_at=? WHERE channel_id=? AND sync_claim_token=?",
			)
				.bind(new Date().toISOString(), channelId, claimToken)
				.run();
			throw error;
		}
		if (!recover) throw error;
		return { messages: 0, recovered: true };
	} finally {
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_claim_token=NULL, sync_claimed_at=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(new Date().toISOString(), channelId, claimToken)
			.run();
		if (recover) await backfillGmailInbox(env, channelId);
	}
}

async function commitHistoryCursor(
	env: Env,
	channelId: string,
	claimToken: string,
	current: string,
	candidate: string,
): Promise<void> {
	if (compareHistoryIds(candidate, current) <= 0) return;
	await renewLease(env, channelId, claimToken);
	const result = await env.DB.prepare(
		"UPDATE gmail_accounts SET history_id=?, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
	)
		.bind(candidate, new Date().toISOString(), channelId, claimToken)
		.run();
	if (result.meta.changes !== 1)
		throw new LostGmailSyncLeaseError("Gmail history cursor was not advanced");
}

function greatestHistoryId(ids: string[]): string | null {
	return ids
		.filter((id) => /^\d+$/.test(id))
		.reduce<string | null>(
			(greatest, id) =>
				!greatest || compareHistoryIds(id, greatest) > 0 ? id : greatest,
			null,
		);
}
function compareHistoryIds(a: string, b: string): number {
	if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return a.localeCompare(b);
	const left = a.replace(/^0+/, "") || "0";
	const right = b.replace(/^0+/, "") || "0";
	return left.length - right.length || left.localeCompare(right);
}

export async function backfillGmailInbox(
	env: Env,
	channelId: string,
): Promise<GmailBackfillResult> {
	const db = drizzle(env.DB);
	const account = await db
		.select({
			backfillDays: gmailAccounts.backfillDays,
			email: gmailAccounts.email,
		})
		.from(gmailAccounts)
		.innerJoin(channels, eq(gmailAccounts.channelId, channels.id))
		.where(
			and(
				eq(gmailAccounts.channelId, channelId),
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
			),
		)
		.get();
	if (!account) throw new Error("Gmail channel is unavailable");

	const claimToken = crypto.randomUUID();
	const now = new Date().toISOString();
	const expired = new Date(Date.now() - SYNC_LEASE_MS).toISOString();
	const claim = await env.DB.prepare(
		`UPDATE gmail_accounts SET sync_claim_token=?, sync_claimed_at=?, sync_state='syncing', updated_at=?
		 WHERE channel_id=? AND (sync_claim_token IS NULL OR sync_claimed_at < ?)
		 AND sync_state <> 'reconnect_required'`,
	)
		.bind(claimToken, now, now, channelId, expired)
		.run();
	if (claim.meta.changes !== 1)
		throw new LostGmailSyncLeaseError(
			"Gmail sync is already running or requires reconnection",
		);

	try {
		const gmail = await GmailApi.forChannel(env, channelId, claimToken);
		const query = `newer_than:${account.backfillDays}d -in:spam -in:trash -in:drafts`;
		const cutoff = Date.now() - account.backfillDays * 86_400_000;
		let pageToken: string | undefined;
		let threads = 0;
		let messages = 0;
		let truncated = false;
		do {
			await renewLease(env, channelId, claimToken);
			const page = await gmail.listInboxThreads(query, pageToken);
			for (const listed of page.threads) {
				if (threads >= MAX_BACKFILL_THREADS) {
					truncated = true;
					break;
				}
				if (!isGmailId(listed.id)) continue;
				const projected = await projectGmailThread({
					env,
					db,
					gmail,
					channelId,
					claimToken,
					threadId: listed.id,
					accountEmail: account.email,
					cutoff,
				});
				if (projected) threads++;
				messages += projected?.messages ?? 0;
			}
			if (truncated) break;
			pageToken = page.nextPageToken ?? undefined;
		} while (pageToken);
		await renewLease(env, channelId, claimToken);
		const profile = await gmail.getProfile();
		await env.DB.prepare(
			"UPDATE gmail_accounts SET history_id=?, last_synced_at=?, sync_state='idle', last_error=?, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(
				profile.historyId,
				new Date().toISOString(),
				truncated
					? "Gmail Inbox backfill reached the 5,000-thread limit"
					: null,
				new Date().toISOString(),
				channelId,
				claimToken,
			)
			.run();
		return { threads, messages, truncated };
	} catch (error) {
		if (!(error instanceof LostGmailSyncLeaseError)) {
			await env.DB.prepare(
				"UPDATE gmail_accounts SET sync_state=CASE WHEN sync_state='reconnect_required' THEN sync_state ELSE 'error' END, last_error='Gmail Inbox sync failed', updated_at=? WHERE channel_id=? AND sync_claim_token=?",
			)
				.bind(new Date().toISOString(), channelId, claimToken)
				.run();
		}
		throw error;
	} finally {
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_claim_token=NULL, sync_claimed_at=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(new Date().toISOString(), channelId, claimToken)
			.run();
	}
}

async function renewLease(
	env: Env,
	channelId: string,
	claimToken: string,
): Promise<void> {
	const result = await env.DB.prepare(
		"UPDATE gmail_accounts SET sync_claimed_at=?, updated_at=? WHERE channel_id=? AND sync_claim_token=? AND sync_state='syncing'",
	)
		.bind(
			new Date().toISOString(),
			new Date().toISOString(),
			channelId,
			claimToken,
		)
		.run();
	if (result.meta.changes !== 1)
		throw new LostGmailSyncLeaseError("Gmail sync lease was lost");
}

async function projectGmailThread({
	env,
	db,
	gmail,
	channelId,
	claimToken,
	threadId,
	accountEmail,
	cutoff,
}: {
	env: Env;
	db: ReturnType<typeof drizzle>;
	gmail: GmailApi;
	channelId: string;
	claimToken: string;
	threadId: string;
	accountEmail: string;
	cutoff: number;
}): Promise<{ messages: number } | null> {
	await renewLease(env, channelId, claimToken);
	const thread = await gmail.getThread(threadId);
	if (thread.id !== threadId || !isGmailId(thread.id)) return null;
	const inbound = thread.messages
		.filter((message) =>
			eligibleMessage(message, threadId, accountEmail, cutoff),
		)
		.sort(compareMessages);
	const participant =
		inbound[0] &&
		normalizeAddress(headersByName(inbound[0].payload.headers ?? []).from);
	if (!participant) return { messages: 0 };
	let messages = 0;
	for (const message of inbound) {
		const headers = headersByName(message.payload.headers ?? []);
		if (normalizeAddress(headers.from) !== participant) continue;
		const existing = await db
			.select({ id: gmailMessageRefs.gmailMessageId })
			.from(gmailMessageRefs)
			.where(
				and(
					eq(gmailMessageRefs.channelId, channelId),
					eq(gmailMessageRefs.gmailMessageId, message.id),
				),
			)
			.get();
		if (existing) continue;
		const text = decodeText(message.payload);
		if (!text) continue;
		await renewLease(env, channelId, claimToken);
		const conversationId = `gmail:${channelId}:${thread.id}`;
		await routeInbound(env, {
			conversationId,
			channel: "gmail",
			providerMessageId: message.id,
			senderId: participant,
			text,
			createdAt: new Date(Number(message.internalDate)).toISOString(),
			payload: {
				subject: headers.subject ?? null,
				gmailThreadId: thread.id,
				gmailMessageId: message.id,
			},
			attachments: [],
		});
		await renewLease(env, channelId, claimToken);
		const inserted = await db
			.insert(gmailMessageRefs)
			.values({
				channelId,
				gmailMessageId: message.id,
				gmailThreadId: thread.id,
				conversationId,
				direction: "inbound",
				rfcMessageId: headers["message-id"] ?? null,
				inReplyTo: headers["in-reply-to"] ?? null,
				referencesJson: headers.references
					? JSON.stringify(headers.references.split(/\s+/))
					: null,
				labelIdsJson: JSON.stringify(message.labelIds),
				createdAt: new Date().toISOString(),
			})
			.onConflictDoNothing()
			.run();
		messages += inserted.meta.changes ?? 0;
	}
	return { messages };
}

function eligibleMessage(
	message: GmailMessage,
	threadId: string,
	accountEmail: string,
	cutoff: number,
): boolean {
	if (
		!isGmailId(message.id) ||
		message.threadId !== threadId ||
		!isGmailId(message.threadId) ||
		!shouldImport(message.labelIds)
	)
		return false;
	const timestamp = Number(message.internalDate);
	if (
		!Number.isSafeInteger(timestamp) ||
		timestamp < cutoff ||
		timestamp > 8_640_000_000_000_000 ||
		timestamp > Date.now() + 300_000
	)
		return false;
	const from = normalizeAddress(
		headersByName(message.payload.headers ?? []).from,
	);
	return !!from && from !== accountEmail.toLowerCase();
}
function compareMessages(a: GmailMessage, b: GmailMessage): number {
	return (
		Number(a.internalDate) - Number(b.internalDate) || a.id.localeCompare(b.id)
	);
}
function isGmailId(value: string): boolean {
	return GMAIL_ID.test(value);
}
function shouldImport(labels: string[]): boolean {
	return (
		labels.includes("INBOX") &&
		!labels.some((label) => ["SPAM", "TRASH", "DRAFT", "SENT"].includes(label))
	);
}
function headersByName(
	headers: { name: string; value: string }[],
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const header of headers)
		if (
			typeof header.name === "string" &&
			typeof header.value === "string" &&
			!/[\r\n]/.test(header.value)
		)
			result[header.name.toLowerCase()] = header.value.trim();
	return result;
}
function normalizeAddress(value: string | undefined): string | null {
	return value?.match(/<?([^\s<>@]+@[^\s<>@]+)>?/)?.[1]?.toLowerCase() ?? null;
}
function decodeText(payload: {
	body?: { data?: string };
	parts?: unknown[];
}): string {
	const encoded = payload.body?.data ?? findTextPart(payload.parts ?? []);
	if (!encoded || !/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)) return "";
	try {
		const unpadded = encoded.replace(/=+$/, "");
		if (unpadded.length % 4 === 1) return "";
		const padded = unpadded
			.replaceAll("-", "+")
			.replaceAll("_", "/")
			.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
		return new TextDecoder()
			.decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))
			.slice(0, 256 * 1024)
			.trim();
	} catch {
		return "";
	}
}
function findTextPart(parts: unknown[]): string | undefined {
	for (const part of parts) {
		if (!part || typeof part !== "object") continue;
		const item = part as {
			mimeType?: unknown;
			body?: { data?: unknown };
			parts?: unknown[];
		};
		if (item.mimeType === "text/plain" && typeof item.body?.data === "string")
			return item.body.data;
		const nested = findTextPart(item.parts ?? []);
		if (nested) return nested;
	}
}
