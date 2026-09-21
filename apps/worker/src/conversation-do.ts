import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { conversations, messagesSummary } from "@msgflow/db";
import type {
	Comment,
	ConversationEvent,
	Message,
	PresenceEntry,
} from "@msgflow/contracts";
import type { Env } from "./env";

interface WebSocketAttachment {
	agentId: string;
}

/**
 * One ConversationDO per conversation. Owns the live Message/Comment timeline
 * (authoritative), holds connected agent WebSockets (Hibernation API), and
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
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider_message_id);
      CREATE INDEX IF NOT EXISTS idx_messages_seq ON messages(seq);
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        mentions TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presence (
        agent_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      );
    `);
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
		if (request.method === "GET" && url.pathname === "/messages") {
			return this.listMessages();
		}
		if (request.method === "POST" && url.pathname === "/broadcast") {
			return this.broadcastEvent(request);
		}

		return new Response("not found", { status: 404 });
	}

	private handleUpgrade(request: Request): Response {
		const agentId = request.headers.get("x-agent-id") ?? "anonymous";
		const pair = new WebSocketPair();
		const { 0: client, 1: server } = pair;

		this.ctx.acceptWebSocket(server, [agentId]);
		server.serializeAttachment({ agentId } satisfies WebSocketAttachment);

		this.upsertPresence(agentId, "viewing");
		void this.broadcast({ type: "presence", agents: this.listPresence() });

		return new Response(null, { status: 101, webSocket: client });
	}

	private async appendMessage(request: Request): Promise<Response> {
		const message = (await request.json()) as Message;

		// Idempotency: dedup by providerMessageId (webhook replays) and by message
		// id (client retries / scheduled-message retries) before appending.
		if (message.providerMessageId || message.id) {
			const existing = this.sql
				.exec(
					"SELECT id FROM messages WHERE id = ? OR provider_message_id = ?",
					message.id,
					message.providerMessageId,
				)
				.toArray()[0];
			if (existing) {
				return new Response("duplicate", { status: 200 });
			}
		}

		const seq = this.nextSeq();
		// Stamp the seq so WS broadcasts and GET /messages carry it — the web
		// client uses it to advance the read cursor (ADR 0015).
		message.seq = seq;
		this.sql.exec(
			`INSERT INTO messages (id, seq, provider_message_id, kind, channel, sender_id, text, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			message.id,
			seq,
			message.providerMessageId,
			message.kind,
			message.channel,
			message.senderId,
			message.text,
			JSON.stringify(message.payload),
			message.createdAt,
		);

		// Summary sync (ADR 0004/0015): the DO is the single-threaded owner of the
		// timeline, so it upserts the D1 summary projection here — one row per
		// message for list/search plus the conversation's latest-seq/messageCount
		// for per-agent unread.
		await drizzle(this.env.DB)
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
			.onConflictDoNothing()
			.run();

		await drizzle(this.env.DB)
			.update(conversations)
			.set({
				lastMessagePreview: message.text.slice(0, 200),
				lastMessageAt: message.createdAt,
				messageCount: seq,
			})
			.where(eq(conversations.id, message.conversationId))
			.run();

		void this.broadcast({ type: "message:new", message });
		return new Response("ok", { status: 200 });
	}

	private async appendComment(request: Request): Promise<Response> {
		const comment = (await request.json()) as Comment;
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

	/**
	 * Relay a Worker-originated metadata event to connected agents (ADR 0004):
	 * the Worker updates D1 first, then asks the DO to fan out the
	 * conversation-updated event. Only metadata events are accepted here —
	 * messages/comments go through their own append endpoints.
	 */
	private async broadcastEvent(request: Request): Promise<Response> {
		const event = (await request.json()) as ConversationEvent;
		if (event.type !== "conversation-updated") {
			return new Response("invalid event", { status: 400 });
		}
		await this.broadcast(event);
		return new Response("ok", { status: 200 });
	}

	/** Reconstruct a canonical Message from a stored row (attachments not stored yet). */
	private rowToMessage(row: Record<string, unknown>): Message {
		return {
			id: row.id as string,
			conversationId: this.ctx.id.name ?? "",
			kind: row.kind as Message["kind"],
			channel: row.channel as Message["channel"],
			providerMessageId: (row.provider_message_id as string | null) ?? null,
			senderId: row.sender_id as string,
			text: row.text as string,
			payload: row.payload ? JSON.parse(row.payload as string) : null,
			attachments: [],
			createdAt: row.created_at as string,
			seq: row.seq as number,
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

	private async broadcast(event: ConversationEvent): Promise<void> {
		const payload = JSON.stringify(event);
		for (const ws of this.ctx.getWebSockets()) {
			try {
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

		const attachment = ws.deserializeAttachment() as
			| WebSocketAttachment
			| undefined;
		const agentId = attachment?.agentId ?? "anonymous";

		let event: { type: string; isTyping?: boolean };
		try {
			event = JSON.parse(message);
		} catch {
			return;
		}

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
