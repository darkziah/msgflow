import { afterEach, expect, test } from "bun:test";
import { createTestDb, seedWorkspace, type TestCtx } from "./helpers";
import { routeInboundFacebookCall } from "../src/calling-service";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

test("call ingress claims a signed-normalized connect event before contact/activity/session side effects", async () => {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await ctx.env.DB.batch([
		ctx.env.DB.prepare("INSERT INTO meta_apps (id,workspace_id,display_name,app_id,app_secret,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("app", workspaceId, "App", "meta-app", "secret", now, now),
		ctx.env.DB.prepare("INSERT INTO channels (id,workspace_id,type,display_name,external_id,meta_app_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("page", workspaceId, "facebook_page", "Page", "page-id", "app", "active", now, now),
		ctx.env.DB.prepare("INSERT INTO inboxes (id,workspace_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind("inbox", workspaceId, "Inbox", now, Date.now()),
		ctx.env.DB.prepare("INSERT INTO inbox_channels (id,inbox_id,channel_id,is_default) VALUES (?,?,?,1)").bind("link", "inbox", "page"),
	]);
	const starts: unknown[] = [];
	ctx.env.CALL_SESSION_DO = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => { starts.push(await request.json()); return new Response("ok"); } }) } as unknown as typeof ctx.env.CALL_SESSION_DO;
	const call = { id: "fb-call:page-id:call-1:connect:1:entry-0:call-0", pageId: "page-id", providerCallId: "call-1", event: "connect" as const, endpointPsid: "psid-1", direction: "user_initiated" as const, timestamp: now };
	await routeInboundFacebookCall(ctx.env, "app", call);
	await routeInboundFacebookCall(ctx.env, "app", call);
	expect(await ctx.env.DB.prepare("SELECT count(*) AS count FROM call_events").first()).toEqual({ count: 1 });
	expect(await ctx.env.DB.prepare("SELECT count(*) AS count FROM conversations").first()).toEqual({ count: 1 });
	expect(await ctx.env.DB.prepare("SELECT count(*) AS count FROM messages_summary").first()).toEqual({ count: 0 });
	expect(ctx.activityRequests).toHaveLength(2); // received + no-agent, with no enabled queue
	expect(starts).toHaveLength(0);
});

test("call ingress ignores a Page attached to another Meta App", async () => {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await ctx.env.DB.batch([
		ctx.env.DB.prepare("INSERT INTO meta_apps (id,workspace_id,display_name,app_id,app_secret,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("app", workspaceId, "App", "meta-app", "secret", now, now),
		ctx.env.DB.prepare("INSERT INTO meta_apps (id,workspace_id,display_name,app_id,app_secret,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("other-app", workspaceId, "Other App", "meta-other", "secret", now, now),
		ctx.env.DB.prepare("INSERT INTO channels (id,workspace_id,type,display_name,external_id,meta_app_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("page", workspaceId, "facebook_page", "Page", "page-id", "other-app", "active", now, now),
	]);
	await routeInboundFacebookCall(ctx.env, "app", { id: "event", pageId: "page-id", providerCallId: "call-1", event: "connect", endpointPsid: "psid-1", direction: "user_initiated", timestamp: now });
	expect(await ctx.env.DB.prepare("SELECT count(*) AS count FROM call_events").first()).toEqual({ count: 0 });
});
