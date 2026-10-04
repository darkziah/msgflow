import { channels, gmailAccounts, gmailMessageRefs } from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { GmailApi } from "./gmail-api";
import { routeInbound } from "./ingest";

const MAX_BACKFILL_THREADS = 5_000;
const SYNC_LEASE_MS = 10 * 60 * 1000;

export type GmailBackfillResult = {
	threads: number;
	messages: number;
	truncated: boolean;
};

/**
 * Imports a bounded Inbox snapshot. History/watch reconciliation deliberately
 * remains separate: this routine owns no Google push state and never mutates
 * Gmail labels or Cloudflare email persistence.
 */
export async function backfillGmailInbox(
	env: Env,
	channelId: string,
): Promise<GmailBackfillResult> {
	const db = drizzle(env.DB);
	const account = await db
		.select({
			channelId: gmailAccounts.channelId,
			backfillDays: gmailAccounts.backfillDays,
			email: gmailAccounts.email,
			workspaceId: gmailAccounts.workspaceId,
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
		throw new Error("Gmail sync is already running or requires reconnection");

	try {
		const gmail = await GmailApi.forChannel(env, channelId);
		const query = `newer_than:${account.backfillDays}d -in:spam -in:trash -in:drafts`;
		let pageToken: string | undefined;
		let threads = 0;
		let messages = 0;
		let truncated = false;
		do {
			const page = await gmail.listInboxThreads(query, pageToken);
			for (const listed of page.threads) {
				if (threads >= MAX_BACKFILL_THREADS) {
					truncated = true;
					break;
				}
				threads++;
				const thread = await gmail.getThread(listed.id);
				for (const message of thread.messages) {
					if (!shouldImport(message.labelIds)) continue;
					const headers = headersByName(message.payload.headers ?? []);
					const from = normalizeAddress(headers.from);
					if (!from || from === account.email.toLowerCase()) continue;
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
					const createdAt = new Date(
						Number(message.internalDate),
					).toISOString();
					const conversationId = `gmail:${channelId}:${message.threadId}`;
					await routeInbound(env, {
						conversationId,
						channel: "gmail",
						providerMessageId: message.id,
						senderId: from,
						text,
						createdAt: Number.isNaN(Date.parse(createdAt)) ? now : createdAt,
						payload: {
							subject: headers.subject ?? null,
							gmailThreadId: message.threadId,
							gmailMessageId: message.id,
						},
						attachments: [],
					});
					await db
						.insert(gmailMessageRefs)
						.values({
							channelId,
							gmailMessageId: message.id,
							gmailThreadId: message.threadId,
							conversationId,
							direction: "inbound",
							rfcMessageId: headers["message-id"] ?? null,
							inReplyTo: headers["in-reply-to"] ?? null,
							referencesJson: headers.references
								? JSON.stringify(headers.references.split(/\s+/))
								: null,
							labelIdsJson: JSON.stringify(message.labelIds),
							createdAt: now,
						})
						.onConflictDoNothing()
						.run();
					messages++;
				}
			}
			if (truncated) break;
			pageToken = page.nextPageToken ?? undefined;
		} while (pageToken);
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
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_state=CASE WHEN sync_state='reconnect_required' THEN sync_state ELSE 'error' END, last_error='Gmail Inbox sync failed', updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(new Date().toISOString(), channelId, claimToken)
			.run();
		throw error;
	} finally {
		await env.DB.prepare(
			"UPDATE gmail_accounts SET sync_claim_token=NULL, sync_claimed_at=NULL, updated_at=? WHERE channel_id=? AND sync_claim_token=?",
		)
			.bind(new Date().toISOString(), channelId, claimToken)
			.run();
	}
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
		if (!/[\r\n]/.test(header.value))
			result[header.name.toLowerCase()] = header.value.trim();
	return result;
}

function normalizeAddress(value: string | undefined): string | null {
	const address = value?.match(/<?([^\s<>@]+@[^\s<>@]+)>?/)?.[1]?.toLowerCase();
	return address ?? null;
}

function decodeText(payload: {
	body?: { data?: string };
	parts?: unknown[];
}): string {
	const encoded = payload.body?.data ?? findTextPart(payload.parts ?? []);
	if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return "";
	try {
		const padded = encoded
			.replaceAll("-", "+")
			.replaceAll("_", "/")
			.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
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
