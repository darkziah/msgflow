import { SendMessageRequestSchema } from "@msgflow/contracts";
import { Either, Schema } from "effect";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { canReadConversation } from "./conversation-permissions";

export type EmailDraft = Schema.Schema.Type<typeof SendMessageRequestSchema>;

async function authorize(
	env: Env,
	workspaceId: string,
	conversationId: string,
	userId: string,
) {
	if (!(await canReadConversation(env, userId, conversationId, workspaceId)))
		throw new ManageError("conversation not found", 404);
}

export async function readEmailDraft(
	env: Env,
	workspaceId: string,
	conversationId: string,
	userId: string,
): Promise<EmailDraft | null> {
	await authorize(env, workspaceId, conversationId, userId);
	const row = await env.DB.prepare(
		"SELECT payload_json, revision FROM email_drafts WHERE workspace_id=? AND conversation_id=? AND user_id=?",
	)
		.bind(workspaceId, conversationId, userId)
		.first<{ payload_json: string; revision: number }>();
	if (!row) return null;
	try {
		const decoded = Schema.decodeUnknownEither(SendMessageRequestSchema)(
			JSON.parse(row.payload_json),
		);
		return Either.isRight(decoded)
			? { ...decoded.right, draftRevision: row.revision }
			: { text: "", draftRevision: row.revision };
	} catch {
		return { text: "", draftRevision: row.revision };
	}
}

export async function saveEmailDraft(
	env: Env,
	workspaceId: string,
	conversationId: string,
	userId: string,
	input: EmailDraft,
): Promise<EmailDraft> {
	await authorize(env, workspaceId, conversationId, userId);
	const decoded = Schema.decodeUnknownEither(SendMessageRequestSchema)(input);
	if (Either.isLeft(decoded)) throw new ManageError("invalid draft", 400);
	const { draftRevision = 0, ...body } = decoded.right;
	const payload = JSON.stringify(body);
	if (new TextEncoder().encode(payload).byteLength > 64 * 1024)
		throw new ManageError("draft too large", 400);
	const now = new Date().toISOString();
	const result = await env.DB.prepare(
		"UPDATE email_drafts SET payload_json=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND conversation_id=? AND user_id=? AND revision=? AND json_extract(payload_json,'$.clientMessageId') IS NULL",
	)
		.bind(payload, now, workspaceId, conversationId, userId, draftRevision)
		.run();
	if (result.meta.changes) return { ...body, draftRevision: draftRevision + 1 };
	if (draftRevision === 0) {
		const inserted = await env.DB.prepare(
			"INSERT INTO email_drafts (workspace_id,conversation_id,user_id,payload_json,updated_at,revision) VALUES (?,?,?,?,?,1) ON CONFLICT(conversation_id,user_id) DO NOTHING",
		)
			.bind(workspaceId, conversationId, userId, payload, now)
			.run();
		if (inserted.meta.changes) return { ...body, draftRevision: 1 };
	}
	// Only an identical immutable submission may recover a lost save response.
	const current = await readEmailDraft(
		env,
		workspaceId,
		conversationId,
		userId,
	);
	if (current && body.clientMessageId) {
		const { draftRevision: currentRevision, ...currentBody } = current;
		if (
			(currentRevision === draftRevision + 1 ||
				currentRevision === draftRevision) &&
			JSON.stringify(currentBody) === payload
		)
			return current;
	}
	throw new ManageError(
		"Draft changed or a submitted draft exists. Reload before continuing.",
		409,
	);
}

export async function deleteEmailDraft(
	env: Env,
	workspaceId: string,
	conversationId: string,
	userId: string,
	clientMessageId: string,
): Promise<void> {
	await authorize(env, workspaceId, conversationId, userId);
	await env.DB.prepare(
		"UPDATE email_drafts SET payload_json='{\"text\":\"\"}',revision=revision+1 WHERE workspace_id=? AND conversation_id=? AND user_id=? AND json_extract(payload_json,'$.clientMessageId')=?",
	)
		.bind(workspaceId, conversationId, userId, clientMessageId)
		.run();
}
