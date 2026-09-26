import { Hono } from "hono";
import { Either, Schema } from "effect";
import type { Context } from "hono";

import { and, desc, eq, inArray } from "drizzle-orm";
import type {
	ApiResponse,
	Attachment,
	Comment,
	CommentNotificationsResponse,
	ConversationEvent,
	ConversationUpdateResponse,
	CreateCommentResponse,
	SavedFilterCreateRequest,
	SendMessageResult,
	SidebarPreferencesUpdate,
	TimelineResponse,
	UserSummary,
} from "@msgflow/contracts";
import {
	EmailDomainCreateRequestSchema,
	EmailDomainStateUpdateRequestSchema,
	FacebookChannelCreateRequestSchema,
	OwnerSetupRequestSchema,
	MailboxDelegateRequestSchema,
	MailboxStateUpdateRequestSchema,
	MetaAppCreateRequestSchema,
	MetaOAuthStartRequestSchema,
	PrivateMailboxCreateRequestSchema,
	SharedMailboxCreateRequestSchema,
	ChannelConnectRequestSchema,
	ConversationTagRequestSchema,
	ConversationUpdateRequestSchema,
	CreateCommentRequestSchema,
	CannedReplyWriteRequestSchema,
	InboxCreateRequestSchema,
	InboxChannelRequestSchema,
	InboxMemberRequestSchema,
	InboxReorderRequestSchema,
	InboxUpdateRequestSchema,
	MarkReadRequestSchema,
	MessengerWebhookEnvelopeSchema,
	RuleWriteRequestSchema,
	SavedFilterCreateRequestSchema,
	SendMessageRequestSchema,
	SetDefaultInboxRequestSchema,
	SidebarPreferencesUpdateSchema,
	TagCreateRequestSchema,
	TagUpdateRequestSchema,
} from "@msgflow/contracts";
import { createAuth } from "@msgflow/auth";
import { drizzle } from "drizzle-orm/d1";
import {
	channels,
	conversationReads,
	commentNotifications,
	conversationTags,
	conversations,
	inboxes,
	metaApps,
	tags,
	user,
	workspaceMembers,
} from "@msgflow/db";
import { normalizeFacebookWebhook } from "@msgflow/channel";
import { ConversationDO } from "./conversation-do";
import type { Env } from "./env";
import { routeInbound } from "./ingest";

import {
	ManageError,
	addInboxMember,
	archiveInbox,
	connectChannelToken,
	createFacebookChannel,
	createCannedReply,
	createInbox,
	createRule,
	createTag,
	disconnectChannel,
	deleteCannedReply,
	deleteInbox,
	deleteRule,
	deleteTag,
	joinInbox,
	leaveInbox,
	linkChannelToInbox,
	listCannedReplies,
	listChannels,
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
import {
	addPrivateMailboxDelegate,
	createEmailDomain,
	createPrivateMailbox,
	createSharedMailbox,
	listEmailDomains,
	listMailboxes,
	removePrivateMailboxDelegate,
	type MailboxStateUpdateInput,
	updateEmailDomainState,
	updateMailboxState,
} from "./mailboxes";
import { getConfiguredWorkspace } from "./workspace";
import { createMetaApp, listMetaApps } from "./meta-apps";
import {
	completeMetaOAuth,
	connectAuthorizedPage,
	listAuthorizedPages,
	startMetaOAuth,
} from "./meta-oauth";
import { scheduleOutbound, sendOutbound } from "./outbound";
import { getConversation, listConversations } from "./queries";
import { handleScheduled } from "./scheduled";
import { verifyFacebookSignatureForSecrets } from "./webhook";
import { decryptChannelToken } from "./channel-token-crypto";
import { requireDefaultWorkspaceAccess } from "./access";
import { appendActivity } from "./activity";
import {
	AttachmentError,
	MAX_ATTACHMENTS_PER_MESSAGE,
	storeImageBlob,
	validateAttachments,
} from "./attachments";
import { decodeJsonBody } from "./validation";
import { OwnerSetupError, setupInitialOwner } from "./setup";
import { isInitialSetupComplete } from "./setup-state";
import {
	canReadConversation,
	filterReadableNotifications,
} from "./conversation-permissions";
import {
	readEmailDraft,
	saveEmailDraft,
	deleteEmailDraft,
} from "./email-drafts";
import { handleInboundEmail } from "./email-ingress";
import { emailApi, validatePrivateEmailAttachments } from "./email-api";
import { onboardingApi } from "./onboarding-api";

export { ConversationDO };

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", async (c, next) => {
	c.header("Cache-Control", "private, no-store");
	// The first-use owner flow is the only public application route before the
	// durable setup claim completes. An empty deployment is never a tenant.
	if (
		c.req.path !== "/api/setup/owner" &&
		!(await isInitialSetupComplete(c.env))
	) {
		return c.json({ success: false, error: "MsgFlow setup is required" }, 503);
	}
	await next();
});

app.get("/", (c) => c.text("MsgFlow API"));

app.get("/health", (c) =>
	c.json<ApiResponse>({ message: "ok", success: true }),
);

// Better Auth (email + password), mounted at the default basePath /api/auth.
app.on(["GET", "POST"], "/api/auth/*", (c) => {
	return createAuth(c.env).handler(c.req.raw);
});
app.route("/api", onboardingApi);

// The sole first-use account-creation path. Better Auth's generic public sign-up
// remains disabled; this route wins a durable D1 claim before using its server API.
app.post("/api/setup/owner", async (c) => {
	const decoded = await decodeJsonBody(c.req.raw, OwnerSetupRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		const setup = await setupInitialOwner(c.env, decoded.value);
		return c.json({ success: true, setup }, 201);
	} catch (err) {
		if (err instanceof OwnerSetupError) {
			return c.json({ success: false, error: err.message }, err.status);
		}
		console.error("initial owner setup error:", err);
		return c.json({ success: false, error: "internal error" }, 500);
	}
});

app.on(["GET", "PUT", "DELETE"], "/api/conversations/:id/draft", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const id = c.req.param("id");
		if (c.req.method === "GET")
			return c.json({
				draft: await readEmailDraft(c.env, workspaceId, id, session.user.id),
			});
		if (c.req.method === "DELETE") {
			const expected = c.req.query("clientMessageId");
			if (!expected)
				return c.json(
					{ success: false, error: "submitted draft identifier required" },
					400,
				);
			await deleteEmailDraft(c.env, workspaceId, id, session.user.id, expected);
			return c.json({ success: true });
		}
		const decoded = await decodeJsonBody(c.req.raw, SendMessageRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		return c.json({
			draft: await saveEmailDraft(
				c.env,
				workspaceId,
				id,
				session.user.id,
				decoded.value,
			),
		});
	} catch (error) {
		return manageError(c, error);
	}
});

// Send a reply (or schedule one): authenticated, channel dispatch in outbound.ts.
app.post("/api/attachments", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		// This is intentionally Worker-mediated: browsers never receive R2 keys.
		await requireDefaultWorkspaceAccess(drizzle(c.env.DB), session.user.id);
		const form = await c.req.formData();
		const files = form.getAll("files");
		if (
			files.length === 0 ||
			files.length > MAX_ATTACHMENTS_PER_MESSAGE ||
			files.some((file) => !(file instanceof File))
		) {
			return c.json(
				{
					success: false,
					error: `provide 1-${MAX_ATTACHMENTS_PER_MESSAGE} image files`,
				},
				400,
			);
		}
		const attachments = await Promise.all(
			files.map((file) => {
				if (!(file instanceof File)) throw new AttachmentError("invalid file");
				return storeImageBlob(c.env, file, file.name);
			}),
		);
		return c.json({ attachments }, 201);
	} catch (err) {
		if (err instanceof AttachmentError)
			return c.json({ success: false, error: err.message }, 400);
		return manageError(c, err);
	}
});

app.post("/api/conversations/:id/messages", async (c) => {
	const session = await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});
	if (!session) {
		return c.json({ success: false, error: "unauthorized" }, 401);
	}

	const decoded = await decodeJsonBody(c.req.raw, SendMessageRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	const body = decoded.value;
	let attachments: Attachment[] = [];
	let isEmail = false;
	const conversationId = c.req.param("id");
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const conversation = await getConversation(
			c.env,
			session.user.id,
			conversationId,
			workspaceId,
		);
		if (!conversation) {
			return c.json({ success: false, error: "not found" }, 404);
		}
		attachments =
			conversation.channel === "email"
				? await validatePrivateEmailAttachments(
						c.env,
						workspaceId,
						conversationId,
						session.user.id,
						body.attachments ?? [],
					)
				: validateAttachments(c.env, body.attachments ?? []);
		isEmail = conversation.channel === "email";
	} catch (err) {
		return manageError(c, err);
	}
	if (!body.text.trim() && attachments.length === 0)
		return c.json(
			{ success: false, error: "text or an attachment is required" },
			400,
		);
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
				attachments,
				senderId: session.user.id,
				clientMessageId: body.clientMessageId,
				sendAt: sendAt.toISOString(),
				mailboxId: body.mailboxId,
				confirmPrivateIdentity: body.confirmPrivateIdentity,
			});
			return c.json({
				success: true,
				sent: false,
				scheduledAt,
			} satisfies SendMessageResult);
		}
	}

	const result = await sendOutbound(
		c.env,
		{
			conversationId,
			text,
			subject: body.subject,
			attachments,
			senderId: session.user.id,
			clientMessageId: body.clientMessageId,
			mailboxId: body.mailboxId,
			confirmPrivateIdentity: body.confirmPrivateIdentity,
		},
		{ retryDefinitiveFailure: true },
	);

	if (!result.ok) {
		return c.json({ success: false, error: result.error }, 502);
	}
	return c.json({
		success: true,
		sent: true,
		...(isEmail ? { deliveryState: "accepted" as const } : {}),
		message: result.message,
	} satisfies SendMessageResult);
});

// GET /api/conversations — inbox list (D1 read; ADR 0015 unread counts).
// Facets (ADR 0013): status, inboxId, q (free text), assigneeId, channel,
// tagId, dateFrom/dateTo (on lastMessageAt).
app.get("/api/conversations", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const statusParam = c.req.query("status") ?? "open";
		const inboxId = c.req.query("inboxId") ?? undefined;
		const conversations = await listConversations(
			c.env,
			session.user.id,
			{
				status:
					statusParam === "archived" || statusParam === "all"
						? statusParam
						: "open",
				inboxId,
				q: c.req.query("q") ?? undefined,
				mailboxId: c.req.query("mailboxId") ?? undefined,
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
			},
			workspaceId,
		);
		return c.json({ conversations });
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/conversations/:id — single conversation (metadata + contact).
app.get("/api/conversations/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const conversation = await getConversation(
			c.env,
			session.user.id,
			c.req.param("id"),
			workspaceId,
		);
		if (!conversation) {
			return c.json({ success: false, error: "not found" }, 404);
		}
		return c.json(conversation);
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/conversations/:id/messages — full timeline from the Conversation DO.
// The established path stays intact for the web client while its response now
// includes team-only comments and system Activities alongside messages.
app.get("/api/conversations/:id/messages", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const conversationId = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			conversationId,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);
		const stub = c.env.CONVERSATION_DO.get(
			c.env.CONVERSATION_DO.idFromName(conversationId),
		);
		const [messagesRes, commentsRes, activitiesRes] = await Promise.all([
			stub.fetch("https://do/messages"),
			stub.fetch("https://do/comments"),
			stub.fetch("https://do/activities?limit=50"),
		]);
		if (!messagesRes.ok || !commentsRes.ok || !activitiesRes.ok) {
			return c.json({ success: false, error: "timeline unavailable" }, 502);
		}
		const [{ messages }, { comments }, { activities }] = await Promise.all([
			messagesRes.json() as Promise<{ messages: TimelineResponse["messages"] }>,
			commentsRes.json() as Promise<{ comments: TimelineResponse["comments"] }>,
			activitiesRes.json() as Promise<{
				activities: TimelineResponse["activities"];
			}>,
		]);
		return c.json({
			messages,
			comments,
			activities,
		} satisfies TimelineResponse);
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/conversations/:id/comments — authenticated internal note. The
// Worker authorizes the conversation before resolving its globally derivable DO.
app.post("/api/conversations/:id/comments", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const db = drizzle(c.env.DB);
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			db,
			session.user.id,
		);
		const conversationId = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			conversationId,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);

		const decoded = await decodeJsonBody(c.req.raw, CreateCommentRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		const mentions = [...new Set(body.mentions ?? [])].filter(
			(mention) => mention !== session.user.id,
		);

		if (mentions.length > 0) {
			const members = await db
				.select({ userId: workspaceMembers.userId })
				.from(workspaceMembers)
				.where(
					and(
						eq(workspaceMembers.workspaceId, workspaceId),
						inArray(workspaceMembers.userId, mentions),
					),
				)
				.all();
			if (members.length !== mentions.length) {
				return c.json(
					{ success: false, error: "mentions must be workspace teammates" },
					400,
				);
			}
			for (const recipientId of mentions) {
				if (
					!(await canReadConversation(
						c.env,
						recipientId,
						conversationId,
						workspaceId,
					))
				) {
					return c.json(
						{
							success: false,
							error: "mention recipients must have conversation access",
						},
						403,
					);
				}
			}
		}

		const comment: Comment = {
			id: crypto.randomUUID(),
			conversationId,
			authorId: session.user.id,
			text: body.text.trim(),
			mentions,
			createdAt: new Date().toISOString(),
		};
		const stub = c.env.CONVERSATION_DO.get(
			c.env.CONVERSATION_DO.idFromName(conversationId),
		);
		const res = await stub.fetch("https://do/append-comment", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(comment),
		});
		if (!res.ok) {
			return c.json({ success: false, error: "timeline unavailable" }, 502);
		}
		if (mentions.length > 0) {
			await db
				.insert(commentNotifications)
				.values(
					mentions.map((userId) => ({
						id: crypto.randomUUID(),
						workspaceId,
						userId,
						conversationId,
						commentId: comment.id,
						authorId: session.user.id,
						commentText: comment.text,
						createdAt: comment.createdAt,
					})),
				)
				.onConflictDoNothing()
				.run();
		}
		return c.json({ comment } satisfies CreateCommentResponse, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/comment-notifications — personal mention inbox, bounded for the sidebar.
app.get("/api/comment-notifications", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const db = drizzle(c.env.DB);
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			db,
			session.user.id,
		);
		const rows = await db
			.select()
			.from(commentNotifications)
			.where(
				and(
					eq(commentNotifications.userId, session.user.id),
					eq(commentNotifications.workspaceId, workspaceId),
				),
			)
			.orderBy(desc(commentNotifications.createdAt))
			.limit(200)
			.all();
		const notifications = (
			await filterReadableNotifications(
				c.env,
				session.user.id,
				workspaceId,
				rows,
			)
		).slice(0, 50);
		return c.json({
			notifications,
			unreadCount: notifications.filter((row) => !row.readAt).length,
		} satisfies CommentNotificationsResponse);
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/comment-notifications/:id/read", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const db = drizzle(c.env.DB);
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			db,
			session.user.id,
		);
		const notification = await db
			.select()
			.from(commentNotifications)
			.where(
				and(
					eq(commentNotifications.id, c.req.param("id")),
					eq(commentNotifications.userId, session.user.id),
					eq(commentNotifications.workspaceId, workspaceId),
				),
			)
			.get();
		if (
			!notification ||
			!(await canReadConversation(
				c.env,
				session.user.id,
				notification.conversationId,
				workspaceId,
			))
		) {
			return c.json({ success: false, error: "not found" }, 404);
		}
		await db
			.update(commentNotifications)
			.set({ readAt: new Date().toISOString() })
			.where(
				and(
					eq(commentNotifications.id, notification.id),
					eq(commentNotifications.userId, session.user.id),
					eq(commentNotifications.workspaceId, workspaceId),
				),
			)
			.run();
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/conversations/:id/read — advance the agent's read cursor (ADR 0015).
app.post("/api/conversations/:id/read", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const conversationId = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			conversationId,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);

		const decoded = await decodeJsonBody(c.req.raw, MarkReadRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;

		await drizzle(c.env.DB)
			.insert(conversationReads)
			.values({
				conversationId,
				agentId: session.user.id,
				lastReadSeq: body.lastReadSeq,
			})
			.onConflictDoUpdate({
				target: [conversationReads.conversationId, conversationReads.agentId],
				set: { lastReadSeq: body.lastReadSeq },
			})
			.run();
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/users — workspace agents for assignee pickers.
app.get("/api/users", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const db = drizzle(c.env.DB);
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			db,
			session.user.id,
		);
		const users = await db
			.select({ id: user.id, name: user.name, email: user.email })
			.from(workspaceMembers)
			.innerJoin(user, eq(workspaceMembers.userId, user.id))
			.where(eq(workspaceMembers.workspaceId, workspaceId))
			.all();
		return c.json({ users } satisfies { users: UserSummary[] });
	} catch (err) {
		return manageError(c, err);
	}
});

// PATCH /api/conversations/:id — update metadata (status, assignee, snooze).
// D1 write first, then relay a conversation-updated broadcast through the DO
// (ADR 0004) so open threads update in real time.
app.patch("/api/conversations/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const id = c.req.param("id");
		const current = await getConversation(
			c.env,
			session.user.id,
			id,
			workspaceId,
		);
		if (!current) {
			return c.json({ success: false, error: "not found" }, 404);
		}

		const decoded = await decodeJsonBody(
			c.req.raw,
			ConversationUpdateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;

		const patch: Record<string, unknown> = {};
		if (body.status !== undefined) {
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
			// Conversations can only move to an inbox in their authorized workspace.
			const target = await drizzle(c.env.DB)
				.select({ id: inboxes.id })
				.from(inboxes)
				.where(
					and(
						eq(inboxes.id, body.inboxId),
						eq(inboxes.workspaceId, workspaceId),
					),
				)
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

		const changes: Record<string, { from: unknown; to: unknown }> = {};
		if (patch.status !== undefined && patch.status !== current.status) {
			changes.status = { from: current.status, to: patch.status };
		}
		if (
			patch.assigneeId !== undefined &&
			patch.assigneeId !== current.assigneeId
		) {
			changes.assigneeId = { from: current.assigneeId, to: patch.assigneeId };
		}
		if (
			patch.snoozedUntil !== undefined &&
			patch.snoozedUntil !== current.snoozedUntil
		) {
			changes.snoozedUntil = {
				from: current.snoozedUntil,
				to: patch.snoozedUntil,
			};
		}
		if (patch.inboxId !== undefined && patch.inboxId !== current.inboxId) {
			changes.inboxId = { from: current.inboxId, to: patch.inboxId };
		}

		await drizzle(c.env.DB)
			.update(conversations)
			.set(set)
			.where(
				and(
					eq(conversations.id, id),
					eq(conversations.workspaceId, workspaceId),
				),
			)
			.run();

		// Best-effort relay to connected agents; the D1 write already succeeded.
		await broadcastUpdate(c.env, id, { ...patch, updatedAt });
		if (Object.keys(changes).length > 0) {
			await appendActivity(c.env, {
				conversationId: id,
				action: "conversation.updated",
				actorId: session.user.id,
				details: { changes },
			});
		}

		const conversation = await getConversation(
			c.env,
			session.user.id,
			id,
			workspaceId,
		);
		if (!conversation) {
			return c.json({ success: false, error: "not found" }, 404);
		}
		return c.json({
			success: true,
			conversation,
		} satisfies ConversationUpdateResponse);
	} catch (err) {
		return manageError(c, err);
	}
});

// GET /api/channels — channel instances with connection state. Access tokens
// never leave the Worker; clients only see hasToken.
app.get("/api/channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		return c.json({
			channels: await listChannels(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/facebook-channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(
		c.req.raw,
		FacebookChannelCreateRequestSchema,
	);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json(
			{
				channel: await createFacebookChannel(
					c.env,
					c.req.param("workspaceId"),
					decoded.value,
					session.user.id,
				),
			},
			201,
		);
	} catch (err) {
		return manageError(c, err);
	}
});

app.get("/api/workspaces/:workspaceId/meta-apps", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			metaApps: await listMetaApps(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/meta-apps", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, MetaAppCreateRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json(
			{
				metaApp: await createMetaApp(
					c.env,
					c.req.param("workspaceId"),
					decoded.value,
					session.user.id,
				),
			},
			201,
		);
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/meta-oauth/start", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, MetaOAuthStartRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json(
			await startMetaOAuth(
				c.env,
				c.req.param("workspaceId"),
				decoded.value.metaAppId,
				decoded.value.inboxId,
				session.user.id,
				new URL(c.req.url).origin,
			),
		);
	} catch (err) {
		return manageError(c, err);
	}
});

app.get("/api/meta-oauth/:sessionId/pages", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const pages = await listAuthorizedPages(
			c.env,
			c.req.param("sessionId"),
			session.user.id,
		);
		return c.json({ pages: pages.map(({ id, name }) => ({ id, name })) });
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/meta-oauth/:sessionId/pages/:pageId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json(
			{
				channel: await connectAuthorizedPage(
					c.env,
					c.req.param("sessionId"),
					c.req.param("pageId"),
					session.user.id,
				),
			},
			201,
		);
	} catch (err) {
		return manageError(c, err);
	}
});

// Meta redirects through its origin, so callback authorization is bound to the
// opaque, expiring state row rather than a browser session cookie.
app.get("/api/meta-oauth/callback", async (c) => {
	const state = c.req.query("state");
	const code = c.req.query("code");
	if (!state || !code) return c.text("Facebook authorization failed", 400);
	try {
		const { callbackOrigin, sessionId } = await completeMetaOAuth(
			c.env,
			state,
			code,
		);
		return c.redirect(
			`${callbackOrigin}/setup/channel?metaOauthSession=${encodeURIComponent(sessionId)}`,
		);
	} catch {
		return c.text("Facebook authorization failed", 400);
	}
});

// POST /api/channels/:id/token — store a Page access token (dev-mode connect;
// the production flow will be a Meta OAuth callback that lands here).
app.post("/api/channels/:id/token", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const decoded = await decodeJsonBody(
			c.req.raw,
			ChannelConnectRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		await connectChannelToken(
			c.env,
			workspaceId,
			c.req.param("id"),
			decoded.value.accessToken,
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// POST /api/channels/:id/disconnect — clear credentials; outbound stops.
app.post("/api/channels/:id/disconnect", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		await disconnectChannel(
			c.env,
			workspaceId,
			c.req.param("id"),
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// ---------------------------------------------------------------------------
// INBOXES (ADR 0008 + routing spec): shared queues. Legacy /api/inboxes*
// routes resolve the lazy default workspace and enforce the same admin/
// membership rules as the workspace-scoped routes below (the first caller
// bootstraps as owner, so single-tenant demos keep working).
// ---------------------------------------------------------------------------

async function defaultWorkspaceId(env: Env): Promise<string> {
	const db = drizzle(env.DB);
	const workspace = await getConfiguredWorkspace(db);
	return workspace.id;
}

/**
 * A Messenger delivery identifies its Page in `entry[].id`. Resolve only the
 * Meta App secrets attached to those active Page Channels before verifying the
 * HMAC; a secret belonging to an unrelated App must never authenticate it.
 */
async function verifyMessengerSignature(
	env: Env,
	rawBody: string,
	signature: string | null | undefined,
): Promise<boolean> {
	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return false;
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		(payload as { object?: unknown }).object !== "page" ||
		!Array.isArray((payload as { entry?: unknown }).entry)
	) {
		return false;
	}
	const pageIds = [
		...new Set(
			(payload as { entry: unknown[] }).entry.flatMap((entry) =>
				entry &&
				typeof entry === "object" &&
				typeof (entry as { id?: unknown }).id === "string"
					? [(entry as { id: string }).id]
					: [],
			),
		),
	];
	if (pageIds.length === 0) return false;

	const db = drizzle(env.DB);
	const matches = await db
		.select({ pageId: channels.externalId, appSecret: metaApps.appSecret })
		.from(channels)
		.innerJoin(metaApps, eq(channels.metaAppId, metaApps.id))
		.where(
			and(
				eq(channels.type, "facebook_page"),
				eq(channels.status, "active"),
				inArray(channels.externalId, pageIds),
			),
		)
		.all();
	if (new Set(matches.map((match) => match.pageId)).size !== pageIds.length) {
		return false;
	}

	const secrets = await Promise.all(
		[...new Set(matches.map((match) => match.appSecret))].map(
			async (ciphertext) => {
				try {
					return await decryptChannelToken(
						ciphertext,
						env.CHANNEL_TOKEN_ENCRYPTION_KEY,
					);
				} catch {
					return null;
				}
			},
		),
	);
	const usableSecrets = secrets.filter(
		(secret): secret is string => secret !== null,
	);
	return verifyFacebookSignatureForSecrets(rawBody, signature, usableSecrets);
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
		const decoded = await decodeJsonBody(c.req.raw, InboxCreateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const inbox = await createInbox(
			c.env,
			workspaceId,
			decoded.value,
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
		const decoded = await decodeJsonBody(c.req.raw, InboxUpdateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const inbox = await updateInbox(
			c.env,
			workspaceId,
			c.req.param("id"),
			decoded.value,
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
		const decoded = await decodeJsonBody(c.req.raw, InboxChannelRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		await linkChannelToInbox(
			c.env,
			workspaceId,
			c.req.param("id"),
			decoded.value,
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
		const decoded = await decodeJsonBody(c.req.raw, InboxMemberRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		if (body.userId) {
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
		const decoded = await decodeJsonBody(c.req.raw, InboxMemberRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		if (body.userId) {
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

// ---------------------------------------------------------------------------
// EMAIL DOMAINS AND MAILBOXES: workspace-scoped configuration. Authorization
// is enforced by the service; routes only derive actor/workspace from session.
// ---------------------------------------------------------------------------
app.get("/api/workspaces/:workspaceId/email-domains", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			emailDomains: await listEmailDomains(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/email-domains", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const decoded = await decodeJsonBody(
			c.req.raw,
			EmailDomainCreateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const emailDomain = await createEmailDomain(
			c.env,
			c.req.param("workspaceId"),
			decoded.value,
			session.user.id,
		);
		return c.json({ emailDomain }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch(
	"/api/workspaces/:workspaceId/email-domains/:domainId/state",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			const decoded = await decodeJsonBody(
				c.req.raw,
				EmailDomainStateUpdateRequestSchema,
			);
			if (!decoded.ok)
				return c.json({ success: false, error: decoded.error }, 400);
			const emailDomain = await updateEmailDomainState(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("domainId"),
				decoded.value,
				session.user.id,
			);
			return c.json({ emailDomain });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

app.get("/api/workspaces/:workspaceId/mailboxes", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			mailboxes: await listMailboxes(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/mailboxes/private", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const decoded = await decodeJsonBody(
			c.req.raw,
			PrivateMailboxCreateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const mailbox = await createPrivateMailbox(
			c.env,
			c.req.param("workspaceId"),
			decoded.value,
			session.user.id,
		);
		return c.json({ mailbox }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/mailboxes/shared", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const decoded = await decodeJsonBody(
			c.req.raw,
			SharedMailboxCreateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const mailbox = await createSharedMailbox(
			c.env,
			c.req.param("workspaceId"),
			decoded.value,
			session.user.id,
		);
		return c.json({ mailbox }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch(
	"/api/workspaces/:workspaceId/mailboxes/:mailboxId/state",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			const decoded = await decodeJsonBody(
				c.req.raw,
				MailboxStateUpdateRequestSchema,
			);
			if (!decoded.ok)
				return c.json({ success: false, error: decoded.error }, 400);
			const mailbox = await updateMailboxState(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("mailboxId"),
				decoded.value as MailboxStateUpdateInput,
				session.user.id,
			);
			return c.json({ mailbox });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

app.post(
	"/api/workspaces/:workspaceId/mailboxes/:mailboxId/delegates",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			const decoded = await decodeJsonBody(
				c.req.raw,
				MailboxDelegateRequestSchema,
			);
			if (!decoded.ok)
				return c.json({ success: false, error: decoded.error }, 400);
			await addPrivateMailboxDelegate(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("mailboxId"),
				decoded.value,
				session.user.id,
			);
			return c.json({ success: true }, 201);
		} catch (err) {
			return manageError(c, err);
		}
	},
);

app.delete(
	"/api/workspaces/:workspaceId/mailboxes/:mailboxId/delegates/:userId",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			await removePrivateMailboxDelegate(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("mailboxId"),
				c.req.param("userId"),
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

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
		const decoded = await decodeJsonBody(c.req.raw, InboxCreateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const inbox = await createInbox(
			c.env,
			c.req.param("workspaceId"),
			decoded.value,
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
		const decoded = await decodeJsonBody(c.req.raw, InboxUpdateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const inbox = await updateInbox(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("inboxId"),
			decoded.value,
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
			const decoded = await decodeJsonBody(
				c.req.raw,
				InboxChannelRequestSchema,
			);
			if (!decoded.ok)
				return c.json({ success: false, error: decoded.error }, 400);
			await linkChannelToInbox(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("inboxId"),
				decoded.value,
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
			const decoded = await decodeJsonBody(
				c.req.raw,
				SetDefaultInboxRequestSchema,
			);
			if (!decoded.ok)
				return c.json({ success: false, error: decoded.error }, 400);
			await setDefaultInbox(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("channelId"),
				decoded.value.inboxId,
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
		const decoded = await decodeJsonBody(c.req.raw, InboxReorderRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		await reorderInboxes(
			c.env,
			c.req.param("workspaceId"),
			[...decoded.value.inboxIds],
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
		const decoded = await decodeJsonBody(
			c.req.raw,
			SidebarPreferencesUpdateSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const preferences = await updateSidebarPreferences(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			decoded.value as SidebarPreferencesUpdate,
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
		const decoded = await decodeJsonBody(
			c.req.raw,
			SavedFilterCreateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const view = await createSavedFilter(
			c.env,
			c.req.param("workspaceId"),
			session.user.id,
			decoded.value as SavedFilterCreateRequest,
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
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		return c.json({
			tags: await listTags(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const decoded = await decodeJsonBody(c.req.raw, TagCreateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const tag = await createTag(
			c.env,
			workspaceId,
			decoded.value,
			session.user.id,
		);
		return c.json({ tag }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const decoded = await decodeJsonBody(c.req.raw, TagUpdateRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const tag = await updateTag(
			c.env,
			workspaceId,
			c.req.param("id"),
			decoded.value,
			session.user.id,
		);
		return c.json({ tag });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		await deleteTag(c.env, workspaceId, c.req.param("id"), session.user.id);
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
	try {
		const access = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const { workspaceId } = access;
		const id = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			id,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);

		const decoded = await decodeJsonBody(
			c.req.raw,
			ConversationTagRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		const tag = await drizzle(c.env.DB)
			.select({
				id: tags.id,
				visibility: tags.visibility,
				ownerUserId: tags.ownerUserId,
			})
			.from(tags)
			.where(and(eq(tags.id, body.tagId), eq(tags.workspaceId, workspaceId)))
			.get();
		if (
			!tag ||
			(!access.isAdmin &&
				tag.visibility === "private" &&
				tag.ownerUserId !== session.user.id)
		) {
			return c.json({ success: false, error: "tag not found" }, 404);
		}

		const tagInsert = await drizzle(c.env.DB)
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
		if ((tagInsert.meta.changes ?? 0) > 0) {
			await appendActivity(c.env, {
				conversationId: id,
				action: "tag.added",
				actorId: session.user.id,
				details: { tagId: body.tagId },
			});
		}
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Remove a tag from a conversation.
app.delete("/api/conversations/:id/tags/:tagId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const access = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const { workspaceId } = access;
		const id = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			id,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);

		const tagId = c.req.param("tagId");
		const tag = await drizzle(c.env.DB)
			.select({ visibility: tags.visibility, ownerUserId: tags.ownerUserId })
			.from(tags)
			.where(and(eq(tags.id, tagId), eq(tags.workspaceId, workspaceId)))
			.get();
		if (
			!tag ||
			(!access.isAdmin &&
				tag.visibility === "private" &&
				tag.ownerUserId !== session.user.id)
		) {
			return c.json({ success: false, error: "tag not found" }, 404);
		}
		const tagDelete = await drizzle(c.env.DB)
			.delete(conversationTags)
			.where(
				and(
					eq(conversationTags.conversationId, id),
					eq(conversationTags.tagId, tagId),
				),
			)
			.run();
		await broadcastUpdate(c.env, id);
		if ((tagDelete.meta.changes ?? 0) > 0) {
			await appendActivity(c.env, {
				conversationId: id,
				action: "tag.removed",
				actorId: session.user.id,
				details: { tagId },
			});
		}
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
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
		const decoded = await decodeJsonBody(c.req.raw, RuleWriteRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = {
			...decoded.value,
			conditions: decoded.value.conditions.map((condition) => ({
				...condition,
			})),
			actions: decoded.value.actions.map((action) => ({ ...action })),
		};
		const rule = await createRule(c.env, workspaceId, body, session.user.id);
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
		const decoded = await decodeJsonBody(c.req.raw, RuleWriteRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = {
			...decoded.value,
			conditions: decoded.value.conditions.map((condition) => ({
				...condition,
			})),
			actions: decoded.value.actions.map((action) => ({ ...action })),
		};
		const rule = await updateRule(
			c.env,
			workspaceId,
			c.req.param("id"),
			body,
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
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		return c.json({
			cannedReplies: await listCannedReplies(
				c.env,
				workspaceId,
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/canned-replies", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const decoded = await decodeJsonBody(
			c.req.raw,
			CannedReplyWriteRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const reply = await createCannedReply(
			c.env,
			workspaceId,
			decoded.value,
			session.user.id,
		);
		return c.json({ cannedReply: reply }, 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.patch("/api/canned-replies/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		const decoded = await decodeJsonBody(
			c.req.raw,
			CannedReplyWriteRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const reply = await updateCannedReply(
			c.env,
			workspaceId,
			c.req.param("id"),
			decoded.value,
			session.user.id,
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
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(c.env.DB),
			session.user.id,
		);
		await deleteCannedReply(
			c.env,
			workspaceId,
			c.req.param("id"),
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// Meta webhook verification handshake (GET).
app.get("/webhooks/messenger", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const verifyToken = c.req.query("hub.verify_token");
	const challenge = c.req.query("hub.challenge");
	if (verifyToken === c.env.MESSENGER_VERIFY_TOKEN && challenge) {
		return c.text(challenge);
	}
	return c.text("forbidden", 403);
});

// Meta webhook events (POST): verify signature → normalize → route to the DO.
app.post("/webhooks/messenger", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const rawBody = await c.req.text();
	const signature = c.req.header("X-Hub-Signature-256");
	const ok = await verifyMessengerSignature(c.env, rawBody, signature);
	if (!ok) {
		return c.text("invalid signature", 403);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(rawBody);
	} catch {
		return c.text("invalid json", 400);
	}
	const decoded = Schema.decodeUnknownEither(MessengerWebhookEnvelopeSchema)(
		raw,
	);
	if (Either.isLeft(decoded)) return c.text("invalid json", 400);

	const inbound = normalizeFacebookWebhook(decoded.right);
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
		if (!(await isInitialSetupComplete(env))) {
			message.setReject("MsgFlow setup is required");
			return;
		}
		await handleInboundEmail(env, message);
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
	// Authorize D1 workspace/mailbox ownership before resolving the globally
	// derivable Durable Object name.
	try {
		const { workspaceId } = await requireDefaultWorkspaceAccess(
			drizzle(env.DB),
			agentId,
		);
		if (!(await getConversation(env, agentId, conversationId, workspaceId))) {
			return new Response("not found", { status: 404 });
		}
	} catch (error) {
		if (error instanceof ManageError)
			return new Response("forbidden", { status: 403 });
		throw error;
	}

	const id = env.CONVERSATION_DO.idFromName(conversationId);
	const stub = env.CONVERSATION_DO.get(id);

	const headers = new Headers(request.headers);
	headers.set("x-agent-id", agentId);
	headers.set("x-conversation-id", conversationId);
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

app.route("/api", emailApi);

export { app };
