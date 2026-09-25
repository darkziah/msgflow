import type { Attachment, Message } from "@msgflow/contracts";
import { emailConversationId } from "@msgflow/contracts";
import PostalMime from "postal-mime";
import {
	getCanonicalEmail,
	lookupEmailThread,
	projectCanonicalEmail,
} from "./email-persistence";
import {
	MAX_EMAIL_BYTES,
	readBoundedEmail,
	storePrivateEmailAttachment,
} from "./email-storage";
import {
	type AuthorizedEmailInboundRoute,
	canAccessMailbox,
	resolveInboundEmailRoute,
} from "./email-transport";
import type { Env } from "./env";
import { routeInbound } from "./ingest";
export const MAX_INBOUND_EMAIL_BYTES = MAX_EMAIL_BYTES;
// Leave room for JSON escaping and metadata under D1's 2 MiB row limit.
export const MAX_INBOUND_EMAIL_TEXT_BYTES = 256 * 1024;
export class EmailIngressRejectError extends Error {}
export interface StoredEmailIngress {
	id: string;
	raw: Uint8Array;
	rawObjectKey: string;
	dedupeKey: string;
}
interface IngressRow {
	id: string;
	workspace_id: string;
	mailbox_id: string;
	raw_object_key: string;
	envelope_from: string | null;
	received_at: string;
	state: string;
	canonical_address: string;
}
export async function archiveInboundEmail(
	env: Env,
	route: AuthorizedEmailInboundRoute,
	stream: ReadableStream<Uint8Array>,
	envelopeFrom?: string,
): Promise<StoredEmailIngress | null> {
	let raw: Uint8Array;
	try {
		raw = await readBoundedEmail(stream);
	} catch {
		throw new EmailIngressRejectError("message exceeds the 5 MiB pilot limit");
	}
	const dedupeKey = Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
	)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const rawObjectKey = `email/raw/${route.mailboxId}/${dedupeKey}.eml`;
	await env.EMAIL_ARCHIVE.put(rawObjectKey, raw, {
		httpMetadata: { contentType: "message/rfc822" },
	});
	const id = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT OR IGNORE INTO email_ingress(id,workspace_id,mailbox_id,dedupe_key,raw_object_key,raw_sha256,raw_bytes,state,received_at,envelope_from) VALUES(?,?,?,?,?,?,?,'stored',?,?)`,
	)
		.bind(
			id,
			route.workspaceId,
			route.mailboxId,
			dedupeKey,
			rawObjectKey,
			dedupeKey,
			raw.length,
			new Date().toISOString(),
			envelopeFrom ?? null,
		)
		.run();
	const row = await env.DB.prepare(
		"SELECT id,state FROM email_ingress WHERE mailbox_id=? AND dedupe_key=?",
	)
		.bind(route.mailboxId, dedupeKey)
		.first<{ id: string; state: string }>();
	if (!row) throw new Error("email ingress record unavailable");
	if (row.state === "processed") return null;
	return { id: row.id, raw, rawObjectKey, dedupeKey };
}
export function rfcIds(value: string | undefined): string[] {
	return (value?.match(/<[^<>\s]+>/g) ?? []).slice(-50);
}
/** Text only: never render untrusted HTML or fetch its resources. */
export function plainTextFromHtml(html: string): string {
	return html
		.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<!--([\s\S]*?)-->/g, "")
		.replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(
			/&(amp|lt|gt|quot|apos|nbsp);/gi,
			(_, e: string) =>
				({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[
					e.toLowerCase()
				] ?? "",
		)
		.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
			const code =
				n[0]?.toLowerCase() === "x"
					? Number.parseInt(n.slice(1), 16)
					: Number(n);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
		})
		.trim();
}
async function processIngress(env: Env, row: IngressRow): Promise<boolean> {
	const token = crypto.randomUUID();
	const now = Date.now();
	const claim = await env.DB.prepare(
		"UPDATE email_ingress SET state='processing',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state IN ('stored','failed','processing') AND (lease_until IS NULL OR lease_until<?)",
	)
		.bind(token, now + 300000, row.id, now)
		.run();
	if (!claim.meta.changes) return false;
	try {
		const resolution = await resolveInboundEmailRoute(
			env,
			row.canonical_address,
		);
		if (!resolution.ok) throw new Error("mailbox unavailable");
		const existing = await getCanonicalEmail(env, row.id);
		if (existing?.routing_done) {
			await projectCanonicalEmail(env, row.id);
		} else {
			const object = await env.EMAIL_ARCHIVE.get(row.raw_object_key);
			if (!object) throw new Error("raw archive missing");
			const raw = await readBoundedEmail(object.body);
			let email: Awaited<ReturnType<typeof PostalMime.parse>>;
			try {
				email = await PostalMime.parse(raw, {
					maxNestingDepth: 30,
					maxHeadersSize: 65536,
					attachmentEncoding: "arraybuffer",
				});
			} catch {
				throw new EmailIngressRejectError("invalid MIME message");
			}
			const text = email.text?.trim() || plainTextFromHtml(email.html ?? "");
			if (
				new TextEncoder().encode(text).byteLength > MAX_INBOUND_EMAIL_TEXT_BYTES
			)
				throw new EmailIngressRejectError("message text exceeds 256 KiB");
			const messageId = rfcIds(email.messageId)[0] ?? null;
			const references = rfcIds(email.references);
			const inReplyTo = rfcIds(email.inReplyTo)[0] ?? null;
			const from = email.from?.address ?? row.envelope_from ?? "";
			if (!from || /[\r\n]/.test(from))
				throw new EmailIngressRejectError("invalid sender");
			const prior = existing
				? (JSON.parse(existing.message_json) as Message)
				: null;
			const conversationId =
				prior?.conversationId ??
				(await lookupEmailThread(env, row.workspace_id, row.mailbox_id, [
					...references,
					...(inReplyTo ? [inReplyTo] : []),
				])) ??
				emailConversationId(row.canonical_address, row.id);
			const attachments: Attachment[] = [];
			let total = 0;
			// Validate every part before storing any attachment or routing a timeline.
			for (const attachment of email.attachments) {
				if (
					![
						"image/png",
						"image/jpeg",
						"image/gif",
						"image/webp",
						"application/pdf",
					].includes(attachment.mimeType)
				) {
					throw new EmailIngressRejectError("unsupported attachment MIME type");
				}
			}
			for (const [index, attachment] of email.attachments.entries()) {
				const bytes =
					typeof attachment.content === "string"
						? new TextEncoder().encode(attachment.content)
						: new Uint8Array(attachment.content);
				total += bytes.length;
				if (total > MAX_EMAIL_BYTES)
					throw new EmailIngressRejectError("attachments exceed 5 MiB");
				attachments.push(
					await storePrivateEmailAttachment(
						env,
						{
							workspaceId: row.workspace_id,
							mailboxId: row.mailbox_id,
							ingressId: row.id,
						},
						attachment.filename ?? "attachment",
						attachment.mimeType,
						bytes,
						`${row.id}-${index}`,
					),
				);
			}
			const metadata = {
				subject: email.subject ?? "",
				from,
				replyTo: email.replyTo ?? [],
				to: email.to ?? [],
				cc: email.cc ?? [],
				envelopeFrom: row.envelope_from,
				envelopeTo: row.canonical_address,
				messageId,
				inReplyTo,
				references,
				receivingMailboxId: row.mailbox_id,
			};
			await routeInbound(
				env,
				{
					conversationId,
					channel: "email",
					providerMessageId: messageId,
					senderId: from,
					text,
					createdAt: row.received_at,
					payload: metadata,
					attachments,
				},
				resolution.route,
				row.id,
			);
		}
		await env.DB.prepare(
			"UPDATE email_ingress SET state='processed',processed_at=?,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
		)
			.bind(new Date().toISOString(), row.id, token)
			.run();
		return true;
	} catch (error) {
		await env.DB.prepare(
			"UPDATE email_ingress SET state=?,error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
		)
			.bind(
				error instanceof EmailIngressRejectError ? "quarantined" : "failed",
				error instanceof EmailIngressRejectError
					? error.message
					: "processing failed; replay required",
				row.id,
				token,
			)
			.run();
		return false;
	}
}
export async function handleInboundEmail(
	env: Env,
	message: {
		to: string;
		from: string;
		raw: ReadableStream<Uint8Array>;
		setReject(reason: string): void;
	},
): Promise<void> {
	const route = await resolveInboundEmailRoute(env, message.to);
	if (!route.ok) {
		message.setReject(route.reason);
		return;
	}
	let stored: StoredEmailIngress | null;
	try {
		stored = await archiveInboundEmail(
			env,
			route.route,
			message.raw,
			message.from,
		);
	} catch (error) {
		if (error instanceof EmailIngressRejectError) {
			message.setReject(error.message);
			return;
		}
		throw error;
	}
	if (stored) await replayEmailIngress(env, undefined, undefined, stored.id);
}
/** With actorId, permission is checked per mailbox; without it, internal cron only. */
export async function replayEmailIngress(
	env: Env,
	workspaceId?: string,
	actorId?: string,
	id?: string,
): Promise<{ processed: number; attempted: number }> {
	if (actorId && !workspaceId) throw new Error("workspace required");
	const rows = await env.DB.prepare(
		`SELECT e.*,m.canonical_address FROM email_ingress e JOIN mailboxes m ON m.id=e.mailbox_id WHERE (e.state IN ('stored','failed','processing') OR (e.state='quarantined' AND ?=1)) AND (e.lease_until IS NULL OR e.lease_until<?) AND (? IS NULL OR e.workspace_id=?) AND (? IS NULL OR e.id=?) AND (e.attempts<10 OR ? IS NOT NULL) ORDER BY e.received_at LIMIT 20`,
	)
		.bind(
			actorId && id ? 1 : 0,
			Date.now(),
			workspaceId ?? null,
			workspaceId ?? null,
			id ?? null,
			id ?? null,
			id ?? null,
		)
		.all<IngressRow>();
	let processed = 0,
		attempted = 0;
	for (const row of rows.results) {
		if (
			actorId &&
			!(await canAccessMailbox(
				env,
				row.workspace_id,
				row.canonical_address,
				actorId,
			))
		)
			continue;
		if (row.state === "quarantined") {
			// Only an explicit, mailbox-authorized replay may release poison mail.
			// Compare-and-set prevents concurrent replays from releasing a new claim.
			const released = await env.DB.prepare(
				"UPDATE email_ingress SET state='stored',error=NULL,lease_token=NULL,lease_until=NULL WHERE id=? AND workspace_id=? AND state='quarantined' AND (lease_until IS NULL OR lease_until<?)",
			)
				.bind(row.id, row.workspace_id, Date.now())
				.run();
			if (!released.meta.changes) continue;
		}
		attempted++;
		if (await processIngress(env, row)) processed++;
	}
	return { processed, attempted };
}
// Legacy exports retained until the Worker entrypoint switches to handleInboundEmail.
export async function markEmailIngressProcessing(
	env: Env,
	id: string,
): Promise<void> {
	await env.DB.prepare(
		"UPDATE email_ingress SET state='processing' WHERE id=? AND state='stored'",
	)
		.bind(id)
		.run();
}
export async function markEmailIngressProcessed(
	env: Env,
	id: string,
): Promise<void> {
	await env.DB.prepare(
		"UPDATE email_ingress SET state='processed',processed_at=? WHERE id=?",
	)
		.bind(new Date().toISOString(), id)
		.run();
}
export async function quarantineEmailIngress(
	env: Env,
	id: string,
	reason: string,
): Promise<void> {
	await env.DB.prepare(
		"UPDATE email_ingress SET state='quarantined',error=? WHERE id=?",
	)
		.bind(reason.slice(0, 200), id)
		.run();
}
