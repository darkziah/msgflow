import { Hono } from "hono";
import type { Env } from "./env";
import {
	decodeGmailPubSubNotification,
	enqueueGmailPubSubNotification,
	GmailPubSubConfigurationError,
	verifyGooglePubSubJwt,
} from "./gmail-pubsub";

/** Public Google push boundary: authenticate, validate, and enqueue only. */
export const gmailPubSubApi = new Hono<{ Bindings: Env }>();
gmailPubSubApi.post("/pubsub", async (c) => {
	try {
		if (!(await verifyGooglePubSubJwt(c.env, c.req.header("Authorization"))))
			return c.text("unauthorized", 401);
	} catch (error) {
		if (error instanceof GmailPubSubConfigurationError)
			return c.text("Gmail Pub/Sub is not configured", 503);
		throw error;
	}
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		return c.text("invalid json", 400);
	}
	const notification = decodeGmailPubSubNotification(raw);
	if (!notification) return c.text("invalid payload", 400);
	await enqueueGmailPubSubNotification(c.env, notification);
	return new Response(null, { status: 204 });
});
