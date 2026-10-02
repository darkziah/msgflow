import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	callQueues,
	channels,
	metaApps,
	teamMembers,
	teams,
	workspaceMembers,
} from "@msgflow/db";
import { eq } from "drizzle-orm";
import {
	createCallQueue,
	createRingGroup,
	disableCallQueue,
	enableCallQueue,
} from "../src/calling-config";
import { encryptChannelToken } from "../src/channel-token-crypto";
import { configureMessengerInboundCalling } from "../src/facebook-calling-provider";
import { createTestDb, seedUser, seedWorkspace, type TestCtx } from "./helpers";

const pageAccessToken = "page-access-token-never-returned";
const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const hours = [
	{ day_of_week: "MONDAY" as const, open_time: "0900", close_time: "1700" },
];
let ctx: TestCtx;
let originalFetch: typeof fetch;

afterEach(async () => {
	if (originalFetch) globalThis.fetch = originalFetch;
	await ctx?.mf?.dispose();
});

function mockGraph(...responses: Array<Response | Error | Promise<Response>>) {
	const fetchMock = mock(async () => {
		const response = responses.shift();
		if (response instanceof Error) throw response;
		if (!response) throw new Error("unexpected Graph request");
		return response;
	});
	originalFetch = globalThis.fetch;
	globalThis.fetch = fetchMock as typeof fetch;
	return fetchMock;
}

async function providerInput() {
	return {
		pageId: "page-1",
		encryptedPageAccessToken: await encryptChannelToken(
			pageAccessToken,
			encryptionKey,
		),
		channelTokenEncryptionKey: encryptionKey,
		timezoneId: "UTC",
		weeklyOperatingHours: hours,
	};
}

async function seedQueue() {
	ctx = await createTestDb();
	ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY = encryptionKey;
	const { workspaceId } = await seedWorkspace(ctx);
	const now = new Date().toISOString();
	await seedUser(ctx, "owner", "owner@test.dev");
	await ctx.db
		.insert(workspaceMembers)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			userId: "owner",
			role: "owner",
			createdAt: now,
		})
		.run();
	const teamId = crypto.randomUUID();
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
	const channelId = crypto.randomUUID();
	await ctx.db
		.insert(metaApps)
		.values({
			id: "meta-app-1",
			workspaceId,
			displayName: "Meta App",
			appId: "123",
			appSecret: "encrypted-app-secret",
			webhookSubscriptionConfirmedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	await ctx.db
		.insert(channels)
		.values({
			id: channelId,
			workspaceId,
			type: "facebook_page",
			displayName: "Page",
			externalId: "page-1",
			accessToken: await encryptChannelToken(pageAccessToken, encryptionKey),
			metaAppId: "meta-app-1",
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const ringGroup = await createRingGroup(
		ctx.env,
		workspaceId,
		{ teamId, name: "Primary", strategy: "simultaneous", memberIds: ["owner"] },
		"owner",
	);
	const queue = await createCallQueue(
		ctx.env,
		workspaceId,
		{
			channelId,
			teamId,
			name: "Calls",
			timezoneId: "UTC",
			weeklyOperatingHours: hours,
			noAgentReplyText: "Unavailable",
			stages: [{ ringGroupId: ringGroup.id, ringDurationSeconds: 10 }],
		},
		"owner",
	);
	return {
		workspaceId,
		queueId: queue.id,
		channelId,
		teamId,
		ringGroupId: ringGroup.id,
	};
}

describe("Messenger Page calling provider", () => {
	test("uses the documented eligibility body and exact call-settings payload", async () => {
		const fetchMock = mockGraph(
			new Response(
				JSON.stringify({
					data: [{ feature: "messenger_api_calling", status: "ENABLED" }],
				}),
				{ status: 200 },
			),
			new Response(JSON.stringify({ result: "success" }), { status: 200 }),
		);
		await configureMessengerInboundCalling(await providerInput());
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
			features: [{ feature: "messenger_api_calling" }],
		});
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
			call_hours: { timezone_id: "UTC", weekly_operating_hours: hours },
			call_routing: { ring_target: "PARTNERS" },
		});
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
			expect.objectContaining({ authorization: `Bearer ${pageAccessToken}` }),
		);
	});

	test("treats malformed or unrelated eligibility data as controlled uncertainty", async () => {
		for (const body of [
			{},
			{ data: [] },
			{ data: [{ feature: "other", status: "ENABLED" }] },
			{ data: [{ feature: "messenger_api_calling" }] },
		]) {
			mockGraph(new Response(JSON.stringify(body), { status: 200 }));
			await expect(
				configureMessengerInboundCalling(await providerInput()),
			).rejects.toThrow(/uncertain; retry/i);
		}
	});

	test("requires exact uppercase ENABLED and result success", async () => {
		mockGraph(
			new Response(JSON.stringify({ data: [{ feature: "messenger_api_calling", status: "enabled" }] }), { status: 200 }),
		);
		await expect(configureMessengerInboundCalling(await providerInput())).rejects.toThrow(/not eligible/i);
		mockGraph(
			new Response(JSON.stringify({ data: [{ feature: "messenger_api_calling", status: "ENABLED" }] }), { status: 200 }),
			new Response(JSON.stringify({ success: true }), { status: 200 }),
		);
		await expect(configureMessengerInboundCalling(await providerInput())).rejects.toThrow(/settings response is uncertain/i);
	});

	test("classifies eligibility 4xx, 5xx, and transport failures without token leaks", async () => {
		for (const response of [new Response("no", { status: 400 }), new Response("no", { status: 500 }), new Error("network down")]) {
			mockGraph(response);
			let failure: unknown;
			try { await configureMessengerInboundCalling(await providerInput()); } catch (error) { failure = error; }
			expect(failure).toBeDefined();
			expect(String(failure)).not.toContain(pageAccessToken);
		}
	});

	test("keeps local state disabled for settings, transport, or credential failures without token leaks", async () => {
		const { workspaceId, queueId } = await seedQueue();
		mockGraph(
			new Response(
				JSON.stringify({
					data: [{ feature: "messenger_api_calling", status: "ENABLED" }],
				}),
				{ status: 200 },
			),
			new Response("settings failed", { status: 400 }),
		);
		let settingsFailure: unknown;
		try {
			await enableCallQueue(ctx.env, workspaceId, queueId, "owner");
		} catch (error) {
			settingsFailure = error;
		}
		expect(String(settingsFailure)).toMatch(/settings/i);
		expect(String(settingsFailure)).not.toContain(pageAccessToken);
		expect(
			(
				await ctx.db
					.select()
					.from(callQueues)
					.where(eq(callQueues.id, queueId))
					.get()
			)?.isEnabled,
		).toBe(false);
		ctx.env.CHANNEL_TOKEN_ENCRYPTION_KEY = "invalid";
		await expect(
			enableCallQueue(ctx.env, workspaceId, queueId, "owner"),
		).rejects.toThrow(/credential/i);
		expect(
			(
				await ctx.db
					.select()
					.from(callQueues)
					.where(eq(callQueues.id, queueId))
					.get()
			)?.isEnabled,
		).toBe(false);
	});

	test("a competing provisioning reservation rejects before Graph", async () => {
		const { workspaceId, channelId, teamId, ringGroupId } = await seedQueue();
		const first = await createCallQueue(
			ctx.env,
			workspaceId,
			{
				channelId,
				teamId,
				name: "Other",
				timezoneId: "UTC",
				weeklyOperatingHours: hours,
				noAgentReplyText: "Unavailable",
				stages: [{ ringGroupId, ringDurationSeconds: 10 }],
			},
			"owner",
		);
		await ctx.db
			.update(callQueues)
			.set({ provisioningLeaseToken: "other-enable-lease" })
			.where(eq(callQueues.id, first.id))
			.run();
		const fetchMock = mockGraph();
		const queues = await ctx.db.select().from(callQueues).all();
		const second = queues.find((queue) => queue.id !== first.id);
		if (!second) throw new Error("expected a second queue");
		await expect(
			enableCallQueue(ctx.env, workspaceId, second.id, "owner"),
		).rejects.toMatchObject({ status: 409 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("keeps dispatch disabled while Graph provisioning is pending", async () => {
		const { workspaceId, queueId } = await seedQueue();
		let resolveEligibility: ((response: Response) => void) | undefined;
		const pendingEligibility = new Promise<Response>((resolve) => { resolveEligibility = resolve; });
		const fetchMock = mockGraph(pendingEligibility, new Response(JSON.stringify({ result: "success" }), { status: 200 }));
		const enabling = enableCallQueue(ctx.env, workspaceId, queueId, "owner");
		for (let attempt = 0; attempt < 20 && fetchMock.mock.calls.length === 0; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const pending = await ctx.db.select().from(callQueues).where(eq(callQueues.id, queueId)).get();
		expect(pending?.isEnabled).toBe(false);
		expect(pending?.provisioningLeaseToken).toBeString();
		resolveEligibility?.(new Response(JSON.stringify({ data: [{ feature: "messenger_api_calling", status: "ENABLED" }] }), { status: 200 }));
		await enabling;
		expect((await ctx.db.select().from(callQueues).where(eq(callQueues.id, queueId)).get())?.isEnabled).toBe(true);
	});

	test("does not re-enable a queue disabled while Graph provisioning is pending", async () => {
		const { workspaceId, queueId } = await seedQueue();
		let resolveEligibility: ((response: Response) => void) | undefined;
		const pendingEligibility = new Promise<Response>((resolve) => {
			resolveEligibility = resolve;
		});
		const fetchMock = mockGraph(
			pendingEligibility,
			new Response(JSON.stringify({ result: "success" }), { status: 200 }),
		);
		const enabling = enableCallQueue(ctx.env, workspaceId, queueId, "owner");
		for (let attempt = 0; attempt < 20 && fetchMock.mock.calls.length === 0; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await disableCallQueue(ctx.env, workspaceId, queueId, "owner");
		resolveEligibility?.(
			new Response(
				JSON.stringify({
					data: [{ feature: "messenger_api_calling", status: "ENABLED" }],
				}),
				{ status: 200 },
			),
		);
		await expect(enabling).rejects.toThrow(/cancelled|disabled/i);

		const queue = await ctx.db
			.select()
			.from(callQueues)
			.where(eq(callQueues.id, queueId))
			.get();
		expect(queue?.isEnabled).toBe(false);
		expect(queue?.provisioningLeaseToken).toBeNull();
	});

	test("missing webhook confirmation blocks Graph calls and leaves the queue disabled", async () => {
		const { workspaceId, queueId } = await seedQueue();
		await ctx.db.update(metaApps).set({ webhookSubscriptionConfirmedAt: null }).where(eq(metaApps.id, "meta-app-1")).run();
		const fetchMock = mockGraph();
		await expect(enableCallQueue(ctx.env, workspaceId, queueId, "owner")).rejects.toThrow(/confirm.*calls/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await ctx.db.select().from(callQueues).where(eq(callQueues.id, queueId)).get())?.isEnabled).toBe(false);
	});

	test("disables locally without claiming external teardown", async () => {
		const { workspaceId, queueId } = await seedQueue();
		mockGraph(
			new Response(
				JSON.stringify({
					data: [{ feature: "messenger_api_calling", status: "ENABLED" }],
				}),
				{ status: 200 },
			),
			new Response(JSON.stringify({ result: "success" }), { status: 200 }),
		);
		await enableCallQueue(ctx.env, workspaceId, queueId, "owner");
		await disableCallQueue(ctx.env, workspaceId, queueId, "owner");
		expect(
			(
				await ctx.db
					.select()
					.from(callQueues)
					.where(eq(callQueues.id, queueId))
					.get()
			)?.isEnabled,
		).toBe(false);
	});
});
