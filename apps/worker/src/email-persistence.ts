import type { Message } from "@msgflow/contracts";
import { canAccessMailbox } from "./email-transport";
import type { Env } from "./env";
import { evaluateRules, type RuleEvaluationContext } from "./rules";

export interface EmailOutboundMetadata {
	intent_id: string;
	workspace_id: string;
	receiving_mailbox_id: string;
	mailbox_id: string;
	from_address: string;
	to_address: string;
	in_reply_to: string | null;
	references_json: string;
	confirm_private_identity: number;
	created_at: string;
}
export async function getEmailOutboundMetadata(
	env: Env,
	id: string,
): Promise<EmailOutboundMetadata | null> {
	return env.DB.prepare(
		"SELECT * FROM email_outbound_metadata WHERE intent_id=?",
	)
		.bind(id)
		.first<EmailOutboundMetadata>();
}
export async function resolveEmailReplyMetadata(
	env: Env,
	conversationId: string,
	actorId: string,
	mailboxId?: string,
	confirmPrivateIdentity = false,
): Promise<Omit<EmailOutboundMetadata, "intent_id" | "created_at">> {
	const receiving = await env.DB.prepare(
		`SELECT m.*,c.workspace_id FROM conversations c JOIN channels ch ON ch.id=c.channel_id JOIN mailboxes m ON m.canonical_address=ch.external_id AND m.workspace_id=c.workspace_id WHERE c.id=? AND ch.type='email'`,
	)
		.bind(conversationId)
		.first<{
			id: string;
			workspace_id: string;
			canonical_address: string;
			type: string;
		}>();
	if (
		!receiving ||
		!(await canAccessMailbox(
			env,
			receiving.workspace_id,
			receiving.canonical_address,
			actorId,
		))
	)
		throw new Error("conversation mailbox access denied");
	const selected = await env.DB.prepare(
		`SELECT m.*,d.outbound_state,d.inbound_state FROM mailboxes m JOIN email_domains d ON d.id=m.email_domain_id AND d.workspace_id=m.workspace_id WHERE m.id=? AND m.workspace_id=?`,
	)
		.bind(mailboxId ?? receiving.id, receiving.workspace_id)
		.first<{
			id: string;
			canonical_address: string;
			type: string;
			is_enabled: number;
			is_send_enabled: number;
			outbound_state: string;
			inbound_state: string;
		}>();
	if (
		!selected ||
		!selected.is_enabled ||
		!selected.is_send_enabled ||
		selected.outbound_state !== "ready" ||
		selected.inbound_state === "suspended" ||
		!(await canAccessMailbox(
			env,
			receiving.workspace_id,
			selected.canonical_address,
			actorId,
		))
	)
		throw new Error("selected From mailbox unavailable or unauthorized");
	if (
		selected.type === "private" &&
		receiving.type === "shared" &&
		selected.id !== receiving.id &&
		!confirmPrivateIdentity
	)
		throw new Error(
			"confirm private identity before replying in a shared conversation",
		);
	const latest = await env.DB.prepare(
		"SELECT metadata_json FROM email_canonical_messages WHERE conversation_id=? AND ingress_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1",
	)
		.bind(conversationId)
		.first<{ metadata_json: string }>();
	if (!latest) throw new Error("no durable inbound email to reply to");
	const meta = JSON.parse(latest.metadata_json) as {
		from: string;
		replyTo?: { address?: string }[];
		messageId?: string;
		references?: string[];
	};
	const recipient = meta.replyTo?.find((a) => a.address)?.address ?? meta.from;
	if (!recipient || /[\r\n]/.test(recipient))
		throw new Error("invalid reply recipient");
	return {
		workspace_id: receiving.workspace_id,
		receiving_mailbox_id: receiving.id,
		mailbox_id: selected.id,
		from_address: selected.canonical_address,
		to_address: recipient,
		in_reply_to: meta.messageId ?? null,
		references_json: JSON.stringify(
			[
				...(meta.references ?? []),
				...(meta.messageId ? [meta.messageId] : []),
			].slice(-50),
		),
		confirm_private_identity: confirmPrivateIdentity ? 1 : 0,
	};
}
export async function persistEmailOutboundMetadata(
	env: Env,
	id: string,
	meta: Omit<EmailOutboundMetadata, "intent_id" | "created_at">,
): Promise<EmailOutboundMetadata> {
	await env.DB.prepare(
		`INSERT OR IGNORE INTO email_outbound_metadata(intent_id,workspace_id,receiving_mailbox_id,mailbox_id,from_address,to_address,in_reply_to,references_json,confirm_private_identity,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
	)
		.bind(
			id,
			meta.workspace_id,
			meta.receiving_mailbox_id,
			meta.mailbox_id,
			meta.from_address,
			meta.to_address,
			meta.in_reply_to,
			meta.references_json,
			meta.confirm_private_identity,
			new Date().toISOString(),
		)
		.run();
	const saved = await getEmailOutboundMetadata(env, id);
	if (!saved) throw new Error("outbound metadata unavailable");
	return saved;
}
export interface CanonicalEmailRow {
	id: string;
	message_json: string;
	metadata_json: string;
	routing_done: number;
	projected_at: string | null;
	conversation_id: string;
	mailbox_id: string;
	workspace_id: string;
}
export async function getCanonicalEmail(
	env: Env,
	id: string,
): Promise<CanonicalEmailRow | null> {
	return env.DB.prepare("SELECT * FROM email_canonical_messages WHERE id=?")
		.bind(id)
		.first<CanonicalEmailRow>();
}
export async function persistCanonicalEmail(
	env: Env,
	message: Message,
	scope: { workspaceId: string; mailboxId: string; ingressId?: string },
	metadata: unknown,
): Promise<void> {
	if (await getCanonicalEmail(env, message.id)) return;
	const json = JSON.stringify(message);
	await env.EMAIL_ARCHIVE.put(
		`email/canonical/${scope.mailboxId}/${message.id}.json`,
		json,
		{ httpMetadata: { contentType: "application/json" } },
	);
	await env.DB.prepare(
		`INSERT OR IGNORE INTO email_canonical_messages(id,workspace_id,mailbox_id,conversation_id,ingress_id,rfc_message_id,message_json,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
	)
		.bind(
			message.id,
			scope.workspaceId,
			scope.mailboxId,
			message.conversationId,
			scope.ingressId ?? null,
			message.providerMessageId
				? message.providerMessageId.startsWith("<")
					? message.providerMessageId
					: `<${message.providerMessageId}>`
				: null,
			json,
			JSON.stringify(metadata),
			message.createdAt,
		)
		.run();
}
/** Buffer rule writes, then commit them atomically with the routing marker.
 * The current rules engine reads configuration only (no read-your-writes dependency).
 * Never expose this buffering database outside this one evaluation. */
export async function routeEmailRulesAtomically(
	env: Env,
	id: string,
	ctx: RuleEvaluationContext,
): Promise<void> {
	const row = await getCanonicalEmail(env, id);
	if (!row || row.routing_done) return;
	const writes: D1PreparedStatement[] = [];
	function wrap(stmt: D1PreparedStatement): D1PreparedStatement {
		return new Proxy(stmt, {
			get(target, key) {
				if (key === "bind")
					return (...values: unknown[]) => wrap(target.bind(...values));
				if (key === "run")
					return async () => {
						writes.push(target);
						return { success: true, meta: { changes: 1 }, results: [] };
					};
				const value = Reflect.get(target, key);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}
	const database = new Proxy(env.DB, {
		get(target, key) {
			if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const outcome = await evaluateRules({ ...env, DB: database }, ctx);
	// Inbound rules cannot change mailbox privacy: channel/mailbox remains stable.
	writes.push(
		env.DB.prepare(
			"UPDATE conversations SET inbox_id=?,assignee_id=?,status=?,updated_at=? WHERE id=?",
		).bind(
			outcome.inboxId,
			outcome.assigneeId,
			outcome.status,
			new Date().toISOString(),
			ctx.conversationId,
		),
	);
	writes.push(
		env.DB.prepare(
			"UPDATE email_canonical_messages SET routing_done=1 WHERE id=?",
		).bind(id),
	);
	try {
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO email_routing_commits(message_id) VALUES(?)",
			).bind(id),
			...writes,
		]);
	} catch (error) {
		if (!(await getCanonicalEmail(env, id))?.routing_done) throw error;
	}
}
export async function projectCanonicalEmail(
	env: Env,
	id: string,
): Promise<Message> {
	const row = await getCanonicalEmail(env, id);
	if (!row) throw new Error("canonical email missing");
	const message = JSON.parse(row.message_json) as Message;
	const stub = env.CONVERSATION_DO.get(
		env.CONVERSATION_DO.idFromName(message.conversationId),
	);
	const response = await stub.fetch("https://do/append-message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: row.message_json,
	});
	if (!response.ok)
		throw new Error(`email projection failed (${response.status})`);
	await env.DB.prepare(
		"UPDATE email_canonical_messages SET projected_at=? WHERE id=?",
	)
		.bind(new Date().toISOString(), id)
		.run();
	return message;
}
export async function lookupEmailThread(
	env: Env,
	workspaceId: string,
	mailboxId: string,
	ids: string[],
): Promise<string | null> {
	for (const id of ids.slice(-50).reverse()) {
		const direct = await env.DB.prepare(
			"SELECT conversation_id FROM email_canonical_messages WHERE workspace_id=? AND mailbox_id=? AND rfc_message_id=? LIMIT 1",
		)
			.bind(workspaceId, mailboxId, id)
			.first<{ conversation_id: string }>();
		if (direct) return direct.conversation_id;
		const bridge = await env.DB.prepare(
			"SELECT conversation_id FROM email_identity_bridges WHERE workspace_id=? AND mailbox_id=? AND provider_message_id=?",
		)
			.bind(workspaceId, mailboxId, id)
			.first<{ conversation_id: string }>();
		if (bridge) return bridge.conversation_id;
	}
	return null;
}
