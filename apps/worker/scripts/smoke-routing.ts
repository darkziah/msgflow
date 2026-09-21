/**
 * Routing + sidebar integration test — drives the full inbox-routing chain
 * against a RUNNING local worker:
 *
 *   webhook -> channel/contact/conversation -> default inbox
 *           -> routing rule -> destination inbox -> sidebar counts -> prefs
 *
 * Prereqs:
 * - Worker up: `cd apps/worker && bunx wrangler dev --var MESSENGER_APP_SECRET:test-secret
 *   --var MESSENGER_VERIFY_TOKEN:test-verify --var BETTER_AUTH_SECRET:... --var
 *   BETTER_AUTH_TRUSTED_ORIGINS:http://localhost:5174 --port 8787` with the
 *   migration chain applied to a FRESH local D1 (the workspace bootstrap makes
 *   the first signup the owner; a stale dev DB with prior members would 403
 *   the workspace-scoped endpoints for a new user).
 *
 * Run: bun run smoke-routing   (from apps/worker)
 * Env: WORKER_URL, MESSENGER_APP_SECRET overridable.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.WORKER_URL ?? "http://localhost:8787";
const APP_SECRET = process.env.MESSENGER_APP_SECRET ?? "test-secret";
const EMAIL = `route-${Date.now()}@yehey.jp`;
const PASSWORD = "password123";
const PAGE_ID = `page-route-${Date.now()}`;
const PSID = "psid-route";
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

/** Signed Messenger webhook payload (same shape the smoke test uses). */
function signedWebhook(
	mid: string,
	text: string,
): { payload: string; signature: string } {
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
						message: { mid, text },
					},
				],
			},
		],
	});
	const signature = `sha256=${createHmac("sha256", APP_SECRET).update(payload).digest("hex")}`;
	return { payload, signature };
}

async function postWebhook(mid: string, text: string): Promise<number> {
	const { payload, signature } = signedWebhook(mid, text);
	const res = await api("/webhooks/messenger", {
		method: "POST",
		body: payload,
		headers: { "x-hub-signature-256": signature },
	});
	return res.status;
}

async function run(): Promise<void> {
	// 1. Sign up a fresh agent (session cookie).
	const signup = await api("/api/auth/sign-up/email", {
		method: "POST",
		body: JSON.stringify({
			email: EMAIL,
			password: PASSWORD,
			name: "Route Agent",
		}),
	});
	assert(
		"sign-up creates session",
		signup.status === 200,
		`status ${signup.status}`,
	);
	const cookie = signup.setCookie ?? "";
	assert("sign-up sets a session cookie", cookie.length > 0);

	// The first caller of any workspace endpoint bootstraps as owner.
	const workspacesRes = await api("/api/workspaces", { cookie });
	const workspaces = arr(workspacesRes.body, "workspaces");
	assert(
		"bootstrap: new user owns the default workspace",
		workspaces.length === 1,
		`${workspaces.length} workspace(s)`,
	);
	const workspaceId = str(workspaces[0]?.id);
	assert("workspace id present", workspaceId.length > 0);

	// 2. Ingest a message with NO matching rule yet -> lands in the channel's
	//    default inbox (created lazily by ingest: "Facebook Support").
	const mid1 = `mid.route.${Date.now()}.1`;
	assert(
		"webhook #1 accepted",
		(await postWebhook(mid1, "hello, nothing here")) === 200,
	);

	const conv1 = await api(`/api/conversations/${CONVERSATION_ID}`, { cookie });
	assert(
		"conversation exists after webhook #1",
		conv1.status === 200,
		`status ${conv1.status}`,
	);
	const defaultInboxId = str(conv1.body?.inboxId);

	const inboxesRes = await api("/api/inboxes", { cookie });
	const inboxes = arr(inboxesRes.body, "inboxes");
	const defaultInbox = inboxes.find(
		(inbox) => str(inbox.id) === defaultInboxId,
	);
	assert(
		"message sits in the channel's default inbox",
		Boolean(defaultInbox),
		`inboxId=${defaultInboxId}`,
	);
	const defaultLink = arr(defaultInbox ?? {}, "channels").find(
		(link) =>
			str(link.channelType) === "facebook_page" && link.isDefault === true,
	);
	assert(
		"default inbox is the channel's default link",
		Boolean(defaultLink),
		"no default facebook link found",
	);

	// 3. Admin creates a rule destination inbox (no channel attached) + rule.
	const createInbox = await api("/api/inboxes", {
		method: "POST",
		cookie,
		body: JSON.stringify({
			name: "Sales Leads",
			description: "Rule destination",
			color: "#F97316",
			icon: "badge-dollar-sign",
		}),
	});
	assert(
		"create inbox (admin)",
		createInbox.status === 201,
		`status ${createInbox.status}`,
	);
	const createdInbox = createInbox.body?.inbox as Json | undefined;
	const salesLeadsId = str(createdInbox?.id ?? createInbox.body?.id);

	const createRule = await api("/api/rules", {
		method: "POST",
		cookie,
		body: JSON.stringify({
			name: "Quote keywords",
			triggerType: "message_received",
			isActive: true,
			priority: 1,
			stopProcessing: false,
			conditions: [
				{
					field: "message.body",
					operator: "contains",
					value: "quote",
					matchGroup: 0,
				},
			],
			actions: [
				{
					actionType: "move_inbox",
					actionValue: salesLeadsId,
					executionOrder: 0,
				},
			],
		}),
	});
	assert(
		"create routing rule (admin)",
		createRule.status === 201,
		`status ${createRule.status}`,
	);

	// 4. A message matching the rule gets routed to the destination inbox.
	const mid2 = `mid.route.${Date.now()}.2`;
	assert(
		"webhook #2 accepted",
		(await postWebhook(mid2, "I need a quotation please")) === 200,
	);
	const conv2 = await api(`/api/conversations/${CONVERSATION_ID}`, { cookie });
	assert(
		"rule routed conversation to Sales Leads",
		str(conv2.body?.inboxId) === salesLeadsId,
		`inboxId=${str(conv2.body?.inboxId)} expected=${salesLeadsId}`,
	);

	// 5. Duplicate webhook (exact replay of #2) must NOT duplicate messages,
	//    re-route, or re-run rule side effects.
	const before = await api(`/api/conversations/${CONVERSATION_ID}/messages`, {
		cookie,
	});
	const beforeCount = arr(before.body, "messages").length;
	const beforeInbox = str(conv2.body?.inboxId);

	const replay = signedWebhook(mid2, "I need a quotation please");
	const dup = await api("/webhooks/messenger", {
		method: "POST",
		body: replay.payload,
		headers: { "x-hub-signature-256": replay.signature },
	});
	assert("duplicate webhook accepted (silent 200)", dup.status === 200);

	const after = await api(`/api/conversations/${CONVERSATION_ID}/messages`, {
		cookie,
	});
	const afterCount = arr(after.body, "messages").length;
	assert(
		"duplicate webhook did not duplicate the message",
		afterCount === beforeCount,
		`before=${beforeCount} after=${afterCount}`,
	);
	const convAfter = await api(`/api/conversations/${CONVERSATION_ID}`, {
		cookie,
	});
	assert(
		"duplicate webhook did not re-run routing",
		str(convAfter.body?.inboxId) === beforeInbox,
		`inboxId=${str(convAfter.body?.inboxId)}`,
	);

	// 6. Sidebar: shaped sections, counts, and personal preferences.
	const sidebar = await api(`/api/workspaces/${workspaceId}/sidebar`, {
		cookie,
	});
	assert(
		"sidebar returned",
		sidebar.status === 200,
		`status ${sidebar.status}`,
	);
	const sections = arr(sidebar.body, "sections");
	assert(
		"sidebar has sections",
		sections.length === 5,
		`${sections.length} sections`,
	);
	const inboxSection = sections.find((s) => str(s.key) === "inbox");
	const allItem = arr(inboxSection ?? {}, "items").find(
		(item) => str(item.id) === "system:all",
	);
	assert(
		"sidebar all-messages count reflects the conversation",
		num(allItem?.count) >= 1,
		`count=${num(allItem?.count)}`,
	);
	const groupItems = (arr(inboxSection ?? {}, "groups") ?? []).flatMap(
		(group) => arr(group, "items"),
	);
	const salesItem = groupItems.find(
		(item) => str(item.id) === `inbox:${salesLeadsId}`,
	);
	assert(
		"Sales Leads inbox row renders with count",
		Boolean(salesItem) && num(salesItem?.count) === 1,
		`count=${num(salesItem?.count)} color=${str(salesItem?.color)}`,
	);
	assert(
		"Sales Leads row carries its color",
		str(salesItem?.color) === "#F97316",
		`color=${str(salesItem?.color)}`,
	);

	// 7. Personal preferences persist per user and never touch shared state.
	const prefs = await api(
		`/api/workspaces/${workspaceId}/sidebar-preferences`,
		{
			method: "PATCH",
			cookie,
			body: JSON.stringify({
				collapsedSections: ["teams"],
				pinnedItemIds: ["system:all", `inbox:${salesLeadsId}`],
			}),
		},
	);
	assert("preferences saved", prefs.status === 200, `status ${prefs.status}`);
	const savedPrefs = prefs.body?.preferences as Json | undefined;
	assert(
		"collapsed sections persisted",
		JSON.stringify(savedPrefs?.collapsedSections) === JSON.stringify(["teams"]),
	);
	const sidebar2 = await api(`/api/workspaces/${workspaceId}/sidebar`, {
		cookie,
	});
	const roundTripPrefs = sidebar2.body?.preferences as Json | undefined;
	const pinnedIds = roundTripPrefs?.pinnedItemIds;
	assert(
		"preferences round-trip through the sidebar",
		Array.isArray(pinnedIds) && pinnedIds.includes("system:all"),
	);

	// 8. Permission boundary: an unauthenticated call is rejected.
	const noAuth = await api(`/api/workspaces/${workspaceId}/sidebar`);
	assert(
		"sidebar requires auth",
		noAuth.status === 401,
		`status ${noAuth.status}`,
	);
}

run()
	.then(() => {
		console.log("\nRouting + sidebar integration results");
		for (const result of results) {
			console.log(
				`  ${result.ok ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`,
			);
		}
		console.log(`\n${results.length - failures}/${results.length} passed`);
		process.exit(failures === 0 ? 0 : 1);
	})
	.catch((err: unknown) => {
		console.error("ROUTING SMOKE CRASHED:", err);
		process.exit(1);
	});
