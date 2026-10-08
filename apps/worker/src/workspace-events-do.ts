import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

interface WorkspaceSocketAttachment {
	agentId: string;
	workspaceId: string;
}

const CONVERSATIONS_CHANGED_EVENT = JSON.stringify({
	type: "workspace:conversations-changed",
});

/** One hibernating WebSocket fanout per workspace for inbox-list refresh signals. */
export class WorkspaceEventsDO extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
			return this.handleUpgrade(request);
		}
		if (url.pathname === "/notify" && request.method === "POST") {
			return this.notify(request);
		}
		return new Response("not found", { status: 404 });
	}

	private handleUpgrade(request: Request): Response {
		// The public Worker derives both values from the authenticated session and
		// authorized workspace; browser-supplied identity never crosses this boundary.
		const agentId = request.headers.get("x-agent-id");
		const workspaceId = request.headers.get("x-workspace-id");
		if (!agentId || !workspaceId) return new Response("forbidden", { status: 403 });
		const pair = new WebSocketPair();
		const { 0: client, 1: server } = pair;
		this.ctx.acceptWebSocket(server, [workspaceId]);
		server.serializeAttachment({ agentId, workspaceId } satisfies WorkspaceSocketAttachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	private notify(request: Request): Response {
		const workspaceId = request.headers.get("x-workspace-id");
		if (!workspaceId) return new Response("forbidden", { status: 403 });
		for (const socket of this.ctx.getWebSockets()) {
			try {
				const attachment = socket.deserializeAttachment() as WorkspaceSocketAttachment | null;
				if (attachment?.workspaceId === workspaceId)
					socket.send(CONVERSATIONS_CHANGED_EVENT);
			} catch {
				// A stale recipient must not prevent later sockets from receiving the event.
			}
		}
		return new Response("ok");
	}
}
