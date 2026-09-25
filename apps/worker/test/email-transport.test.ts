import { afterEach, describe, expect, test } from "bun:test";
import {
	channels,
	contactIdentities,
	contacts,
	conversations,
	emailDomains,
	inboxes,
	mailboxes,
	outboundIntents,
	teamMembers,
	teams,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import {
	authorizeEmailOutbound,
	authorizeIncomingEmail,
	resolveInboundEmailRoute,
} from "../src/email-transport";
import { recordProviderAccepted } from "../src/outbound-state";
import { listConversations } from "../src/queries";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf?.dispose();
});

async function seedMailTransport(
	input: { private?: boolean; teamOnly?: boolean } = {},
) {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "owner", "owner@test.dev");
	await seedUser(ctx, "member", "member@test.dev");
	await ctx.db
		.insert(workspaceMembers)
		.values([
			{
				id: crypto.randomUUID(),
				workspaceId,
				userId: "owner",
				role: "owner",
				createdAt: now,
			},
			{
				id: crypto.randomUUID(),
				workspaceId,
				userId: "member",
				role: "member",
				createdAt: now,
			},
		])
		.run();
	const domainId = crypto.randomUUID();
	const mailboxId = crypto.randomUUID();
	const inboxId = crypto.randomUUID();
	const channelId = crypto.randomUUID();
	const contactId = crypto.randomUUID();
	const conversationId = "email:support@example.com:thread-1";
	let teamId: string | null = null;
	if (input.teamOnly) {
		teamId = crypto.randomUUID();
		await ctx.db
			.insert(teams)
			.values({ id: teamId, workspaceId, name: "Support", createdAt: now })
			.run();
		await ctx.db
			.insert(teamMembers)
			.values({
				id: crypto.randomUUID(),
				teamId,
				userId: "owner",
				role: "member",
				createdAt: now,
			})
			.run();
	}
	await ctx.db
		.insert(inboxes)
		.values({ id: inboxId, workspaceId, name: "Support", createdAt: now })
		.run();
	await ctx.db
		.insert(emailDomains)
		.values({
			id: domainId,
			workspaceId,
			canonicalDomain: "example.com",
			inboundState: "ready",
			outboundState: "ready",
			dnsStatusJson: "{}",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "email",
			displayName: "Support",
			externalId: "support@example.com",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(mailboxes)
		.values({
			id: mailboxId,
			workspaceId,
			emailDomainId: domainId,
			localPart: "support",
			canonicalAddress: "support@example.com",
			type: input.private ? "private" : "shared",
			ownerUserId: input.private ? "owner" : null,
			inboxId: input.private ? null : inboxId,
			teamId: input.private ? null : teamId,
			isEnabled: true,
			isSendEnabled: true,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(contacts)
		.values({
			id: contactId,
			workspaceId,
			primaryEmail: "customer@example.net",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(contactIdentities)
		.values({
			id: crypto.randomUUID(),
			contactId,
			channelId,
			channelType: "email",
			externalUserId: "customer@example.net",
			createdAt: now,
		})
		.run();
	await ctx.db
		.insert(conversations)
		.values({
			id: conversationId,
			workspaceId,
			channelId,
			inboxId,
			contactId,
			doBindingId: conversationId,
			status: "open",
			messageCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { workspaceId, mailboxId, conversationId };
}

describe("logical mailbox transport gates", () => {
	test("unknown and disabled envelope recipients fail closed without a route", async () => {
		await seedMailTransport();
		expect(
			await resolveInboundEmailRoute(ctx.env, "missing@example.com"),
		).toMatchObject({ ok: false });
		const rejected: string[] = [];
		expect(
			await authorizeIncomingEmail(ctx.env, {
				to: "missing@example.com",
				setReject: (reason) => rejected.push(reason),
			}),
		).toBeNull();
		expect(rejected[0]).toStartWith("550 ");
		await ctx.db
			.update(mailboxes)
			.set({ isEnabled: false })
			.where(eq(mailboxes.canonicalAddress, "support@example.com"))
			.run();
		expect(
			await resolveInboundEmailRoute(ctx.env, "SUPPORT@EXAMPLE.COM"),
		).toMatchObject({ ok: false });
		expect(
			await authorizeIncomingEmail(ctx.env, {
				to: "support@example.com",
				setReject: (reason) => rejected.push(reason),
			}),
		).toBeNull();
		expect(rejected).toHaveLength(2);
	});

	test("private and team-scoped mailboxes reject unauthorized senders and readers", async () => {
		let seeded = await seedMailTransport({ private: true });
		expect(
			await authorizeEmailOutbound(ctx.env, seeded.conversationId, "member"),
		).toMatchObject({ ok: false });
		expect(
			await listConversations(ctx.env, "member", {}, seeded.workspaceId),
		).toEqual([]);
		expect(
			(await listConversations(ctx.env, "owner", {}, seeded.workspaceId)).map(
				(conversation) => conversation.id,
			),
		).toEqual([seeded.conversationId]);
		await ctx.mf.dispose();
		seeded = await seedMailTransport({ teamOnly: true });
		expect(
			await authorizeEmailOutbound(ctx.env, seeded.conversationId, "member"),
		).toMatchObject({ ok: false });
		expect(
			await listConversations(ctx.env, "member", {}, seeded.workspaceId),
		).toEqual([]);
		expect(
			await authorizeEmailOutbound(ctx.env, seeded.conversationId, "owner"),
		).toMatchObject({ ok: true });
		expect(
			(await listConversations(ctx.env, "owner", {}, seeded.workspaceId)).map(
				(conversation) => conversation.id,
			),
		).toEqual([seeded.conversationId]);
	});

	test("provider handoff is recorded as accepted, never delivered", async () => {
		const { conversationId } = await seedMailTransport();
		const now = "2026-09-24T00:00:00.000Z";
		await ctx.db
			.insert(outboundIntents)
			.values({
				id: "accepted-1",
				conversationId,
				text: "reply",
				senderId: "owner",
				status: "sending",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await recordProviderAccepted(ctx.env, "accepted-1", "provider-1", now);
		const intent = await ctx.db
			.select()
			.from(outboundIntents)
			.where(eq(outboundIntents.id, "accepted-1"))
			.get();
		expect(intent).toMatchObject({
			status: "provider_sent",
			providerMessageId: "provider-1",
			providerSentAt: now,
		});
		expect(intent?.deliveredAt).toBeNull();
	});
});
