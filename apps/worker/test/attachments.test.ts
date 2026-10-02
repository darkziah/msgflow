import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { normalizeEmailMessage, normalizeFacebookWebhook } from "@msgflow/channel";
import { outboundIntents, scheduledMessages } from "@msgflow/db";
import { AttachmentError, storeImageBlob } from "../src/attachments";
import { createTestDb, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => { await ctx?.mf?.dispose(); });

describe("image attachment storage and normalization", () => {
	test("stores only image blobs with public metadata and preserves emoji text", async () => {
		ctx = await createTestDb();
		const attachment = await storeImageBlob(ctx.env, new Blob(["png"], { type: "image/png" }), "猫.png");
		expect(attachment).toMatchObject({ type: "image/png", name: "猫.png", url: `https://attachments.test/${attachment.key}` });
		expect(await ctx.env.ATTACHMENTS.get(attachment.key)).not.toBeNull();
		const inbound = normalizeFacebookWebhook({ entry: [{ id: "page", messaging: [{ sender: { id: "psid" }, timestamp: 1_700_000_000_000, message: { mid: "mid", text: "hello 👋", attachments: [{ type: "image", payload: { url: "https://provider/image" } }] } }] }] });
		expect(inbound[0]).toMatchObject({ text: "hello 👋", providerAttachments: [{ type: "image", url: "https://provider/image" }] });
	});

	test("rejects non-images and permits a text-less email image", async () => {
		ctx = await createTestDb();
		await expect(storeImageBlob(ctx.env, new Blob(["no"], { type: "application/pdf" }), "no.pdf")).rejects.toBeInstanceOf(AttachmentError);
		const image = await storeImageBlob(ctx.env, new Blob(["gif"], { type: "image/gif" }), "a.gif");
		const inbound = normalizeEmailMessage({ from: "customer@example.com", to: "support@example.com", subject: "", messageId: "<m@example.com>", inReplyTo: null, references: null, text: "", attachments: [image], mailbox: "support@example.com", receivedAt: "2026-01-01T00:00:00.000Z" });
		expect(inbound).toMatchObject({ text: "", attachments: [image] });
	});
});

describe("attachment durable outbound rows", () => {
	test("keeps serialized attachment metadata in intent and scheduled rows", async () => {
		ctx = await createTestDb();
		const now = "2026-09-22T00:00:00.000Z";
		const json = JSON.stringify([{ id: "a", key: "attachments/00000000-0000-0000-0000-000000000000.png", type: "image/png", url: "https://attachments.test/attachments/00000000-0000-0000-0000-000000000000.png", name: "a.png", size: 3 }]);
		await ctx.db.insert(outboundIntents).values({ id: "intent", conversationId: "email:support:x", text: "📨", attachmentsJson: json, senderId: "agent", status: "pending", createdAt: now, updatedAt: now }).run();
		await ctx.db.insert(scheduledMessages).values({ id: "scheduled", conversationId: "email:support:x", text: "", attachmentsJson: json, sendAt: now }).run();
		expect((await ctx.db.select().from(outboundIntents).where(eq(outboundIntents.id, "intent")).get())?.attachmentsJson).toBe(json);
		expect((await ctx.db.select().from(scheduledMessages).where(eq(scheduledMessages.id, "scheduled")).get())?.attachmentsJson).toBe(json);
	});
});
