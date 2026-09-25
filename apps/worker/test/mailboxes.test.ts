import { afterEach, describe, expect, test } from "bun:test";
import {
	emailDomains,
	inboxes,
	mailboxDelegates,
	teams,
	user,
	workspaceMembers,
	workspaces,
} from "@msgflow/db";
import { eq } from "drizzle-orm";

import { ManageError } from "../src/errors";
import {
	addPrivateMailboxDelegate,
	createEmailDomain,
	createPrivateMailbox,
	createSharedMailbox,
	listEmailDomains,
	listMailboxes,
	removePrivateMailboxDelegate,
	updateEmailDomainState,
	updateMailboxState,
} from "../src/mailboxes";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => ctx?.mf?.dispose());

const OWNER = "owner";
const ADMIN = "admin";
const MEMBER = "member";

async function addMember(
	workspaceId: string,
	userId: string,
	role: "owner" | "admin" | "member",
) {
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			userId,
			role,
			createdAt: new Date().toISOString(),
		})
		.run();
}

async function setup() {
	ctx = await createTestDb();
	const { workspaceId } = await seedWorkspace(ctx);
	for (const userId of [OWNER, ADMIN, MEMBER, "delegate"]) {
		await seedUser(ctx, userId, `${userId}@test.dev`);
	}
	await addMember(workspaceId, OWNER, "owner");
	await addMember(workspaceId, ADMIN, "admin");
	await addMember(workspaceId, MEMBER, "member");
	await addMember(workspaceId, "delegate", "member");
	return workspaceId;
}

describe("email domain and mailbox service", () => {
	test("only workspace owners create globally unique pending domains", async () => {
		const workspaceId = await setup();
		await expect(
			createEmailDomain(
				ctx.env,
				workspaceId,
				{ canonicalDomain: " Example.COM. " },
				ADMIN,
			),
		).rejects.toMatchObject({ status: 403 });
		const domain = await createEmailDomain(
			ctx.env,
			workspaceId,
			{ canonicalDomain: " Example.COM. " },
			OWNER,
		);
		expect(domain).toMatchObject({
			canonicalDomain: "example.com",
			inboundState: "pending",
			outboundState: "pending",
		});
		expect(await listEmailDomains(ctx.env, workspaceId, ADMIN)).toHaveLength(1);
		await expect(
			updateEmailDomainState(
				ctx.env,
				workspaceId,
				domain.id,
				{ inboundState: "ready" },
				ADMIN,
			),
		).rejects.toMatchObject({ status: 403 });

		const otherWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: otherWorkspaceId,
				name: "Other",
				slug: "other",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await addMember(otherWorkspaceId, OWNER, "owner");
		await expect(
			createEmailDomain(
				ctx.env,
				otherWorkspaceId,
				{ canonicalDomain: "example.com" },
				OWNER,
			),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			listEmailDomains(ctx.env, otherWorkspaceId, OWNER),
		).resolves.toEqual([]);
	});

	test("shared mailboxes link only workspace-owned domain, inbox, and team and remain pending", async () => {
		const workspaceId = await setup();
		const domain = await createEmailDomain(
			ctx.env,
			workspaceId,
			{ canonicalDomain: "mail.example.com" },
			OWNER,
		);
		const now = new Date().toISOString();
		const inboxId = crypto.randomUUID();
		const teamId = crypto.randomUUID();
		await ctx.db
			.insert(teams)
			.values({ id: teamId, workspaceId, name: "Support", createdAt: now })
			.run();
		await ctx.db
			.insert(inboxes)
			.values({
				id: inboxId,
				workspaceId,
				teamId,
				name: "Support",
				createdAt: now,
			})
			.run();

		await expect(
			createSharedMailbox(
				ctx.env,
				workspaceId,
				{ emailDomainId: domain.id, localPart: "support", inboxId, teamId },
				ADMIN,
			),
		).rejects.toMatchObject({ status: 403 });
		const mailbox = await createSharedMailbox(
			ctx.env,
			workspaceId,
			{ emailDomainId: domain.id, localPart: "support", inboxId, teamId },
			OWNER,
		);
		expect(mailbox).toMatchObject({
			canonicalAddress: "support@mail.example.com",
			type: "shared",
			inboxId,
			teamId,
			isEnabled: false,
			isSendEnabled: false,
		});
		await expect(
			updateMailboxState(
				ctx.env,
				workspaceId,
				mailbox.id,
				{ isEnabled: true, isSendEnabled: true },
				OWNER,
			),
		).rejects.toMatchObject({ status: 409 });

		// DNS verification itself is covered in mailbox-pilot.test.ts.
		await ctx.db
			.update(emailDomains)
			.set({
				dnsStatusJson: JSON.stringify({
					checkedAt: new Date().toISOString(),
					routingDns: true,
					sendingDns: true,
					routingConfirmed: true,
					sendingConfirmed: true,
				}),
			})
			.where(eq(emailDomains.id, domain.id))
			.run();
		await updateEmailDomainState(
			ctx.env,
			workspaceId,
			domain.id,
			{ inboundState: "ready", outboundState: "ready" },
			OWNER,
		);
		const enabled = await updateMailboxState(
			ctx.env,
			workspaceId,
			mailbox.id,
			{ isEnabled: true, isSendEnabled: true },
			OWNER,
		);
		expect(enabled).toMatchObject({ isEnabled: true, isSendEnabled: true });
		expect(await listMailboxes(ctx.env, workspaceId, ADMIN)).toHaveLength(1);

		const foreignWorkspaceId = crypto.randomUUID();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign",
				slug: "foreign-mailbox",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const foreignInboxId = crypto.randomUUID();
		await ctx.db
			.insert(inboxes)
			.values({
				id: foreignInboxId,
				workspaceId: foreignWorkspaceId,
				name: "Foreign",
				createdAt: now,
			})
			.run();
		await expect(
			createSharedMailbox(
				ctx.env,
				workspaceId,
				{
					emailDomainId: domain.id,
					localPart: "other",
					inboxId: foreignInboxId,
				},
				OWNER,
			),
		).rejects.toThrow(ManageError);
	});

	test("private provisioning uses a member's username and only private owners manage delegates", async () => {
		const workspaceId = await setup();
		const domain = await createEmailDomain(
			ctx.env,
			workspaceId,
			{ canonicalDomain: "private.example.com" },
			OWNER,
		);
		await expect(
			createPrivateMailbox(
				ctx.env,
				workspaceId,
				{ ownerUserId: MEMBER, emailDomainId: domain.id },
				OWNER,
			),
		).rejects.toMatchObject({ status: 409 });
		// Existing-account migration permits nullable usernames; provision only after
		// a username is present, never by falling back to email or display name.
		await ctx.db
			.update(user)
			.set({ username: "member.handle" })
			.where(eq(user.id, MEMBER))
			.run();
		const provisioned = await createPrivateMailbox(
			ctx.env,
			workspaceId,
			{ ownerUserId: MEMBER, emailDomainId: domain.id },
			OWNER,
		);
		expect(provisioned).toMatchObject({
			localPart: "member.handle",
			canonicalAddress: "member.handle@private.example.com",
			type: "private",
			ownerUserId: MEMBER,
			inboxId: null,
			teamId: null,
			isEnabled: false,
			isSendEnabled: false,
		});
		await expect(
			createPrivateMailbox(
				ctx.env,
				workspaceId,
				{ ownerUserId: MEMBER, emailDomainId: domain.id },
				OWNER,
			),
		).rejects.toMatchObject({ status: 409 });

		await expect(
			addPrivateMailboxDelegate(
				ctx.env,
				workspaceId,
				provisioned.id,
				{ userId: "delegate" },
				OWNER,
			),
		).rejects.toMatchObject({ status: 403 });
		await addPrivateMailboxDelegate(
			ctx.env,
			workspaceId,
			provisioned.id,
			{ userId: "delegate" },
			MEMBER,
		);
		expect(
			await ctx.db
				.select()
				.from(mailboxDelegates)
				.where(eq(mailboxDelegates.mailboxId, provisioned.id))
				.all(),
		).toHaveLength(1);
		await expect(
			removePrivateMailboxDelegate(
				ctx.env,
				workspaceId,
				provisioned.id,
				"delegate",
				OWNER,
			),
		).rejects.toMatchObject({ status: 403 });
		await removePrivateMailboxDelegate(
			ctx.env,
			workspaceId,
			provisioned.id,
			"delegate",
			MEMBER,
		);
		expect(
			await ctx.db
				.select()
				.from(mailboxDelegates)
				.where(eq(mailboxDelegates.mailboxId, provisioned.id))
				.all(),
		).toHaveLength(0);
	});
});
