// biome-ignore assist/source/organizeImports: preserve the existing route-domain import grouping.
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
	WhatsAppChannelCreateRequestSchema,
	WhatsAppChannelUpdateRequestSchema,
	OwnerSetupRequestSchema,
	MailboxDelegateRequestSchema,
	MailboxStateUpdateRequestSchema,
	MetaAppCreateRequestSchema,
	MetaAppUpdateRequestSchema,
	MetaOAuthStartRequestSchema,
	PrivateMailboxCreateRequestSchema,
	SharedMailboxCreateRequestSchema,
	ChannelConnectRequestSchema,
	ConversationTagRequestSchema,
	ConversationUpdateRequestSchema,
	CreateCommentRequestSchema,
	EmailDraftRequestSchema,
	CannedReplyWriteRequestSchema,
	InboxCreateRequestSchema,
	InboxChannelRequestSchema,
	InboxReorderRequestSchema,
	InboxTreeMoveRequestSchema,
	InboxUpdateRequestSchema,
	MarkReadRequestSchema,
	RuleWriteRequestSchema,
	SavedFilterCreateRequestSchema,
	SendMessageRequestSchema,
	SetDefaultInboxRequestSchema,
	SidebarPreferencesUpdateSchema,
	TagCreateRequestSchema,
	TagUpdateRequestSchema,
	WhatsAppWebhookEnvelopeSchema,
	CallAcceptRequestSchema,
	CallRejectRequestSchema,
	CallTerminateRequestSchema,
	CallMetricsRequestSchema,
	ComposeEmailRequestSchema,
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
import {
	normalizeFacebookWebhook,
	normalizeFacebookCallingWebhook,
	normalizeWhatsAppWebhook,
} from "@msgflow/channel";
import { ConversationDO } from "./conversation-do";
import { CallDispatchDO, callDispatchInternalHeaders } from "./call-dispatch-do";
import { CallSessionDO } from "./call-session-do";
import type { Env } from "./env";
import { routeInbound } from "./ingest";
import { routeInboundFacebookCall } from "./calling-service";

import {
	ManageError,
	archiveInbox,
	connectChannelToken,
	createFacebookChannel,
	createWhatsAppChannel,
	createCannedReply,
	createInbox,
	createRule,
	createTag,
	disconnectChannel,
	deleteFacebookChannel,
	deleteWhatsAppChannel,
	deleteCannedReply,
	deleteRule,
	deleteTag,
	linkChannelToInbox,
	listCannedReplies,
	listChannels,
	listInboxes,
	listRules,
	listTags,
	listTeams,
	reorderInboxes,
	setDefaultInbox,
	unlinkChannelFromInbox,
	updateCannedReply,
	updateWhatsAppChannel,
	updateInbox,
	updateRule,
	updateTag,
} from "./manage";
import {
	createSavedFilter,
	deleteSavedFilter,
	getSidebar,
	resolveSavedViewFilters,
	updateSidebarPreferences,
} from "./workspace-api";
import {
	addPrivateMailboxDelegate,
	createEmailDomain,
	createPrivateMailbox,
	createSharedMailbox,
	deleteEmailDomain,
	listEmailDomains,
	listMailboxes,
	removePrivateMailboxDelegate,
	type MailboxStateUpdateInput,
	updateEmailDomainState,
	updateMailboxState,
} from "./mailboxes";
import {
	confirmMetaAppWebhookSubscription,
	hashWebhookVerifyToken,
	createMetaApp,
	deleteMetaApp,
	listMetaApps,
	recreateMetaAppWebhookToken,
	updateMetaApp,
} from "./meta-apps";
import {
	completeMetaOAuth,
	connectAuthorizedPage,
	listAuthorizedPages,
	startMetaOAuth,
} from "./meta-oauth";
import { scheduleOutbound, sendOutbound } from "./outbound";
import { composeEmail } from "./email-compose";
import { getConversation, listConversations } from "./queries";
import { getReadableInboxIds } from "./inbox-tree";
import { handleInboxTreeMove } from "./inbox-tree-route";
import { handleScheduled } from "./scheduled";
import { verifyFacebookSignatureForSecrets } from "./webhook";
import { decryptChannelToken } from "./channel-token-crypto";
import { requireWorkspaceAccess } from "./access";
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
import { firstSignInWalkthroughApi } from "./first-sign-in-walkthrough-api";
import { workspaceApi } from "./workspace-api-route";
import { teamApi } from "./team-api";
import {
	CallQueueWriteSchema,
	RingGroupWriteSchema,
	createCallQueue,
	createRingGroup,
	deleteCallQueue,
	deleteRingGroup,
	disableCallQueue,
	enableCallQueue,
	listCallQueues,
	listRingGroups,
	updateCallQueue,
	updateRingGroup,
} from "./calling-config";

export { ConversationDO, CallDispatchDO, CallSessionDO };

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
app.route("/api", firstSignInWalkthroughApi);
app.route("/api", workspaceApi);
app.route("/api", teamApi);

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
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
		const decoded = await decodeJsonBody(c.req.raw, EmailDraftRequestSchema);
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
		const form = await c.req.formData();
		const workspaceId = form.get("workspaceId");
		if (typeof workspaceId !== "string" || !workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
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
		const { workspaceId } = body;
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
				humanAgent: false,
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
			humanAgent: true,
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

// POST /api/workspaces/:workspaceId/email/compose — create and send a new email.
app.post("/api/workspaces/:workspaceId/email/compose", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const workspaceId = c.req.param("workspaceId");
	const decoded = await decodeJsonBody(c.req.raw, ComposeEmailRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		const result = await composeEmail(c.env, {
			...decoded.value,
			workspaceId,
			actorId: session.user.id,
		});
		if (!result.ok) return c.json({ success: false, error: result.error }, 502);
		return c.json(
			{
				success: true,
				conversationId: result.conversationId,
				message: result.message,
			},
			201,
		);
	} catch (error) {
		return manageError(c, error);
	}
});

// GET /api/conversations — inbox list (D1 read; ADR 0015 unread counts).
// Facets (ADR 0013): status, inboxId, q (free text), assigneeId, channel,
// tagId, dateFrom/dateTo (on lastMessageAt).
app.get("/api/conversations", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		const statusParam = c.req.query("status") ?? "open";
		const inboxId = c.req.query("inboxId") ?? undefined;
		const savedViewId = c.req.query("savedViewId") ?? undefined;
		const savedViewFilters = savedViewId
			? await resolveSavedViewFilters(
					c.env,
					workspaceId,
					session.user.id,
					savedViewId,
				)
			: undefined;
		const conversations = await listConversations(
			c.env,
			session.user.id,
			{
				status: savedViewFilters?.status ??
					(statusParam === "archived" || statusParam === "all"
						? statusParam
						: "open"),
				inboxId: savedViewFilters?.inboxId ?? inboxId,
				inboxScope:
					savedViewFilters?.inboxId
						? "exact"
						:
					c.req.query("inboxScope") === "descendants"
						? "descendants"
						: "exact",
				q: savedViewFilters?.q ?? c.req.query("q") ?? undefined,
				mailboxId: c.req.query("mailboxId") ?? undefined,
				assigneeId: savedViewFilters?.assigneeId ?? c.req.query("assigneeId") ?? undefined,
				unassigned: savedViewFilters?.unassigned ?? (c.req.query("unassigned") === "true" || undefined),
				snoozed: savedViewFilters?.snoozed ?? (c.req.query("snoozed") === "true" || undefined),
				channel:
					savedViewFilters?.channel ??
					((c.req.query("channel") === "facebook" ||
						c.req.query("channel") === "email" ||
						c.req.query("channel") === "whatsapp")
						? (c.req.query("channel") as "facebook" | "email" | "whatsapp")
						: undefined),
				channelId: savedViewFilters?.channelId ?? c.req.query("channelId") ?? undefined,
				tagId: savedViewFilters?.tagId ?? c.req.query("tagId") ?? undefined,
				dateFrom: savedViewFilters?.dateFrom ?? c.req.query("dateFrom") ?? undefined,
				dateTo: savedViewFilters?.dateTo ?? c.req.query("dateTo") ?? undefined,
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
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
		const decoded = await decodeJsonBody(c.req.raw, CreateCommentRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		const { workspaceId } = body;
		await requireWorkspaceAccess(db, workspaceId, session.user.id);
		const conversationId = c.req.param("id");
		const conversation = await getConversation(
			c.env,
			session.user.id,
			conversationId,
			workspaceId,
		);
		if (!conversation)
			return c.json({ success: false, error: "not found" }, 404);

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
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(db, workspaceId, session.user.id);
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
		const workspaceId = c.req.query("workspaceId");
		if (!workspaceId)
			return c.json({ success: false, error: "missing workspaceId" }, 400);
		await requireWorkspaceAccess(db, workspaceId, session.user.id);
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
		const decoded = await decodeJsonBody(c.req.raw, MarkReadRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		const { workspaceId } = body;
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

// GET /api/workspaces/:workspaceId/users — workspace agents for assignee pickers.
app.get("/api/workspaces/:workspaceId/users", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const db = drizzle(c.env.DB);
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(db, workspaceId, session.user.id);
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
		const decoded = await decodeJsonBody(
			c.req.raw,
			ConversationUpdateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		const body = decoded.value;
		const { workspaceId } = body;
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
			// Moving into a hidden inbox would create a conversation the actor can no
			// longer read, so target scope is checked before the metadata write.
			const readableInboxIds = await getReadableInboxIds(
				drizzle(c.env.DB),
				workspaceId,
				session.user.id,
			);
			if (!readableInboxIds.includes(body.inboxId)) {
				return c.json({ success: false, error: "inbox not found" }, 404);
			}
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
				return c.json({ success: false, error: "inbox not found" }, 404);
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

// GET /api/workspaces/:workspaceId/channels — channel instances with connection
// state. Access tokens never leave the Worker; clients only see hasToken.
app.get("/api/workspaces/:workspaceId/channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.post("/api/workspaces/:workspaceId/whatsapp-channels", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		const decoded = await decodeJsonBody(
			c.req.raw,
			WhatsAppChannelCreateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		return c.json(
			{
				channel: await createWhatsAppChannel(
					c.env,
					workspaceId,
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

app.patch("/api/workspaces/:workspaceId/whatsapp-channels/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		const decoded = await decodeJsonBody(
			c.req.raw,
			WhatsAppChannelUpdateRequestSchema,
		);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		return c.json({
			channel: await updateWhatsAppChannel(
				c.env,
				workspaceId,
				c.req.param("id"),
				decoded.value,
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/workspaces/:workspaceId/whatsapp-channels/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		await deleteWhatsAppChannel(
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
		return c.json(await createMetaApp(c.env, c.req.param("workspaceId"), decoded.value, session.user.id), 201);
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/meta-apps/:metaAppId/webhook-token", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json(await recreateMetaAppWebhookToken(c.env, c.req.param("workspaceId"), c.req.param("metaAppId"), session.user.id));
	} catch (err) {
		return manageError(c, err);
	}
});

// This is an explicit Owner attestation, not evidence inferred from an App ID.
app.post(
	"/api/workspaces/:workspaceId/meta-apps/:metaAppId/webhook-subscription-confirmation",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			await confirmMetaAppWebhookSubscription(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("metaAppId"),
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

app.patch("/api/workspaces/:workspaceId/meta-apps/:metaAppId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, MetaAppUpdateRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json({
			metaApp: await updateMetaApp(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("metaAppId"),
				decoded.value,
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/workspaces/:workspaceId/meta-apps/:metaAppId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await deleteMetaApp(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("metaAppId"),
			session.user.id,
		);
		return c.json({ success: true });
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
		const { callbackOrigin, sessionId, workspaceId, inboxId } =
			await completeMetaOAuth(c.env, state, code);
		return c.redirect(
			`${callbackOrigin}/setup/channel?metaOauthSession=${encodeURIComponent(sessionId)}&workspaceId=${encodeURIComponent(workspaceId)}&inboxId=${encodeURIComponent(inboxId)}`,
		);
	} catch {
		return c.text("Facebook authorization failed", 400);
	}
});

// POST /api/workspaces/:workspaceId/channels/:id/token — store a Page access
// token (dev-mode connect; the production flow will be a Meta OAuth callback).
app.post("/api/workspaces/:workspaceId/channels/:id/token", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

// POST /api/workspaces/:workspaceId/channels/:id/disconnect — clear credentials; outbound stops.
app.post("/api/workspaces/:workspaceId/channels/:id/disconnect", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);

	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

// DELETE keeps conversations but removes this Page from active routing/config.
app.delete("/api/workspaces/:workspaceId/channels/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		await deleteFacebookChannel(
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

/**
 * A Messenger delivery identifies its Page in `entry[].id`. Resolve only the
 * Meta App secrets attached to those active Page Channels before verifying the
 * HMAC; a secret belonging to an unrelated App must never authenticate it.
 */
async function verifyMessengerSignature(
	env: Env,
	rawBody: string,
	signature: string | null | undefined,
	metaAppId: string,
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
				eq(channels.metaAppId, metaAppId),
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

/**
 * WhatsApp identifies its receiving phone in each change metadata record. Only
 * active phone channels on the path's Meta App may contribute a signing secret;
 * this rejects mixed/foreign deliveries before any secret is decrypted.
 */
async function verifyWhatsAppSignature(
	env: Env,
	rawBody: string,
	signature: string | null | undefined,
	metaAppId: string,
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
		(payload as { object?: unknown }).object !== "whatsapp_business_account" ||
		!Array.isArray((payload as { entry?: unknown }).entry)
	) {
		return false;
	}
	const phoneNumberIds = [
		...new Set(
			(payload as { entry: unknown[] }).entry.flatMap((entry) =>
				entry && typeof entry === "object" &&
				Array.isArray((entry as { changes?: unknown }).changes)
					? (entry as { changes: unknown[] }).changes.flatMap((change) => {
						const value =
							change && typeof change === "object"
								? (change as { value?: unknown }).value
								: null;
						const metadata =
							value && typeof value === "object"
								? (value as { metadata?: unknown }).metadata
								: null;
						return metadata &&
							typeof metadata === "object" &&
							typeof (metadata as { phone_number_id?: unknown })
								.phone_number_id === "string"
							? [(metadata as { phone_number_id: string }).phone_number_id]
							: [];
					})
					: [],
			),
		),
	];
	if (phoneNumberIds.length === 0) return false;

	const matches = await drizzle(env.DB)
		.select({
			phoneNumberId: channels.externalId,
			appSecret: metaApps.appSecret,
		})
		.from(channels)
		.innerJoin(metaApps, eq(channels.metaAppId, metaApps.id))
		.where(
			and(
				eq(channels.type, "whatsapp_phone"),
				eq(channels.status, "active"),
				eq(channels.metaAppId, metaAppId),
				inArray(channels.externalId, phoneNumberIds),
			),
		)
		.all();
	if (
		new Set(matches.map((match) => match.phoneNumberId)).size !==
		phoneNumberIds.length
	) {
		return false;
	}
	const secrets = await Promise.all(
		[...new Set(matches.map((match) => match.appSecret))].map(async (ciphertext) => {
			try {
				return await decryptChannelToken(
					ciphertext,
					env.CHANNEL_TOKEN_ENCRYPTION_KEY,
				);
			} catch {
				return null;
			}
		}),
	);
	return verifyFacebookSignatureForSecrets(
		rawBody,
		signature,
		secrets.filter((secret): secret is string => secret !== null),
	);
}

// ---------------------------------------------------------------------------
// WORKSPACE-SCOPED INBOX ROUTING + SIDEBAR (the Front-style surface)
// Every route validates the session user belongs to the workspace; config
// mutations additionally require owner/admin. Path workspaceIds are never
// trusted alone — every inner query re-checks workspace scoping.
// ---------------------------------------------------------------------------

// GET /api/workspaces and POST /api/workspaces are mounted from workspaceApi.

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

app.delete("/api/workspaces/:workspaceId/email-domains/:domainId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await deleteEmailDomain(
			c.env,
			c.req.param("workspaceId"),
			c.req.param("domainId"),
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

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
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(drizzle(c.env.DB), workspaceId, session.user.id);
		return c.json({
			inboxes: await listInboxes(
				c.env,
				workspaceId,
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
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			c.req.param("workspaceId"),
			session.user.id,
		);
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
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			c.req.param("workspaceId"),
			session.user.id,
		);
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

// POST /api/workspaces/:workspaceId/inboxes/:inboxId/move — navigation-only
// tree placement. It deliberately does not update conversations, rules, or
// channel defaults.
app.post("/api/workspaces/:workspaceId/inboxes/:inboxId/move", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		const decoded = await decodeJsonBody(c.req.raw, InboxTreeMoveRequestSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		await handleInboxTreeMove(
			c.env,
			workspaceId,
			c.req.param("inboxId"),
			decoded.value,
			session.user.id,
		);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

app.delete("/api/workspaces/:workspaceId/inboxes/:inboxId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			c.req.param("workspaceId"),
			session.user.id,
		);
		return c.json(
			{
				success: false,
				error:
					"inbox deletion is disabled: archive the inbox or explicitly transfer its conversations first",
			},
			409,
		);
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
			await requireWorkspaceAccess(
				drizzle(c.env.DB),
				c.req.param("workspaceId"),
				session.user.id,
			);
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
			await requireWorkspaceAccess(
				drizzle(c.env.DB),
				c.req.param("workspaceId"),
				session.user.id,
			);
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

app.get("/api/workspaces/:workspaceId/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		return c.json({
			tags: await listTags(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.patch("/api/workspaces/:workspaceId/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.delete("/api/workspaces/:workspaceId/tags/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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
app.post("/api/workspaces/:workspaceId/conversations/:id/tags", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const access = await requireWorkspaceAccess(
			drizzle(c.env.DB),
			c.req.param("workspaceId"),
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
app.delete("/api/workspaces/:workspaceId/conversations/:id/tags/:tagId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const access = await requireWorkspaceAccess(
			drizzle(c.env.DB),
			c.req.param("workspaceId"),
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

app.get("/api/workspaces/:workspaceId/rules", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		return c.json({
			rules: await listRules(c.env, workspaceId, session.user.id),
		});
	} catch (err) {
		return manageError(c, err);
	}
});

app.post("/api/workspaces/:workspaceId/rules", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
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

app.patch("/api/workspaces/:workspaceId/rules/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
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

app.delete("/api/workspaces/:workspaceId/rules/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
			session.user.id,
		);
		await deleteRule(c.env, workspaceId, c.req.param("id"), session.user.id);
		return c.json({ success: true });
	} catch (err) {
		return manageError(c, err);
	}
});

// ---------------------------------------------------------------------------
// CANNED REPLIES (used by the rule action 'send_canned_reply')
// ---------------------------------------------------------------------------

app.get("/api/workspaces/:workspaceId/canned-replies", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.post("/api/workspaces/:workspaceId/canned-replies", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.patch("/api/workspaces/:workspaceId/canned-replies/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

app.delete("/api/workspaces/:workspaceId/canned-replies/:id", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		const workspaceId = c.req.param("workspaceId");
		await requireWorkspaceAccess(
			drizzle(c.env.DB),
			workspaceId,
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

// Meta webhook verification is isolated per Meta App. The opaque App id makes
// the GET handshake deterministic; only a SHA-256 token hash is retained in D1.
app.get("/webhooks/messenger/:metaAppId", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const verifyToken = c.req.query("hub.verify_token");
	const challenge = c.req.query("hub.challenge");
	if (!verifyToken || !challenge) return c.text("forbidden", 403);
	const match = await drizzle(c.env.DB)
		.select({ webhookVerifyTokenHash: metaApps.webhookVerifyTokenHash })
		.from(metaApps)
		.where(eq(metaApps.id, c.req.param("metaAppId")))
		.get();
	if (
		match?.webhookVerifyTokenHash ===
		(await hashWebhookVerifyToken(verifyToken))
	) {
		return c.text(challenge);
	}
	return c.text("forbidden", 403);
});

// Meta webhook events (POST): verify signature → normalize → route to the DO.
app.post("/webhooks/messenger/:metaAppId", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const rawBody = await c.req.text();
	const signature = c.req.header("X-Hub-Signature-256");
	const ok = await verifyMessengerSignature(
		c.env,
		rawBody,
		signature,
		c.req.param("metaAppId"),
	);
	if (!ok) {
		return c.text("invalid signature", 403);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(rawBody);
	} catch {
		return c.text("invalid json", 400);
	}
	// Keep the signed provider object intact. Message and call normalizers consume
	// different extensions of the same delivery; decoding a message-only envelope
	// here strips `entry[].calls` before the call normalizer can see it.
	for (const message of normalizeFacebookWebhook(raw)) {
		await routeInbound(c.env, message);
	}
	// Calls have a separate idempotency key and no Message timeline entry.
	for (const call of normalizeFacebookCallingWebhook(raw)) {
		await routeInboundFacebookCall(c.env, c.req.param("metaAppId"), call);
	}
	// Always 200 so Meta doesn't retry; dedup happens in the DO.
	return c.json({ status: "received" });
});

// WhatsApp shares Meta's HMAC format but scopes signing secrets to the active
// receiving phone identities named by this delivery.
app.get("/webhooks/whatsapp/:metaAppId", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const verifyToken = c.req.query("hub.verify_token");
	const challenge = c.req.query("hub.challenge");
	if (!verifyToken || !challenge) return c.text("forbidden", 403);
	const match = await drizzle(c.env.DB)
		.select({ webhookVerifyTokenHash: metaApps.webhookVerifyTokenHash })
		.from(metaApps)
		.where(eq(metaApps.id, c.req.param("metaAppId")))
		.get();
	if (
		match?.webhookVerifyTokenHash ===
		(await hashWebhookVerifyToken(verifyToken))
	) {
		return c.text(challenge);
	}
	// Do not distinguish an unknown App from a bad token.
	return c.text("forbidden", 403);
});

app.post("/webhooks/whatsapp/:metaAppId", async (c) => {
	if (!(await isInitialSetupComplete(c.env)))
		return c.text("setup required", 503);
	const rawBody = await c.req.text();
	let raw: unknown;
	try {
		raw = JSON.parse(rawBody);
	} catch {
		return c.text("invalid json", 400);
	}
	const decoded = Schema.decodeUnknownEither(WhatsAppWebhookEnvelopeSchema)(
		raw,
	);
	if (Either.isLeft(decoded)) return c.text("invalid json", 400);
	const ok = await verifyWhatsAppSignature(
		c.env,
		rawBody,
		c.req.header("X-Hub-Signature-256"),
		c.req.param("metaAppId"),
	);
	if (!ok) return c.text("invalid signature", 403);

	for (const message of normalizeWhatsAppWebhook(decoded.right)) {
		await routeInbound(c.env, message);
	}
	// Status-only updates are authentic but do not produce inbound messages.
	return c.json({ status: "received" });
});

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ws/calling") {
			return handleCallingWebSocket(request, env);
		}
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
	const workspaceId = url.searchParams.get("workspaceId");
	if (!conversationId || !workspaceId) {
		return new Response(
			`missing ${!conversationId ? "conversationId" : "workspaceId"}`,
			{ status: 400 },
		);
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
		await requireWorkspaceAccess(drizzle(env.DB), workspaceId, agentId);
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

async function handleCallingWebSocket(request: Request, env: Env): Promise<Response> {
	const workspaceId = new URL(request.url).searchParams.get("workspaceId");
	if (!workspaceId) return new Response("missing workspaceId", { status: 400 });
	const session = await createAuth(env).api.getSession({ headers: request.headers });
	if (!session) return new Response("unauthorized", { status: 401 });
	try {
		await requireWorkspaceAccess(drizzle(env.DB), workspaceId, session.user.id);
	} catch (error) {
		if (error instanceof ManageError) return new Response("forbidden", { status: 403 });
		throw error;
	}
	const headers = await callDispatchInternalHeaders(env.BETTER_AUTH_SECRET, "GET", "/ws", workspaceId, session.user.id);
	// Identity crosses this boundary only from the verified session, never query
	// parameters or browser-provided user identifiers.
	headers.set("x-authenticated-workspace-id", workspaceId);
	headers.set("x-authenticated-user-id", session.user.id);
	// Preserve the browser upgrade and give the DO its internal route, rather
	// than forwarding the public /ws/calling URL it does not own.
	headers.set("Upgrade", "websocket");
	const dispatchUrl = new URL(request.url);
	dispatchUrl.pathname = "/ws";
	return env.CALL_DISPATCH_DO.get(env.CALL_DISPATCH_DO.idFromName(workspaceId)).fetch(
		new Request(dispatchUrl.toString(), { method: "GET", headers }),
	);
}

app.patch("/api/workspaces/:workspaceId/calling/presence", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	let body: unknown;
	try { body = await c.req.json(); } catch { return c.json({ success: false, error: "invalid json" }, 400); }
	if (!isExactRecord(body, ["status"])) return c.json({ success: false, error: "invalid presence" }, 400);
	const status = typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
	if (status !== "available" && status !== "away") {
		return c.json({ success: false, error: "status must be available or away" }, 400);
	}
	const workspaceId = c.req.param("workspaceId");
	try {
		await requireWorkspaceAccess(drizzle(c.env.DB), workspaceId, session.user.id);
	} catch (error) {
		if (error instanceof ManageError) return c.json({ success: false, error: "forbidden" }, 403);
		throw error;
	}
	const rawBody = JSON.stringify({ status });
	const headers = await callDispatchInternalHeaders(c.env.BETTER_AUTH_SECRET, "PATCH", "/presence", workspaceId, session.user.id, rawBody);
	headers.set("content-type", "application/json");
	headers.set("x-authenticated-workspace-id", workspaceId);
	headers.set("x-authenticated-user-id", session.user.id);
	const response = await c.env.CALL_DISPATCH_DO.get(c.env.CALL_DISPATCH_DO.idFromName(workspaceId)).fetch(
		new Request("https://call-dispatch/presence", { method: "PATCH", headers, body: rawBody }),
	);
	return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
});

// Call commands cross the browser boundary only after session + workspace checks.
// The session DO is authoritative for offered/winner authorization and serializes races.
app.post("/api/workspaces/:workspaceId/calling/calls/:callId/accept", async (c) => {
	const session = await getSession(c); if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallAcceptRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	const result = await forwardCallCommand(c, session.user.id, "accept", { offerSdp: decoded.value.offerSdp });
	return result;
});
app.post("/api/workspaces/:workspaceId/calling/calls/:callId/reject", async (c) => {
	const session = await getSession(c); if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallRejectRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	return forwardCallCommand(c, session.user.id, "reject", { reason: decoded.value.reason });
});
app.post("/api/workspaces/:workspaceId/calling/calls/:callId/terminate", async (c) => {
	const session = await getSession(c); if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallTerminateRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	return forwardCallCommand(c, session.user.id, "terminate", { reason: decoded.value.reason });
});
app.post("/api/workspaces/:workspaceId/calling/calls/:callId/metrics", async (c) => {
	const session = await getSession(c); if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallMetricsRequestSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	return forwardCallCommand(c, session.user.id, "metrics", decoded.value);
});

async function forwardCallCommand(c: Context<{ Bindings: Env }>, actorId: string, action: "accept" | "reject" | "terminate" | "metrics", body: Record<string, unknown>): Promise<Response> {
	const workspaceId = c.req.param("workspaceId");
	const callId = c.req.param("callId");
	try { await requireWorkspaceAccess(drizzle(c.env.DB), workspaceId, actorId); } catch (error) {
		if (error instanceof ManageError) return c.json({ success: false, error: "forbidden" }, 403);
		throw error;
	}
	const owned = await c.env.DB.prepare("SELECT 1 FROM call_events WHERE workspace_id=? AND provider_call_id=? LIMIT 1").bind(workspaceId, callId).first();
	if (!owned) return c.json({ success: false, error: "not found" }, 404);
	const rawBody = JSON.stringify({ ...body, actorId });
	const headers = await callDispatchInternalHeaders(c.env.BETTER_AUTH_SECRET, "POST", `/${action}`, workspaceId, actorId, rawBody);
	headers.set("content-type", "application/json");
	headers.set("x-authenticated-workspace-id", workspaceId);
	headers.set("x-authenticated-user-id", actorId);
	const response = await c.env.CALL_SESSION_DO.get(c.env.CALL_SESSION_DO.idFromName(`facebook-call:${callId}`)).fetch(new Request(`https://call-session/${action}`, { method: "POST", headers, body: rawBody }));
	return new Response(response.body, { status: response.status, headers: { "content-type": "application/json" } });
}

// Facebook Page calling configuration is workspace-admin only. The service owns all
// tenant/resource validation; these routes only authenticate and decode once.
app.get("/api/workspaces/:workspaceId/calling/ring-groups", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			ringGroups: await listRingGroups(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});
app.post("/api/workspaces/:workspaceId/calling/ring-groups", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, RingGroupWriteSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json(
			{
				ringGroup: await createRingGroup(
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
app.patch(
	"/api/workspaces/:workspaceId/calling/ring-groups/:ringGroupId",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		const decoded = await decodeJsonBody(c.req.raw, RingGroupWriteSchema);
		if (!decoded.ok)
			return c.json({ success: false, error: decoded.error }, 400);
		try {
			return c.json({
				ringGroup: await updateRingGroup(
					c.env,
					c.req.param("workspaceId"),
					c.req.param("ringGroupId"),
					decoded.value,
					session.user.id,
				),
			});
		} catch (err) {
			return manageError(c, err);
		}
	},
);
app.delete(
	"/api/workspaces/:workspaceId/calling/ring-groups/:ringGroupId",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			await deleteRingGroup(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("ringGroupId"),
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);
app.get("/api/workspaces/:workspaceId/calling/queues", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	try {
		return c.json({
			queues: await listCallQueues(
				c.env,
				c.req.param("workspaceId"),
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});
app.post("/api/workspaces/:workspaceId/calling/queues", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallQueueWriteSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json(
			{
				queue: await createCallQueue(
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
app.patch("/api/workspaces/:workspaceId/calling/queues/:queueId", async (c) => {
	const session = await getSession(c);
	if (!session) return unauthorized(c);
	const decoded = await decodeJsonBody(c.req.raw, CallQueueWriteSchema);
	if (!decoded.ok) return c.json({ success: false, error: decoded.error }, 400);
	try {
		return c.json({
			queue: await updateCallQueue(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("queueId"),
				decoded.value,
				session.user.id,
			),
		});
	} catch (err) {
		return manageError(c, err);
	}
});
app.post(
	"/api/workspaces/:workspaceId/calling/queues/:queueId/enable",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			return c.json({
				queue: await enableCallQueue(
					c.env,
					c.req.param("workspaceId"),
					c.req.param("queueId"),
					session.user.id,
				),
			});
		} catch (err) {
			return manageError(c, err);
		}
	},
);
app.post(
	"/api/workspaces/:workspaceId/calling/queues/:queueId/disable",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			return c.json({
				queue: await disableCallQueue(
					c.env,
					c.req.param("workspaceId"),
					c.req.param("queueId"),
					session.user.id,
				),
			});
		} catch (err) {
			return manageError(c, err);
		}
	},
);
app.delete(
	"/api/workspaces/:workspaceId/calling/queues/:queueId",
	async (c) => {
		const session = await getSession(c);
		if (!session) return unauthorized(c);
		try {
			await deleteCallQueue(
				c.env,
				c.req.param("workspaceId"),
				c.req.param("queueId"),
				session.user.id,
			);
			return c.json({ success: true });
		} catch (err) {
			return manageError(c, err);
		}
	},
);

async function getSession(c: Context<{ Bindings: Env }>) {
	return createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
}

function unauthorized(c: Context<{ Bindings: Env }>) {
	return c.json({ success: false, error: "unauthorized" }, 401);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) &&
		Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

/** Map a ManageError (validation/not-found) to a JSON error response. */
function manageError(c: Context<{ Bindings: Env }>, err: unknown) {
	if (err instanceof ManageError) {
		return c.json(
			{ success: false, error: err.message },
			err.status as 400 | 403 | 404 | 409,
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
