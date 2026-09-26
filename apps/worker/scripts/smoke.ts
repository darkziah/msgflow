/**
 * Smoke test for the MsgFlow worker — drives the full ingest → inbox → thread
 * → actions → outbound chain against a RUNNING local worker.
 *
 * Prereqs: worker up (`bunx wrangler dev --var MESSENGER_APP_SECRET:test-secret
 * --var MESSENGER_VERIFY_TOKEN:test-verify --var BETTER_AUTH_SECRET:... --var
 * BETTER_AUTH_TRUSTED_ORIGINS:http://localhost:5174 --port 8787`) with D1
 * migrations applied, and outbound network access for the provider-boundary
 * check (a fake token still hits graph.facebook.com).
 *
 * Run: bun run smoke   (from apps/worker)
 * Env: WORKER_URL, MESSENGER_APP_SECRET overridable.
 *
 * This test exists because the ingest path was shipped untested and silently
 * no-oped (fb: prefix parse mismatch) / 500'd (SqlStorage .one() on empty) —
 * both only surfaced under a real request.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.WORKER_URL ?? "http://localhost:8787";
const APP_SECRET = process.env.MESSENGER_APP_SECRET ?? "test-secret";
const EMAIL = `smoke-${Date.now()}@example.test`;
const PASSWORD = "password123";
const PAGE_ID = `page-smoke-${Date.now()}`;
const PSID = "psid-smoke";
const CONVERSATION_ID = `fb:${PAGE_ID}:${PSID}`;

const results: { name: string; ok: boolean; detail?: string }[] = [];
let failures = 0;

function assert(name: string, ok: boolean, detail?: string) {
	results.push({ name, ok, detail });
	if (!ok) failures++;
}

type Json = Record<string, unknown>;

async function api(
	path: string,
	init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: Json | null; setCookie: string | null }> {
	const headers = new Headers(init.headers ?? {});
	headers.set("content-type", "application/json");
	if (init.cookie) headers.set("cookie", init.cookie);
	const res = await fetch(`${BASE}${path}`, { ...init, headers });
	let body: Json | null = null;
	try {
		body = (await res.json()) as Json;
	} catch {
		// non-JSON response — body stays null
	}
	return { status: res.status, body, setCookie: res.headers.get("set-cookie") };
}

function arr(body: Json | null, key: string): Json[] {
	const value = body?.[key];
	return Array.isArray(value) ? (value as Json[]) : [];
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
	return typeof value === "number" ? value : -1;
}

async function run(): Promise<void> {
	// 1. Sign up a fresh agent (session cookie).
	const signup = await api("/api/auth/sign-up/email", {
		method: "POST",
		body: JSON.stringify({
			email: EMAIL,
			password: PASSWORD,
			name: "Smoke Agent",
		}),
	});
	assert(
		"sign-up creates session",
		signup.status === 200,
		`status ${signup.status}`,
	);
	const cookie = signup.setCookie ?? "";
	assert("sign-up sets a session cookie", cookie.length > 0);

	// 2. Ingest a Messenger message via the webhook (HMAC-signed).
	const payload = JSON.stringify({
		object: "page",
		entry: [
			{
				id: PAGE_ID,
				messaging: [
					{
						sender: { id: PSID },
						recipient: { id: PAGE_ID },
						timestamp: Math.floor(Date.now() / 1000),
						message: {
							mid: `mid.smoke.${Date.now()}`,
							text: "Smoke test message",
						},
					},
				],
			},
		],
	});
	const signature = `sha256=${createHmac("sha256", APP_SECRET).update(payload).digest("hex")}`;
	const webhook = await api("/webhooks/messenger", {
		method: "POST",
		body: payload,
		headers: { "x-hub-signature-256": signature },
	});
	assert(
		"webhook accepted",
		webhook.status === 200,
		`status ${webhook.status}`,
	);

	// 3. List shows the conversation, unread = 1.
	const list = await api("/api/conversations?status=open", { cookie });
	const conversation = arr(list.body, "conversations").find(
		(c) => c.id === CONVERSATION_ID,
	);
	assert(
		"conversation appears in open list",
		Boolean(conversation),
		`${arr(list.body, "conversations").length} open conversation(s)`,
	);
	assert(
		"unread = 1",
		conversation !== undefined && num(conversation.unreadCount) === 1,
	);

	// 4. Thread returns the message with its seq.
	const thread = await api(`/api/conversations/${CONVERSATION_ID}/messages`, {
		cookie,
	});
	const messages = arr(thread.body, "messages");
	assert(
		"thread has exactly 1 message",
		messages.length === 1,
		`len ${messages.length}`,
	);
	assert(
		"message seq = 1",
		num(messages[0]?.seq) === 1,
		`seq ${messages[0]?.seq}`,
	);
	assert(
		"message text matches",
		str(messages[0]?.text) === "Smoke test message",
	);

	// 5. Mark read → unread 0.
	await api(`/api/conversations/${CONVERSATION_ID}/read`, {
		method: "POST",
		cookie,
		body: JSON.stringify({ lastReadSeq: 1 }),
	});
	const afterRead = await api("/api/conversations?status=open", { cookie });
	const read = arr(afterRead.body, "conversations").find(
		(c) => c.id === CONVERSATION_ID,
	);
	assert(
		"unread cleared after mark-read",
		read !== undefined && num(read.unreadCount) === 0,
	);

	// 6. Archive drops it from the open list; reopen restores it.
	const archive = await api(`/api/conversations/${CONVERSATION_ID}`, {
		method: "PATCH",
		cookie,
		body: JSON.stringify({ status: "archived" }),
	});
	assert(
		"archive sets status archived",
		archive.status === 200 &&
			str((archive.body?.conversation as Json | undefined)?.status) ===
				"archived",
		`status ${archive.status}`,
	);
	const openAfterArchive = await api("/api/conversations?status=open", {
		cookie,
	});
	assert(
		"archived conversation leaves the open list",
		!arr(openAfterArchive.body, "conversations").some(
			(c) => c.id === CONVERSATION_ID,
		),
	);
	await api(`/api/conversations/${CONVERSATION_ID}`, {
		method: "PATCH",
		cookie,
		body: JSON.stringify({ status: "open" }),
	});

	// 7. Send before connecting → explicit "token missing" error, not a crash.
	const sendBefore = await api(
		`/api/conversations/${CONVERSATION_ID}/messages`,
		{
			method: "POST",
			cookie,
			body: JSON.stringify({ text: "Hello!" }),
		},
	);
	assert(
		"send without token fails cleanly",
		sendBefore.status === 502,
		`status ${sendBefore.status}`,
	);
	assert(
		"error names the missing token",
		str(sendBefore.body?.error).includes("access token"),
		str(sendBefore.body?.error),
	);

	// 8. Connect a fake token → send now crosses the provider boundary
	//    (Graph API rejects the token instead of "token missing").
	const channels = await api("/api/channels", { cookie });
	const channel = arr(channels.body, "channels").find(
		(c) => c.externalId === PAGE_ID,
	);
	assert("channel is listed", Boolean(channel));
	assert(
		"channel starts unconnected",
		channel !== undefined && channel.hasToken === false,
	);
	const connect = await api(`/api/channels/${str(channel?.id)}/token`, {
		method: "POST",
		cookie,
		body: JSON.stringify({ accessToken: "EAA-smoke-fake" }),
	});
	assert(
		"connect stores the token",
		connect.status === 200,
		`status ${connect.status}`,
	);
	const sendAfter = await api(
		`/api/conversations/${CONVERSATION_ID}/messages`,
		{
			method: "POST",
			cookie,
			body: JSON.stringify({ text: "Hello!" }),
		},
	);
	assert(
		"send reaches the provider layer",
		sendAfter.status === 502,
		`status ${sendAfter.status}`,
	);
	assert(
		"provider error surfaced (not 'token missing')",
		!str(sendAfter.body?.error).includes("access token missing"),
		str(sendAfter.body?.error),
	);
	const disconnect = await api(`/api/channels/${str(channel?.id)}/disconnect`, {
		method: "POST",
		cookie,
	});
	assert("disconnect clears the token", disconnect.status === 200);

	// 9. Unauthenticated access is rejected.
	const anon = await api("/api/conversations?status=open");
	assert(
		"unauthenticated list → 401",
		anon.status === 401,
		`status ${anon.status}`,
	);
}

run()
	.then(() => {
		for (const r of results) {
			console.log(
				`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`,
			);
		}
		const passed = results.length - failures;
		console.log(`\n${passed}/${results.length} checks passed`);
		if (failures > 0) process.exit(1);
	})
	.catch((err: unknown) => {
		console.error("SMOKE CRASHED:", err);
		process.exit(1);
	});
