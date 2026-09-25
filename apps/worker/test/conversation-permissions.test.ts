import { afterEach, expect, test } from "bun:test";
import {
	readEmailDraft,
	saveEmailDraft,
	deleteEmailDraft,
} from "../src/email-drafts";
import {
	channels,
	contacts,
	conversations,
	emailDomains,
	inboxes,
	mailboxDelegates,
	mailboxes,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import {
	canReadConversation,
	filterReadableNotifications,
} from "../src/conversation-permissions";
import { requireDefaultWorkspaceAccess } from "../src/access";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf.dispose();
});

async function fixture() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	for (const id of ["owner", "delegate", "admin"]) {
		await seedUser(ctx, id, `${id}@test.dev`);
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id,
				workspaceId,
				userId: id,
				role: id === "admin" ? "admin" : "member",
				createdAt: now,
			})
			.run();
	}
	await ctx.db
		.insert(emailDomains)
		.values({
			id: "domain",
			workspaceId,
			canonicalDomain: "inbox.test.dev",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(mailboxes)
		.values({
			id: "mailbox",
			workspaceId,
			emailDomainId: "domain",
			localPart: "owner",
			canonicalAddress: "owner@inbox.test.dev",
			type: "private",
			ownerUserId: "owner",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(mailboxDelegates)
		.values({
			mailboxId: "mailbox",
			userId: "delegate",
			createdBy: "owner",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(inboxes)
		.values({ id: "inbox", workspaceId, name: "Private", createdAt: now })
		.run();
	const channel = await ctx.db
		.select()
		.from(channels)
		.where(eq(channels.externalId, "owner@inbox.test.dev"))
		.get();
	if (!channel) throw new Error("mailbox channel was not provisioned");
	await ctx.db
		.insert(contacts)
		.values({
			id: "contact",
			workspaceId,
			primaryEmail: "customer@test.dev",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const conversationId = "email:owner@inbox.test.dev:thread";
	await ctx.db
		.insert(conversations)
		.values({
			id: conversationId,
			workspaceId,
			channelId: channel.id,
			inboxId: "inbox",
			contactId: "contact",
			doBindingId: conversationId,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { workspaceId, conversationId };
}

test("private projections deny admins and revoke existing delegates immediately", async () => {
	const { workspaceId, conversationId } = await fixture();
	expect(
		await canReadConversation(ctx.env, "owner", conversationId, workspaceId),
	).toBe(true);
	expect(
		await canReadConversation(ctx.env, "admin", conversationId, workspaceId),
	).toBe(false);
	expect(
		await canReadConversation(ctx.env, "delegate", conversationId, workspaceId),
	).toBe(true);
	const notification = { workspaceId, conversationId, commentText: "private" };
	await saveEmailDraft(ctx.env, workspaceId, conversationId, "delegate", {
		text: "private draft",
		clientMessageId: "stable-request",
	});
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "delegate"),
	).toMatchObject({ text: "private draft", clientMessageId: "stable-request" });
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "owner"),
	).toBeNull();
	await expect(
		saveEmailDraft(ctx.env, workspaceId, conversationId, "delegate", {
			text: "stale other-tab draft",
		}),
	).rejects.toThrow("submitted draft");
	await deleteEmailDraft(
		ctx.env,
		workspaceId,
		conversationId,
		"delegate",
		"different-request",
	);
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "delegate"),
	).toMatchObject({ clientMessageId: "stable-request" });
	await deleteEmailDraft(
		ctx.env,
		workspaceId,
		conversationId,
		"delegate",
		"stable-request",
	);
	await saveEmailDraft(ctx.env, workspaceId, conversationId, "delegate", {
		text: "newer device draft",
		draftRevision: 2,
	});
	await deleteEmailDraft(
		ctx.env,
		workspaceId,
		conversationId,
		"delegate",
		"stable-request",
	);
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "delegate"),
	).toMatchObject({ text: "newer device draft" });
	await expect(
		readEmailDraft(ctx.env, workspaceId, conversationId, "admin"),
	).rejects.toThrow();
	expect(
		await filterReadableNotifications(ctx.env, "admin", workspaceId, [
			notification,
		]),
	).toEqual([]);
	await ctx.db
		.delete(mailboxDelegates)
		.where(eq(mailboxDelegates.userId, "delegate"))
		.run();
	await expect(
		readEmailDraft(ctx.env, workspaceId, conversationId, "delegate"),
	).rejects.toThrow();
	expect(
		await filterReadableNotifications(ctx.env, "delegate", workspaceId, [
			notification,
		]),
	).toEqual([]);
	expect(
		await canReadConversation(
			ctx.env,
			"owner",
			conversationId,
			"another-workspace",
		),
	).toBe(false);
});

test("draft revisions fence stale tabs, retained tombstones and immutable retries", async () => {
	const { workspaceId, conversationId } = await fixture();
	const save = (input: Parameters<typeof saveEmailDraft>[4]) =>
		saveEmailDraft(ctx.env, workspaceId, conversationId, "owner", input);
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "owner"),
	).toBeNull();
	const first = await save({ text: "tab one", draftRevision: 0 });
	expect(first.draftRevision).toBe(1);
	await expect(
		save({ text: "tab two", draftRevision: 0 }),
	).rejects.toMatchObject({ status: 409 });
	const submission = { ...first, clientMessageId: "immutable-attempt" };
	const submitted = await save(submission);
	expect(submitted.draftRevision).toBe(2);
	expect(await save(submission)).toEqual(submitted);
	await expect(save({ ...submission, text: "changed" })).rejects.toMatchObject({
		status: 409,
	});
	await deleteEmailDraft(
		ctx.env,
		workspaceId,
		conversationId,
		"owner",
		"immutable-attempt",
	);
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "owner"),
	).toEqual({ text: "", draftRevision: 3 });
	await expect(
		save({ text: "tab two", draftRevision: 0 }),
	).rejects.toMatchObject({ status: 409 });
	await expect(save(submission)).rejects.toMatchObject({ status: 409 });
	const newer = await save({ text: "new draft", draftRevision: 3 });
	await deleteEmailDraft(
		ctx.env,
		workspaceId,
		conversationId,
		"owner",
		"immutable-attempt",
	);
	expect(
		await readEmailDraft(ctx.env, workspaceId, conversationId, "owner"),
	).toEqual(newer);
});

test("legacy access resolves configured workspace slug without creating a default workspace", async () => {
	ctx = await createTestDb();
	const now = new Date().toISOString();
	await seedUser(ctx, "owner", "owner@test.dev");
	await ctx.env.DB.prepare(
		"INSERT INTO workspaces (id,name,slug,created_at,updated_at) VALUES ('custom','Custom','custom-slug',?,?)",
	)
		.bind(now, now)
		.run();
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: "member",
			workspaceId: "custom",
			userId: "owner",
			role: "owner",
			createdAt: now,
		})
		.run();
	expect(await requireDefaultWorkspaceAccess(ctx.db, "owner")).toMatchObject({
		workspaceId: "custom",
		role: "owner",
	});
	expect(
		await ctx.env.DB.prepare("SELECT count(*) AS n FROM workspaces").first("n"),
	).toBe(1);
	await expect(
		requireDefaultWorkspaceAccess(ctx.db, "outsider"),
	).rejects.toThrow();
});
