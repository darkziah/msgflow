import type { OutboundMessage, ProviderSendResult } from "@msgflow/channel";
import {
	channels,
	contactIdentities,
	conversations,
	gmailAccountDelegates,
	gmailAccounts,
	gmailMessageRefs,
	teamMembers,
	workspaceMembers,
} from "@msgflow/db";
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import { GmailApi, GmailApiError } from "./gmail-api";

/** Gmail content authorization is deliberately separate from Cloudflare mailbox access. */
export async function resolveGmailOutboundContext(
	env: Env,
	conversationId: string,
	actorId: string,
): Promise<
	| { ok: false; error: string }
	| {
			ok: true;
			to: string;
			send: (message: OutboundMessage) => Promise<ProviderSendResult>;
	  }
> {
	const db = drizzle(env.DB);
	const row = await db
		.select({
			conversation: conversations,
			channel: channels,
			account: gmailAccounts,
			recipient: contactIdentities.externalUserId,
			membership: workspaceMembers.userId,
			delegate: gmailAccountDelegates.userId,
			teamMember: teamMembers.userId,
		})
		.from(conversations)
		.innerJoin(channels, eq(channels.id, conversations.channelId))
		.innerJoin(gmailAccounts, eq(gmailAccounts.channelId, channels.id))
		.innerJoin(
			contactIdentities,
			and(
				eq(contactIdentities.contactId, conversations.contactId),
				eq(contactIdentities.channelId, channels.id),
			),
		)
		.leftJoin(
			workspaceMembers,
			and(
				eq(workspaceMembers.workspaceId, conversations.workspaceId),
				eq(workspaceMembers.userId, actorId),
			),
		)
		.leftJoin(
			gmailAccountDelegates,
			and(
				eq(gmailAccountDelegates.accountId, gmailAccounts.id),
				eq(gmailAccountDelegates.userId, actorId),
			),
		)
		.leftJoin(
			teamMembers,
			and(
				eq(teamMembers.teamId, gmailAccounts.teamId),
				eq(teamMembers.userId, actorId),
			),
		)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(channels.type, "gmail"),
				eq(channels.status, "active"),
				eq(gmailAccounts.syncState, "idle"),
			),
		)
		.get();
	if (!row) return { ok: false, error: "Gmail conversation is unavailable" };
	if (!row.membership)
		return { ok: false, error: "you do not have access to this Gmail account" };
	if (
		(row.account.accessMode === "private" &&
			row.account.ownerUserId !== actorId &&
			!row.delegate) ||
		(row.account.accessMode === "shared" && !row.teamMember)
	)
		return { ok: false, error: "you do not have access to this Gmail account" };
	const threadId = row.conversation.externalThreadId;
	const expectedConversationId = `gmail:${row.channel.id}:${threadId}`;
	if (
		!threadId ||
		row.conversation.id !== expectedConversationId ||
		!row.recipient
	)
		return { ok: false, error: "Gmail conversation mapping is invalid" };

	const refs = await db
		.select({
			rfcMessageId: gmailMessageRefs.rfcMessageId,
			referencesJson: gmailMessageRefs.referencesJson,
		})
		.from(gmailMessageRefs)
		.where(
			and(
				eq(gmailMessageRefs.channelId, row.channel.id),
				eq(gmailMessageRefs.conversationId, conversationId),
				or(
					eq(gmailMessageRefs.direction, "inbound"),
					eq(gmailMessageRefs.direction, "outbound"),
				),
			),
		)
		.orderBy(gmailMessageRefs.createdAt)
		.all();
	const rfcIds = refs.flatMap((ref) => [
		...parseReferences(ref.referencesJson),
		...(ref.rfcMessageId ? [ref.rfcMessageId] : []),
	]);
	const references = [...new Set(rfcIds.map(safeRfcId).filter(Boolean))];
	const inReplyTo = references.at(-1);
	return {
		ok: true,
		to: row.recipient,
		send: async (message) => {
			if (message.attachments?.length)
				return {
					ok: false,
					providerMessageId: null,
					error: "Gmail attachments are not supported",
					failureKind: "definitive",
				};
			try {
				const gmail = await GmailApi.forChannel(env, row.channel.id);
				const accepted = await gmail.sendMessage(
					buildRawMessage({
						from: row.account.email,
						to: row.recipient,
						subject: normalizeReplySubject(
							message.subject ?? row.conversation.subject,
						),
						text: message.text,
						inReplyTo,
						references,
						intentId: message.idempotencyKey,
					}),
					threadId,
				);
				if (accepted.threadId !== threadId)
					return {
						ok: false,
						providerMessageId: null,
						error: "Gmail send outcome is uncertain",
						failureKind: "uncertain",
					};
				await db
					.insert(gmailMessageRefs)
					.values({
						channelId: row.channel.id,
						gmailMessageId: accepted.id,
						gmailThreadId: accepted.threadId,
						conversationId,
						direction: "outbound",
						inReplyTo: inReplyTo ?? null,
						referencesJson: references.length
							? JSON.stringify(references)
							: null,
						createdAt: new Date().toISOString(),
					})
					.onConflictDoNothing()
					.run();
				return { ok: true, providerMessageId: accepted.id };
			} catch (error) {
				if (error instanceof GmailApiError)
					return {
						ok: false,
						providerMessageId: null,
						error: error.message,
						failureKind:
							error.kind === "uncertain"
								? "uncertain"
								: error.kind === "retryable"
									? "definitive"
									: "definitive",
					};
				// The provider may have accepted before the mapping write failed.
				return {
					ok: false,
					providerMessageId: null,
					error: "Gmail send outcome is uncertain",
					failureKind: "uncertain",
				};
			}
		},
	};
}

function parseReferences(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}
function safeRfcId(value: string): string {
	if (!value || /[\r\n]/.test(value)) return "";
	return value.startsWith("<") ? value : `<${value}>`;
}
function headerValue(value: string): string {
	if (/[\r\n]/.test(value)) throw new Error("invalid RFC header");
	return value;
}
export function normalizeReplySubject(
	subject: string | null | undefined,
): string {
	const base = (subject ?? "").replace(/^(?:\s*re\s*:\s*)+/i, "").trim();
	return `Re: ${base || "(no subject)"}`;
}
export function buildRawMessage(input: {
	from: string;
	to: string;
	subject: string;
	text: string;
	inReplyTo?: string;
	references: string[];
	intentId?: string;
}): string {
	const headers = [
		`From: ${headerValue(input.from)}`,
		`To: ${headerValue(input.to)}`,
		`Subject: ${headerValue(input.subject)}`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
	];
	if (input.inReplyTo)
		headers.push(`In-Reply-To: ${headerValue(input.inReplyTo)}`);
	if (input.references.length)
		headers.push(`References: ${input.references.map(headerValue).join(" ")}`);
	if (input.intentId)
		headers.push(`X-MsgFlow-Intent: ${headerValue(input.intentId)}`);
	return `${headers.join("\r\n")}\r\n\r\n${input.text.replace(/\r?\n/g, "\r\n")}`;
}
