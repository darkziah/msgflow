import { afterEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
	cannedReplies,
	channels,
	contacts,
	conversations,
	inboxChannels,
	inboxes,
	metaApps,
	ruleActions,
	ruleConditions,
	ruleExecutionLog,
	rules,
	tags,
	userSidebarPreferences,
	workspaceMembers,
	workspaces,
} from "@msgflow/db";
import {
	archiveInbox,
	connectChannelToken,
	createFacebookChannel,
	createCannedReply,
	createInbox,
	createRule,
	createTag,
	deleteTag,
	disconnectChannel,
	linkChannelToInbox,
	listCannedReplies,
	listChannels,
	listInboxes,
	listTags,
	reorderInboxes,
	setDefaultInbox,
	unlinkChannelFromInbox,
	updateCannedReply,
	updateInbox,
	updateTag,
} from "../src/manage";
import {
	getWorkspaceAccess,
	requireAdminAccess,
	requireWorkspaceAccess,
} from "../src/access";
import { evaluateRules, type RuleEvaluationContext } from "../src/rules";
import {
	createSavedFilter,
	getSidebar,
	updateSidebarPreferences,
} from "../src/workspace-api";
import { ManageError } from "../src/errors";
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

async function insertChannel(workspaceId: string): Promise<string> {
	const channelId = crypto.randomUUID();
	const now = new Date().toISOString();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "email",
			displayName: "channel",
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
					: { id: "page-123" },
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
// Sidebar: counts scoped to permitted inboxes, prefs, saved filters
// ---------------------------------------------------------------------------

describe("sidebar + preferences", () => {
	test("sidebar shows all active inboxes; archived only when open-assigned", async () => {
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

		// Members see every active (non-archived) workspace inbox — the list
		// read model is workspace-scoped, so the sidebar never hides an inbox
		// the conversation list would still show.
		const sidebar = await getSidebar(ctx.env, workspaceId, MEMBER);
		const inboxSection = sidebar.sections.find((s) => s.key === "inbox");
		expect(inboxSection).toBeDefined();
		const items = inboxSection?.groups.flatMap((g) => g.items) ?? [];
		expect(items.some((item) => item.id === `inbox:${inboxB}`)).toBe(true);
		const allItem = inboxSection?.items.find(
			(item) => item.id === "system:all",
		);
		if (allItem && allItem.kind === "system") {
			expect(allItem.count).toBe(2); // both conversations
		}

		// Archived inboxes disappear from navigation…
		await ctx.db
			.update(inboxes)
			.set({ isArchived: true })
			.where(eq(inboxes.id, inboxB))
			.run();
		const afterArchive = await getSidebar(ctx.env, workspaceId, MEMBER);
		const afterItems =
			afterArchive.sections
				.find((s) => s.key === "inbox")
				?.groups.flatMap((g) => g.items) ?? [];
		expect(afterItems.some((item) => item.id === `inbox:${inboxB}`)).toBe(
			false,
		);

		// …unless the user has an open conversation assigned inside them (the
		// never-remove rule keeps assigned work visible until resolved).
		await ctx.db
			.update(conversations)
			.set({ assigneeId: MEMBER, status: "open" })
			.where(eq(conversations.inboxId, inboxB))
			.run();
		const withAssigned = await getSidebar(ctx.env, workspaceId, MEMBER);
		const assignedItems =
			withAssigned.sections
				.find((s) => s.key === "inbox")
				?.groups.flatMap((g) => g.items) ?? [];
		const assignedItem = assignedItems.find(
			(item) => item.id === `inbox:${inboxB}`,
		);
		expect(assignedItem?.kind).toBe("inbox");
		if (assignedItem && assignedItem.kind === "inbox") {
			expect(assignedItem.hasOpenAssigned).toBe(true);
		}
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
		const views = sidebar.sections.find((s) => s.key === "views");
		expect(views?.items.some((item) => item.id === `view:${view.id}`)).toBe(
			true,
		);
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
			.find((s) => s.key === "inbox")
			?.groups.flatMap((g) => g.items)
			.find((i) => i.id === `inbox:${inbox.id}`);
		expect(item?.label).toBe("New");
	});
});
