import type { NormalizedFacebookCallingWebhook } from "@msgflow/channel";
import type { Env } from "./env";
import { appendActivity } from "./activity";
import { rejectMessengerInboundCall } from "./facebook-calling-provider";
import { callDispatchInternalHeaders } from "./call-dispatch-client";
import { notifyWorkspaceConversationChange } from "./workspace-events";

/** Route a signed, normalized inbound Page call without treating it as a message. */
export async function routeInboundFacebookCall(env: Env, metaAppId: string, call: NormalizedFacebookCallingWebhook): Promise<void> {
	if (call.event !== "connect" || !call.endpointPsid || (call.direction && call.direction !== "user_initiated")) return;
	const channel = await env.DB.prepare("SELECT id, external_id AS pageId, workspace_id AS workspaceId, access_token AS accessToken FROM channels WHERE type='facebook_page' AND status='active' AND external_id=? AND meta_app_id=?").bind(call.pageId, metaAppId).first<{ id: string; pageId: string; workspaceId: string; accessToken: string | null }>();
	if (!channel) return;
	const now = new Date().toISOString();
	// provider_event_id is composed only from Meta call/event/timestamp identity.
	// It is claimed before every side effect, including a session start.
	const claimed = await env.DB.prepare("INSERT INTO call_events (id,workspace_id,channel_id,conversation_id,queue_id,provider_call_id,provider_event_id,direction,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(channel_id,provider_event_id) DO NOTHING").bind(crypto.randomUUID(), channel.workspaceId, channel.id, null, null, call.providerCallId, call.id, "consumer_to_business", "ringing", now, now).run();
	if ((claimed.meta?.changes ?? 0) === 0) return;

	const inbox = await env.DB.prepare("SELECT i.id FROM inbox_channels ic JOIN inboxes i ON i.id=ic.inbox_id WHERE ic.channel_id=? AND ic.is_default=1 AND i.workspace_id=? AND i.is_archived=0").bind(channel.id, channel.workspaceId).first<{ id: string }>();
	if (!inbox) { await markFailed(env, channel.id, call.providerCallId, "default inbox unavailable"); return; }
	const contact = await getOrCreateContact(env, channel.workspaceId, channel.id, call.endpointPsid, now);
	const existingConversation = await env.DB.prepare("SELECT id FROM conversations WHERE workspace_id=? AND channel_id=? AND contact_id=? AND status='open' ORDER BY updated_at DESC, id DESC LIMIT 1").bind(channel.workspaceId, channel.id, contact.id).first<{ id: string }>();
	const conversationId = existingConversation?.id ?? crypto.randomUUID();
	if (!existingConversation) {
		await env.DB.prepare("INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,status,message_count,created_at,updated_at) VALUES (?,?,?,?,?,?, 'open',0,?,?)").bind(conversationId, channel.workspaceId, channel.id, inbox.id, contact.id, conversationId, now, now).run();
		// This INSERT has no conflict clause, so reaching here means the new
		// conversation persisted successfully.
		// The call may take a no-agent path next; expose its persisted conversation
		// before that provider outcome is attempted.
		await notifyWorkspaceConversationChange(env, channel.workspaceId);
	}
	const queue = await env.DB.prepare("SELECT id FROM call_queues WHERE channel_id=? AND workspace_id=? AND is_enabled=1").bind(channel.id, channel.workspaceId).first<{ id: string }>();
	await env.DB.prepare("UPDATE call_events SET conversation_id=?, queue_id=?, updated_at=? WHERE channel_id=? AND provider_call_id=? AND provider_event_id=?").bind(conversationId, queue?.id ?? null, now, channel.id, call.providerCallId, call.id).run();
	await appendActivity(env, { conversationId, action: "call.received", actorId: null, details: {} });
	if (!queue) { await noAgent(env, channel, call.providerCallId, conversationId, "queue unavailable"); return; }
	const stages = await env.DB.prepare("SELECT ring_group_id AS ringGroupId, ring_duration_seconds AS ringDurationSeconds FROM call_queue_stages WHERE queue_id=? ORDER BY stage_order ASC").bind(queue.id).all<{ ringGroupId: string; ringDurationSeconds: number }>();
	const totalSeconds = stages.results.reduce((total, stage) => total + stage.ringDurationSeconds, 0);
	if (!stages.results.length || stages.results.length > 50 || totalSeconds > 50 || !(await hasEligibleAgent(env, channel.workspaceId, stages.results.map((stage) => stage.ringGroupId)))) { await noAgent(env, channel, call.providerCallId, conversationId, "no eligible agents"); return; }
	const webhookReceivedAt = call.timestamp ?? now;
	const body = JSON.stringify({ callId: call.providerCallId, workspaceId: channel.workspaceId, channelId: channel.id, pageId: call.pageId, encryptedPageAccessToken: channel.accessToken, conversationId, queueId: queue.id, stages: stages.results, contact, webhookReceivedAt });
	const headers = await internalCallSessionHeaders(env, "POST", "/start", channel.workspaceId, body);
	headers.set("content-type", "application/json");
	const stub = env.CALL_SESSION_DO.get(env.CALL_SESSION_DO.idFromName(`facebook-call:${call.providerCallId}`));
	const response = await stub.fetch("https://call-session/start", { method: "POST", headers, body });
	if (!response.ok) await markFailed(env, channel.id, call.providerCallId, "session unavailable");
}

async function getOrCreateContact(env: Env, workspaceId: string, channelId: string, psid: string, now: string): Promise<{ id: string; displayName: string | null; avatarUrl: string | null }> {
	const existing = await findContact(env, channelId, psid);
	if (existing) return existing;
	// Stable IDs make the two inserts race-safe: concurrent first deliveries
	// converge on the same Contact and unique identity instead of making orphans.
	const id = `facebook-contact:${channelId}:${psid}`;
	await env.DB.batch([
		env.DB.prepare("INSERT INTO contacts (id,workspace_id,display_name,avatar_url,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id, workspaceId, null, null, now, now),
		env.DB.prepare("INSERT INTO contact_identities (id,contact_id,channel_id,channel_type,external_user_id,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(channel_id,external_user_id) DO NOTHING").bind(`facebook-identity:${channelId}:${psid}`, id, channelId, "facebook_page", psid, now),
	]);
	const contact = await findContact(env, channelId, psid);
	if (!contact) throw new Error("contact identity claim failed");
	return contact;
}
async function findContact(env: Env, channelId: string, psid: string) { return env.DB.prepare("SELECT c.id, c.display_name AS displayName, c.avatar_url AS avatarUrl FROM contact_identities ci JOIN contacts c ON c.id=ci.contact_id WHERE ci.channel_id=? AND ci.external_user_id=?").bind(channelId, psid).first<{ id: string; displayName: string | null; avatarUrl: string | null }>(); }
async function hasEligibleAgent(env: Env, workspaceId: string, groupIds: string[]): Promise<boolean> {
	if (!groupIds.length) return false;
	const placeholders = groupIds.map(() => "?").join(",");
	return !!(await env.DB.prepare(`SELECT 1 FROM ring_group_members rgm JOIN agent_call_presence p ON p.user_id=rgm.user_id AND p.workspace_id=? WHERE rgm.ring_group_id IN (${placeholders}) AND p.status='available' AND p.socket_connected_at IS NOT NULL AND p.heartbeat_expires_at > ? LIMIT 1`).bind(workspaceId, ...groupIds, new Date().toISOString()).first());
}
async function noAgent(env: Env, channel: { id: string; pageId: string; accessToken: string | null }, callId: string, conversationId: string, reason: string): Promise<void> {
	// Rejection is a real provider operation. The provider policy is the only
	// authority that can permit an optional no-agent message; this service sends none.
	const rejected = await rejectMessengerInboundCall({ pageId: channel.pageId, providerCallId: callId, encryptedPageAccessToken: channel.accessToken, channelTokenEncryptionKey: env.CHANNEL_TOKEN_ENCRYPTION_KEY });
	await env.DB.prepare("UPDATE call_events SET state=?, terminal_reason=?, updated_at=? WHERE channel_id=? AND provider_call_id=?").bind(rejected ? "rejected" : "failed", reason, new Date().toISOString(), channel.id, callId).run();
	await appendActivity(env, { conversationId, action: "call.no_agent_reply", actorId: null, details: { status: "not_sent", reason } });
}
async function markFailed(env: Env, channelId: string, callId: string, reason: string): Promise<void> { await env.DB.prepare("UPDATE call_events SET state='failed', terminal_reason=?, updated_at=? WHERE channel_id=? AND provider_call_id=?").bind(reason, new Date().toISOString(), channelId, callId).run(); }

async function internalCallSessionHeaders(env: Env, method: string, pathname: string, workspaceId: string, body: string): Promise<Headers> {
	// Sign the literal serialized payload sent to the Session DO. Its capability
	// verifier hashes the raw body, so no object may be reserialized after this.
	const headers = await callDispatchInternalHeaders(env.BETTER_AUTH_SECRET, method, pathname, workspaceId, undefined, body);
	headers.set("x-authenticated-workspace-id", workspaceId);
	return headers;
}
