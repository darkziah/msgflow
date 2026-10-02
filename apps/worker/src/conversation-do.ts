import { DurableObject } from "cloudflare:workers";
import type {
	Activity,
	Comment,
	ConversationEvent,
	Message,
	PresenceEntry,
	TimelineItem,
	TimelinePageResponse,
} from "@msgflow/contracts";
import {
	CallActivityDetailsSchema,
	ConversationUpdatedEventSchema,
	TimelineActivityDetailsSchema,
	TimelineActivitySchema,
	TimelineAttachmentsSchema,
	TimelineCommentSchema,
	TimelineMentionsSchema,
	TimelineMessageSchema,
	TimelinePayloadSchema,
	WebSocketClientEventSchema,
} from "@msgflow/contracts";
import { conversations, messagesSummary } from "@msgflow/db";
import { and, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Either, Schema } from "effect";
import { isCallActivity, isCallActivityAction } from "./activity";
import { canReadConversation } from "./conversation-permissions";
import type { Env } from "./env";
import { decodeJsonBody } from "./validation";
import { notifyWorkspaceConversationChange } from "./workspace-events";

interface WebSocketAttachment {
	agentId: string;
	conversationId: string;
}

/**
 * One ConversationDO per conversation. Owns the live Message/Comment/Activity
 * timeline (authoritative), holds connected agent WebSockets (Hibernation API), and
 * fans out events in real time. D1 is only a synced summary — this DO never
 * stores conversation metadata.
 */
export class ConversationDO extends DurableObject<Env> {
	private readonly sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        provider_message_id TEXT,
        kind TEXT NOT NULL,
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        text TEXT NOT NULL,
        payload TEXT,
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider_message_id);
      CREATE INDEX IF NOT EXISTS idx_messages_seq ON messages(seq);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at, id);
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        mentions TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at, id);
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_id TEXT,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at, id);
      CREATE TABLE IF NOT EXISTS presence (
        agent_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      );
    `);
		// Existing DO SQLite databases predate image attachments. The add is
		// intentionally idempotent across constructor restarts.
		try {
			this.sql.exec(
				"ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'",
			);
		} catch {
			// Column already exists.
		}
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			return this.handleUpgrade(request);
		}

		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/message") {
			const id = url.searchParams.get("id");
			if (!id) return new Response("missing id", { status: 400 });
			const row = this.sql
				.exec("SELECT * FROM messages WHERE id = ?", id)
				.toArray()[0];
			if (!row) return new Response("not found", { status: 404 });
			return new Response(JSON.stringify(this.rowToMessage(row)), {
				headers: { "content-type": "application/json" },
			});
		}
		if (request.method === "POST" && url.pathname === "/append-message") {
			return this.appendMessage(request);
		}
		if (request.method === "POST" && url.pathname === "/append-comment") {
			return this.appendComment(request);
		}
		if (request.method === "POST" && url.pathname === "/append-activity") {
			return this.appendActivity(request);
		}
		if (request.method === "GET" && url.pathname === "/messages") {
			return this.listMessages();
		}
		if (request.method === "GET" && url.pathname === "/comments") {
			return this.listComments();
		}
		if (request.method === "GET" && url.pathname === "/activities") {
			const requestedLimit = Number.parseInt(
				url.searchParams.get("limit") ?? "50",
				10,
			);
			const limit = Number.isFinite(requestedLimit)
				? Math.min(Math.max(requestedLimit, 1), 100)
				: 50;
			return this.listActivities(limit);
		}
		if (request.method === "GET" && url.pathname === "/timeline") {
			return this.listTimeline(url);
		}
		if (request.method === "POST" && url.pathname === "/broadcast") {
			return this.broadcastEvent(request);
		}

		return new Response("not found", { status: 404 });
	}

	private async handleUpgrade(request: Request): Promise<Response> {
		const agentId = request.headers.get("x-agent-id");
		const conversationId = request.headers.get("x-conversation-id");
		if (
			!agentId ||
			!conversationId ||
			!(await canReadConversation(this.env, agentId, conversationId))
		) {
			return new Response("forbidden", { status: 403 });
		}
		const pair = new WebSocketPair();
		const { 0: client, 1: server } = pair;

		this.ctx.acceptWebSocket(server, [agentId]);
		server.serializeAttachment({
			agentId,
			conversationId,
		} satisfies WebSocketAttachment);

		this.upsertPresence(agentId, "viewing");
		void this.broadcast({ type: "presence", agents: this.listPresence() });

		return new Response(null, { status: 101, webSocket: client });
	}

	private async appendMessage(request: Request): Promise<Response> {
		const decoded = await decodeJsonBody(
			request,
			TimelineMessageSchema,
			8 * 1024 * 1024,
		);
		if (!decoded.ok) return new Response(decoded.error, { status: 400 });
		const message = decoded.value as Message;

		// Idempotency: dedup by providerMessageId (webhook replays) and by message
		// id (client retries / scheduled-message retries) before appending.
		if (message.providerMessageId || message.id) {
			const existing = this.sql
				.exec(
					"SELECT * FROM messages WHERE id = ? OR (channel != 'email' AND provider_message_id = ?)",
					message.id,
					message.providerMessageId,
				)
				.toArray()[0];
			if (existing) {
				const stored = {
					...this.rowToMessage(existing),
					conversationId: message.conversationId,
				};
				// A replay repairs an interrupted D1 projection, but must not reset
				// every workspace list or rebroadcast a duplicate message frame.
				await this.syncProjection(stored);
				return new Response("duplicate", { status: 200 });
			}
		}

		const seq = this.nextSeq();
		// Stamp the seq so WS broadcasts and GET /messages carry it — the web
		// client uses it to advance the read cursor (ADR 0015).
		message.seq = seq;
		this.sql.exec(
			`INSERT INTO messages (id, seq, provider_message_id, kind, channel, sender_id, text, payload, attachments, created_at)
	       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			message.id,
			seq,
			message.providerMessageId,
			message.kind,
			message.channel,
			message.senderId,
			message.text,
			JSON.stringify(message.payload),
			JSON.stringify(message.attachments),
			message.createdAt,
		);

		await this.syncProjection(message);
		void this.notifyWorkspaceConversationChange(message.conversationId);
		await this.broadcast({ type: "message:new", message });
		return new Response("ok", { status: 200 });
	}

	private async syncProjection(message: Message): Promise<void> {
		const seq = message.seq ?? 0;
		const db = drizzle(this.env.DB);
		await db.batch([
			db
				.insert(messagesSummary)
				.values({
					id: message.id,
					conversationId: message.conversationId,
					seq,
					direction: message.kind === "inbound" ? "inbound" : "outbound",
					senderType: message.kind === "inbound" ? "contact" : "user",
					senderId: message.senderId,
					preview: message.text.slice(0, 200),
					hasAttachments: message.attachments.length > 0,
					sentAt: message.createdAt,
					createdAt: message.createdAt,
				})
				.onConflictDoNothing(),
			db
				.update(conversations)
				.set({
					lastMessagePreview: message.text.slice(0, 200),
					lastMessageAt: message.createdAt,
					messageCount: seq,
				})
				.where(
					and(
						eq(conversations.id, message.conversationId),
						lte(conversations.messageCount, seq),
					),
				),
		]);
	}

	private async notifyWorkspaceConversationChange(
		conversationId: string,
	): Promise<void> {
		const conversation = await drizzle(this.env.DB)
			.select({ workspaceId: conversations.workspaceId })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
			.get();
		if (!conversation) return;
		await notifyWorkspaceConversationChange(this.env, conversation.workspaceId);
	}

	private async appendComment(request: Request): Promise<Response> {
		const decoded = await decodeJsonBody(request, TimelineCommentSchema);
		if (!decoded.ok) return new Response(decoded.error, { status: 400 });
		const comment = decoded.value as Comment;
		this.sql.exec(
			"INSERT INTO comments (id, author_id, text, mentions, created_at) VALUES (?, ?, ?, ?, ?)",
			comment.id,
			comment.authorId,
			comment.text,
			JSON.stringify(comment.mentions),
			comment.createdAt,
		);
		void this.broadcast({ type: "comment:new", comment });
		return new Response("ok", { status: 200 });
	}

	private async appendActivity(request: Request): Promise<Response> {
		const decoded = await decodeJsonBody(request, TimelineActivitySchema);
		if (!decoded.ok) return new Response(decoded.error, { status: 400 });
		const activity: Activity = decoded.value;
		this.sql.exec(
			"INSERT INTO activities (id, action, actor_id, details, created_at) VALUES (?, ?, ?, ?, ?)",
			activity.id,
			activity.action,
			isCallActivity(activity) ? null : activity.actorId,
			JSON.stringify(activity.details),
			activity.createdAt,
		);
		void this.broadcast({ type: "activity:new", activity });
		return new Response("ok", { status: 200 });
	}

	private nextSeq(): number {
		const row = this.sql
			.exec("SELECT COALESCE(MAX(seq), 0) AS s FROM messages")
			.one();
		return Number(row?.s ?? 0) + 1;
	}

	private listMessages(): Response {
		const rows = this.sql
			.exec("SELECT * FROM messages ORDER BY seq ASC")
			.toArray();
		return new Response(
			JSON.stringify({ messages: rows.map((r) => this.rowToMessage(r)) }),
			{ headers: { "content-type": "application/json" } },
		);
	}

	private listComments(): Response {
		const rows = this.sql
			.exec("SELECT * FROM comments ORDER BY created_at ASC, id ASC")
			.toArray();
		return new Response(
			JSON.stringify({ comments: rows.map((r) => this.rowToComment(r)) }),
			{ headers: { "content-type": "application/json" } },
		);
	}

	private listActivities(limit: number): Response {
		const rows = this.sql
			.exec(
				"SELECT * FROM (SELECT * FROM activities ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC",
				limit,
			)
			.toArray();
		return new Response(
			JSON.stringify({ activities: rows.map((r) => this.rowToActivity(r)) }),
			{ headers: { "content-type": "application/json" } },
		);
	}

	/** A newest-first, mixed timeline page. The cursor is exclusive. */
	private listTimeline(url: URL): Response {
		let limit: number;
		let cursor: TimelineCursor | undefined;
		try {
			limit = parseTimelineLimit(url.searchParams);
			cursor = parseTimelineCursor(url.searchParams);
		} catch (error) {
			return new Response(
				error instanceof Error ? error.message : "invalid timeline parameters",
				{ status: 400 },
			);
		}

		const rows = this.sql
			.exec(
				`SELECT * FROM (
					SELECT 'message' AS timeline_type, id, created_at, seq, provider_message_id, kind, channel, sender_id, text, payload, attachments, NULL AS author_id, NULL AS mentions, NULL AS action, NULL AS actor_id, NULL AS details FROM messages
					UNION ALL
					SELECT 'comment' AS timeline_type, id, created_at, NULL AS seq, NULL AS provider_message_id, NULL AS kind, NULL AS channel, NULL AS sender_id, text, NULL AS payload, NULL AS attachments, author_id, mentions, NULL AS action, NULL AS actor_id, NULL AS details FROM comments
					UNION ALL
					SELECT 'activity' AS timeline_type, id, created_at, NULL AS seq, NULL AS provider_message_id, NULL AS kind, NULL AS channel, NULL AS sender_id, NULL AS text, NULL AS payload, NULL AS attachments, NULL AS author_id, NULL AS mentions, action, actor_id, details FROM activities
				) WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND (id < ? OR (id = ? AND timeline_type < ?))))
				ORDER BY created_at DESC, id DESC, timeline_type DESC LIMIT ?`,
				cursor?.createdAt ?? null,
				cursor?.createdAt ?? null,
				cursor?.createdAt ?? null,
				cursor?.id ?? null,
				cursor?.id ?? null,
				cursor?.timelineType ?? null,
				limit + 1,
			)
			.toArray();
		const hasMore = rows.length > limit;
		const visibleRows = rows.slice(0, limit);
		const items = visibleRows.map((row) => this.rowToTimelineItem(row));
		const last = visibleRows.at(-1);
		return Response.json({
			items,
			nextCursor: hasMore && last ? encodeTimelineCursor(last) : null,
		} satisfies TimelinePageResponse);
	}

	private rowToTimelineItem(row: Record<string, unknown>): TimelineItem {
		switch (row.timeline_type) {
			case "message":
				return { type: "message", item: this.rowToMessage(row) };
			case "comment":
				return { type: "comment", item: this.rowToComment(row) };
			case "activity":
				return { type: "activity", item: this.rowToActivity(row) };
			default:
				throw new Error("invalid timeline row");
		}
	}

	/**
	 * Relay a Worker-originated metadata event to connected agents (ADR 0004):
	 * the Worker updates D1 first, then asks the DO to fan out the
	 * conversation-updated event. Only metadata events are accepted here —
	 * messages/comments go through their own append endpoints.
	 */
	private async broadcastEvent(request: Request): Promise<Response> {
		const decoded = await decodeJsonBody(
			request,
			ConversationUpdatedEventSchema,
		);
		if (!decoded.ok) return new Response(decoded.error, { status: 400 });
		const event = decoded.value as ConversationEvent;
		await this.broadcast(event);
		return new Response("ok", { status: 200 });
	}

	/** Reconstruct a canonical Message from a stored row. */
	private rowToMessage(row: Record<string, unknown>): Message {
		return {
			id: row.id as string,
			conversationId: this.ctx.id.name ?? "",
			kind: row.kind as Message["kind"],
			channel: row.channel as Message["channel"],
			providerMessageId: (row.provider_message_id as string | null) ?? null,
			senderId: row.sender_id as string,
			text: row.text as string,
			payload: decodeStoredJson(row.payload, TimelinePayloadSchema, null),
			attachments: [
				...decodeStoredJson(row.attachments, TimelineAttachmentsSchema, []),
			],
			createdAt: row.created_at as string,
			seq: row.seq as number,
		};
	}

	private rowToComment(row: Record<string, unknown>): Comment {
		return {
			id: row.id as string,
			conversationId: this.ctx.id.name ?? "",
			authorId: row.author_id as string,
			text: row.text as string,
			mentions: [...decodeStoredJson(row.mentions, TimelineMentionsSchema, [])],
			createdAt: row.created_at as string,
		};
	}

	private rowToActivity(row: Record<string, unknown>): Activity {
		const action = row.action as Activity["action"];
		const base = {
			id: row.id as string,
			conversationId: this.ctx.id.name ?? "",
			createdAt: row.created_at as string,
		};
		if (isCallActivityAction(action)) {
			return {
				...base,
				action,
				details: decodeStoredJson(row.details, CallActivityDetailsSchema, {}),
			};
		}
		return {
			...base,
			action,
			actorId: (row.actor_id as string | null) ?? null,
			details: decodeStoredJson(row.details, TimelineActivityDetailsSchema, {}),
		};
	}

	private upsertPresence(
		agentId: string,
		status: "viewing" | "drafting",
	): void {
		this.sql.exec(
			`INSERT INTO presence (agent_id, status, connected_at) VALUES (?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET status = excluded.status, connected_at = excluded.connected_at`,
			agentId,
			status,
			new Date().toISOString(),
		);
	}

	private listPresence(): PresenceEntry[] {
		return this.sql
			.exec("SELECT agent_id, status, connected_at FROM presence")
			.toArray()
			.map((r) => ({
				agentId: r.agent_id as string,
				status: r.status as "viewing" | "drafting",
				connectedAt: r.connected_at as string,
			}));
	}

	private async socketAuthorized(ws: WebSocket): Promise<boolean> {
		try {
			const identity = ws.deserializeAttachment() as
				| WebSocketAttachment
				| undefined;
			if (
				identity?.agentId &&
				identity.conversationId &&
				(await canReadConversation(
					this.env,
					identity.agentId,
					identity.conversationId,
				))
			)
				return true;
			if (identity?.agentId)
				this.sql.exec(
					"DELETE FROM presence WHERE agent_id = ?",
					identity.agentId,
				);
			ws.close(1008, "conversation access revoked");
		} catch {
			try {
				ws.close(1011, "authorization unavailable");
			} catch {
				/* already closed */
			}
		}
		return false;
	}

	private async broadcast(event: ConversationEvent): Promise<void> {
		const payload = JSON.stringify(event);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				if (!(await this.socketAuthorized(ws))) continue;
				ws.send(payload);
			} catch {
				// ignore a closed socket
			}
		}
	}

	async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		if (typeof message !== "string") return;
		if (!(await this.socketAuthorized(ws))) return;

		const attachment = ws.deserializeAttachment() as
			| WebSocketAttachment
			| undefined;
		const agentId = attachment?.agentId ?? "anonymous";

		let raw: unknown;
		try {
			raw = JSON.parse(message);
		} catch {
			return;
		}
		const decoded = Schema.decodeUnknownEither(WebSocketClientEventSchema)(raw);
		if (Either.isLeft(decoded)) return;
		const event = decoded.right;

		switch (event.type) {
			case "draft:opened":
				this.upsertPresence(agentId, "drafting");
				await this.broadcast({ type: "presence", agents: this.listPresence() });
				break;
			case "draft:closed":
				this.upsertPresence(agentId, "viewing");
				await this.broadcast({ type: "presence", agents: this.listPresence() });
				break;
			case "typing":
				await this.broadcast({
					type: "typing",
					agentId,
					isTyping: Boolean(event.isTyping),
				});
				break;
			default:
				break;
		}
	}

	async webSocketClose(
		ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	): Promise<void> {
		const attachment = ws.deserializeAttachment() as
			| WebSocketAttachment
			| undefined;
		const agentId = attachment?.agentId;
		if (agentId) {
			this.sql.exec("DELETE FROM presence WHERE agent_id = ?", agentId);
			await this.broadcast({ type: "presence", agents: this.listPresence() });
		}
	}

	async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
		// no-op for the skeleton
	}
}

interface TimelineCursor {
	createdAt: string;
	id: string;
	timelineType: "message" | "comment" | "activity";
}

function parseTimelineLimit(params: URLSearchParams): number {
	const values = params.getAll("limit");
	if (values.length === 0) return 50;
	const value = values[0];
	if (values.length !== 1 || value === undefined || !/^[1-9]\d*$/.test(value))
		throw new Error("limit must be an integer between 1 and 100");
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit > 100)
		throw new Error("limit must be an integer between 1 and 100");
	return limit;
}

function parseTimelineCursor(
	params: URLSearchParams,
): TimelineCursor | undefined {
	const values = params.getAll("cursor");
	if (values.length === 0) return undefined;
	const value = values[0];
	if (values.length !== 1 || value === undefined)
		throw new Error("invalid timeline cursor");
	return decodeTimelineCursor(value);
}

function encodeTimelineCursor(row: Record<string, unknown>): string {
	return encodeBase64Url(
		JSON.stringify({
			createdAt: row.created_at,
			id: row.id,
			timelineType: row.timeline_type,
		}),
	);
}

function decodeTimelineCursor(value: string): TimelineCursor {
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
		const parsed: unknown = JSON.parse(decodeBase64Url(value));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Object.keys(parsed).length !== 3 ||
			!("createdAt" in parsed) ||
			!("id" in parsed) ||
			!("timelineType" in parsed) ||
			typeof parsed.createdAt !== "string" ||
			parsed.createdAt.length === 0 ||
			typeof parsed.id !== "string" ||
			parsed.id.length === 0 ||
			(parsed.timelineType !== "message" &&
				parsed.timelineType !== "comment" &&
				parsed.timelineType !== "activity")
		)
			throw new Error("invalid cursor shape");
		if (
			encodeBase64Url(
				JSON.stringify({
					createdAt: parsed.createdAt,
					id: parsed.id,
					timelineType: parsed.timelineType,
				}),
			) !== value
		)
			throw new Error("non-canonical cursor");
		return {
			createdAt: parsed.createdAt,
			id: parsed.id,
			timelineType: parsed.timelineType,
		};
	} catch {
		throw new Error("invalid timeline cursor");
	}
}

function encodeBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function decodeBase64Url(value: string): string {
	const padded = value
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(padded);
	return new TextDecoder().decode(
		Uint8Array.from(binary, (char) => char.charCodeAt(0)),
	);
}

function decodeStoredJson<A, I>(
	value: unknown,
	schema: Schema.Schema<A, I, never>,
	fallback: A,
): A {
	if (typeof value !== "string") return fallback;
	try {
		const decoded = Schema.decodeUnknownEither(schema)(JSON.parse(value));
		return Either.isRight(decoded) ? decoded.right : fallback;
	} catch {
		return fallback;
	}
}
