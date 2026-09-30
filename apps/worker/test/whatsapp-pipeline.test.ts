import { afterEach, expect, test } from "bun:test";
import type { Message } from "@msgflow/contracts";
import {
	channels,
	contactIdentities,
	contacts,
	conversations,
	inboxChannels,
	inboxes,
	outboundIntents,
	processedMessages,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import { encryptChannelToken } from "../src/channel-token-crypto";
import type { Env } from "../src/env";
import { routeInbound } from "../src/ingest";
import { sendOutbound } from "../src/outbound";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let ctx: TestCtx;
let restoreFetch: typeof fetch | null = null;

afterEach(async () => {
	if (restoreFetch) {
		globalThis.fetch = restoreFetch;
		restoreFetch = null;
	}
	await ctx?.mf.dispose();
});

test("WhatsApp ingress routes canonical text once and outbound uses its phone token", async () => {
	ctx = await createTestDb();
	ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "agent", "agent@test.dev");
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: "agent-membership",
			workspaceId,
			userId: "agent",
			role: "member",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxes)
		.values({
			id: "whatsapp-inbox",
			workspaceId,
			name: "WhatsApp",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: "whatsapp-channel",
			workspaceId,
			type: "whatsapp_phone",
			displayName: "Acme WhatsApp",
			externalId: "phone-123",
			accessToken: await encryptChannelToken("provider-token", TOKEN_KEY),
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxChannels)
		.values({
			id: "whatsapp-default",
			inboxId: "whatsapp-inbox",
			channelId: "whatsapp-channel",
			isDefault: true,
		})
		.run();

	const appended: Message[] = [];
	ctx.env.CONVERSATION_DO = {
		idFromName: (id: string) => id,
		get: () => ({
			fetch: async (_input: string, init?: RequestInit) => {
				if (!init) return new Response("missing", { status: 404 });
				const message = JSON.parse(init.body as string) as Message;
				appended.push(message);
				return Response.json(message);
			},
		}),
	} as unknown as Env["CONVERSATION_DO"];

	const inbound = {
		conversationId: "wa:phone-123:customer-456",
		channel: "whatsapp" as const,
		providerMessageId: "wamid.inbound",
		senderId: "customer-456",
		text: "Hello from WhatsApp",
		payload: { phoneNumberId: "phone-123", profileName: "Customer Name" },
		attachments: [],
		createdAt: now,
	};
	await routeInbound(ctx.env, inbound);
	await routeInbound(ctx.env, inbound);

	expect(appended).toHaveLength(1);
	expect(appended[0]).toMatchObject({
		channel: "whatsapp",
		attachments: [],
		providerMessageId: "wamid.inbound",
	});
	expect(
		await ctx.db
			.select()
			.from(conversations)
			.where(eq(conversations.id, inbound.conversationId))
			.get(),
	).toMatchObject({
		workspaceId,
		channelId: "whatsapp-channel",
		inboxId: "whatsapp-inbox",
	});
	expect((await ctx.db.select().from(contacts).get())?.displayName).toBe(
		"Customer Name",
	);
	expect(
		(await ctx.db.select().from(contactIdentities).get())?.externalUserId,
	).toBe("customer-456");
	expect(await ctx.db.select().from(processedMessages).all()).toHaveLength(1);

	const providerRequests: {
		url: string;
		authorization: string | null;
		body: unknown;
	}[] = [];
	restoreFetch = globalThis.fetch;
	globalThis.fetch = (async (input, init) => {
		providerRequests.push({
			url: String(input),
			authorization: new Headers(init?.headers).get("authorization"),
			body: JSON.parse(String(init?.body)),
		});
		return Response.json({ messages: [{ id: "wamid.outbound" }] });
	}) as typeof fetch;

	const sent = await sendOutbound(ctx.env, {
		conversationId: inbound.conversationId,
		text: "Thanks for contacting us",
		senderId: "agent",
		clientMessageId: "whatsapp-outbound-1",
	});
	expect(sent).toMatchObject({
		ok: true,
		message: { providerMessageId: "wamid.outbound" },
	});
	expect(providerRequests).toEqual([
		expect.objectContaining({
			url: "https://graph.facebook.com/v25.0/phone-123/messages",
			authorization: "Bearer provider-token",
			body: expect.objectContaining({
				messaging_product: "whatsapp",
				to: "customer-456",
				type: "text",
			}),
		}),
	]);
	expect(
		await ctx.db
			.select()
			.from(outboundIntents)
			.where(eq(outboundIntents.id, "whatsapp-outbound-1"))
			.get(),
	).toMatchObject({ status: "accepted", providerMessageId: "wamid.outbound" });
	expect(appended).toHaveLength(2);
});
