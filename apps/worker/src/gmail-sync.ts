import { channels, gmailAccounts, gmailMessageRefs } from "@msgflow/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import type { GmailMessage } from "./gmail-api";
import { GmailApi } from "./gmail-api";
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

/** Imports a bounded Inbox snapshot under a renewable compare-and-set lease. */
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
				await renewLease(env, channelId, claimToken);
				const thread = await gmail.getThread(listed.id);
				if (thread.id !== listed.id || !isGmailId(thread.id)) continue;
				threads++;
				const inbound = thread.messages
					.filter((message) =>
						eligibleMessage(message, listed.id, account.email, cutoff),
					)
					.sort(compareMessages);
				const participant =
					inbound[0] &&
					normalizeAddress(
						headersByName(inbound[0].payload.headers ?? []).from,
					);
				if (!participant) continue;
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
