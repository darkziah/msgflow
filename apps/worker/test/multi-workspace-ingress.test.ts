import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	contacts,
	conversations,
	emailDomains,
	inboxChannels,
	inboxes,
	mailboxes,
	metaApps,
	workspaceMembers,
	workspaces,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import { routeInbound } from "../src/ingest";
import { createMetaApp, recreateMetaAppWebhookToken } from "../src/meta-apps";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
const OWNER = "owner";
const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

afterEach(async () => {
	await ctx?.mf.dispose();
});

async function addWorkspace(name: string, slug: string): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(workspaces)
		.values({ id, name, slug, createdAt: now, updatedAt: now })
		.run();
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId: id,
			userId: OWNER,
			role: "owner",
			createdAt: now,
		})
		.run();
	return id;
}

async function setupWorkspaces(): Promise<{
	workspaceA: string;
	workspaceB: string;
}> {
	ctx = await createTestDb();
	ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY = TOKEN_KEY;
	const { workspaceId: workspaceA } = await seedWorkspace(ctx);
	await seedUser(ctx, OWNER, "owner@test.dev");
	const now = new Date().toISOString();
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId: workspaceA,
			userId: OWNER,
			role: "owner",
			createdAt: now,
		})
		.run();
	return {
		workspaceA,
		workspaceB: await addWorkspace("Workspace B", "workspace-b"),
	};
}

async function insertPage(
	workspaceId: string,
	externalId: string,
	status: "active" | "disconnected" | "deleted" = "active",
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(channels)
		.values({
			id,
			workspaceId,
			type: "facebook_page",
			displayName: externalId,
			externalId,
			status,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

async function insertInbox(
	workspaceId: string,
	channelId: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(inboxes)
		.values({ id, workspaceId, name: `Inbox ${id}`, createdAt: now })
		.run();
	await ctx.db
		.insert(inboxChannels)
		.values({
			id: crypto.randomUUID(),
			inboxId: id,
			channelId,
			isDefault: true,
		})
		.run();
	return id;
}

describe("multi-workspace provider identity fences", () => {
	test("rejects a duplicate installation-owned Meta App ID across workspaces", async () => {
		const { workspaceA, workspaceB } = await setupWorkspaces();
		const first = await createMetaApp(
			ctx.env,
			workspaceA,
			{ displayName: "App A", appId: "meta-app-shared", appSecret: "secret-a" },
			OWNER,
		);

		await expect(
			createMetaApp(
				ctx.env,
				workspaceB,
				{
					displayName: "App B",
					appId: "meta-app-shared",
					appSecret: "secret-b",
				},
				OWNER,
			),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			ctx.db
				.insert(metaApps)
				.values({
					id: crypto.randomUUID(),
					workspaceId: workspaceB,
					displayName: "bypass attempt",
					appId: first.metaApp.appId,
					appSecret: "enc:v1:test",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})
				.run(),
		).rejects.toThrow();
	});

	test("recreates a Meta App verify token without changing its App identity", async () => {
		const { workspaceA } = await setupWorkspaces();
		const created = await createMetaApp(ctx.env, workspaceA, { displayName: "App A", appId: "meta-app-a", appSecret: "secret-a" }, OWNER);
		const recreated = await recreateMetaAppWebhookToken(ctx.env, workspaceA, created.metaApp.id, OWNER);
		expect(recreated.metaApp).toMatchObject({ id: created.metaApp.id, appId: "meta-app-a" });
		expect(recreated.webhookVerifyToken).not.toBe(created.webhookVerifyToken);
		const row = await ctx.db.select().from(metaApps).where(eq(metaApps.id, created.metaApp.id)).get();
		expect(row?.webhookVerifyTokenHash).not.toBeNull();
		expect(row?.webhookVerifyTokenHash).not.toBe(recreated.webhookVerifyToken);
	});

	test("rejects the same configured Facebook Page identity in another workspace", async () => {
		const { workspaceA, workspaceB } = await setupWorkspaces();
		await insertPage(workspaceA, "page-shared");
		await expect(insertPage(workspaceB, "page-shared")).rejects.toThrow();

		// Historical deleted rows do not receive ingress and may retain the old ID.
		await insertPage(workspaceB, "page-shared", "deleted");
	});

	test("routes Page A ingress only to Page A's workspace rows", async () => {
		const { workspaceA, workspaceB } = await setupWorkspaces();
		const pageA = await insertPage(workspaceA, "page-a");
		const inboxA = await insertInbox(workspaceA, pageA);
		const pageB = await insertPage(workspaceB, "page-b");
		await insertInbox(workspaceB, pageB);

		await routeInbound(ctx.env, {
			conversationId: "fb:page-a:psid-1",
			channel: "facebook",
			providerMessageId: "message-a-1",
			senderId: "psid-1",
			text: "hello from Page A",
			payload: {},
			attachments: [],
			createdAt: new Date().toISOString(),
		});

		const routed = await ctx.db
			.select()
			.from(conversations)
			.where(eq(conversations.id, "fb:page-a:psid-1"))
			.get();
		expect(routed).toMatchObject({
			workspaceId: workspaceA,
			channelId: pageA,
			inboxId: inboxA,
		});
		expect(
			await ctx.db
				.select()
				.from(conversations)
				.where(eq(conversations.workspaceId, workspaceB))
				.all(),
		).toEqual([]);
		expect(
			await ctx.db
				.select()
				.from(contacts)
				.where(and(eq(contacts.workspaceId, workspaceB)))
				.all(),
		).toEqual([]);
		expect(ctx.activityRequests).toHaveLength(1);
	});

	test("keeps email domains and canonical mailbox addresses global", async () => {
		const { workspaceA, workspaceB } = await setupWorkspaces();
		const now = new Date().toISOString();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "domain-a",
				workspaceId: workspaceA,
				canonicalDomain: "example.test",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await expect(
			ctx.db
				.insert(emailDomains)
				.values({
					id: "domain-b-conflict",
					workspaceId: workspaceB,
					canonicalDomain: "example.test",
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "domain-b",
				workspaceId: workspaceB,
				canonicalDomain: "other.test",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(mailboxes)
			.values({
				id: "mailbox-a",
				workspaceId: workspaceA,
				emailDomainId: "domain-a",
				localPart: "support",
				canonicalAddress: "support@example.test",
				type: "shared",
				inboxId: await insertInbox(
					workspaceA,
					await insertPage(workspaceA, "page-mail-a"),
				),
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await expect(
			ctx.db
				.insert(mailboxes)
				.values({
					id: "mailbox-b-conflict",
					workspaceId: workspaceB,
					emailDomainId: "domain-b",
					localPart: "support",
					canonicalAddress: "support@example.test",
					type: "shared",
					inboxId: await insertInbox(
						workspaceB,
						await insertPage(workspaceB, "page-mail-b"),
					),
					createdAt: now,
					updatedAt: now,
				})
				.run(),
		).rejects.toThrow();
	});
});
