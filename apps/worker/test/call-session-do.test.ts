import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createTestDb, type TestCtx } from "./helpers";
import { callDispatchInternalHeaders } from "../src/call-dispatch-client";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

async function internalHeaders(method: string, pathname: string, body = ""): Promise<Headers> {
	const headers = await callDispatchInternalHeaders(
		ctx.env.BETTER_AUTH_SECRET,
		method,
		pathname,
		"workspace",
		undefined,
		body,
	);
	headers.set("x-authenticated-workspace-id", "workspace");
	if (body) headers.set("content-type", "application/json");
	return headers;
}

test("call session stores a terminal no-stage outcome", async () => {
	const bundled = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/call-dispatch-worker.ts")], target: "browser", external: ["cloudflare:workers", "cloudflare:email"] });
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	ctx = await createTestDb({ script: await bundled.outputs[0]!.text() });
	const namespace = await ctx.mf.getDurableObjectNamespace("CALL_SESSION_DO");
	const stub = namespace.get(namespace.idFromName("facebook-call:call-1"));
	const startBody = JSON.stringify({ callId: "call-1", workspaceId: "workspace", channelId: "channel", pageId: "page", encryptedPageAccessToken: null, conversationId: "conversation", queueId: "queue", stages: [], contact: { id: "contact", displayName: null, avatarUrl: null }, webhookReceivedAt: new Date().toISOString() });
	const startHeaders = await internalHeaders("POST", "/start", startBody);
	const start = await stub.fetch("https://call-session/start", { method: "POST", headers: Object.fromEntries(startHeaders), body: startBody });
	expect(start.status).toBe(200);
	const stateHeaders = await internalHeaders("GET", "/state");
	expect(await (await stub.fetch("https://call-session/state", { headers: Object.fromEntries(stateHeaders) })).json()).toMatchObject({ state: "timed_out" });
});
