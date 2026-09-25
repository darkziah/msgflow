import { createAuth } from "@msgflow/auth";
import {
	AssignUsernameRequestSchema,
	EmailDomainVerifyRequestSchema,
	EmailProvisionRequestSchema,
	type Attachment,
} from "@msgflow/contracts";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "./env";
import {
	requireDefaultWorkspaceAccess,
	requireWorkspaceAccess,
} from "./access";
import { canReadConversation } from "./conversation-permissions";
import { canAccessMailbox } from "./email-transport";
import {
	appendEmailAudit,
	assignLegacyUsername,
	commitBulkPrivateMailboxes,
	listReadableMailboxes,
	previewBulkPrivateMailboxes,
	verifyEmailDomain,
} from "./mailboxes";
import { replayEmailIngress } from "./email-ingress";
import {
	MAX_EMAIL_BYTES,
	readBoundedEmail,
	readPrivateEmailAttachment,
	uploadPrivateEmailAttachment,
} from "./email-storage";
import { ManageError } from "./errors";
import { decodeJsonBody } from "./validation";

export const emailApi = new Hono<{
	Bindings: Env;
	Variables: { userId: string };
}>();
emailApi.use("*", async (c, next) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) return c.json({ success: false, error: "unauthorized" }, 401);
	c.set("userId", session.user.id);
	await next();
});
emailApi.onError((error, c) => {
	if (error instanceof ManageError)
		return c.json(
			{ success: false, error: error.message },
			error.status as 400 | 403 | 404 | 409 | 500,
		);
	console.error(
		"email_api_failure",
		error instanceof Error ? error.name : "unknown",
	);
	return c.json({ success: false, error: "email operation failed" }, 500);
});
emailApi.get("/workspaces/:workspaceId/mailboxes/assigned", async (c) => {
	return c.json({
		mailboxes: await listReadableMailboxes(
			c.env,
			c.req.param("workspaceId"),
			c.get("userId"),
		),
	});
});
emailApi.post(
	"/workspaces/:workspaceId/email-domains/:id/verify",
	async (c) => {
		const decoded = await decodeJsonBody(
			c.req.raw,
			EmailDomainVerifyRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		return c.json({
			domain: await verifyEmailDomain(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("id"),
				decoded.value,
				c.get("userId"),
			),
		});
	},
);
emailApi.post(
	"/workspaces/:workspaceId/mailboxes/provision-preview",
	async (c) => {
		const decoded = await decodeJsonBody(
			c.req.raw,
			EmailProvisionRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const input = {
			...decoded.value,
			userIds: [...decoded.value.userIds],
			excludeUserIds: [...(decoded.value.excludeUserIds ?? [])],
		};
		const rows = await previewBulkPrivateMailboxes(
			c.env,
			c.req.param("workspaceId"),
			input,
			c.get("userId"),
		);
		return c.json({
			preview: rows.filter(
				(row) =>
					input.userIds.length === 0 || input.userIds.includes(row.userId),
			),
		});
	},
);
emailApi.post("/workspaces/:workspaceId/mailboxes/provision", async (c) => {
	const decoded = await decodeJsonBody(c.req.raw, EmailProvisionRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	const input = {
		...decoded.value,
		userIds: [...decoded.value.userIds],
		excludeUserIds: [...(decoded.value.excludeUserIds ?? [])],
	};
	return c.json(
		{
			mailboxes: await commitBulkPrivateMailboxes(
				c.env,
				c.req.param("workspaceId"),
				input,
				c.get("userId"),
			),
		},
		201,
	);
});
emailApi.post("/workspaces/:workspaceId/users/:id/username", async (c) => {
	const decoded = await decodeJsonBody(c.req.raw, AssignUsernameRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	await assignLegacyUsername(
		c.env,
		c.req.param("workspaceId"),
		c.req.param("id"),
		decoded.value.username,
		c.get("userId"),
	);
	return c.json({ success: true });
});

export async function receivingMailbox(
	env: Env,
	conversationId: string,
	workspaceId: string,
) {
	return env.DB.prepare(
		"SELECT m.id,m.canonical_address,m.type,c.subject FROM conversations c JOIN channels ch ON ch.id=c.channel_id JOIN mailboxes m ON m.canonical_address=ch.external_id AND m.workspace_id=c.workspace_id WHERE c.id=? AND c.workspace_id=? AND ch.type='email'",
	)
		.bind(conversationId, workspaceId)
		.first<{
			id: string;
			canonical_address: string;
			type: string;
			subject: string | null;
		}>();
}

emailApi.get("/conversations/:id/email-context", async (c) => {
	const userId = c.get("userId");
	const { workspaceId } = await requireDefaultWorkspaceAccess(
		drizzle(c.env.DB),
		userId,
	);
	const conversationId = c.req.param("id");
	if (!(await canReadConversation(c.env, userId, conversationId, workspaceId)))
		throw new ManageError("not found", 404);
	const mailbox = await receivingMailbox(c.env, conversationId, workspaceId);
	if (!mailbox) throw new ManageError("email mailbox not found", 404);
	const latest = await c.env.DB.prepare(
		"SELECT metadata_json FROM email_canonical_messages WHERE conversation_id=? AND workspace_id=? AND ingress_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1",
	)
		.bind(conversationId, workspaceId)
		.first<{ metadata_json: string }>();
	let metadata: {
		from?: string;
		replyTo?: { address?: string }[];
		subject?: string;
	} = {};
	try {
		metadata = JSON.parse(latest?.metadata_json ?? "{}");
	} catch {
		/* missing legacy metadata */
	}
	const delivery = await c.env.DB.prepare(
		"SELECT o.id,o.status,o.last_error AS error,o.provider_message_id AS providerMessageId,o.updated_at AS updatedAt,m.from_address AS fromAddress FROM outbound_intents o LEFT JOIN email_outbound_metadata m ON m.intent_id=o.id WHERE o.conversation_id=? ORDER BY o.created_at DESC LIMIT 50",
	)
		.bind(conversationId)
		.all();
	return c.json({
		mailboxes: await listReadableMailboxes(c.env, workspaceId, userId),
		receivingMailboxId: mailbox.id,
		receivingMailboxType: mailbox.type,
		recipient:
			metadata.replyTo?.find((item) => item.address)?.address ??
			metadata.from ??
			"",
		subject: mailbox.subject ?? metadata.subject ?? "",
		deliveryStates: delivery.results,
	});
});

emailApi.post("/email-attachments", async (c) => {
	const userId = c.get("userId");
	const { workspaceId } = await requireDefaultWorkspaceAccess(
		drizzle(c.env.DB),
		userId,
	);
	let form: FormData;
	try {
		if (!c.req.raw.body) throw new Error("missing body");
		const bytes = await readBoundedEmail(
			c.req.raw.body,
			MAX_EMAIL_BYTES + 64 * 1024,
		);
		form = await new Response(bytes, {
			headers: { "content-type": c.req.header("content-type") ?? "" },
		}).formData();
	} catch {
		throw new ManageError("invalid or oversized attachment upload", 400);
	}
	const conversationId = form.get("conversationId");
	if (
		typeof conversationId !== "string" ||
		!(await canReadConversation(c.env, userId, conversationId, workspaceId))
	)
		throw new ManageError("not found", 404);
	const mailbox = await receivingMailbox(c.env, conversationId, workspaceId);
	if (!mailbox) throw new ManageError("email mailbox not found", 404);
	const files = form.getAll("files");
	if (
		!files.length ||
		files.length > 5 ||
		files.some((file) => !(file instanceof File))
	)
		throw new ManageError("provide 1–5 email attachments", 400);
	const uploaded = files as File[];
	if (uploaded.reduce((size, file) => size + file.size, 0) > MAX_EMAIL_BYTES)
		throw new ManageError("attachments exceed 5 MiB", 400);
	const attachments = [];
	for (const file of uploaded) {
		try {
			attachments.push(
				await uploadPrivateEmailAttachment(
					c.env,
					{
						workspaceId,
						mailboxId: mailbox.id,
						conversationId,
						actorId: userId,
					},
					file.name,
					file.type,
					file.stream(),
				),
			);
		} catch {
			throw new ManageError(
				"only valid PDF, JPEG, PNG, GIF and WebP files within the email limit are supported",
				400,
			);
		}
	}
	return c.json({ attachments }, 201);
});
emailApi.get("/email-attachments/:id", async (c) => {
	const userId = c.get("userId");
	const { workspaceId } = await requireDefaultWorkspaceAccess(
		drizzle(c.env.DB),
		userId,
	);
	let attachment: Awaited<ReturnType<typeof readPrivateEmailAttachment>>;
	try {
		attachment = await readPrivateEmailAttachment(
			c.env,
			c.req.param("id"),
			workspaceId,
			userId,
		);
	} catch {
		throw new ManageError("not found", 404);
	}
	if (!attachment) throw new ManageError("not found", 404);
	await appendEmailAudit(
		c.env,
		workspaceId,
		userId,
		"attachment.download",
		c.req.param("id"),
	);
	return new Response(attachment.bytes, {
		headers: {
			"content-type": attachment.type,
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff",
			"content-security-policy": "sandbox",
		},
	});
});

export async function validatePrivateEmailAttachments(
	env: Env,
	workspaceId: string,
	conversationId: string,
	userId: string,
	input: readonly unknown[],
): Promise<Attachment[]> {
	if (input.length > 5) throw new ManageError("at most five attachments", 400);
	const attachments: Attachment[] = [];
	for (const value of input) {
		if (
			!value ||
			typeof value !== "object" ||
			!("id" in value) ||
			typeof value.id !== "string"
		)
			throw new ManageError("invalid email attachment", 400);
		const row = await env.DB.prepare(
			"SELECT id,object_key AS key,name,mime_type AS type,size,mailbox_id FROM email_private_attachments WHERE id=? AND workspace_id=? AND conversation_id=?",
		)
			.bind(value.id, workspaceId, conversationId)
			.first<Attachment & { mailbox_id: string }>();
		if (
			!row ||
			!(await canReadConversation(env, userId, conversationId, workspaceId))
		)
			throw new ManageError("email attachment not found", 404);
		attachments.push({
			id: row.id,
			key: row.key,
			name: row.name,
			type: row.type,
			size: row.size,
			url: `/api/email-attachments/${encodeURIComponent(row.id)}`,
		});
	}
	if (attachments.reduce((size, item) => size + item.size, 0) > MAX_EMAIL_BYTES)
		throw new ManageError("email attachments exceed 5 MiB", 400);
	return attachments;
}

emailApi.get("/workspaces/:workspaceId/email-operations", async (c) => {
	const workspaceId = c.req.param("workspaceId");
	const userId = c.get("userId");
	const access = await requireWorkspaceAccess(
		drizzle(c.env.DB),
		workspaceId,
		userId,
	);
	const readable = await listReadableMailboxes(c.env, workspaceId, userId);
	const ids = new Set(readable.map((mailbox) => mailbox.id));
	const rows = await c.env.DB.prepare(
		"SELECT i.id,i.mailbox_id AS mailboxId,m.canonical_address AS address,i.state,i.error,i.received_at AS receivedAt,i.attempts FROM email_ingress i JOIN mailboxes m ON m.id=i.mailbox_id WHERE i.workspace_id=? AND i.state!='processed' ORDER BY i.received_at DESC LIMIT 200",
	)
		.bind(workspaceId)
		.all<{
			id: string;
			mailboxId: string;
			state: string;
			error: string | null;
		}>();
	const ingress = rows.results.filter((row) => ids.has(row.mailboxId));
	const audits = await c.env.DB.prepare(
		"SELECT id,actor_user_id AS actorUserId,action,target_id AS targetId,created_at AS createdAt FROM email_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
	)
		.bind(workspaceId)
		.all<{ targetId: string; actorUserId: string | null; action: string }>();
	// Config audit is visible to administrators; private access/send events only to their actor.
	const audit = audits.results.filter(
		(row) =>
			row.actorUserId === userId ||
			(access.isAdmin &&
				/^(domain\.|mailbox\.(create|state)|username\.)/.test(row.action)),
	);
	return c.json({
		ingress,
		audit,
		counts: Object.fromEntries(
			["stored", "processing", "quarantined", "failed"].map((state) => [
				state,
				ingress.filter((row) => row.state === state).length,
			]),
		),
		limits: {
			messageBytes: MAX_EMAIL_BYTES,
			providerQuota:
				"Account-specific: inspect Cloudflare Email Sending dashboard",
		},
	});
});
emailApi.post(
	"/workspaces/:workspaceId/email-ingress/:id/replay",
	async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const userId = c.get("userId");
		await requireWorkspaceAccess(drizzle(c.env.DB), workspaceId, userId);
		const row = await c.env.DB.prepare(
			"SELECT m.canonical_address FROM email_ingress i JOIN mailboxes m ON m.id=i.mailbox_id WHERE i.id=? AND i.workspace_id=?",
		)
			.bind(c.req.param("id"), workspaceId)
			.first<{ canonical_address: string }>();
		if (
			!row ||
			!(await canAccessMailbox(
				c.env,
				workspaceId,
				row.canonical_address,
				userId,
			))
		)
			throw new ManageError("not found", 404);
		await appendEmailAudit(
			c.env,
			workspaceId,
			userId,
			"ingress.replay",
			c.req.param("id"),
		);
		return c.json(
			await replayEmailIngress(c.env, workspaceId, userId, c.req.param("id")),
		);
	},
);
