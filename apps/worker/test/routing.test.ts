import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	cannedReplies,
	channels,
	contacts,
	conversations,
	conversationTags,
	emailDomains,
	inboxChannels,
	inboxes,
	inboxMembers,
	mailboxDelegates,
	mailboxes,
	metaApps,
	ruleActions,
	ruleConditions,
	ruleExecutionLog,
	rules,
	tags,
	teamMembers,
	teams,
	userSidebarPreferences,
	workspaceMembers,
	workspaces,
} from "@msgflow/db";
import { and, eq } from "drizzle-orm";
import {
	getWorkspaceAccess,
	requireAdminAccess,
	requireWorkspaceAccess,
} from "../src/access";
import { canReadConversation } from "../src/conversation-permissions";
import { ManageError } from "../src/errors";
import {
	assertValidInboxParent,
	getInboxDescendantIds,
	getReadableInboxIds,
} from "../src/inbox-tree";
import { handleInboxTreeMove } from "../src/inbox-tree-route";
import {
	archiveInbox,
	connectChannelToken,
	createCannedReply,
	createFacebookChannel,
	createInbox,
	createRule,
	createTag,
	deleteFacebookChannel,
	deleteRule,
	deleteTag,
	disconnectChannel,
	linkChannelToInbox,
	listCannedReplies,
	listChannels,
	listInboxes,
	listRules,
	listTags,
	moveInboxInTree,
	reorderInboxes,
	setDefaultInbox,
	unlinkChannelFromInbox,
	updateCannedReply,
	updateInbox,
	updateTag,
} from "../src/manage";
import { getConversation, listConversations } from "../src/queries";
import { evaluateRules, type RuleEvaluationContext } from "../src/rules";
import {
	createSavedFilter,
	deleteSavedFilter,
	getSidebar,
	updateSidebarPreferences,
} from "../src/workspace-api";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

// Each test gets a fresh Miniflare D1 with the full migration chain.
let ctx: TestCtx;
let restoreFetch: typeof fetch | null = null;
afterEach(async () => {
	if (restoreFetch) {
		globalThis.fetch = restoreFetch;
		restoreFetch = null;
	}
	await ctx?.mf.dispose();
});

const ADMIN = "user-admin";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

async function setup(): Promise<{ workspaceId: string }> {
	ctx = await createTestDb();
	const ws = await seedWorkspace(ctx);
	await seedUser(ctx, ADMIN, "admin@test.dev");
	await seedUser(ctx, MEMBER, "member@test.dev");
	await seedUser(ctx, OUTSIDER, "outsider@test.dev");
	// Explicit setup creates the owner membership; tests seed that durable state.
	await addMember(ws.workspaceId, ADMIN, "owner");
	return ws;
}

async function addMember(
	workspaceId: string,
	userId: string,
	role: "owner" | "member" | "admin" = "member",
): Promise<void> {
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			userId,
			role,
			createdAt: new Date().toISOString(),
		})
		.onConflictDoNothing()
		.run();
}

function baseContext(
	conversationId: string,
	workspaceId: string,
	inboxId: string,
	text = "hello",
): RuleEvaluationContext {
	return {
		conversationId,
		workspaceId,
		inboxId,
		assigneeId: null,
		status: "open",
		channelType: "email",
		senderEmail: "sender@test.dev",
		subject: null,
		messageText: text,
		conversationTagIds: [],
	};
}

async function insertChannel(
	workspaceId: string,
	type: "email" | "facebook_page" = "email",
	label = "channel",
): Promise<string> {
	const channelId = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type,
			displayName: label,
			externalId: channelId,
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return channelId;
}

async function insertContact(workspaceId: string): Promise<string> {
	const contactId = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(contacts)
		.values({ id: contactId, workspaceId, createdAt: now, updatedAt: now })
		.run();
	return contactId;
}

async function insertConversation(
	workspaceId: string,
	channelId: string,
	inboxId: string,
	contactId: string,
	id: string,
	status: "open" | "archived" = "open",
): Promise<void> {
	const now = new Date().toISOString();
	await ctx.db
		.insert(conversations)
		.values({
			id,
			workspaceId,
			channelId,
			inboxId,
			contactId,
			doBindingId: id,
			status,
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

async function insertTreeInbox(
	workspaceId: string,
	id: string,
	options: Partial<typeof inboxes.$inferInsert> = {},
): Promise<void> {
	await ctx.db
		.insert(inboxes)
		.values({
			id,
			workspaceId,
			name: id,
			createdAt: new Date().toISOString(),
			...options,
		})
		.run();
}

/** Insert a rule with conditions/actions, all in match_group 0 (OR'd). */
async function insertRule(
	workspaceId: string,
	id: string,
	priority: number,
	stopProcessing: boolean,
	conditions: { field: string; operator: string; value: string }[],
	actions: { type: string; value: string; order: number }[],
): Promise<void> {
	const now = new Date().toISOString();
	await ctx.db
		.insert(rules)
		.values({
			id,
			workspaceId,
			name: id,
			triggerType: "message_received",
			isActive: true,
			priority,
			stopProcessing,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const condition of conditions) {
		await ctx.db
			.insert(ruleConditions)
			.values({
				id: crypto.randomUUID(),
				ruleId: id,
				field: condition.field,
				operator:
					condition.operator as (typeof ruleConditions.$inferInsert)["operator"],
				value: condition.value,
				matchGroup: 0,
				createdAt: now,
			})
			.run();
	}
	for (const action of actions) {
		await ctx.db
			.insert(ruleActions)
			.values({
				id: crypto.randomUUID(),
				ruleId: id,
				actionType:
					action.type as (typeof ruleActions.$inferInsert)["actionType"],
				actionValue: action.value,
				executionOrder: action.order,
				createdAt: now,
			})
			.run();
	}
}

async function channelContactConversation(
	workspaceId: string,
	inboxId: string,
): Promise<string> {
	const channelId = await insertChannel(workspaceId);
	const contactId = await insertContact(workspaceId);
	const conversationId = crypto.randomUUID();
	await insertConversation(
		workspaceId,
		channelId,
		inboxId,
		contactId,
		conversationId,
	);
	return conversationId;
}

async function channelAndInboxes(): Promise<{
	workspaceId: string;
	channelId: string;
	inboxA: string;
	inboxB: string;
}> {
	const { workspaceId } = await setup();
	const channelId = await insertChannel(workspaceId);
	const inboxA = (await createInbox(ctx.env, workspaceId, { name: "A" }, ADMIN))
		.id;
	const inboxB = (await createInbox(ctx.env, workspaceId, { name: "B" }, ADMIN))
		.id;
	return { workspaceId, channelId, inboxA, inboxB };
}

// ---------------------------------------------------------------------------
// Workspace permission boundaries
// ---------------------------------------------------------------------------

describe("workspace permission boundaries", () => {
	test("requires an explicit owner membership; non-members are rejected", async () => {
		const { workspaceId } = await setup();

		const adminAccess = await getWorkspaceAccess(ctx.db, workspaceId, ADMIN);
		expect(adminAccess).not.toBeNull();
		expect(adminAccess?.role).toBe("owner");
		expect(adminAccess?.isAdmin).toBe(true);

		// OUTSIDER is not a member → no access.
		const outsider = await getWorkspaceAccess(ctx.db, workspaceId, OUTSIDER);
		expect(outsider).toBeNull();
		await expect(
			requireWorkspaceAccess(ctx.db, workspaceId, OUTSIDER),
		).rejects.toThrow(ManageError);

		// MEMBER sees the workspace but is not an admin.
		await addMember(workspaceId, MEMBER);
		const memberAccess = await getWorkspaceAccess(ctx.db, workspaceId, MEMBER);
		expect(memberAccess?.role).toBe("member");
		expect(memberAccess?.isAdmin).toBe(false);
		await expect(
			requireAdminAccess(ctx.db, workspaceId, MEMBER),
		).rejects.toThrow(ManageError);
	});

	test("members cannot mutate inbox configuration", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await expect(
			createInbox(ctx.env, workspaceId, { name: "Member inbox" }, MEMBER),
		).rejects.toThrow(ManageError);
	});

	test("workspace-scoped reads require membership (403 for outsiders)", async () => {
		const { workspaceId } = await setup();
		await expect(listInboxes(ctx.env, workspaceId, OUTSIDER)).rejects.toThrow(
			ManageError,
		);
		await expect(getSidebar(ctx.env, workspaceId, OUTSIDER)).rejects.toThrow(
			ManageError,
		);
	});
});

// ---------------------------------------------------------------------------
// Legacy management RBAC: tags, canned replies, and channel credentials
// ---------------------------------------------------------------------------

describe("legacy management workspace RBAC", () => {
	test("enforces private-tag ownership, admin configuration, and foreign-id 404s", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await addMember(workspaceId, OUTSIDER);

		const privateTag = await createTag(
			ctx.env,
			workspaceId,
			{ name: "Member private", visibility: "private" },
			MEMBER,
		);
		expect(privateTag.ownerUserId).toBe(MEMBER);
		expect(
			(await listTags(ctx.env, workspaceId, MEMBER)).map((tag) => tag.id),
		).toContain(privateTag.id);
		expect(
			(await listTags(ctx.env, workspaceId, OUTSIDER)).map((tag) => tag.id),
		).not.toContain(privateTag.id);
		expect(
			(await listTags(ctx.env, workspaceId, ADMIN)).map((tag) => tag.id),
		).toContain(privateTag.id);

		await updateTag(
			ctx.env,
			workspaceId,
			privateTag.id,
			{ name: "Renamed" },
			MEMBER,
		);
		await updateTag(
			ctx.env,
			workspaceId,
			privateTag.id,
			{ color: "#123456" },
			ADMIN,
		);
		await expect(
			updateTag(
				ctx.env,
				workspaceId,
				privateTag.id,
				{ visibility: "shared" },
				MEMBER,
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			createTag(
				ctx.env,
				workspaceId,
				{ name: "Shared", visibility: "shared" },
				MEMBER,
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			createCannedReply(
				ctx.env,
				workspaceId,
				{ name: "No", body: "No" },
				MEMBER,
			),
		).rejects.toMatchObject({ status: 403 });

		const cannedReply = await createCannedReply(
			ctx.env,
			workspaceId,
			{ name: "Approved", body: "Done" },
			ADMIN,
		);
		expect((await listCannedReplies(ctx.env, workspaceId, MEMBER))[0]?.id).toBe(
			cannedReply.id,
		);

		const foreignWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign",
				slug: "foreign",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await addMember(foreignWorkspaceId, ADMIN, "owner");
		const foreignTag = await createTag(
			ctx.env,
			foreignWorkspaceId,
			{ name: "Foreign shared", visibility: "shared" },
			ADMIN,
		);
		const foreignReply = await createCannedReply(
			ctx.env,
			foreignWorkspaceId,
			{ name: "Foreign reply", body: "Hidden" },
			ADMIN,
		);
		const foreignChannelId = crypto.randomUUID();
		await ctx.db
			.insert(channels)
			.values({
				id: foreignChannelId,
				workspaceId: foreignWorkspaceId,
				type: "facebook_page",
				displayName: "Foreign Page",
				externalId: "foreign-page",
				accessToken: "enc:v1:credential",
				status: "active",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await insertRule(foreignWorkspaceId, "foreign-rule", 0, false, [], []);

		// Every remaining management resource is constrained by the requested
		// workspace, even when the actor also belongs to the foreign workspace.
		expect(
			(await listRules(ctx.env, workspaceId, ADMIN)).map((rule) => rule.id),
		).not.toContain("foreign-rule");
		await expect(
			deleteRule(ctx.env, workspaceId, "foreign-rule", ADMIN),
		).rejects.toMatchObject({ status: 404 });

		await expect(
			updateTag(ctx.env, workspaceId, foreignTag.id, { name: "Leaked" }, ADMIN),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			deleteTag(ctx.env, workspaceId, foreignTag.id, ADMIN),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			updateCannedReply(
				ctx.env,
				workspaceId,
				foreignReply.id,
				{ name: "Leaked", body: "Leaked" },
				ADMIN,
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			disconnectChannel(ctx.env, workspaceId, foreignChannelId, ADMIN),
		).rejects.toMatchObject({ status: 404 });

		const foreignRows = await ctx.db
			.select({
				tagName: tags.name,
				replyName: cannedReplies.name,
				token: channels.accessToken,
			})
			.from(tags)
			.innerJoin(cannedReplies, eq(cannedReplies.workspaceId, tags.workspaceId))
			.innerJoin(channels, eq(channels.workspaceId, tags.workspaceId))
			.where(eq(tags.id, foreignTag.id))
			.get();
		expect(foreignRows).toEqual({
			tagName: "Foreign shared",
			replyName: "Foreign reply",
			token: "enc:v1:credential",
		});
		expect(
			(await listChannels(ctx.env, workspaceId, ADMIN))[0],
		).toBeUndefined();
		await expect(
			connectChannelToken(
				ctx.env,
				workspaceId,
				foreignChannelId,
				"token",
				ADMIN,
			),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("workspace-scoped management route boundaries", () => {
	test("registers every management route canonically and authorizes before resource access", () => {
		const source = readFileSync(
			new URL("../src/index.ts", import.meta.url),
			"utf8",
		);
		const routes = [
			[
				"inbox list",
				"get",
				"/api/workspaces/:workspaceId/inboxes",
				"listInboxes(",
			],
			[
				"inbox create",
				"post",
				"/api/workspaces/:workspaceId/inboxes",
				"createInbox(",
			],
			[
				"inbox update",
				"patch",
				"/api/workspaces/:workspaceId/inboxes/:inboxId",
				"updateInbox(",
			],
			[
				"inbox move",
				"post",
				"/api/workspaces/:workspaceId/inboxes/:inboxId/move",
				"handleInboxTreeMove(",
			],
			[
				"inbox delete",
				"delete",
				"/api/workspaces/:workspaceId/inboxes/:inboxId",
				"deleteInbox(",
			],
			[
				"inbox channel link",
				"post",
				"/api/workspaces/:workspaceId/inboxes/:inboxId/channels",
				"linkChannelToInbox(",
			],
			[
				"inbox channel unlink",
				"delete",
				"/api/workspaces/:workspaceId/inboxes/:inboxId/channels/:channelId",
				"unlinkChannelFromInbox(",
			],
			[
				"users",
				"get",
				"/api/workspaces/:workspaceId/users",
				"const users = await db",
			],
			[
				"channels",
				"get",
				"/api/workspaces/:workspaceId/channels",
				"listChannels(",
			],
			[
				"channel token",
				"post",
				"/api/workspaces/:workspaceId/channels/:id/token",
				"connectChannelToken(",
			],
			[
				"channel disconnect",
				"post",
				"/api/workspaces/:workspaceId/channels/:id/disconnect",
				"disconnectChannel(",
			],
			[
				"channel delete",
				"delete",
				"/api/workspaces/:workspaceId/channels/:id",
				"deleteFacebookChannel(",
			],
			["tag list", "get", "/api/workspaces/:workspaceId/tags", "listTags("],
			["tag create", "post", "/api/workspaces/:workspaceId/tags", "createTag("],
			[
				"tag update",
				"patch",
				"/api/workspaces/:workspaceId/tags/:id",
				"updateTag(",
			],
			[
				"tag delete",
				"delete",
				"/api/workspaces/:workspaceId/tags/:id",
				"deleteTag(",
			],
			[
				"conversation tag add",
				"post",
				"/api/workspaces/:workspaceId/conversations/:id/tags",
				"getConversation(",
			],
			[
				"conversation tag remove",
				"delete",
				"/api/workspaces/:workspaceId/conversations/:id/tags/:tagId",
				"getConversation(",
			],
			["rule list", "get", "/api/workspaces/:workspaceId/rules", "listRules("],
			[
				"rule create",
				"post",
				"/api/workspaces/:workspaceId/rules",
				"createRule(",
			],
			[
				"rule update",
				"patch",
				"/api/workspaces/:workspaceId/rules/:id",
				"updateRule(",
			],
			[
				"rule delete",
				"delete",
				"/api/workspaces/:workspaceId/rules/:id",
				"deleteRule(",
			],
			[
				"canned reply list",
				"get",
				"/api/workspaces/:workspaceId/canned-replies",
				"listCannedReplies(",
			],
			[
				"canned reply create",
				"post",
				"/api/workspaces/:workspaceId/canned-replies",
				"createCannedReply(",
			],
			[
				"canned reply update",
				"patch",
				"/api/workspaces/:workspaceId/canned-replies/:id",
				"updateCannedReply(",
			],
			[
				"canned reply delete",
				"delete",
				"/api/workspaces/:workspaceId/canned-replies/:id",
				"deleteCannedReply(",
			],
		] as const;

		function extractRouteBlock(method: string, path: string): string {
			const registration = `app.${method}("${path}", async (c) => {`;
			const matches = [
				...source.matchAll(new RegExp(escapeRegExp(registration), "g")),
			];
			expect(
				matches,
				`${method.toUpperCase()} ${path} registration`,
			).toHaveLength(1);
			const start = matches[0]?.index;
			expect(start).toBeDefined();

			const bodyStart = start + registration.length - 1;
			let depth = 0;
			let quote: "'" | '"' | "`" | null = null;
			let lineComment = false;
			let blockComment = false;
			for (let index = bodyStart; index < source.length; index += 1) {
				const char = source[index];
				const next = source[index + 1];
				if (lineComment) {
					if (char === "\n") lineComment = false;
					continue;
				}
				if (blockComment) {
					if (char === "*" && next === "/") {
						blockComment = false;
						index += 1;
					}
					continue;
				}
				if (quote) {
					if (char === "\\") {
						index += 1;
					} else if (char === quote) {
						quote = null;
					}
					continue;
				}
				if (char === "/" && next === "/") {
					lineComment = true;
					index += 1;
					continue;
				}
				if (char === "/" && next === "*") {
					blockComment = true;
					index += 1;
					continue;
				}
				if (char === "'" || char === '"' || char === "`") {
					quote = char;
					continue;
				}
				if (char === "{") depth += 1;
				if (char === "}" && --depth === 0)
					return source.slice(start, index + 1);
			}
			throw new Error(`unterminated ${method.toUpperCase()} ${path} handler`);
		}

		for (const [name, method, path, resourceMarker] of routes) {
			const handler = extractRouteBlock(method, path);
			const authorization = handler.indexOf("requireWorkspaceAccess(");
			const resourceAccess = handler.indexOf(resourceMarker);
			expect(authorization, `${name} authorization`).toBeGreaterThanOrEqual(0);
			expect(resourceAccess, `${name} resource access`).toBeGreaterThanOrEqual(
				0,
			);
			expect(authorization, `${name} authorization order`).toBeLessThan(
				resourceAccess,
			);
			if (name.startsWith("inbox")) {
				expect(handler).toContain('c.req.param("workspaceId")');
			}
		}

		for (const legacyRegistration of [
			'app.get("/api/inboxes",',
			'app.post("/api/inboxes",',
			'app.patch("/api/inboxes/:id",',
			'app.delete("/api/inboxes/:id",',
			'app.post("/api/inboxes/:id/channels",',
			'app.delete("/api/inboxes/:id/channels/:channelId",',
		]) {
			expect(source).not.toContain(legacyRegistration);
		}
	});
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Inbox CRUD + name uniqueness + validation
// ---------------------------------------------------------------------------

describe("inbox CRUD", () => {
	test("owner creates an explicit Facebook Page channel with one default Inbox", async () => {
		const { workspaceId } = await setup();
		ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY =
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
		restoreFetch = globalThis.fetch;
		globalThis.fetch = (async (input) => {
			const url = String(input);
			return Response.json(
				url.includes("subscribed_apps")
					? { success: true }
					: { id: url.includes("page-456") ? "page-456" : "page-123" },
			);
		}) as typeof fetch;
		const inbox = await createInbox(
			ctx.env,
			workspaceId,
			{ name: "Messenger" },
			ADMIN,
		);
		const now = new Date().toISOString();
		await ctx.db
			.insert(metaApps)
			.values({
				id: "meta-app",
				workspaceId,
				displayName: "Development App",
				appId: "app-123",
				appSecret: "enc:v1:test",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const channel = await createFacebookChannel(
			ctx.env,
			workspaceId,
			{
				pageId: "page-123",
				displayName: "Acme Support",
				accessToken: "page-access-token",
				inboxId: inbox.id,
				metaAppId: "meta-app",
			},
			ADMIN,
		);
		expect(channel).toMatchObject({
			type: "facebook_page",
			externalId: "page-123",
			hasToken: true,
		});
		expect(
			await ctx.env.DB.prepare(
				"SELECT is_default FROM inbox_channels WHERE inbox_id=? AND channel_id=?",
			)
				.bind(inbox.id, channel.id)
				.first(),
		).toEqual({ is_default: 1 });
		await connectChannelToken(
			ctx.env,
			workspaceId,
			channel.id,
			"rotated-token",
			ADMIN,
		);
		expect(
			await ctx.env.DB.prepare(
				"SELECT access_token,status FROM channels WHERE id=?",
			)
				.bind(channel.id)
				.first<{ access_token: string | null; status: string }>(),
		).toMatchObject({
			status: "active",
			access_token: expect.stringMatching(/^enc:v1:/),
		});
		await disconnectChannel(ctx.env, workspaceId, channel.id, ADMIN);
		expect(
			await ctx.env.DB.prepare(
				"SELECT access_token,status FROM channels WHERE id=?",
			)
				.bind(channel.id)
				.first(),
		).toEqual({ access_token: null, status: "disconnected" });
		const secondChannel = await createFacebookChannel(
			ctx.env,
			workspaceId,
			{
				pageId: "page-456",
				displayName: "Acme Sales",
				accessToken: "second-page-token",
				inboxId: inbox.id,
				metaAppId: "meta-app",
			},
			ADMIN,
		);
		expect(secondChannel.externalId).toBe("page-456");
		expect(
			await ctx.env.DB.prepare(
				"SELECT count(*) AS count FROM channels WHERE meta_app_id=?",
			)
				.bind("meta-app")
				.first<{ count: number }>(),
		).toEqual({ count: 2 });
		await expect(
			createFacebookChannel(
				ctx.env,
				workspaceId,
				{
					...channel,
					pageId: "page-123",
					accessToken: "another",
					inboxId: inbox.id,
					metaAppId: "meta-app",
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
	});

	test("reconnect revives a deleted Facebook Page in the same workspace", async () => {
		const { workspaceId } = await setup();
		ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY =
			"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
		restoreFetch = globalThis.fetch;
		globalThis.fetch = (async (input) =>
			Response.json(
				String(input).includes("subscribed_apps")
					? { success: true }
					: { id: "page-reconnect" },
			)) as typeof fetch;
		const inbox = await createInbox(
			ctx.env,
			workspaceId,
			{ name: "Messenger" },
			ADMIN,
		);
		const now = new Date().toISOString();
		await ctx.db
			.insert(metaApps)
			.values({
				id: "meta-app-reconnect",
				workspaceId,
				displayName: "Development App",
				appId: "app-reconnect",
				appSecret: "enc:v1:test",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const original = await createFacebookChannel(
			ctx.env,
			workspaceId,
			{
				pageId: "page-reconnect",
				accessToken: "first-token",
				inboxId: inbox.id,
				metaAppId: "meta-app-reconnect",
			},
			ADMIN,
		);
		await deleteFacebookChannel(ctx.env, workspaceId, original.id, ADMIN);
		const reconnected = await createFacebookChannel(
			ctx.env,
			workspaceId,
			{
				pageId: "page-reconnect",
				accessToken: "second-token",
				inboxId: inbox.id,
				metaAppId: "meta-app-reconnect",
			},
			ADMIN,
		);
		expect(reconnected.id).toBe(original.id);
		expect(
			await ctx.env.DB.prepare(
				"SELECT status,access_token,meta_app_id FROM channels WHERE id=?",
			)
				.bind(original.id)
				.first(),
		).toMatchObject({
			status: "active",
			meta_app_id: "meta-app-reconnect",
			access_token: expect.stringMatching(/^enc:v1:/),
		});
		expect(
			await ctx.env.DB.prepare(
				"SELECT count(*) AS count FROM inbox_channels WHERE channel_id=?",
			)
				.bind(original.id)
				.first<{ count: number }>(),
		).toEqual({ count: 1 });
	});

	test("admin creates an inbox with the full settings surface", async () => {
		const { workspaceId } = await setup();
		const inbox = await createInbox(
			ctx.env,
			workspaceId,
			{
				name: "Billing",
				description: "Payments",
				color: "#EAB308",
				icon: "receipt-text",
				assignmentStrategy: "round_robin",
			},
			ADMIN,
		);
		expect(inbox.name).toBe("Billing");
		expect(inbox.color).toBe("#EAB308");
		expect(inbox.icon).toBe("receipt-text");
		expect(inbox.assignmentStrategy).toBe("round_robin");
		expect(inbox.memberIds).toContain(ADMIN);
	});

	test("inbox names are unique per workspace", async () => {
		const { workspaceId } = await setup();
		await createInbox(ctx.env, workspaceId, { name: "Billing" }, ADMIN);
		await expect(
			createInbox(ctx.env, workspaceId, { name: "Billing" }, ADMIN),
		).rejects.toThrow(ManageError);
	});

	test("invalid color / icon / strategy are rejected", async () => {
		const { workspaceId } = await setup();
		await expect(
			createInbox(
				ctx.env,
				workspaceId,
				{ name: "Bad color", color: "blue" },
				ADMIN,
			),
		).rejects.toThrow(ManageError);
		await expect(
			createInbox(
				ctx.env,
				workspaceId,
				{ name: "Bad icon", icon: "custom.png" as never },
				ADMIN,
			),
		).rejects.toThrow(ManageError);
		await expect(
			createInbox(
				ctx.env,
				workspaceId,
				{ name: "Bad strat", assignmentStrategy: "random" as never },
				ADMIN,
			),
		).rejects.toThrow(ManageError);
	});
});

// ---------------------------------------------------------------------------
// Default-inbox invariants (the core routing rules)
// ---------------------------------------------------------------------------

describe("default-inbox uniqueness", () => {
	test("setting a new default transactionally demotes the old one", async () => {
		const { workspaceId, channelId, inboxA, inboxB } =
			await channelAndInboxes();
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxA, ADMIN);
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxB, ADMIN);

		const links = await ctx.db
			.select()
			.from(inboxChannels)
			.where(eq(inboxChannels.channelId, channelId))
			.all();
		const defaults = links.filter((link) => link.isDefault);
		expect(defaults).toHaveLength(1);
		expect(defaults[0]?.inboxId).toBe(inboxB);
	});

	test("the partial unique index rejects a second default row outright", async () => {
		const { workspaceId, channelId, inboxA, inboxB } =
			await channelAndInboxes();
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxA, ADMIN);
		// Bypass the API layer: a raw second default must violate the index.
		await expect(
			ctx.db
				.insert(inboxChannels)
				.values({
					id: crypto.randomUUID(),
					inboxId: inboxB,
					channelId,
					isDefault: true,
				})
				.run(),
		).rejects.toThrow();
	});

	test("unlinking a channel's only default is rejected until a replacement exists", async () => {
		const { workspaceId, channelId, inboxA, inboxB } =
			await channelAndInboxes();
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxA, ADMIN);
		await expect(
			unlinkChannelFromInbox(ctx.env, workspaceId, inboxA, channelId, ADMIN),
		).rejects.toThrow(ManageError);
		// With a replacement in place, the old default can be unlinked.
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxB, ADMIN);
		await unlinkChannelFromInbox(
			ctx.env,
			workspaceId,
			inboxA,
			channelId,
			ADMIN,
		);
		const links = await ctx.db
			.select()
			.from(inboxChannels)
			.where(
				and(
					eq(inboxChannels.channelId, channelId),
					eq(inboxChannels.inboxId, inboxA),
				),
			)
			.all();
		expect(links).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Archived inbox validation
// ---------------------------------------------------------------------------

describe("archived inbox validation", () => {
	test("cannot archive the only default inbox of a channel", async () => {
		const { workspaceId } = await setup();
		const channelId = await insertChannel(workspaceId);
		const inboxA = (
			await createInbox(ctx.env, workspaceId, { name: "A" }, ADMIN)
		).id;
		const inboxB = (
			await createInbox(ctx.env, workspaceId, { name: "B" }, ADMIN)
		).id;
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxA, ADMIN);
		await expect(
			archiveInbox(ctx.env, workspaceId, inboxA, ADMIN),
		).rejects.toThrow(ManageError);
		// After a replacement default, archiving is allowed.
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxB, ADMIN);
		const archived = await archiveInbox(ctx.env, workspaceId, inboxA, ADMIN);
		expect(archived.isArchived).toBe(true);
	});

	test("archived inboxes cannot become a default (API + link)", async () => {
		const { workspaceId, channelId, inboxA, inboxB } =
			await channelAndInboxes();
		await setDefaultInbox(ctx.env, workspaceId, channelId, inboxA, ADMIN);
		await ctx.db
			.update(inboxes)
			.set({ isArchived: true })
			.where(eq(inboxes.id, inboxB))
			.run();
		await expect(
			setDefaultInbox(ctx.env, workspaceId, channelId, inboxB, ADMIN),
		).rejects.toThrow(ManageError);
		await expect(
			linkChannelToInbox(
				ctx.env,
				workspaceId,
				inboxB,
				{ channelId, isDefault: true },
				ADMIN,
			),
		).rejects.toThrow(ManageError);
	});

	test("rules cannot be scoped to an archived inbox", async () => {
		const { workspaceId } = await setup();
		const inboxA = (
			await createInbox(ctx.env, workspaceId, { name: "A" }, ADMIN)
		).id;
		await ctx.db
			.update(inboxes)
			.set({ isArchived: true })
			.where(eq(inboxes.id, inboxA))
			.run();
		await expect(
			createRule(
				ctx.env,
				workspaceId,
				{
					name: "archived scope",
					triggerType: "message_received",
					isActive: true,
					priority: 1,
					inboxId: inboxA,
					conditions: [],
					actions: [],
				},
				ADMIN,
			),
		).rejects.toThrow(ManageError);
	});

	test("a rule action never moves a conversation into an archived inbox", async () => {
		const { workspaceId } = await setup();
		const defaultInbox = (
			await createInbox(ctx.env, workspaceId, { name: "Default" }, ADMIN)
		).id;
		const archivedTarget = (
			await createInbox(ctx.env, workspaceId, { name: "Target" }, ADMIN)
		).id;
		await ctx.db
			.update(inboxes)
			.set({ isArchived: true })
			.where(eq(inboxes.id, archivedTarget))
			.run();
		const conversationId = await channelContactConversation(
			workspaceId,
			defaultInbox,
		);

		await insertRule(
			workspaceId,
			"r-archived",
			1,
			false,
			[{ field: "message.body", operator: "contains", value: "invoice" }],
			[{ type: "move_inbox", value: archivedTarget, order: 0 }],
		);

		const outcome = await evaluateRules(
			ctx.env,
			baseContext(conversationId, workspaceId, defaultInbox, "my invoice"),
		);
		expect(outcome.inboxId).toBe(defaultInbox); // move was skipped

		const logs = await ctx.db
			.select()
			.from(ruleExecutionLog)
			.where(eq(ruleExecutionLog.ruleId, "r-archived"))
			.all();
		expect(logs).toHaveLength(1);
		expect(logs[0]?.result).toBe("matched");
		expect(logs[0]?.detail).toContain("move_inbox:skipped");
	});
});

// ---------------------------------------------------------------------------
// Rules: priority, stop_processing, skipped logging
// ---------------------------------------------------------------------------

describe("rule evaluation", () => {
	async function ruleSetup(): Promise<{
		workspaceId: string;
		defaultInbox: string;
		destA: string;
		destB: string;
		conversationId: string;
	}> {
		const { workspaceId } = await setup();
		const defaultInbox = (
			await createInbox(ctx.env, workspaceId, { name: "Default" }, ADMIN)
		).id;
		const destA = (
			await createInbox(ctx.env, workspaceId, { name: "Dest A" }, ADMIN)
		).id;
		const destB = (
			await createInbox(ctx.env, workspaceId, { name: "Dest B" }, ADMIN)
		).id;
		const conversationId = await channelContactConversation(
			workspaceId,
			defaultInbox,
		);
		return { workspaceId, defaultInbox, destA, destB, conversationId };
	}

	test("rules run in ascending priority; first routing action wins", async () => {
		const { workspaceId, defaultInbox, destA, destB, conversationId } =
			await ruleSetup();
		await insertRule(
			workspaceId,
			"r-p1",
			1,
			false,
			[{ field: "message.body", operator: "contains", value: "ping" }],
			[{ type: "move_inbox", value: destA, order: 0 }],
		);
		await insertRule(
			workspaceId,
			"r-p2",
			2,
			false,
			[{ field: "message.body", operator: "contains", value: "ping" }],
			[{ type: "move_inbox", value: destB, order: 0 }],
		);

		const outcome = await evaluateRules(
			ctx.env,
			baseContext(conversationId, workspaceId, defaultInbox, "ping me"),
		);
		expect(outcome.inboxId).toBe(destA); // lower priority ran first
	});

	test("stop_processing halts later rules after a match", async () => {
		const { workspaceId, defaultInbox, destA, destB, conversationId } =
			await ruleSetup();
		await insertRule(
			workspaceId,
			"r-stop",
			1,
			true,
			[{ field: "message.body", operator: "contains", value: "stop" }],
			[{ type: "move_inbox", value: destA, order: 0 }],
		);
		// This rule would match too, but must never run after r-stop.
		await insertRule(
			workspaceId,
			"r-after",
			2,
			false,
			[{ field: "message.body", operator: "contains", value: "stop" }],
			[{ type: "move_inbox", value: destB, order: 0 }],
		);

		const outcome = await evaluateRules(
			ctx.env,
			baseContext(conversationId, workspaceId, defaultInbox, "stop now"),
		);
		expect(outcome.inboxId).toBe(destA);
		const logs = await ctx.db.select().from(ruleExecutionLog).all();
		const loggedRuleIds = logs.map((log) => log.ruleId);
		expect(loggedRuleIds).toContain("r-stop");
		expect(loggedRuleIds).not.toContain("r-after");
	});

	test("every candidate evaluation is logged (skipped + matched)", async () => {
		const { workspaceId, defaultInbox, destA, conversationId } =
			await ruleSetup();
		await insertRule(
			workspaceId,
			"r-no-match",
			1,
			false,
			[{ field: "message.body", operator: "contains", value: "zzz" }],
			[{ type: "move_inbox", value: destA, order: 0 }],
		);
		await insertRule(
			workspaceId,
			"r-match",
			2,
			false,
			[{ field: "message.body", operator: "contains", value: "invoice" }],
			[{ type: "move_inbox", value: destA, order: 0 }],
		);

		await evaluateRules(
			ctx.env,
			baseContext(conversationId, workspaceId, defaultInbox, "my invoice"),
		);
		const logs = await ctx.db.select().from(ruleExecutionLog).all();
		expect(logs).toHaveLength(2);
		const byRule = new Map(logs.map((log) => [log.ruleId, log.result]));
		expect(byRule.get("r-no-match")).toBe("skipped");
		expect(byRule.get("r-match")).toBe("matched");
	});

	test("rules can route into an inbox with no channel attached", async () => {
		const { workspaceId, defaultInbox, destA, conversationId } =
			await ruleSetup();
		// destA has no inbox_channels link at all — pure rule destination.
		await insertRule(
			workspaceId,
			"r-route",
			1,
			false,
			[{ field: "message.body", operator: "contains", value: "invoice" }],
			[{ type: "move_inbox", value: destA, order: 0 }],
		);
		const outcome = await evaluateRules(
			ctx.env,
			baseContext(conversationId, workspaceId, defaultInbox, "pay my invoice"),
		);
		expect(outcome.inboxId).toBe(destA);
	});
});

// ---------------------------------------------------------------------------
// Inbox tree persistence migration
// ---------------------------------------------------------------------------

describe("inbox tree persistence", () => {
	test("fresh migrated D1 enforces tree integrity and Drizzle roundtrips defaults", async () => {
		const { workspaceId } = await setup();
		const inboxColumns = await ctx.env.DB.prepare(
			"PRAGMA table_info(inboxes)",
		).all<{
			name: string;
		}>();
		expect(inboxColumns.results.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"parent_inbox_id",
				"visibility_type",
				"tree_version",
			]),
		);
		const inboxIndexes = await ctx.env.DB.prepare(
			"PRAGMA index_list(inboxes)",
		).all<{
			name: string;
		}>();
		expect(inboxIndexes.results.map((index) => index.name)).toEqual(
			expect.arrayContaining([
				"idx_inboxes_workspace_parent_order",
				"idx_inboxes_workspace_visibility",
			]),
		);
		const indexColumns = async (name: string): Promise<string[]> => {
			const result = await ctx.env.DB.prepare(
				`PRAGMA index_info(${name})`,
			).all<{
				name: string;
			}>();
			return result.results.map((column: { name: string }) => column.name);
		};
		expect(await indexColumns("idx_inboxes_workspace_parent_order")).toEqual([
			"workspace_id",
			"parent_inbox_id",
			"sort_order",
			"id",
		]);
		expect(await indexColumns("idx_inboxes_workspace_visibility")).toEqual([
			"workspace_id",
			"visibility_type",
			"is_archived",
		]);
		const preferenceColumns = await ctx.env.DB.prepare(
			"PRAGMA table_info(user_sidebar_preferences)",
		).all<{ name: string }>();
		expect(preferenceColumns.results.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"collapsed_node_ids_json",
				"last_open_branch_ids_json",
			]),
		);

		const now = new Date().toISOString();
		const parentId = crypto.randomUUID();
		const childId = crypto.randomUUID();
		await ctx.db
			.insert(inboxes)
			.values({
				id: parentId,
				workspaceId,
				name: "Parent",
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(inboxes)
			.values({
				id: childId,
				workspaceId,
				parentInboxId: parentId,
				name: "Child",
				createdAt: now,
			})
			.run();
		const child = await ctx.db
			.select()
			.from(inboxes)
			.where(eq(inboxes.id, childId))
			.get();
		expect(child).toMatchObject({
			parentInboxId: parentId,
			visibilityType: "shared",
			treeVersion: 0,
		});

		const foreignWorkspaceId = crypto.randomUUID();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign workspace",
				slug: `foreign-${foreignWorkspaceId}`,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const foreignParentId = crypto.randomUUID();
		await ctx.db
			.insert(inboxes)
			.values({
				id: foreignParentId,
				workspaceId: foreignWorkspaceId,
				name: "Foreign parent",
				createdAt: now,
			})
			.run();

		// These use the fresh Miniflare D1 after the real migration, bypassing
		// Worker validation so the SQLite triggers and constraints are exercised.
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET workspace_id = ? WHERE id = ?")
				.bind(foreignWorkspaceId, parentId)
				.run(),
		).rejects.toThrow(
			"inbox workspace cannot change while children remain in another workspace",
		);
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET parent_inbox_id = ? WHERE id = ?")
				.bind(childId, parentId)
				.run(),
		).rejects.toThrow("inbox parent would create a cycle");
		const crossWorkspaceChildId = crypto.randomUUID();
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(
					crossWorkspaceChildId,
					workspaceId,
					foreignParentId,
					"Cross-workspace child",
					now,
				)
				.run(),
		).rejects.toThrow("inbox parent must belong to the same workspace");
		const selfInsertId = crypto.randomUUID();
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(selfInsertId, workspaceId, selfInsertId, "Self parent", now)
				.run(),
		).rejects.toThrow("inbox cannot be its own parent");
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET parent_inbox_id = ? WHERE id = ?")
				.bind(foreignParentId, childId)
				.run(),
		).rejects.toThrow("inbox parent must belong to the same workspace");
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET parent_inbox_id = ? WHERE id = ?")
				.bind(childId, childId)
				.run(),
		).rejects.toThrow("inbox cannot be its own parent");
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET workspace_id = ? WHERE id = ?")
				.bind(foreignWorkspaceId, childId)
				.run(),
		).rejects.toThrow("inbox parent must belong to the same workspace");
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(
					crypto.randomUUID(),
					workspaceId,
					"missing-parent",
					"Missing parent",
					now,
				)
				.run(),
		).rejects.toThrow(/FOREIGN KEY constraint failed/);
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, name, created_at, visibility_type) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(
					crypto.randomUUID(),
					workspaceId,
					"Bad visibility",
					now,
					"invalid",
				)
				.run(),
		).rejects.toThrow(/CHECK constraint failed/);

		const grandchildId = crypto.randomUUID();
		await ctx.env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(grandchildId, workspaceId, childId, "Grandchild", now)
			.run();
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET parent_inbox_id = ? WHERE id = ?")
				.bind(grandchildId, parentId)
				.run(),
		).rejects.toThrow("inbox parent would create a cycle");

		// A root plus 63 descendants has a 63-edge path; adding one more child
		// reaches the allowed 64-edge maximum, while the 65th must be rejected.
		let deepestId = crypto.randomUUID();
		await ctx.env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
		)
			.bind(deepestId, workspaceId, "Depth root", now)
			.run();
		for (let depth = 1; depth <= 64; depth += 1) {
			const childAtDepthId = crypto.randomUUID();
			await ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(childAtDepthId, workspaceId, deepestId, `Depth ${depth}`, now)
				.run();
			deepestId = childAtDepthId;
		}
		await expect(
			ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(crypto.randomUUID(), workspaceId, deepestId, "Depth 65", now)
				.run(),
		).rejects.toThrow("inbox parent hierarchy exceeds maximum depth");

		// The maximum is 64 edges from a root to a node. Reparenting must account
		// for the moved node's entire existing subtree, not merely the moved node.
		let depth63TargetId = crypto.randomUUID();
		await ctx.env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
		)
			.bind(depth63TargetId, workspaceId, "Move target root", now)
			.run();
		for (let depth = 1; depth <= 63; depth += 1) {
			const childAtDepthId = crypto.randomUUID();
			await ctx.env.DB.prepare(
				"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(
					childAtDepthId,
					workspaceId,
					depth63TargetId,
					`Move target depth ${depth}`,
					now,
				)
				.run();
			depth63TargetId = childAtDepthId;
		}
		const subtreeRootId = crypto.randomUUID();
		const subtreeChildId = crypto.randomUUID();
		await ctx.env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)",
		)
			.bind(subtreeRootId, workspaceId, "Move subtree root", now)
			.run();
		await ctx.env.DB.prepare(
			"INSERT INTO inboxes (id, workspace_id, parent_inbox_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(
				subtreeChildId,
				workspaceId,
				subtreeRootId,
				"Move subtree child",
				now,
			)
			.run();
		await expect(
			ctx.env.DB.prepare("UPDATE inboxes SET parent_inbox_id = ? WHERE id = ?")
				.bind(depth63TargetId, subtreeRootId)
				.run(),
		).rejects.toThrow("inbox parent hierarchy exceeds maximum depth");

		await ctx.db.delete(inboxes).where(eq(inboxes.id, parentId)).run();
		expect(
			await ctx.db
				.select({ parentInboxId: inboxes.parentInboxId })
				.from(inboxes)
				.where(eq(inboxes.id, childId))
				.get(),
		).toEqual({ parentInboxId: null });

		await ctx.db
			.insert(userSidebarPreferences)
			.values({
				id: crypto.randomUUID(),
				userId: ADMIN,
				workspaceId,
				updatedAt: Date.now(),
			})
			.run();
		const preferences = await ctx.db
			.select()
			.from(userSidebarPreferences)
			.where(
				and(
					eq(userSidebarPreferences.userId, ADMIN),
					eq(userSidebarPreferences.workspaceId, workspaceId),
				),
			)
			.get();
		expect(preferences).toMatchObject({
			collapsedNodeIdsJson: "[]",
			lastOpenBranchIdsJson: "[]",
		});
	});
});

// ---------------------------------------------------------------------------
// Sidebar: counts scoped to permitted inboxes, prefs, saved filters
// ---------------------------------------------------------------------------

describe("sidebar + preferences", () => {
	test("sidebar returns ordered authorized normalized sections and inbox counts", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		const inboxA = (
			await createInbox(ctx.env, workspaceId, { name: "A" }, ADMIN)
		).id;
		const inboxB = (
			await createInbox(ctx.env, workspaceId, { name: "B" }, ADMIN)
		).id;

		await channelContactConversation(workspaceId, inboxA);
		await channelContactConversation(workspaceId, inboxB);
		await ctx.db
			.update(inboxes)
			.set({ parentInboxId: inboxA })
			.where(eq(inboxes.id, inboxB))
			.run();

		const sidebar = await getSidebar(ctx.env, workspaceId, ADMIN);
		expect(sidebar.sections.map((section) => section.id)).toEqual([
			"section:my-work",
			"section:shared-inboxes",
			"section:channels",
			"section:tags",
			"section:saved-views",
		]);
		const inboxSection = sidebar.sections[1];
		expect(inboxSection).toBeDefined();
		if (!inboxSection) throw new Error("missing shared inboxes section");
		const items = inboxSection.children;
		const inboxANode = items.find((item) => item.id === `inbox:${inboxA}`);
		expect(
			inboxANode?.children.some((item) => item.id === `inbox:${inboxB}`),
		).toBe(true);
		expect(inboxSection.count).toBe(2);
		expect(inboxANode?.count).toBe(2);
		expect(inboxANode?.children[0]?.count).toBe(1);
		expect(inboxANode?.isEditable).toBe(true);
	});

	test("degrades every inbox count to null when descendant aggregation fails", async () => {
		const { workspaceId } = await setup();
		const parent = (
			await createInbox(ctx.env, workspaceId, { name: "Parent" }, ADMIN)
		).id;
		const child = (
			await createInbox(ctx.env, workspaceId, { name: "Child" }, ADMIN)
		).id;
		await ctx.db
			.update(inboxes)
			.set({ parentInboxId: parent })
			.where(eq(inboxes.id, child))
			.run();
		await channelContactConversation(workspaceId, parent);
		await channelContactConversation(workspaceId, child);

		const sidebar = await getSidebar(ctx.env, workspaceId, ADMIN, {
			countInboxDescendants: async () => {
				throw new Error("forced descendant aggregate failure");
			},
		});
		const parentNode = sidebar.sections[1]?.children.find(
			(node) => node.id === `inbox:${parent}`,
		);
		expect(sidebar.sections[1]?.count).toBe(2); // direct aggregate still worked
		expect(parentNode).toMatchObject({
			count: null,
			unread: null,
			unassigned: null,
		});
		expect(parentNode?.children[0]).toMatchObject({
			id: `inbox:${child}`,
			count: null,
			unread: null,
			unassigned: null,
		});
	});

	test("counts channel groups and leaves by their actual conversation channel", async () => {
		const { workspaceId } = await setup();
		const inbox = (
			await createInbox(ctx.env, workspaceId, { name: "Mixed" }, ADMIN)
		).id;
		const facebookA = await insertChannel(
			workspaceId,
			"facebook_page",
			"Facebook A",
		);
		const facebookB = await insertChannel(
			workspaceId,
			"facebook_page",
			"Facebook B",
		);
		const email = await insertChannel(workspaceId, "email", "Email");
		await ctx.db
			.insert(inboxChannels)
			.values(
				[facebookA, facebookB, email].map((channelId) => ({
					id: crypto.randomUUID(),
					inboxId: inbox,
					channelId,
					isDefault: false,
				})),
			)
			.run();
		for (const [channelId, id] of [
			[facebookA, "facebook-a"],
			[facebookB, "facebook-b"],
			[email, "email"],
		] as const) {
			await insertConversation(
				workspaceId,
				channelId,
				inbox,
				await insertContact(workspaceId),
				id,
			);
		}

		const channelsSection = (await getSidebar(ctx.env, workspaceId, ADMIN))
			.sections[2];
		const facebook = channelsSection?.children.find(
			(node) => node.id === "channel-group:facebook",
		);
		const emailGroup = channelsSection?.children.find(
			(node) => node.id === "channel-group:email",
		);
		expect(facebook?.count).toBe(2);
		expect(facebook?.children.map((node) => node.count).sort()).toEqual([1, 1]);
		expect(emailGroup).toMatchObject({ count: 1 });
		expect(emailGroup?.children).toEqual([
			expect.objectContaining({ id: `channel:${email}`, count: 1 }),
		]);
	});

	test("uses exact My Work predicates and omits another user's private tags", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		const inbox = (
			await createInbox(ctx.env, workspaceId, { name: "Work" }, ADMIN)
		).id;
		const ids = await Promise.all(
			["mine", "unassigned", "snoozed", "done", "other"].map(async (id) => {
				const channelId = await insertChannel(workspaceId);
				await insertConversation(
					workspaceId,
					channelId,
					inbox,
					await insertContact(workspaceId),
					id,
				);
				return id;
			}),
		);
		const future = new Date(Date.now() + 60_000).toISOString();
		await ctx.db
			.update(conversations)
			.set({ assigneeId: ADMIN })
			.where(eq(conversations.id, ids[0] ?? ""))
			.run();
		await ctx.db
			.update(conversations)
			.set({ snoozedUntil: future })
			.where(eq(conversations.id, ids[2] ?? ""))
			.run();
		await ctx.db
			.update(conversations)
			.set({ status: "archived" })
			.where(eq(conversations.id, ids[3] ?? ""))
			.run();
		await ctx.db
			.update(conversations)
			.set({ assigneeId: MEMBER })
			.where(eq(conversations.id, ids[4] ?? ""))
			.run();
		await ctx.db
			.insert(tags)
			.values([
				{
					id: "private-member",
					workspaceId,
					name: "Private",
					visibility: "private",
					ownerUserId: MEMBER,
					createdAt: new Date().toISOString(),
				},
				{
					id: "shared-tag",
					workspaceId,
					name: "Shared",
					visibility: "shared",
					createdAt: new Date().toISOString(),
				},
			])
			.run();

		const sidebar = await getSidebar(ctx.env, workspaceId, ADMIN);
		const counts = new Map(
			(sidebar.sections[0]?.children ?? []).map((node) => [
				node.id,
				node.count,
			]),
		);
		expect(counts).toEqual(
			new Map([
				["smart:assigned-to-me", 1],
				["smart:unassigned", 1],
				["smart:snoozed", 1],
				["smart:done", 1],
			]),
		);
		expect(sidebar.sections[3]?.children.map((node) => node.id)).toEqual([
			"tag:shared-tag",
		]);
	});

	test("omits inaccessible ancestors and recovers malformed preferences", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "private-parent", {
			visibilityType: "private",
		});
		await insertTreeInbox(workspaceId, "readable-child", {
			parentInboxId: "private-parent",
			visibilityType: "shared",
		});
		await channelContactConversation(workspaceId, "readable-child");
		await ctx.db
			.insert(userSidebarPreferences)
			.values({
				id: crypto.randomUUID(),
				workspaceId,
				userId: MEMBER,
				collapsedSectionsJson: "not-json",
				collapsedNodeIdsJson: JSON.stringify([
					"inbox:private-parent",
					"inbox:readable-child",
				]),
				lastOpenBranchIdsJson: "[broken",
				pinnedItemIdsJson: JSON.stringify([
					"inbox:private-parent",
					"inbox:readable-child",
				]),
				hiddenItemIdsJson: JSON.stringify([
					"inbox:private-parent",
					"inbox:readable-child",
				]),
				itemOrderJson: JSON.stringify({
					"inbox:private-parent": 0,
					"inbox:readable-child": 1,
				}),
				updatedAt: Date.now(),
			})
			.run();

		const sidebar = await getSidebar(ctx.env, workspaceId, MEMBER);
		const inboxes = sidebar.sections[1]?.children ?? [];
		expect(inboxes.map((node) => node.id)).toContain("inbox:readable-child");
		expect(JSON.stringify(sidebar)).not.toContain("private-parent");
		expect(
			inboxes.find((node) => node.id === "inbox:readable-child"),
		).toMatchObject({
			count: 1,
			isEditable: false,
			isHidden: true,
		});
		expect(sidebar.preferences.collapsedNodeIds).toEqual([
			"inbox:readable-child",
		]);
		expect(sidebar.preferences.lastOpenBranchIds).toEqual([]);
		expect(sidebar.preferences.itemOrder).toEqual({
			"inbox:readable-child": 1,
		});
	});

	test("sidebar preferences validate stable item ids and persist per user", async () => {
		const { workspaceId } = await setup();
		await expect(
			updateSidebarPreferences(ctx.env, workspaceId, ADMIN, {
				pinnedItemIds: ["not-a-valid-id"],
			}),
		).rejects.toThrow(ManageError);

		const prefs = await updateSidebarPreferences(ctx.env, workspaceId, ADMIN, {
			collapsedSections: ["teams"],
			pinnedItemIds: ["system:all", "system:unassigned"],
			hiddenItemIds: ["inbox:xyz"],
			itemOrder: { "system:all": 3 },
		});
		expect(prefs.collapsedSections).toEqual(["teams"]);
		expect(prefs.pinnedItemIds).toContain("system:unassigned");

		const row = await ctx.db
			.select()
			.from(userSidebarPreferences)
			.where(
				and(
					eq(userSidebarPreferences.workspaceId, workspaceId),
					eq(userSidebarPreferences.userId, ADMIN),
				),
			)
			.get();
		expect(row).not.toBeNull();

		// Another user's preferences are independent.
		await addMember(workspaceId, MEMBER);
		const memberPrefs = await updateSidebarPreferences(
			ctx.env,
			workspaceId,
			MEMBER,
			{ pinnedItemIds: ["system:closed"] },
		);
		expect(memberPrefs.pinnedItemIds).toEqual(["system:closed"]);
	});

	test("saved filters validate workspace ownership", async () => {
		const { workspaceId } = await setup();
		await expect(
			createSavedFilter(ctx.env, workspaceId, ADMIN, {
				name: "bad",
				filters: { inboxId: "inbox-from-another-workspace" },
			}),
		).rejects.toThrow(ManageError);
		const view = await createSavedFilter(ctx.env, workspaceId, ADMIN, {
			name: "Urgent",
			filters: { status: "open", q: "urgent" },
		});
		expect(view.name).toBe("Urgent");
		const sidebar = await getSidebar(ctx.env, workspaceId, ADMIN);
		const views = sidebar.sections.find((s) => s.id === "section:saved-views");
		expect(views?.children.some((item) => item.id === `view:${view.id}`)).toBe(
			true,
		);
	});

	test("a member cannot delete another member's saved filter", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		const view = await createSavedFilter(ctx.env, workspaceId, ADMIN, {
			name: "Owner only",
			filters: { status: "open" },
		});

		await expect(
			deleteSavedFilter(ctx.env, workspaceId, view.id, MEMBER),
		).rejects.toMatchObject({ status: 404 });

		const ownerSidebar = await getSidebar(ctx.env, workspaceId, ADMIN);
		expect(
			ownerSidebar.sections
				.find((section) => section.id === "section:saved-views")
				?.children.some((node) => node.id === `view:${view.id}`),
		).toBe(true);
	});

	test("reorder rejects inboxes from another workspace", async () => {
		const { workspaceId } = await setup();
		const inboxA = (
			await createInbox(ctx.env, workspaceId, { name: "A" }, ADMIN)
		).id;
		await expect(
			reorderInboxes(ctx.env, workspaceId, [inboxA, "foreign-inbox"], ADMIN),
		).rejects.toThrow(ManageError);
		await reorderInboxes(ctx.env, workspaceId, [inboxA], ADMIN);
		const row = await ctx.db
			.select({ sortOrder: inboxes.sortOrder })
			.from(inboxes)
			.where(eq(inboxes.id, inboxA))
			.get();
		expect(row?.sortOrder).toBe(0);
	});

	test("updateInbox renders immediately via the summary shape", async () => {
		const { workspaceId } = await setup();
		const inbox = await createInbox(
			ctx.env,
			workspaceId,
			{ name: "Old" },
			ADMIN,
		);
		const updated = await updateInbox(
			ctx.env,
			workspaceId,
			inbox.id,
			{ name: "New", color: "#3B82F6", icon: "headphones" },
			ADMIN,
		);
		expect(updated.name).toBe("New");
		expect(updated.color).toBe("#3B82F6");
		expect(updated.icon).toBe("headphones");
		const sidebar = await getSidebar(ctx.env, workspaceId, ADMIN);
		const item = sidebar.sections
			.find((s) => s.id === "section:shared-inboxes")
			?.children.find((i) => i.id === `inbox:${inbox.id}`);
		expect(item?.label).toBe("New");
	});
});

// ---------------------------------------------------------------------------
// ADR 0026 tree visibility and navigation-only moves
// ---------------------------------------------------------------------------

describe("inbox tree authorization and moves", () => {
	test("uses the accepted shared grant convention and all visibility modes", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "shared-public");
		await insertTreeInbox(workspaceId, "shared-restricted");
		await insertTreeInbox(workspaceId, "private", {
			visibilityType: "private",
		});
		await insertTreeInbox(workspaceId, "system", { visibilityType: "system" });
		await ctx.db
			.insert(teams)
			.values({
				id: "team",
				workspaceId,
				name: "Team",
				createdAt: new Date().toISOString(),
			})
			.run();
		await insertTreeInbox(workspaceId, "team", {
			visibilityType: "team",
			teamId: "team",
		});
		await ctx.db
			.insert(inboxMembers)
			.values({
				id: crypto.randomUUID(),
				inboxId: "shared-restricted",
				userId: ADMIN,
			})
			.run();
		await ctx.db
			.insert(inboxMembers)
			.values({ id: crypto.randomUUID(), inboxId: "private", userId: MEMBER })
			.run();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId: "team",
				userId: MEMBER,
				createdAt: new Date().toISOString(),
			})
			.run();

		expect(await getReadableInboxIds(ctx.db, workspaceId, MEMBER)).toEqual(
			expect.arrayContaining(["shared-public", "private", "system", "team"]),
		);
		expect(
			await getReadableInboxIds(ctx.db, workspaceId, MEMBER),
		).not.toContain("shared-restricted");
		await ctx.db
			.insert(inboxMembers)
			.values({ id: crypto.randomUUID(), inboxId: "team", userId: ADMIN })
			.run();
		expect(await getReadableInboxIds(ctx.db, workspaceId, ADMIN)).not.toContain(
			"team",
		);
		expect(await getReadableInboxIds(ctx.db, workspaceId, ADMIN)).not.toContain(
			"private",
		);
	});

	test("intersects mailbox policy with synchronized private inbox grants", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "mail-private", {
			visibilityType: "private",
		});
		await ctx.db
			.insert(inboxMembers)
			.values({
				id: crypto.randomUUID(),
				inboxId: "mail-private",
				userId: MEMBER,
			})
			.run();
		const channelId = await insertChannel(workspaceId);
		await ctx.db
			.update(channels)
			.set({ externalId: "private@test.dev" })
			.where(eq(channels.id, channelId))
			.run();
		const mailboxNow = new Date().toISOString();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "domain",
				workspaceId,
				canonicalDomain: "test.dev",
				inboundState: "pending",
				outboundState: "pending",
				dnsStatusJson: "{}",
				createdAt: mailboxNow,
				updatedAt: mailboxNow,
			})
			.run();
		await ctx.db
			.insert(mailboxes)
			.values({
				id: "mailbox",
				workspaceId,
				emailDomainId: "domain",
				localPart: "private",
				canonicalAddress: "private@test.dev",
				type: "private",
				ownerUserId: ADMIN,
				inboxId: null,
				isEnabled: false,
				isSendEnabled: false,
				createdAt: mailboxNow,
				updatedAt: mailboxNow,
			})
			.run();
		await ctx.db
			.insert(inboxChannels)
			.values({
				id: crypto.randomUUID(),
				inboxId: "mail-private",
				channelId,
				isDefault: false,
			})
			.run();
		expect(
			await getReadableInboxIds(ctx.db, workspaceId, MEMBER),
		).not.toContain("mail-private");
		await ctx.db
			.insert(mailboxDelegates)
			.values({
				mailboxId: "mailbox",
				userId: MEMBER,
				createdBy: ADMIN,
				createdAt: new Date().toISOString(),
			})
			.run();
		expect(await getReadableInboxIds(ctx.db, workspaceId, MEMBER)).toContain(
			"mail-private",
		);
		await ctx.db
			.delete(mailboxDelegates)
			.where(eq(mailboxDelegates.mailboxId, "mailbox"))
			.run();
		expect(
			await getReadableInboxIds(ctx.db, workspaceId, MEMBER),
		).not.toContain("mail-private");
	});

	test("allows workspace members into public shared mailboxes", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "mail-shared-public");
		const channelId = await insertChannel(workspaceId);
		await ctx.db
			.update(channels)
			.set({ externalId: "support@test.dev" })
			.where(eq(channels.id, channelId))
			.run();
		const now = new Date().toISOString();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "shared-domain",
				workspaceId,
				canonicalDomain: "test.dev",
				inboundState: "pending",
				outboundState: "pending",
				dnsStatusJson: "{}",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(mailboxes)
			.values({
				id: "shared-mailbox",
				workspaceId,
				emailDomainId: "shared-domain",
				localPart: "support",
				canonicalAddress: "support@test.dev",
				type: "shared",
				inboxId: "mail-shared-public",
				isEnabled: false,
				isSendEnabled: false,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		expect(await getReadableInboxIds(ctx.db, workspaceId, MEMBER)).toContain(
			"mail-shared-public",
		);
		const sidebar = await getSidebar(ctx.env, workspaceId, MEMBER);
		const email = sidebar.sections[2]?.children.find(
			(node) => node.id === "channel-group:email",
		);
		expect(email?.children).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: `channel:${channelId}`,
					label: "support@test.dev",
				}),
			]),
		);
		await ctx.db
			.insert(inboxMembers)
			.values({
				id: crypto.randomUUID(),
				inboxId: "mail-shared-public",
				userId: ADMIN,
			})
			.run();
		expect(
			await getReadableInboxIds(ctx.db, workspaceId, MEMBER),
		).not.toContain("mail-shared-public");
	});

	test("enforces direct shared-mailbox team policy without a legacy channel link", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "direct-team-mailbox");
		const now = new Date().toISOString();
		await ctx.db
			.insert(teams)
			.values({
				id: "direct-mailbox-team",
				workspaceId,
				name: "Direct mailbox team",
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId: "direct-mailbox-team",
				userId: ADMIN,
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "direct-team-domain",
				workspaceId,
				canonicalDomain: "test.dev",
				inboundState: "pending",
				outboundState: "pending",
				dnsStatusJson: "{}",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(mailboxes)
			.values({
				id: "direct-team-mailbox",
				workspaceId,
				emailDomainId: "direct-team-domain",
				localPart: "team",
				canonicalAddress: "team@test.dev",
				type: "shared",
				inboxId: "direct-team-mailbox",
				teamId: "direct-mailbox-team",
				isEnabled: false,
				isSendEnabled: false,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		// There is intentionally no inbox_channels row: authorization follows
		// the direct mailbox inbox_id association.
		expect(
			await getReadableInboxIds(ctx.db, workspaceId, MEMBER),
		).not.toContain("direct-team-mailbox");
		expect(await getReadableInboxIds(ctx.db, workspaceId, ADMIN)).not.toContain(
			"direct-team-mailbox",
		);
	});

	test("bounds descendants and preserves routing data during a versioned move", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "root");
		await insertTreeInbox(workspaceId, "child", {
			parentInboxId: "root",
			sortOrder: 0,
			updatedAt: 456,
		});
		await insertTreeInbox(workspaceId, "leaf", {
			parentInboxId: "child",
			sortOrder: 0,
			updatedAt: 123,
		});
		const foreignWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign tree",
				slug: "foreign-tree",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await insertTreeInbox(foreignWorkspaceId, "foreign");
		expect(
			await getInboxDescendantIds(
				ctx.db,
				workspaceId,
				"root",
				new Set(["root", "child", "leaf"]),
			),
		).toEqual(["root", "child", "leaf"]);
		await expect(
			getInboxDescendantIds(ctx.db, workspaceId, "missing", new Set()),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getInboxDescendantIds(
				ctx.db,
				workspaceId,
				"foreign",
				new Set(["foreign"]),
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getInboxDescendantIds(ctx.db, workspaceId, "root", new Set()),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			assertValidInboxParent(ctx.db, workspaceId, "root", "root"),
		).rejects.toThrow(ManageError);
		await expect(
			assertValidInboxParent(ctx.db, workspaceId, "root", "leaf"),
		).rejects.toThrow(ManageError);
		await expect(
			assertValidInboxParent(ctx.db, workspaceId, "root", "foreign"),
		).rejects.toThrow(ManageError);
		const channelId = await insertChannel(workspaceId);
		const contactId = await insertContact(workspaceId);
		await insertConversation(
			workspaceId,
			channelId,
			"leaf",
			contactId,
			"tree-conversation",
		);
		await insertRule(workspaceId, "tree-rule", 0, false, [], []);
		await ctx.db
			.insert(inboxChannels)
			.values({
				id: "tree-default",
				inboxId: "leaf",
				channelId,
				isDefault: false,
			})
			.run();
		const before = await Promise.all([
			ctx.env.DB.prepare(
				"SELECT inbox_id FROM conversations WHERE id='tree-conversation'",
			).first(),
			ctx.env.DB.prepare(
				"SELECT inbox_id FROM rules WHERE id='tree-rule'",
			).first(),
			ctx.env.DB.prepare(
				"SELECT inbox_id, is_default FROM inbox_channels WHERE id='tree-default'",
			).first(),
		]);
		const leafBeforeMove = await ctx.db
			.select()
			.from(inboxes)
			.where(eq(inboxes.id, "leaf"))
			.get();
		await handleInboxTreeMove(
			ctx.env,
			workspaceId,
			"leaf",
			{
				parentInboxId: "root",
				beforeInboxId: "child",
				expectedTreeVersion: leafBeforeMove?.treeVersion ?? 0,
			},
			ADMIN,
		);
		expect(
			await Promise.all([
				ctx.env.DB.prepare(
					"SELECT inbox_id FROM conversations WHERE id='tree-conversation'",
				).first(),
				ctx.env.DB.prepare(
					"SELECT inbox_id FROM rules WHERE id='tree-rule'",
				).first(),
				ctx.env.DB.prepare(
					"SELECT inbox_id, is_default FROM inbox_channels WHERE id='tree-default'",
				).first(),
			]),
		).toEqual(before);
		const moved = await ctx.db
			.select()
			.from(inboxes)
			.where(eq(inboxes.id, "leaf"))
			.get();
		const sibling = await ctx.db
			.select()
			.from(inboxes)
			.where(eq(inboxes.id, "child"))
			.get();
		expect(moved).toMatchObject({
			parentInboxId: "root",
			sortOrder: 0,
			treeVersion: 1,
			updatedAt: 123,
		});
		expect(sibling).toMatchObject({ sortOrder: 1, updatedAt: 456 });
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{ inboxId: "leaf", parentInboxId: null, expectedTreeVersion: 0 },
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
	});

	test("POST move handler seam rejects members, foreign IDs, cycles, stale versions, and foreign anchors", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "root");
		await insertTreeInbox(workspaceId, "child", { parentInboxId: "root" });
		await insertTreeInbox(workspaceId, "other-root");
		await insertTreeInbox(workspaceId, "other-child", {
			parentInboxId: "other-root",
		});
		const foreignWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign move workspace",
				slug: "foreign-move-workspace",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await insertTreeInbox(foreignWorkspaceId, "foreign");

		const expectStatus = async (operation: Promise<void>, status: number) => {
			try {
				await operation;
				throw new Error(`expected HTTP ${status}`);
			} catch (err) {
				expect(err).toBeInstanceOf(ManageError);
				expect((err as ManageError).status).toBe(status);
			}
		};
		const request = { parentInboxId: null, expectedTreeVersion: 0 };
		await expectStatus(
			handleInboxTreeMove(ctx.env, workspaceId, "root", request, MEMBER),
			403,
		);
		await expectStatus(
			handleInboxTreeMove(ctx.env, workspaceId, "missing", request, ADMIN),
			404,
		);
		await expectStatus(
			handleInboxTreeMove(ctx.env, workspaceId, "foreign", request, ADMIN),
			404,
		);
		await expectStatus(
			handleInboxTreeMove(
				ctx.env,
				workspaceId,
				"root",
				{ parentInboxId: "child", expectedTreeVersion: 0 },
				ADMIN,
			),
			409,
		);
		await expectStatus(
			handleInboxTreeMove(
				ctx.env,
				workspaceId,
				"child",
				{
					parentInboxId: "root",
					beforeInboxId: "other-child",
					expectedTreeVersion: 0,
				},
				ADMIN,
			),
			409,
		);
		await handleInboxTreeMove(
			ctx.env,
			workspaceId,
			"child",
			{ parentInboxId: null, expectedTreeVersion: 0 },
			ADMIN,
		);
		await expectStatus(
			handleInboxTreeMove(
				ctx.env,
				workspaceId,
				"child",
				{ parentInboxId: null, expectedTreeVersion: 0 },
				ADMIN,
			),
			409,
		);
	});

	test("permits wide trees while enforcing depth and leaves siblings intact on stale moves", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "wide-root");
		for (let index = 0; index < 65; index += 1) {
			await insertTreeInbox(workspaceId, `wide-${index}`, {
				parentInboxId: "wide-root",
				sortOrder: index,
			});
		}
		const readable = new Set([
			"wide-root",
			...Array.from({ length: 65 }, (_, index) => `wide-${index}`),
		]);
		expect(
			await getInboxDescendantIds(ctx.db, workspaceId, "wide-root", readable),
		).toHaveLength(66);
		await insertTreeInbox(workspaceId, "depth-root");
		let depthParentId = "depth-root";
		for (let depth = 1; depth <= 63; depth += 1) {
			const id = `depth-${depth}`;
			await insertTreeInbox(workspaceId, id, { parentInboxId: depthParentId });
			depthParentId = id;
		}
		await insertTreeInbox(workspaceId, "subtree");
		await insertTreeInbox(workspaceId, "subtree-child", {
			parentInboxId: "subtree",
		});
		await expect(
			assertValidInboxParent(ctx.db, workspaceId, "subtree", depthParentId),
		).rejects.toMatchObject({ status: 409 });

		await insertTreeInbox(workspaceId, "move-root");
		await insertTreeInbox(workspaceId, "first", {
			parentInboxId: "move-root",
			sortOrder: 0,
		});
		await insertTreeInbox(workspaceId, "stale-source", {
			parentInboxId: "move-root",
			sortOrder: 1,
		});
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{
					inboxId: "stale-source",
					parentInboxId: "move-root",
					expectedTreeVersion: 1,
					sortOrder: 0,
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
		const siblings = await ctx.db
			.select({
				id: inboxes.id,
				sortOrder: inboxes.sortOrder,
				treeVersion: inboxes.treeVersion,
			})
			.from(inboxes)
			.where(eq(inboxes.parentInboxId, "move-root"))
			.orderBy(inboxes.sortOrder);
		expect(siblings).toEqual([
			{ id: "first", sortOrder: 0, treeVersion: 0 },
			{ id: "stale-source", sortOrder: 1, treeVersion: 0 },
		]);
	});

	test("invalidates a sibling's prepared move when its sort order changes", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "concurrent-root");
		await insertTreeInbox(workspaceId, "concurrent-first", {
			parentInboxId: "concurrent-root",
			sortOrder: 0,
			updatedAt: 101,
		});
		await insertTreeInbox(workspaceId, "concurrent-sibling", {
			parentInboxId: "concurrent-root",
			sortOrder: 1,
			updatedAt: 202,
		});
		const preparedSibling = await ctx.db
			.select({ treeVersion: inboxes.treeVersion })
			.from(inboxes)
			.where(eq(inboxes.id, "concurrent-sibling"))
			.get();
		await moveInboxInTree(
			ctx.env,
			workspaceId,
			{
				inboxId: "concurrent-first",
				parentInboxId: "concurrent-root",
				expectedTreeVersion: 0,
				sortOrder: 1,
			},
			ADMIN,
		);
		const afterFirstMove = await ctx.db
			.select({
				id: inboxes.id,
				parentInboxId: inboxes.parentInboxId,
				sortOrder: inboxes.sortOrder,
				treeVersion: inboxes.treeVersion,
				updatedAt: inboxes.updatedAt,
			})
			.from(inboxes)
			.where(eq(inboxes.parentInboxId, "concurrent-root"))
			.orderBy(inboxes.sortOrder);
		expect(afterFirstMove).toEqual([
			{
				id: "concurrent-sibling",
				parentInboxId: "concurrent-root",
				sortOrder: 0,
				treeVersion: 1,
				updatedAt: 202,
			},
			{
				id: "concurrent-first",
				parentInboxId: "concurrent-root",
				sortOrder: 1,
				treeVersion: 1,
				updatedAt: 101,
			},
		]);
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{
					inboxId: "concurrent-sibling",
					parentInboxId: "concurrent-root",
					expectedTreeVersion: preparedSibling?.treeVersion ?? 0,
					sortOrder: 1,
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
		expect(
			await ctx.db
				.select({
					id: inboxes.id,
					parentInboxId: inboxes.parentInboxId,
					sortOrder: inboxes.sortOrder,
					treeVersion: inboxes.treeVersion,
					updatedAt: inboxes.updatedAt,
				})
				.from(inboxes)
				.where(eq(inboxes.parentInboxId, "concurrent-root"))
				.orderBy(inboxes.sortOrder),
		).toEqual(afterFirstMove);
	});

	test("reorders only ordinary inboxes without touching lifecycle timestamps", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "ordinary-first", {
			sortOrder: 0,
			updatedAt: 101,
		});
		await insertTreeInbox(workspaceId, "ordinary-second", {
			sortOrder: 1,
			updatedAt: 202,
		});
		await reorderInboxes(
			ctx.env,
			workspaceId,
			["ordinary-second", "ordinary-first"],
			ADMIN,
		);
		const rows = await ctx.db
			.select({
				id: inboxes.id,
				sortOrder: inboxes.sortOrder,
				updatedAt: inboxes.updatedAt,
			})
			.from(inboxes)
			.where(eq(inboxes.workspaceId, workspaceId))
			.orderBy(inboxes.sortOrder);
		expect(rows).toEqual([
			{ id: "ordinary-second", sortOrder: 0, updatedAt: 202 },
			{ id: "ordinary-first", sortOrder: 1, updatedAt: 101 },
		]);
	});

	test("rejects system inbox reorder requests and implicit system reindexing", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "ordinary-before", {
			sortOrder: 0,
			updatedAt: 101,
		});
		await insertTreeInbox(workspaceId, "system-fixed", {
			visibilityType: "system",
			sortOrder: 1,
			updatedAt: 202,
		});
		await insertTreeInbox(workspaceId, "ordinary-after", {
			sortOrder: 2,
			updatedAt: 303,
		});
		const before = await ctx.db
			.select({
				id: inboxes.id,
				sortOrder: inboxes.sortOrder,
				updatedAt: inboxes.updatedAt,
			})
			.from(inboxes)
			.where(eq(inboxes.workspaceId, workspaceId))
			.orderBy(inboxes.sortOrder);
		await expect(
			reorderInboxes(ctx.env, workspaceId, ["system-fixed"], ADMIN),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			reorderInboxes(ctx.env, workspaceId, ["ordinary-after"], ADMIN),
		).rejects.toMatchObject({ status: 409 });
		expect(
			await ctx.db
				.select({
					id: inboxes.id,
					sortOrder: inboxes.sortOrder,
					updatedAt: inboxes.updatedAt,
				})
				.from(inboxes)
				.where(eq(inboxes.workspaceId, workspaceId))
				.orderBy(inboxes.sortOrder),
		).toEqual(before);
	});

	test("rejects moves of system inboxes without changing their tree state", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "system-root", {
			visibilityType: "system",
			sortOrder: 2,
			updatedAt: 999,
		});
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{
					inboxId: "system-root",
					parentInboxId: null,
					expectedTreeVersion: 0,
					sortOrder: 0,
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 403 });
		expect(
			await ctx.db
				.select()
				.from(inboxes)
				.where(eq(inboxes.id, "system-root"))
				.get(),
		).toMatchObject({
			parentInboxId: null,
			sortOrder: 2,
			treeVersion: 0,
			updatedAt: 999,
		});
	});

	test("rejects moving an ordinary tree containing a system descendant", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "destination-root", {
			sortOrder: 0,
			updatedAt: 100,
		});
		await insertTreeInbox(workspaceId, "ordinary-root", {
			sortOrder: 1,
			updatedAt: 200,
		});
		await insertTreeInbox(workspaceId, "system-descendant", {
			parentInboxId: "ordinary-root",
			sortOrder: 0,
			visibilityType: "system",
			updatedAt: 300,
		});
		const before = await ctx.db
			.select({
				id: inboxes.id,
				parentInboxId: inboxes.parentInboxId,
				sortOrder: inboxes.sortOrder,
				treeVersion: inboxes.treeVersion,
			})
			.from(inboxes)
			.where(eq(inboxes.workspaceId, workspaceId))
			.orderBy(inboxes.id);
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{
					inboxId: "ordinary-root",
					parentInboxId: "destination-root",
					expectedTreeVersion: 0,
					sortOrder: 0,
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
		expect(
			await ctx.db
				.select({
					id: inboxes.id,
					parentInboxId: inboxes.parentInboxId,
					sortOrder: inboxes.sortOrder,
					treeVersion: inboxes.treeVersion,
				})
				.from(inboxes)
				.where(eq(inboxes.workspaceId, workspaceId))
				.orderBy(inboxes.id),
		).toEqual(before);
	});

	test("rejects ordinary moves that would reindex a system sibling", async () => {
		const { workspaceId } = await setup();
		await insertTreeInbox(workspaceId, "system-sibling", {
			visibilityType: "system",
			sortOrder: 0,
			updatedAt: 701,
		});
		await insertTreeInbox(workspaceId, "ordinary-source", {
			sortOrder: 1,
			updatedAt: 702,
		});
		const systemBefore = await ctx.db
			.select({ sortOrder: inboxes.sortOrder, updatedAt: inboxes.updatedAt })
			.from(inboxes)
			.where(eq(inboxes.id, "system-sibling"))
			.get();
		await expect(
			moveInboxInTree(
				ctx.env,
				workspaceId,
				{
					inboxId: "ordinary-source",
					parentInboxId: null,
					expectedTreeVersion: 0,
					sortOrder: 0,
				},
				ADMIN,
			),
		).rejects.toMatchObject({ status: 409 });
		expect(
			await ctx.db
				.select({ sortOrder: inboxes.sortOrder, updatedAt: inboxes.updatedAt })
				.from(inboxes)
				.where(eq(inboxes.id, "system-sibling"))
				.get(),
		).toEqual(systemBefore);
	});
});

describe("conversation inbox visibility scope", () => {
	test("lists multiple email conversations with direct private and team mailbox policy", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "mail-policy-inbox");
		const privateChannelId = await insertChannel(workspaceId);
		const teamChannelId = await insertChannel(workspaceId);
		await ctx.db
			.update(channels)
			.set({ externalId: "private@test.dev" })
			.where(eq(channels.id, privateChannelId))
			.run();
		await ctx.db
			.update(channels)
			.set({ externalId: "team@test.dev" })
			.where(eq(channels.id, teamChannelId))
			.run();
		const now = new Date().toISOString();
		await ctx.db
			.insert(emailDomains)
			.values({
				id: "list-policy-domain",
				workspaceId,
				canonicalDomain: "test.dev",
				inboundState: "pending",
				outboundState: "pending",
				dnsStatusJson: "{}",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await ctx.db
			.insert(teams)
			.values({
				id: "list-policy-team",
				workspaceId,
				name: "List policy team",
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId: "list-policy-team",
				userId: MEMBER,
				createdAt: now,
			})
			.run();
		await ctx.db
			.update(inboxes)
			.set({ visibilityType: "team", teamId: "list-policy-team" })
			.where(eq(inboxes.id, "mail-policy-inbox"))
			.run();
		await ctx.db
			.insert(mailboxes)
			.values([
				{
					id: "list-private-mailbox",
					workspaceId,
					emailDomainId: "list-policy-domain",
					localPart: "private",
					canonicalAddress: "private@test.dev",
					type: "private",
					ownerUserId: ADMIN,
					inboxId: null,
					isEnabled: false,
					isSendEnabled: false,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "list-team-mailbox",
					workspaceId,
					emailDomainId: "list-policy-domain",
					localPart: "team",
					canonicalAddress: "team@test.dev",
					type: "shared",
					inboxId: "mail-policy-inbox",
					teamId: "list-policy-team",
					isEnabled: false,
					isSendEnabled: false,
					createdAt: now,
					updatedAt: now,
				},
			])
			.run();
		const contactId = await insertContact(workspaceId);
		await insertConversation(
			workspaceId,
			privateChannelId,
			"mail-policy-inbox",
			contactId,
			"private-one",
		);
		await insertConversation(
			workspaceId,
			privateChannelId,
			"mail-policy-inbox",
			contactId,
			"private-two",
		);
		await insertConversation(
			workspaceId,
			teamChannelId,
			"mail-policy-inbox",
			contactId,
			"team-one",
		);

		const ids = (
			await listConversations(ctx.env, MEMBER, { status: "all" }, workspaceId)
		).map((conversation) => conversation.id);
		expect(ids).toContain("team-one");
		expect(ids).not.toContain("private-one");
		expect(ids).not.toContain("private-two");
	});

	test("scopes every list facet and detail read to permitted inboxes", async () => {
		const { workspaceId } = await setup();
		await addMember(workspaceId, MEMBER);
		await insertTreeInbox(workspaceId, "scope-root");
		await insertTreeInbox(workspaceId, "scope-allowed", {
			parentInboxId: "scope-root",
		});
		await insertTreeInbox(workspaceId, "scope-private", {
			parentInboxId: "scope-root",
			visibilityType: "private",
		});
		await ctx.db
			.insert(teams)
			.values({
				id: "scope-team",
				workspaceId,
				name: "Scope team",
				createdAt: new Date().toISOString(),
			})
			.run();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId: "scope-team",
				userId: MEMBER,
				createdAt: new Date().toISOString(),
			})
			.run();
		await insertTreeInbox(workspaceId, "scope-team-inbox", {
			parentInboxId: "scope-root",
			visibilityType: "team",
			teamId: "scope-team",
		});
		const channelId = await insertChannel(workspaceId);
		const contactId = await insertContact(workspaceId);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-allowed",
			contactId,
			"scope-visible",
		);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-private",
			contactId,
			"scope-hidden",
		);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-team-inbox",
			contactId,
			"scope-team-visible",
		);

		expect(
			(
				await listConversations(
					ctx.env,
					MEMBER,
					{ inboxId: "scope-root", inboxScope: "descendants" },
					workspaceId,
				)
			).map((conversation) => conversation.id),
		).toEqual(["scope-visible", "scope-team-visible"]);
		expect(
			await listConversations(
				ctx.env,
				MEMBER,
				{ inboxId: "scope-private", inboxScope: "exact" },
				workspaceId,
			),
		).toEqual([]);
		expect(
			await getConversation(ctx.env, MEMBER, "scope-hidden", workspaceId),
		).toBeNull();
		expect(
			await canReadConversation(ctx.env, MEMBER, "scope-hidden", workspaceId),
		).toBe(false);

		const now = new Date().toISOString();
		await insertConversation(
			workspaceId,
			channelId,
			"scope-allowed",
			contactId,
			"scope-archived-visible",
			"archived",
		);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-private",
			contactId,
			"scope-archived-hidden",
			"archived",
		);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-allowed",
			contactId,
			"scope-snoozed-visible",
		);
		await insertConversation(
			workspaceId,
			channelId,
			"scope-private",
			contactId,
			"scope-snoozed-hidden",
		);
		await ctx.db
			.update(conversations)
			.set({ assigneeId: MEMBER })
			.where(eq(conversations.id, "scope-visible"))
			.run();
		await ctx.db
			.update(conversations)
			.set({ snoozedUntil: new Date(Date.now() + 60_000).toISOString() })
			.where(eq(conversations.id, "scope-snoozed-visible"))
			.run();
		await ctx.db
			.update(conversations)
			.set({ snoozedUntil: new Date(Date.now() + 60_000).toISOString() })
			.where(eq(conversations.id, "scope-snoozed-hidden"))
			.run();
		await ctx.db
			.insert(tags)
			.values({
				id: "scope-tag",
				workspaceId,
				name: "Scope tag",
				visibility: "shared",
				createdAt: now,
			})
			.run();
		await ctx.db
			.insert(conversationTags)
			.values([
				{
					id: "scope-visible-tag",
					conversationId: "scope-visible",
					tagId: "scope-tag",
					createdAt: now,
				},
				{
					id: "scope-hidden-tag",
					conversationId: "scope-hidden",
					tagId: "scope-tag",
					createdAt: now,
				},
			])
			.run();

		const ids = async (options: Parameters<typeof listConversations>[2]) =>
			(await listConversations(ctx.env, MEMBER, options, workspaceId)).map(
				(conversation) => conversation.id,
			);
		expect(await ids({ status: "all" })).not.toContain("scope-hidden");
		const allIds = await ids({ status: "all" });
		expect(new Set(allIds).size).toBe(allIds.length);
		expect(await ids({ status: "archived" })).toEqual([
			"scope-archived-visible",
		]);
		expect(await ids({ assigneeId: MEMBER })).toEqual(["scope-visible"]);
		expect(await ids({ unassigned: true })).not.toContain("scope-hidden");
		expect(await ids({ snoozed: true })).toEqual(["scope-snoozed-visible"]);
		expect(await ids({ channel: "email" })).not.toContain("scope-hidden");
		expect(await ids({ tagId: "scope-tag" })).toEqual(["scope-visible"]);
	});
});
