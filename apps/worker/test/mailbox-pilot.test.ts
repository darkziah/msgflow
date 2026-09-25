import { afterEach, expect, test } from "bun:test";
import {
	channels,
	contacts,
	conversations,
	emailDomains,
	inboxes,
	inboxMembers,
	user,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import { normalizeEmailDomain } from "../src/email-address";
import {
	authorizeEmailOutbound,
	canAccessMailbox,
	resolveInboundEmailRoute,
} from "../src/email-transport";
import {
	addPrivateMailboxDelegate,
	assignLegacyUsername,
	commitBulkPrivateMailboxes,
	createEmailDomain,
	createPrivateMailbox,
	createSharedMailbox,
	listReadableMailboxes,
	previewBulkPrivateMailboxes,
	repairMailboxTransport,
	updateEmailDomainState,
	updateMailboxState,
	verifyEmailDomain,
} from "../src/mailboxes";
import { listConversations } from "../src/queries";
import { getSidebar } from "../src/workspace-api";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf.dispose());
async function setup() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	for (const id of ["owner", "alice", "bob"]) {
		await seedUser(ctx, id, `${id}@test.dev`);
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id,
				workspaceId,
				userId: id,
				role: id === "owner" ? "owner" : "member",
				createdAt: new Date().toISOString(),
			})
			.run();
	}
	await assignLegacyUsername(ctx.env, workspaceId, "alice", "alice", "owner");
	const domain = await createEmailDomain(
		ctx.env,
		workspaceId,
		{ canonicalDomain: "pilot.example.com" },
		"owner",
	);
	return { workspaceId, domain };
}
const dns = (async (input: string | URL | Request) => {
	const url = new URL(String(input));
	const host = url.searchParams.get("name") ?? "";
	const mx = url.searchParams.get("type") === "MX";
	const data = mx
		? "10 route1.mx.cloudflare.net."
		: host.includes("_domainkey")
			? `v=DKIM1; p=${"A".repeat(64)}`
			: host.startsWith("_dmarc")
				? "v=DMARC1; p=none;"
				: "v=spf1 include:_spf.mx.cloudflare.net ~all";
	return Response.json({ Status: 0, Answer: [{ type: mx ? 15 : 16, data }] });
}) as typeof fetch;

test("strict IDNA parser rejects URL syntax and malformed labels", () => {
	expect(normalizeEmailDomain(" BÜCHER.Example. ")).toBe(
		"xn--bcher-kva.example",
	);
	for (const value of [
		"example.com/path",
		"example.com:443",
		"a@example.com",
		"a..com",
		"-a.com",
		"a-.com",
		"a_.com",
		"example.com?x",
		"example.com\\x",
		"127.0.0.1",
		"é",
		`${"a".repeat(64)}.com`,
	])
		expect(() => normalizeEmailDomain(value)).toThrow();
});

test("DNS readiness requires fresh evidence, separate confirmations and sending selector", async () => {
	const { workspaceId, domain } = await setup();
	await expect(
		updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ inboundState: "ready", operatorConfirmed: true },
			"owner",
		),
	).rejects.toMatchObject({ status: 409 });
	const verified = await verifyEmailDomain(
		ctx.env,
		workspaceId,
		domain.id,
		{
			routingConfirmed: true,
			sendingConfirmed: false,
			dkimSelector: "actual-sender",
		},
		"owner",
		dns,
	);
	expect(
		JSON.parse(verified.dnsStatusJson).records[
			"actual-sender._domainkey.pilot.example.com/TXT"
		],
	).toHaveLength(1);
	await updateEmailDomainState(
		ctx.env,
		workspaceId,
		domain.id,
		{ inboundState: "ready" },
		"owner",
	);
	await expect(
		updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ outboundState: "ready" },
			"owner",
		),
	).rejects.toMatchObject({ status: 409 });
	await verifyEmailDomain(
		ctx.env,
		workspaceId,
		domain.id,
		{ routingConfirmed: true, sendingConfirmed: true },
		"owner",
		dns,
	);
	await updateEmailDomainState(
		ctx.env,
		workspaceId,
		domain.id,
		{ outboundState: "ready" },
		"owner",
	);
	const evidence = JSON.parse(
		(await ctx.db
			.select()
			.from(emailDomains)
			.where(eq(emailDomains.id, domain.id))
			.get())!.dnsStatusJson,
	);
	evidence.checkedAt = "2000-01-01T00:00:00Z";
	await ctx.db
		.update(emailDomains)
		.set({ dnsStatusJson: JSON.stringify(evidence) })
		.where(eq(emailDomains.id, domain.id))
		.run();
	await expect(
		updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ inboundState: "ready" },
			"owner",
		),
	).rejects.toMatchObject({ status: 409 });
});

test("private provisioning routes, preserves CHECK, grants and immutable audit; disabled blocks both directions", async () => {
	const { workspaceId, domain } = await setup();
	const mailbox = await createPrivateMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, ownerUserId: "alice" },
		"owner",
	);
	expect(mailbox.inboxId).toBeNull();
	await verifyEmailDomain(
		ctx.env,
		workspaceId,
		domain.id,
		{ routingConfirmed: true, sendingConfirmed: true },
		"owner",
		dns,
	);
	await updateEmailDomainState(
		ctx.env,
		workspaceId,
		domain.id,
		{ inboundState: "ready", outboundState: "ready" },
		"owner",
	);
	await updateMailboxState(
		ctx.env,
		workspaceId,
		mailbox.id,
		{ isEnabled: true, isSendEnabled: true },
		"owner",
	);
	const route = await resolveInboundEmailRoute(
		ctx.env,
		mailbox.canonicalAddress,
	);
	expect(route.ok).toBe(true);
	if (!route.ok) throw new Error("missing route");
	const now = new Date().toISOString();
	await ctx.db
		.insert(contacts)
		.values({ id: "contact", workspaceId, createdAt: now, updatedAt: now })
		.run();
	await ctx.db
		.insert(conversations)
		.values({
			id: "thread",
			workspaceId,
			channelId: route.route.channelId,
			inboxId: route.route.inboxId,
			contactId: "contact",
			doBindingId: "thread",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	expect(
		await authorizeEmailOutbound(ctx.env, "thread", "owner", mailbox.id),
	).toMatchObject({ ok: false });
	expect(
		await authorizeEmailOutbound(ctx.env, "thread", "alice", "wrong"),
	).toMatchObject({ ok: false });
	expect(
		await authorizeEmailOutbound(ctx.env, "thread", "alice", mailbox.id),
	).toMatchObject({ ok: true });
	expect(
		await listReadableMailboxes(ctx.env, workspaceId, "owner"),
	).toHaveLength(0);
	expect(
		await listReadableMailboxes(ctx.env, workspaceId, "alice"),
	).toMatchObject([{ openCount: 1, totalCount: 1 }]);
	expect(
		await listConversations(
			ctx.env,
			"owner",
			{ mailboxId: mailbox.id },
			workspaceId,
		),
	).toHaveLength(0);
	expect(
		await listConversations(
			ctx.env,
			"alice",
			{ mailboxId: mailbox.id },
			workspaceId,
		),
	).toHaveLength(1);
	expect(
		JSON.stringify(await getSidebar(ctx.env, workspaceId, "owner")),
	).not.toContain(mailbox.canonicalAddress);
	await addPrivateMailboxDelegate(
		ctx.env,
		workspaceId,
		mailbox.id,
		{ userId: "bob" },
		"alice",
	);
	expect(
		await canAccessMailbox(
			ctx.env,
			workspaceId,
			mailbox.canonicalAddress,
			"bob",
		),
	).toBe(true);
	await updateMailboxState(
		ctx.env,
		workspaceId,
		mailbox.id,
		{ isEnabled: false },
		"owner",
	);
	expect(
		await authorizeEmailOutbound(ctx.env, "thread", "alice"),
	).toMatchObject({ ok: false });
	expect(
		await resolveInboundEmailRoute(ctx.env, mailbox.canonicalAddress),
	).toMatchObject({ ok: false });
	expect(
		await listConversations(ctx.env, "alice", {}, workspaceId),
	).toHaveLength(1);
	await expect(
		ctx.env.DB.prepare("UPDATE email_audit SET action = 'tamper'").run(),
	).rejects.toThrow("immutable");
	expect(
		(await ctx.env.DB.prepare("SELECT count(*) AS n FROM email_audit").first<{
			n: number;
		}>())!.n,
	).toBeGreaterThan(5);
});

test("shared without team requires explicit inbox grant; bulk exclusions and collisions are fail closed", async () => {
	const { workspaceId, domain } = await setup();
	await ctx.db
		.insert(inboxes)
		.values({
			id: "shared",
			workspaceId,
			name: "Support",
			createdAt: new Date().toISOString(),
		})
		.run();
	const mailbox = await createSharedMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, localPart: "support", inboxId: "shared" },
		"owner",
	);
	expect(
		await canAccessMailbox(
			ctx.env,
			workspaceId,
			mailbox.canonicalAddress,
			"owner",
		),
	).toBe(false);
	await ctx.db
		.insert(inboxMembers)
		.values({ id: "grant", inboxId: "shared", userId: "bob" })
		.run();
	expect(
		await canAccessMailbox(
			ctx.env,
			workspaceId,
			mailbox.canonicalAddress,
			"bob",
		),
	).toBe(true);
	const preview = await previewBulkPrivateMailboxes(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, excludeUserIds: ["alice"] },
		"owner",
	);
	expect(preview.find((r) => r.userId === "alice")?.reason).toBe("excluded");
	await expect(
		commitBulkPrivateMailboxes(
			ctx.env,
			workspaceId,
			{
				emailDomainId: domain.id,
				excludeUserIds: ["alice"],
				userIds: ["alice"],
			},
			"owner",
		),
	).rejects.toMatchObject({ status: 409 });
	expect(
		await commitBulkPrivateMailboxes(
			ctx.env,
			workspaceId,
			{ emailDomainId: domain.id, userIds: ["alice"] },
			"owner",
		),
	).toHaveLength(1);
	expect(
		(
			await previewBulkPrivateMailboxes(
				ctx.env,
				workspaceId,
				{ emailDomainId: domain.id },
				"owner",
			)
		).find((r) => r.userId === "alice")?.reason,
	).toBe("address collision");
	await expect(
		assignLegacyUsername(ctx.env, workspaceId, "bob", "bob", "alice"),
	).rejects.toMatchObject({ status: 403 });
	await expect(
		assignLegacyUsername(ctx.env, workspaceId, "alice", "new-name", "owner"),
	).rejects.toMatchObject({ status: 409 });
	await repairMailboxTransport(ctx.env, "unknown-mailbox");
	expect(await ctx.db.select().from(channels)).toHaveLength(2);
});

test("privacy filters precede the list limit and provisioning collisions roll back", async () => {
	const { workspaceId, domain } = await setup();
	const hidden = await createPrivateMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, ownerUserId: "alice" },
		"owner",
	);
	await ctx.db
		.insert(inboxes)
		.values({
			id: "public",
			workspaceId,
			name: "Shared",
			createdAt: new Date().toISOString(),
		})
		.run();
	const visible = await createSharedMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, localPart: "support", inboxId: "public" },
		"owner",
	);
	await ctx.db
		.insert(inboxMembers)
		.values({ id: "bob-grant", inboxId: "public", userId: "bob" })
		.run();
	const now = new Date().toISOString();
	await ctx.db
		.insert(contacts)
		.values({
			id: "contact-limit",
			workspaceId,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const insert = (
		id: string,
		mailboxId: string,
		inboxId: string,
		time: string,
	) =>
		ctx.env.DB.prepare(
			"INSERT INTO conversations (id, workspace_id, channel_id, inbox_id, contact_id, do_binding_id, status, last_message_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'contact-limit', ?, 'open', ?, ?, ?)",
		).bind(
			id,
			workspaceId,
			`mailbox-channel:${mailboxId}`,
			inboxId,
			id,
			time,
			now,
			now,
		);
	await ctx.env.DB.batch(
		Array.from({ length: 201 }, (_, i) =>
			insert(`hidden-${i}`, hidden.id, `mailbox-inbox:${hidden.id}`, now),
		),
	);
	await insert(
		"visible-old",
		visible.id,
		"public",
		"2000-01-01T00:00:00Z",
	).run();
	expect(
		(await listConversations(ctx.env, "bob", {}, workspaceId)).map(
			(row) => row.id,
		),
	).toEqual(["visible-old"]);
	const sidebar = await getSidebar(ctx.env, workspaceId, "bob");
	expect(JSON.stringify(sidebar)).not.toContain(hidden.canonicalAddress);
	const allItem = sidebar.sections
		.flatMap((s) => s.items)
		.find((i) => i.id === "system:all");
	expect(allItem?.kind === "system" ? allItem.count : null).toBe(1);
	await ctx.db
		.insert(channels)
		.values({
			id: "collision",
			workspaceId,
			type: "facebook_page",
			displayName: "Collision",
			externalId: "sales@pilot.example.com",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await expect(
		createSharedMailbox(
			ctx.env,
			workspaceId,
			{ emailDomainId: domain.id, localPart: "sales", inboxId: "public" },
			"owner",
		),
	).rejects.toThrow();
	expect(
		await ctx.env.DB.prepare(
			"SELECT id FROM mailboxes WHERE canonical_address = 'sales@pilot.example.com'",
		).first(),
	).toBeNull();
});

test("either domain suspension blocks both transports", async () => {
	const { workspaceId, domain } = await setup();
	const mailbox = await createPrivateMailbox(
		ctx.env,
		workspaceId,
		{ emailDomainId: domain.id, ownerUserId: "alice" },
		"owner",
	);
	await verifyEmailDomain(
		ctx.env,
		workspaceId,
		domain.id,
		{ routingConfirmed: true, sendingConfirmed: true },
		"owner",
		dns,
	);
	const now = new Date().toISOString();
	await ctx.db
		.insert(contacts)
		.values({
			id: "suspend-contact",
			workspaceId,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(conversations)
		.values({
			id: "suspend-thread",
			workspaceId,
			channelId: `mailbox-channel:${mailbox.id}`,
			inboxId: `mailbox-inbox:${mailbox.id}`,
			contactId: "suspend-contact",
			doBindingId: "suspend-thread",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const direction of ["inboundState", "outboundState"] as const) {
		await updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ inboundState: "ready", outboundState: "ready" },
			"owner",
		);
		await updateMailboxState(
			ctx.env,
			workspaceId,
			mailbox.id,
			{ isEnabled: true, isSendEnabled: true },
			"owner",
		);
		await updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ [direction]: "suspended" },
			"owner",
		);
		expect(
			await resolveInboundEmailRoute(ctx.env, mailbox.canonicalAddress),
		).toMatchObject({ ok: false });
		expect(
			await authorizeEmailOutbound(ctx.env, "suspend-thread", "alice"),
		).toMatchObject({ ok: false });
		await expect(
			updateMailboxState(
				ctx.env,
				workspaceId,
				mailbox.id,
				{ isEnabled: true },
				"owner",
			),
		).rejects.toMatchObject({ status: 409 });
	}
});
