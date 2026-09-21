import { Hono } from "hono";
import type { Context } from "hono";
import PostalMime from "postal-mime";
import { and, eq } from "drizzle-orm";
import type {
	ApiResponse,
	ChannelConnectRequest,
	ChannelSummary,
	ConversationEvent,
	ConversationTagRequest,
	ConversationUpdateRequest,
	ConversationUpdateResponse,
	InboxChannelRequest,
	InboxReorderRequest,
	MarkReadRequest,
	MessagesResponse,
	SavedFilterCreateRequest,
	SendMessageRequest,
	SendMessageResult,
	SetDefaultInboxRequest,
	SidebarPreferencesUpdate,
	UserSummary,
} from "@msgflow/contracts";
import { createAuth } from "@msgflow/auth";
import { drizzle } from "drizzle-orm/d1";
import {
	channels,
	conversationReads,
	conversationTags,
	conversations,
	inboxes,
	user,
} from "@msgflow/db";
import {
	normalizeEmailMessage,
	normalizeFacebookWebhook,
	type ParsedEmail,
} from "@msgflow/channel";
import { ConversationDO } from "./conversation-do";
import type { Env } from "./env";
import { routeInbound } from "./ingest";
import {
	ManageError,
	addInboxMember,
	archiveInbox,
	createCannedReply,
	createInbox,
	createRule,
	createTag,
	deleteCannedReply,
	deleteInbox,
	deleteRule,
	deleteTag,
	joinInbox,
	leaveInbox,
	linkChannelToInbox,
	listCannedReplies,
	listInboxes,
	listRules,
	listTags,
	listTeams,
	removeInboxMember,
	reorderInboxes,
	setDefaultInbox,
	unlinkChannelFromInbox,
	updateCannedReply,
	updateInbox,
	updateRule,
	updateTag,
} from "./manage";
import {
	createSavedFilter,
	deleteSavedFilter,
	getSidebar,
	listWorkspacesForUser,
	updateSidebarPreferences,
} from "./workspace-api";
import { getOrCreateWorkspace } from "./workspace";
import { scheduleOutbound, sendOutbound } from "./outbound";
import { getConversation, listConversations } from "./queries";
import { handleScheduled } from "./scheduled";
import { verifyFacebookSignature } from "./webhook";

export { ConversationDO };

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("MsgFlow API"));

app.get("/health", (c) =>
	c.json<ApiResponse>({ message: "ok", success: true }),
);

// Better Auth (email + password), mounted at the default basePath /api/auth.
app.on(["GET", "POST"], "/api/auth/*", (c) => {
	return createAuth(c.env).handler(c.req.raw);
});

// Send a reply (or schedule one): authenticated, channel dispatch in outbound.ts.
app.post("/api/conversations/:id/messages", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) {
		return c.json({ success: false, error: "unauthorized" }, 401);
	}

	const body = (await c.req
		.json()
		.catch(() => null)) as SendMessageRequest | null;
	if (!body || typeof body.text !== "string" || !body.text.trim()) {
		return c.json({ success: false, error: "text is required" }, 400);
	}

	const conversationId = c.req.param("id");
	const text = body.text.trim();

	if (body.sendAt) {
		const sendAt = new Date(body.sendAt);
		if (Number.isNaN(sendAt.getTime())) {
			return c.json({ success: false, error: "invalid sendAt" }, 400);
		}
		// Future sendAt → schedule; past/now → send immediately.
		if (sendAt.getTime() > Date.now()) {
			const scheduledAt = await scheduleOutbound(c.env, {
				conversationId,
				text,
				subject: body.subject,
				senderId: session.user.id,
				clientMessageId: body.clientMessageId,
				sendAt: sendAt.toISOString(),
			});
			return c.json({
				success: true,
				sent: false,
				scheduledAt,
			} satisfies SendMessageResult);
		}
	}

	const result = await sendOutbound(c.env, {
		conversationId,
		text,
		subject: body.subject,
		senderId: session.user.id,
		clientMessageId: body.clientMessageId,
	});
	if (!result.ok) {
		return c.json({ success: false, error: result.error }, 502);
	}
	return c.json({
		success: true,
		sent: true,
		message: result.message,
	} satisfies SendMessageResult);
});

// GET /api/conversations — inbox list (D1 read; ADR 0015 unread counts).
// Facets (ADR 0013): status, inboxId, q (free text), assigneeId, channel,
// tagId, dateFrom/dateTo (on lastMessageAt).
app.get("/api/conversations", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const statusParam = c.req.query("status") ?? "open";
	const inboxId = c.req.query("inboxId") ?? undefined;
	const conversations = await listConversations(c.env, session.user.id, {
		status:
			statusParam === "archived" || statusParam === "all"
				? statusParam
				: "open",
		inboxId,
		q: c.req.query("q") ?? undefined,
		assigneeId: c.req.query("assigneeId") ?? undefined,
		unassigned: c.req.query("unassigned") === "true" || undefined,
		snoozed: c.req.query("snoozed") === "true" || undefined,
		channel:
			c.req.query("channel") === "facebook" ||
			c.req.query("channel") === "email"
				? (c.req.query("channel") as "facebook" | "email")
				: undefined,
		tagId: c.req.query("tagId") ?? undefined,
		dateFrom: c.req.query("dateFrom") ?? undefined,
		dateTo: c.req.query("dateTo") ?? undefined,
	});
	return c.json({ conversations });
});

// GET /api/conversations/:id — single conversation (metadata + contact).
app.get("/api/conversations/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const conversation = await getConversation(
		c.env,
		session.user.id,
		c.req.param("id"),
	);
	if (!conversation) {
		return c.json({ success: false, error: "not found" }, 404);
	}
	return c.json(conversation);
});

// GET /api/conversations/:id/messages — full timeline from the Conversation DO.
app.get("/api/conversations/:id/messages", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const conversationId = c.req.param("id");
	const stub = c.env.CONVERSATION_DO.get(
		c.env.CONVERSATION_DO.idFromName(conversationId),
	);
	const res = await stub.fetch("https://do/messages");
	if (!res.ok) {
		return c.json({ success: false, error: "timeline unavailable" }, 502);
	}
	return c.json((await res.json()) as MessagesResponse);
});

// POST /api/conversations/:id/read — advance the agent's read cursor (ADR 0015).
app.post("/api/conversations/:id/read", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const body = (await c.req.json().catch(() => null)) as MarkReadRequest | null;
	if (!body || !Number.isInteger(body.lastReadSeq) || body.lastReadSeq < 0) {
		return c.json({ success: false, error: "invalid lastReadSeq" }, 400);
	}

	await drizzle(c.env.DB)
		.insert(conversationReads)
		.values({
			conversationId: c.req.param("id"),
			agentId: session.user.id,
			lastReadSeq: body.lastReadSeq,
		})
		.onConflictDoUpdate({
			target: [conversationReads.conversationId, conversationReads.agentId],
			set: { lastReadSeq: body.lastReadSeq },
		})
		.run();
	return c.json({ success: true });
});

// GET /api/users — agents for assignee pickers. Single-tenant bootstrap: all
// registered users (workspace RBAC enforcement is a later phase).
app.get("/api/users", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const users = await drizzle(c.env.DB)
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.all();
	return c.json({ users } satisfies { users: UserSummary[] });
});

// PATCH /api/conversations/:id — update metadata (status, assignee, snooze).
// D1 write first, then relay a conversation-updated broadcast through the DO
// (ADR 0004) so open threads update in real time.
app.patch("/api/conversations/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const id = c.req.param("id");
	const current = await getConversation(c.env, session.user.id, id);
	if (!current) {
		return c.json({ success: false, error: "not found" }, 404);
	}

	const body = (await c.req
		.json()
		.catch(() => null)) as ConversationUpdateRequest | null;
	if (!body) return c.json({ success: false, error: "invalid body" }, 400);

	const patch: Record<string, unknown> = {};
	if (body.status !== undefined) {
		if (body.status !== "open" && body.status !== "archived") {
			return c.json({ success: false, error: "invalid status" }, 400);
		}
		patch.status = body.status;
	}
	if (body.assigneeId !== undefined) {
		// string (assign) or null (unassign); existence is not validated here.
		patch.assigneeId = body.assigneeId;
	}
	if (body.snoozedUntil !== undefined) {
		if (
			body.snoozedUntil !== null &&
			Number.isNaN(new Date(body.snoozedUntil).getTime())
		) {
			return c.json({ success: false, error: "invalid snoozedUntil" }, 400);
		}
		patch.snoozedUntil = body.snoozedUntil;
	}
	if (body.inboxId !== undefined) {
		// Validate the target inbox exists (ADR 0008: conversations never leave
		// the inbox system; the FK is NOT NULL).
		const target = await drizzle(c.env.DB)
			.select({ id: inboxes.id })
			.from(inboxes)
			.where(eq(inboxes.id, body.inboxId))
			.get();
		if (!target) {
			return c.json({ success: false, error: "inbox not found" }, 400);
		}
		patch.inboxId = body.inboxId;
	}
	if (Object.keys(patch).length === 0) {
		return c.json({ success: false, error: "nothing to update" }, 400);
	}

	const updatedAt = new Date().toISOString();
	const set: Partial<typeof conversations.$inferInsert> = { updatedAt };
	if (patch.status !== undefined)
		set.status = patch.status as "open" | "archived";
	if (patch.assigneeId !== undefined)
		set.assigneeId = patch.assigneeId as string | null;
	if (patch.snoozedUntil !== undefined)
		set.snoozedUntil = patch.snoozedUntil as string | null;
	if (patch.inboxId !== undefined) set.inboxId = patch.inboxId as string;

	await drizzle(c.env.DB)
		.update(conversations)
		.set(set)
		.where(eq(conversations.id, id))
		.run();

	// Best-effort relay to connected agents; the D1 write already succeeded.
	await broadcastUpdate(c.env, id, { ...patch, updatedAt });

	const conversation = await getConversation(c.env, session.user.id, id);
	if (!conversation) {
		return c.json({ success: false, error: "not found" }, 404);
	}
	return c.json({
		success: true,
		conversation,
	} satisfies ConversationUpdateResponse);
});

// GET /api/channels — channel instances with connection state. Access tokens
// never leave the Worker; clients only see hasToken.
app.get("/api/channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const rows = await drizzle(c.env.DB)
		.select({
			id: channels.id,
			type: channels.type,
			displayName: channels.displayName,
			externalId: channels.externalId,
			status: channels.status,
			accessToken: channels.accessToken,
			tokenExpiresAt: channels.tokenExpiresAt,
			createdAt: channels.createdAt,
			updatedAt: channels.updatedAt,
		})
		.from(channels)
		.all();

	return c.json({
		channels: rows.map((row) => ({
			id: row.id,
			type: row.type,
			displayName: row.displayName,
			externalId: row.externalId,
			status: row.status,
			hasToken: row.accessToken !== null,
			tokenExpiresAt: row.tokenExpiresAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		})) satisfies ChannelSummary[],
	});
});

// POST /api/channels/:id/token — store a Page access token (dev-mode connect;
// the production flow will be a Meta OAuth callback that lands here).
app.post("/api/channels/:id/token", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const body = (await c.req
		.json()
		.catch(() => null)) as ChannelConnectRequest | null;
	if (
		!body ||
		typeof body.accessToken !== "string" ||
		!body.accessToken.trim()
	) {
		return c.json({ success: false, error: "accessToken is required" }, 400);
	}

	const id = c.req.param("id");
	const updated = await drizzle(c.env.DB)
		.update(channels)
		.set({
			accessToken: body.accessToken.trim(),
			status: "active",
			updatedAt: new Date().toISOString(),
		})
		.where(and(eq(channels.id, id), eq(channels.type, "facebook_page")))
		.returning({ id: channels.id })
		.get();
	if (!updated) {
		return c.json({ success: false, error: "not found" }, 404);
	}
	return c.json({ success: true });
});

// POST /api/channels/:id/disconnect — clear credentials; outbound stops.
app.post("/api/channels/:id/disconnect", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	const id = c.req.param("id");
	const updated = await drizzle(c.env.DB)
		.update(channels)
		.set({
			accessToken: null,
			refreshToken: null,
			tokenExpiresAt: null,
			status: "disconnected",
			updatedAt: new Date().toISOString(),
		})
		.where(eq(channels.id, id))
		.returning({ id: channels.id })
		.get();
	if (!updated) {
		return c.json({ success: false, error: "not found" }, 404);
	}
	return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// INBOXES (ADR 0008 + routing spec): shared queues. Legacy /api/inboxes*
// routes resolve the lazy default workspace and enforce the same admin/
// membership rules as the workspace-scoped routes below (the first caller
// bootstraps as owner, so single-tenant demos keep working).
// ---------------------------------------------------------------------------

async function defaultWorkspaceId(env: Env): Promise<string> {
	const db = drizzle(env.DB);
	const workspace = await getOrCreateWorkspace(db, new Date().toISOString());
	return workspace.id;
}

app.get("/api/inboxes", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		return c.json({
			inboxes: await listInboxes(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/inboxes", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const inbox = await createInbox(
			c.env,
			workspaceId,
			await c.req.json(),
			session.user.id,
		);
		return c.json({ inbox }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/inboxes/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const inbox = await updateInbox(
			c.env,
			workspaceId,
			c.req.param("id"),
			await c.req.json(),
			session.user.id,
		);
		return c.json({ inbox });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/inboxes/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		await deleteInbox(c.env, workspaceId, c.req.param("id"), session.user.id);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Link a channel to an inbox; isDefault demotes the channel's other defaults.
app.post("/api/inboxes/:id/channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const body = (await c.req.json()) as InboxChannelRequest;
		await linkChannelToInbox(
			c.env,
			workspaceId,
			c.req.param("id"),
			body,
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/inboxes/:id/channels/:channelId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		await unlinkChannelFromInbox(
			c.env,
			workspaceId,
			c.req.param("id"),
			c.req.param("channelId"),
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Agent membership: join shares the queue with the agent; leave un-shares.
// With {userId} in the body, admin member management (drawer) adds/removes
// another workspace member instead of the session user.
app.post("/api/inboxes/:id/members", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const body = (await c.req.json().catch(() => null)) as {
			userId?: string;
		} | null;
		if (body?.userId) {
			await addInboxMember(
				c.env,
				workspaceId,
				c.req.param("id"),
				body.userId,
				session.user.id,
			);
		} else {
			await joinInbox(c.env, workspaceId, c.req.param("id"), session.user.id);
		}
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/inboxes/:id/members", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const body = (await c.req.json().catch(() => null)) as {
			userId?: string;
		} | null;
		if (body?.userId) {
			await removeInboxMember(
				c.env,
				workspaceId,
				c.req.param("id"),
				body.userId,
				session.user.id,
			);
		} else {
			await leaveInbox(c.env, workspaceId, c.req.param("id"), session.user.id);
		}
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// ---------------------------------------------------------------------------
// WORKSPACE-SCOPED INBOX ROUTING + SIDEBAR (the Front-style surface)
// Every route validates the session user belongs to the workspace; config
// mutations additionally require owner/admin. Path workspaceIds are never
// trusted alone — every inner query re-checks workspace scoping.
// ---------------------------------------------------------------------------

// GET /api/workspaces — workspaces the session user belongs to (switcher).
app.get("/api/workspaces", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			workspaces: await listWorkspacesForUser(c.env, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/workspaces/:workspaceId/sidebar — shaped sidebar data (sections,
// inbox metadata, counts, permissions, effective preferences, stable ids).
app.get("/api/workspaces/:workspaceId/sidebar", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json(
			await getSidebar(c.env, c.req.param("workspaceId"), session.user.id),
		);
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/workspaces/:workspaceId/inboxes
app.get("/api/workspaces/:workspaceId/inboxes", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			inboxes: await listInboxes(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/workspaces/:workspaceId/inboxes — create (admin).
app.post("/api/workspaces/:workspaceId/inboxes", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const inbox = await createInbox(
			c.env,
			c.req.param("workspaceId"),
			await c.req.json(),
			session.user.id,
		);
		return c.json({ inbox }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

// PATCH /api/workspaces/:workspaceId/inboxes/:inboxId — edit (admin).
app.patch("/api/workspaces/:workspaceId/inboxes/:inboxId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const inbox = await updateInbox(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("inboxId"),
			await c.req.json(),
			session.user.id,
		);
		return c.json({ inbox });
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/workspaces/:workspaceId/inboxes/:inboxId/archive (admin;
// rejected when the inbox is a channel's only default).
app.post("/api/workspaces/:workspaceId/inboxes/:inboxId/archive", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const inbox = await archiveInbox(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("inboxId"),
			session.user.id,
		);
		return c.json({ inbox });
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/workspaces/:workspaceId/inboxes/:inboxId/channels — link (admin).
app.post(
	"/api/workspaces/:workspaceId/inboxes/:inboxId/channels",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			const body = (await c.req.json()) as InboxChannelRequest;
			await linkChannelToInbox(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("inboxId"),
				body,
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

// DELETE /api/workspaces/:workspaceId/inboxes/:inboxId/channels/:channelId
app.delete(
	"/api/workspaces/:workspaceId/inboxes/:inboxId/channels/:channelId",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			await unlinkChannelFromInbox(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("inboxId"),
				c.req.param("channelId"),
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

// POST /api/workspaces/:workspaceId/channels/:channelId/default-inbox —
// atomic default replacement (admin).
app.post(
	"/api/workspaces/:workspaceId/channels/:channelId/default-inbox",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			const body = (await c.req.json()) as SetDefaultInboxRequest;
			if (!body || typeof body.inboxId !== "string") {
				return c.json({ success: false, error: "inboxId is required" }, 400);
			}
			await setDefaultInbox(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("channelId"),
				body.inboxId,
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

// PATCH /api/workspaces/:workspaceId/inboxes/reorder — shared admin ordering.
app.patch("/api/workspaces/:workspaceId/inboxes/reorder", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const body = (await c.req.json()) as InboxReorderRequest;
		await reorderInboxes(
			c.env,
			c.req.param("workspaceId"),
			body.inboxIds,
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// PATCH /api/workspaces/:workspaceId/sidebar-preferences — personal UI state.
app.patch("/api/workspaces/:workspaceId/sidebar-preferences", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const body = (await c.req.json()) as SidebarPreferencesUpdate;
		const preferences = await updateSidebarPreferences(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			body,
		);
		return c.json({ preferences });
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/workspaces/:workspaceId/teams — team options for the drawer.
app.get("/api/workspaces/:workspaceId/teams", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			teams: await listTeams(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

// Views (saved filters): POST create, DELETE remove.
app.post("/api/workspaces/:workspaceId/views", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const body = (await c.req.json()) as SavedFilterCreateRequest;
		const view = await createSavedFilter(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			body,
		);
		return c.json({ view }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/workspaces/:workspaceId/views/:viewId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await deleteSavedFilter(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("viewId"),
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// ---------------------------------------------------------------------------
// TAGS (ADR 0010): workspace-level labels; tagging a conversation is a D1
// write + DO relay broadcast (conversation-updated pattern from ADR 0004).
// ---------------------------------------------------------------------------

app.get("/api/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({ tags: await listTags(c.env) });
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const tag = await createTag(c.env, await c.req.json(), session.user.id);
		return c.json({ tag }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const tag = await updateTag(c.env, c.req.param("id"), await c.req.json());
		return c.json({ tag });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await deleteTag(c.env, c.req.param("id"));
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Attach a tag to a conversation (D1 write + broadcast so open threads and
// the list update in real time).
app.post("/api/conversations/:id/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const id = c.req.param("id");
	const conversation = await getConversation(c.env, session.user.id, id);
	if (!conversation) return c.json({ success: false, error: "not found" }, 404);

	const body = (await c.req
		.json()
		.catch(() => null)) as ConversationTagRequest | null;
	if (!body || typeof body.tagId !== "string" || !body.tagId) {
		return c.json({ success: false, error: "tagId is required" }, 400);
	}
	await drizzle(c.env.DB)
		.insert(conversationTags)
		.values({
			id: crypto.randomUUID(),
			conversationId: id,
			tagId: body.tagId,
			createdBy: session.user.id,
			createdAt: new Date().toISOString(),
		})
		.onConflictDoNothing()
		.run();
	await broadcastUpdate(c.env, id);
	return c.json({ success: true });
});

// Remove a tag from a conversation.
app.delete("/api/conversations/:id/tags/:tagId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const id = c.req.param("id");
	const conversation = await getConversation(c.env, session.user.id, id);
	if (!conversation) return c.json({ success: false, error: "not found" }, 404);

	await drizzle(c.env.DB)
		.delete(conversationTags)
		.where(
			and(
				eq(conversationTags.conversationId, id),
				eq(conversationTags.tagId, c.req.param("tagId")),
			),
		)
		.run();
	await broadcastUpdate(c.env, id);
	return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// RULES (ADR 0009): management CRUD. Evaluation runs in ingest (rules.ts).
// ---------------------------------------------------------------------------

app.get("/api/rules", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		return c.json({
			rules: await listRules(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/rules", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const rule = await createRule(
			c.env,
			workspaceId,
			await c.req.json(),
			session.user.id,
		);
		return c.json({ rule }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/rules/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		const rule = await updateRule(
			c.env,
			workspaceId,
			c.req.param("id"),
			await c.req.json(),
			session.user.id,
		);
		return c.json({ rule });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/rules/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = await defaultWorkspaceId(c.env);
		await deleteRule(c.env, workspaceId, c.req.param("id"), session.user.id);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// ---------------------------------------------------------------------------
// CANNED REPLIES (used by the rule action 'send_canned_reply')
// ---------------------------------------------------------------------------

app.get("/api/canned-replies", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({ cannedReplies: await listCannedReplies(c.env) });
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/canned-replies", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const reply = await createCannedReply(c.env, await c.req.json());
		return c.json({ cannedReply: reply }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/canned-replies/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const reply = await updateCannedReply(
			c.env,
			c.req.param("id"),
			await c.req.json(),
		);
		return c.json({ cannedReply: reply });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/canned-replies/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await deleteCannedReply(c.env, c.req.param("id"));
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Meta webhook verification handshake (GET).
app.get("/webhooks/messenger", (c) => {
	const verifyToken = c.req.query("hub.verify_token");
	const challenge = c.req.query("hub.challenge");
	if (verifyToken === c.env.MESSENGER_VERIFY_TOKEN && challenge) {
		return c.text(challenge);
	}
	return c.text("forbidden", 403);
});

// Meta webhook events (POST): verify signature → normalize → route to the DO.
app.post("/webhooks/messenger", async (c) => {
	const rawBody = await c.req.text();
	const signature = c.req.header("X-Hub-Signature-256");
	const ok = await verifyFacebookSignature(
		rawBody,
		signature,
		c.env.MESSENGER_APP_SECRET,
	);
	if (!ok) {
		return c.text("invalid signature", 403);
	}

	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return c.text("invalid json", 400);
	}

	const inbound = normalizeFacebookWebhook(body);
	for (const message of inbound) {
		await routeInbound(c.env, message);
	}
	// Always 200 so Meta doesn't retry; dedup happens in the DO.
	return c.json({ status: "received" });
});

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ws") {
			return handleWebSocket(request, env);
		}
		return app.fetch(request, env, ctx);
	},

	async email(
		message: ForwardableEmailMessage,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		const parsed = await parseEmailMessage(message);
		if (!parsed) return;
		const inbound = normalizeEmailMessage(parsed);
		if (inbound) {
			await routeInbound(env, inbound);
		}
	},

	// Send-later: fires every minute, delivers due scheduled_messages rows.
	async scheduled(
		_controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		await handleScheduled(env);
	},
};

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const conversationId = url.searchParams.get("conversationId");
	if (!conversationId) {
		return new Response("missing conversationId", { status: 400 });
	}

	// Authenticate: the Worker validates the session; the DO trusts it (ADR 0006).
	const session = await createAuth(env).api.getSession({
		headers: request.headers,
	});
	if (!session) {
		return new Response("unauthorized", { status: 401 });
	}
	const agentId = session.user.id;

	const id = env.CONVERSATION_DO.idFromName(conversationId);
	const stub = env.CONVERSATION_DO.get(id);

	const headers = new Headers(request.headers);
	headers.set("x-agent-id", agentId);
	const upgraded = new Request(request.url, { method: "GET", headers });
	return stub.fetch(upgraded);
}

async function getSession(c: Context<{ Bindings: Env }>) {
	return createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
}

function unauthorized(c: Context<{ Bindings: Env }>) {
	return c.json({ success: false, error: "unauthorized" }, 401);
}

/** Map a ManageError (validation/not-found) to a JSON error response. */
function manageError(c: Context<{ Bindings: Env }>, err: unknown) {
	if (err instanceof ManageError) {
		return c.json(
			{ success: false, error: err.message },
			err.status as 400 | 404,
		);
	}
	if (err instanceof SyntaxError) {
		return c.json({ success: false, error: "invalid json body" }, 400);
	}
	console.error("management endpoint error:", err);
	return c.json({ success: false, error: "internal error" }, 500);
}

/**
 * Relay a conversation-updated broadcast through the DO so open threads and
 * the inbox list update in real time (ADR 0004). Best-effort: the D1 write
 * already succeeded; a dead DO just means clients refetch on their poll.
 */
async function broadcastUpdate(
	env: Env,
	conversationId: string,
	patch: Record<string, unknown> = {},
): Promise<void> {
	const stub = env.CONVERSATION_DO.get(
		env.CONVERSATION_DO.idFromName(conversationId),
	);
	await stub
		.fetch("https://do/broadcast", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: "conversation-updated",
				patch,
			} satisfies ConversationEvent),
		})
		.catch(() => {});
}

async function parseEmailMessage(
	message: ForwardableEmailMessage,
): Promise<ParsedEmail | null> {
	const raw = await new Response(message.raw).text();
	const email = await new PostalMime().parse(raw);

	let receivedAt = new Date().toISOString();
	if (email.date) {
		const parsed = new Date(email.date);
		if (!Number.isNaN(parsed.getTime())) receivedAt = parsed.toISOString();
	}

	return {
		from: email.from?.address ?? "",
		to: message.to,
		subject: email.subject ?? "",
		messageId: email.messageId ?? null,
		inReplyTo: email.inReplyTo ?? null,
		references: email.references
			? email.references.split(/\s+/).filter(Boolean)
			: null,
		text: email.text ?? "",
		mailbox: message.to,
		receivedAt,
	};
}

export { app };
