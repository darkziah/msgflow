import type { Attachment } from "@msgflow/contracts";
import { canAccessMailbox } from "./email-transport";
import type { Env } from "./env";
export const MAX_EMAIL_BYTES = 5 * 1024 * 1024;
export async function readBoundedEmail(
	stream: ReadableStream<Uint8Array>,
	limit = MAX_EMAIL_BYTES,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new Error("message exceeds the 5 MiB pilot limit");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
export function validateEmailAttachment(type: string, bytes: Uint8Array): void {
	const signatures: Record<string, boolean> = {
		"application/pdf": new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-",
		"image/png":
			bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71,
		"image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
		"image/gif":
			new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null,
		"image/webp":
			new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
			new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP",
	};
	if (!signatures[type] || bytes.length > MAX_EMAIL_BYTES)
		throw new Error("unsupported or oversized email attachment");
}
export interface EmailAttachmentScope {
	workspaceId: string;
	mailboxId: string;
	conversationId?: string;
	ingressId?: string;
	actorId?: string;
}
/** Internal ingress primitive; HTTP callers must use uploadPrivateEmailAttachment. */
export async function storePrivateEmailAttachment(
	env: Env,
	scope: EmailAttachmentScope,
	name: string,
	type: string,
	bytes: Uint8Array,
	id = crypto.randomUUID(),
): Promise<Attachment> {
	validateEmailAttachment(type, bytes);
	const key = `email/attachments/${scope.mailboxId}/${id}`;
	const clean =
		// biome-ignore lint/suspicious/noControlCharactersInRegex: strip unsafe filename controls
		name.replace(/[\r\n\x00-\x1f/\\]/g, "-").slice(0, 200) || "attachment";
	await env.EMAIL_ARCHIVE.put(key, bytes, {
		httpMetadata: { contentType: type },
	});
	await env.DB.prepare(
		`INSERT OR IGNORE INTO email_private_attachments(id,workspace_id,mailbox_id,conversation_id,ingress_id,actor_id,object_key,name,mime_type,size,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
	)
		.bind(
			id,
			scope.workspaceId,
			scope.mailboxId,
			scope.conversationId ?? null,
			scope.ingressId ?? null,
			scope.actorId ?? null,
			key,
			clean,
			type,
			bytes.length,
			new Date().toISOString(),
		)
		.run();
	return {
		id,
		key,
		name: clean,
		type: type as Attachment["type"],
		size: bytes.length,
		url: `/api/email-attachments/${encodeURIComponent(id)}`,
	};
}
async function authorizeScope(
	env: Env,
	scope: EmailAttachmentScope,
	actorId: string,
): Promise<void> {
	const row = await env.DB.prepare(
		"SELECT canonical_address FROM mailboxes WHERE id=? AND workspace_id=?",
	)
		.bind(scope.mailboxId, scope.workspaceId)
		.first<{ canonical_address: string }>();
	if (
		!row ||
		!(await canAccessMailbox(
			env,
			scope.workspaceId,
			row.canonical_address,
			actorId,
		))
	)
		throw new Error("email attachment access denied");
	if (scope.conversationId) {
		const conversation = await env.DB.prepare(
			"SELECT c.id FROM conversations c JOIN channels ch ON ch.id=c.channel_id JOIN mailboxes m ON m.canonical_address=ch.external_id AND m.workspace_id=c.workspace_id WHERE c.id=? AND c.workspace_id=? AND m.id=?",
		)
			.bind(scope.conversationId, scope.workspaceId, scope.mailboxId)
			.first();
		if (!conversation) throw new Error("attachment conversation mismatch");
	}
}
export async function uploadPrivateEmailAttachment(
	env: Env,
	scope: EmailAttachmentScope & { actorId: string },
	name: string,
	type: string,
	stream: ReadableStream<Uint8Array>,
): Promise<Attachment> {
	await authorizeScope(env, scope, scope.actorId);
	return storePrivateEmailAttachment(
		env,
		scope,
		name,
		type,
		await readBoundedEmail(stream),
	);
}
export async function readPrivateEmailAttachment(
	env: Env,
	id: string,
	workspaceId: string,
	actorId: string,
	conversationId?: string,
): Promise<{ bytes: ArrayBuffer; name: string; type: string } | null> {
	const row = await env.DB.prepare(
		"SELECT * FROM email_private_attachments WHERE id=? AND workspace_id=?",
	)
		.bind(id, workspaceId)
		.first<{
			mailbox_id: string;
			ingress_id: string | null;
			conversation_id: string | null;
			object_key: string;
			name: string;
			mime_type: string;
			actor_id: string | null;
		}>();
	if (!row) return null;
	let bridgeAccess = false;
	if (row.conversation_id) {
		const receiving = await env.DB.prepare(
			"SELECT ch.external_id FROM conversations c JOIN channels ch ON ch.id=c.channel_id WHERE c.id=? AND c.workspace_id=? AND ch.type='email'",
		)
			.bind(row.conversation_id, workspaceId)
			.first<{ external_id: string }>();
		if (
			!receiving ||
			!(await canAccessMailbox(
				env,
				workspaceId,
				receiving.external_id,
				actorId,
			))
		)
			throw new Error("conversation attachment access denied");
		// A bridge grants only this canonical ingress message, never its mailbox.
		bridgeAccess =
			!!(await env.DB.prepare(`SELECT 1 FROM email_canonical_messages cm
		 JOIN email_identity_bridges b ON b.mailbox_id=cm.mailbox_id AND b.conversation_id=cm.conversation_id AND b.workspace_id=cm.workspace_id
		 JOIN mailboxes source ON source.id=cm.mailbox_id AND source.type='private'
		 JOIN mailboxes receiving ON receiving.workspace_id=cm.workspace_id AND receiving.canonical_address=? AND receiving.type='shared'
		 WHERE cm.ingress_id=? AND cm.mailbox_id=? AND cm.workspace_id=? AND cm.conversation_id=?`)
				.bind(
					receiving.external_id,
					row.ingress_id,
					row.mailbox_id,
					workspaceId,
					row.conversation_id,
				)
				.first());
	}
	if (!bridgeAccess)
		await authorizeScope(
			env,
			{ workspaceId, mailboxId: row.mailbox_id },
			actorId,
		);
	if (conversationId && row.conversation_id !== conversationId)
		throw new Error("attachment is not linked to this conversation");
	if (!row.conversation_id && row.actor_id !== actorId)
		throw new Error("unlinked attachment belongs to another actor");
	const object = await env.EMAIL_ARCHIVE.get(row.object_key);
	if (!object) return null;
	if (bridgeAccess)
		await env.DB.prepare(
			"INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at) VALUES(?,?,?,'identity_bridge.attachment_access',?,?,?)",
		)
			.bind(
				crypto.randomUUID(),
				workspaceId,
				actorId,
				id,
				JSON.stringify({
					conversationId: row.conversation_id,
					ingressId: row.ingress_id,
				}),
				new Date().toISOString(),
			)
			.run();
	return {
		bytes: await object.arrayBuffer(),
		name: row.name,
		type: row.mime_type,
	};
}
