import { afterEach, describe, expect, test } from "bun:test";
import {
	ChannelConnectRequestSchema,
	InboxCreateRequestSchema,
} from "@msgflow/contracts";
import { teams, workspaceMembers, workspaces } from "@msgflow/db";
import { getWorkspaceAccess } from "../src/access";
import { createInbox } from "../src/manage";
import { decodeJsonBody, MAX_JSON_BODY_BYTES } from "../src/validation";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

let ctx: TestCtx;
afterEach(async () => {
	await ctx?.mf?.dispose();
});

function jsonRequest(body: string): Request {
	return new Request("https://msgflow.test/api/inboxes", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
}

describe("Effect Schema inbox-create boundary", () => {
	test("normalizes a valid payload, preserves optional nulls, and strips unknown keys", async () => {
		const decoded = await decodeJsonBody(
			jsonRequest(
				JSON.stringify({
					name: "  Billing  ",
					description: null,
					color: "#EAB308",
					icon: "receipt-text",
					assignmentStrategy: "round_robin",
					clientSuppliedWorkspaceId: "must-not-reach-service",
				}),
			),
			InboxCreateRequestSchema,
		);

		expect(decoded).toEqual({
			ok: true,
			value: {
				name: "Billing",
				description: null,
				color: "#EAB308",
				icon: "receipt-text",
				assignmentStrategy: "round_robin",
			},
		});
	});

	test("rejects malformed JSON separately from field validation", async () => {
		expect(
			await decodeJsonBody(jsonRequest('{"name":'), InboxCreateRequestSchema),
		).toEqual({ ok: false, error: "invalid json body" });
		expect(
			await decodeJsonBody(
				jsonRequest(JSON.stringify({ name: 42 })),
				InboxCreateRequestSchema,
			),
		).toEqual({ ok: false, error: "invalid request body" });
	});

	test("enforces required fields and inbox configuration bounds", async () => {
		for (const body of [
			{},
			{ name: "   " },
			{ name: "x".repeat(121) },
			{ name: "Inbox", color: "blue" },
			{ name: "Inbox", icon: "uploaded-file" },
			{ name: "Inbox", assignmentStrategy: "random" },
			{ name: "Inbox", channelIds: ["", "valid"] },
		]) {
			expect(
				await decodeJsonBody(
					jsonRequest(JSON.stringify(body)),
					InboxCreateRequestSchema,
				),
			).toEqual({ ok: false, error: "invalid request body" });
		}
	});

	test("rejects declared and streamed bodies over the request limit", async () => {
		const oversized = JSON.stringify({ name: "x".repeat(MAX_JSON_BODY_BYTES) });
		expect(
			await decodeJsonBody(
				new Request("https://msgflow.test/api/inboxes", {
					method: "POST",
					headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
					body: oversized,
				}),
				InboxCreateRequestSchema,
			),
		).toEqual({ ok: false, error: "request body too large" });
	});

	test("passes a decoded input to the existing service without bypassing auth, tenant, or uniqueness checks", async () => {
		ctx = await createTestDb();
		const { workspaceId } = await seedWorkspace(ctx);
		await seedUser(ctx, "admin", "admin@test.dev");
		await seedUser(ctx, "member", "member@test.dev");
		await getWorkspaceAccess(ctx.db, workspaceId, "admin");
		await ctx.db
			.insert(workspaceMembers)
			.values({
				id: crypto.randomUUID(),
				workspaceId,
				userId: "member",
				role: "member",
				createdAt: new Date().toISOString(),
			})
			.run();

		const decoded = await decodeJsonBody(
			jsonRequest(JSON.stringify({ name: "  Billing  " })),
			InboxCreateRequestSchema,
		);
		if (!decoded.ok) throw new Error("expected a valid inbox request");
		const inbox = await createInbox(
			ctx.env,
			workspaceId,
			decoded.value,
			"admin",
		);
		expect(inbox.name).toBe("Billing");

		await expect(
			createInbox(ctx.env, workspaceId, decoded.value, "member"),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			createInbox(ctx.env, workspaceId, decoded.value, "admin"),
		).rejects.toMatchObject({ status: 409 });

		const foreignWorkspaceId = crypto.randomUUID();
		const now = new Date().toISOString();
		await ctx.db
			.insert(workspaces)
			.values({
				id: foreignWorkspaceId,
				name: "Foreign workspace",
				slug: "foreign",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const foreignTeamId = crypto.randomUUID();
		await ctx.db
			.insert(teams)
			.values({
				id: foreignTeamId,
				workspaceId: foreignWorkspaceId,
				name: "Foreign team",
				createdAt: now,
			})
			.run();
		const foreignDecoded = await decodeJsonBody(
			jsonRequest(JSON.stringify({ name: "Support", teamId: foreignTeamId })),
			InboxCreateRequestSchema,
		);
		if (!foreignDecoded.ok) throw new Error("expected a valid inbox request");
		await expect(
			createInbox(ctx.env, workspaceId, foreignDecoded.value, "admin"),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("Effect Schema channel-token boundary", () => {
	test("normalizes tokens and strips client-controlled channel fields", async () => {
		const decoded = await decodeJsonBody(
			jsonRequest(
				JSON.stringify({
					accessToken: "  page-token  ",
					workspaceId: "must-not-reach-service",
					status: "active",
				}),
			),
			ChannelConnectRequestSchema,
		);

		expect(decoded).toEqual({
			ok: true,
			value: { accessToken: "page-token" },
		});
	});

	test("rejects malformed, blank, non-string, and oversized tokens", async () => {
		for (const body of [
			"{",
			JSON.stringify({}),
			JSON.stringify({ accessToken: "   " }),
			JSON.stringify({ accessToken: 42 }),
			JSON.stringify({ accessToken: "x".repeat(8_193) }),
		]) {
			expect(
				await decodeJsonBody(jsonRequest(body), ChannelConnectRequestSchema),
			).toEqual({
				ok: false,
				error: body === "{" ? "invalid json body" : "invalid request body",
			});
		}
	});
});
