import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createAuth } from "@msgflow/auth";
import {
	channels,
	contacts,
	conversations,
	inboxMembers,
	inboxes,
	workspaceMembers,
} from "@msgflow/db";
import { ManageError } from "../src/errors";
import { createEmailDomain, createSharedMailbox } from "../src/mailboxes";
import { listConversations } from "../src/queries";
import { setupInitialOwner } from "../src/setup";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());

async function setup() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = "2026-01-01T00:00:00.000Z";
	for (const id of ["owner", "alice", "bob"]) {
		await seedUser(ctx, id, `${id}@test.dev`);
		await ctx.db
			.insert(workspaceMembers)
			.values({ id, workspaceId, userId: id, role: id === "owner" ? "owner" : "member", createdAt: now })
			.run();
	}
	const inboxId = "public-inbox";
	const channelId = "public-channel";
	await ctx.db.insert(inboxes).values({ id: inboxId, workspaceId, name: "Public", createdAt: now }).run();
	await ctx.db.insert(inboxMembers).values({ id: "bob-public", inboxId, userId: "bob" }).run();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "facebook_page",
			displayName: "Public",
			externalId: "public-page",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db.insert(contacts).values({ id: "contact", workspaceId, createdAt: now, updatedAt: now }).run();
	const insert = async (id: string, lastMessageAt: string | null, overrides: Partial<{ channelId: string; inboxId: string }> = {}) =>
		ctx.db.insert(conversations).values({
			id,
			workspaceId,
			channelId: overrides.channelId ?? channelId,
			inboxId: overrides.inboxId ?? inboxId,
			contactId: "contact",
			doBindingId: id,
			status: "open",
			lastMessageAt,
			createdAt: now,
			updatedAt: now,
		}).run();

	for (const [id, timestamp] of [
		["c3", "2026-01-03T00:00:00.000Z"],
		["c2", "2026-01-03T00:00:00.000Z"],
		["c1", "2026-01-02T00:00:00.000Z"],
		["c0", "2026-01-02T00:00:00.000Z"],
		["n2", null],
		["n1", null],
	] as const) await insert(id, timestamp);

	const hiddenInboxId = "hidden-inbox";
	await ctx.db
		.insert(inboxes)
		.values({ id: hiddenInboxId, workspaceId, name: "Hidden", createdAt: now })
		.run();
	const domain = await createEmailDomain(
		ctx.env,
		workspaceId,
		{ canonicalDomain: "private.example.test" },
		"owner",
	);
	const hidden = await createSharedMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, localPart: "hidden", inboxId: hiddenInboxId },
		"owner",
	);
	// The row remains in Bob's readable inbox but points at a mailbox whose own
	// inbox grant excludes Bob, exercising the SQL mailbox policy predicate.
	await insert("hidden", "2026-01-04T00:00:00.000Z", { channelId: `mailbox-channel:${hidden.id}`, inboxId });
	return { workspaceId };
}

test("keyset pagination orders timestamp ties and nulls without private-mailbox gaps", async () => {
	const { workspaceId } = await setup();
	const first = await listConversations(ctx.env, "bob", { limit: 2 }, workspaceId);
	expect(first.conversations.map((conversation) => conversation.id)).toEqual(["c3", "c2"]);
	expect(first.nextCursor).not.toBeNull();

	const second = await listConversations(ctx.env, "bob", { limit: 2, cursor: first.nextCursor! }, workspaceId);
	expect(second.conversations.map((conversation) => conversation.id)).toEqual(["c1", "c0"]);
	expect(second.nextCursor).not.toBeNull();

	const third = await listConversations(ctx.env, "bob", { limit: 2, cursor: second.nextCursor! }, workspaceId);
	expect(third.conversations.map((conversation) => conversation.id)).toEqual(["n2", "n1"]);
	expect(third.nextCursor).toBeNull();
});

test("rejects malformed cursors and invalid direct page sizes", async () => {
	const { workspaceId } = await setup();
	await expect(listConversations(ctx.env, "bob", { cursor: "not-a-cursor" }, workspaceId)).rejects.toBeInstanceOf(ManageError);
	await expect(listConversations(ctx.env, "bob", { limit: 0 }, workspaceId)).rejects.toMatchObject({ status: 400 });
	await expect(listConversations(ctx.env, "bob", { limit: 101 }, workspaceId)).rejects.toMatchObject({ status: 400 });
});

test("conversation route returns a cursor page and rejects malformed cursors", async () => {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "../src/index.ts")],
		target: "browser",
		external: ["cloudflare:workers", "cloudflare:email"],
	});
	if (!bundled.success) throw new Error(bundled.logs.join("\n"));
	ctx = await createTestDb({ script: await bundled.outputs[0]!.text() });
	const owner = await setupInitialOwner(ctx.env, {
		email: "owner@test.dev",
		password: "correct horse battery staple",
		username: "owner",
		workspaceName: "Owner",
		workspaceSlug: "owner",
		initialTeamName: "Team",
		initialInboxName: "Inbox",
	});
	await ctx.env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(owner.userId).run();
	const login = await createAuth(ctx.env).handler(new Request("https://msgflow.test/api/auth/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: "owner@test.dev", password: "correct horse battery staple" }),
	}));
	const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
	if (!cookie) throw new Error("owner sign-in did not issue a session cookie");
	const now = "2026-01-01T00:00:00.000Z";
	await ctx.env.DB.batch([
		ctx.env.DB.prepare("INSERT INTO channels (id,workspace_id,type,display_name,external_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind("route-channel", owner.workspaceId, "facebook_page", "Page", "page", "active", now, now),
		ctx.env.DB.prepare("INSERT INTO contacts (id,workspace_id,created_at,updated_at) VALUES (?,?,?,?)").bind("route-contact", owner.workspaceId, now, now),
		...["route-c3", "route-c2", "route-c1"].map((id, index) =>
			ctx.env.DB.prepare("INSERT INTO conversations (id,workspace_id,channel_id,inbox_id,contact_id,do_binding_id,last_message_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, owner.workspaceId, "route-channel", owner.inboxId, "route-contact", id, `2026-01-0${3 - index}T00:00:00.000Z`, now, now),
		),
	]);
	const response = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations?workspaceId=${owner.workspaceId}&limit=2`,
		{ headers: { cookie } },
	);
	expect(response.status).toBe(200);
	const page = (await response.json()) as { conversations: unknown; nextCursor: unknown };
	expect(Array.isArray(page.conversations)).toBe(true);
	expect(page.conversations).toHaveLength(2);
	expect(page.nextCursor).toEqual(expect.any(String));

	const malformed = await ctx.mf.dispatchFetch(
		`https://msgflow.test/api/conversations?workspaceId=${owner.workspaceId}&cursor=not-a-cursor`,
		{ headers: { cookie } },
	);
	expect(malformed.status).toBe(400);
	expect(await malformed.json()).toMatchObject({ success: false });
});
