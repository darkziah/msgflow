import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { inboxes, metaApps } from "@msgflow/db";
import { requireOwnerAccess } from "./access";
import {
	decryptChannelToken,
	encryptChannelToken,
} from "./channel-token-crypto";
import type { Env } from "./env";
import { ManageError } from "./errors";
import { createFacebookChannel } from "./manage";

const GRAPH_API_VERSION = "v26.0";
const SESSION_LIFETIME_MS = 10 * 60 * 1000;

type AuthorizedPage = { id: string; name: string; accessToken: string };
type GraphPage = { id?: string; name?: string; access_token?: string };

export async function startMetaOAuth(
	env: Env,
	workspaceId: string,
	metaAppId: string,
	inboxId: string,
	actorUserId: string,
	callbackOrigin: string,
): Promise<{ authorizationUrl: string }> {
	const db = drizzle(env.DB);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const [metaApp, inbox] = await Promise.all([
		db
			.select({ id: metaApps.id, appId: metaApps.appId })
			.from(metaApps)
			.where(
				and(eq(metaApps.id, metaAppId), eq(metaApps.workspaceId, workspaceId)),
			)
			.get(),
		db
			.select({ id: inboxes.id })
			.from(inboxes)
			.where(
				and(
					eq(inboxes.id, inboxId),
					eq(inboxes.workspaceId, workspaceId),
					eq(inboxes.isArchived, false),
				),
			)
			.get(),
	]);
	if (!metaApp) throw new ManageError("Meta App not found", 404);
	if (!inbox) throw new ManageError("active inbox not found", 404);
	const id = crypto.randomUUID();
	const state = crypto.randomUUID();
	const now = new Date();
	await env.DB.prepare(
		`INSERT INTO meta_oauth_sessions (id,workspace_id,meta_app_id,actor_user_id,inbox_id,callback_origin,state_nonce,expires_at,created_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
	)
		.bind(
			id,
			workspaceId,
			metaAppId,
			actorUserId,
			inboxId,
			callbackOrigin,
			state,
			new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
			now.toISOString(),
		)
		.run();
	const redirectUri = `${callbackOrigin}/api/meta-oauth/callback`;
	const url = new URL(
		`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`,
	);
	url.search = new URLSearchParams({
		client_id: metaApp.appId,
		redirect_uri: redirectUri,
		state,
		response_type: "code",
		scope: "pages_show_list,pages_messaging,pages_manage_metadata",
	}).toString();
	return { authorizationUrl: url.toString() };
}

export async function completeMetaOAuth(
	env: Env,
	state: string,
	code: string,
): Promise<{ callbackOrigin: string; sessionId: string }> {
	const session = await env.DB.prepare(
		`SELECT s.id, s.workspace_id AS workspaceId, s.meta_app_id AS metaAppId, s.callback_origin AS callbackOrigin,
		m.app_id AS appId, m.app_secret AS appSecret
		FROM meta_oauth_sessions s JOIN meta_apps m ON m.id = s.meta_app_id
		WHERE s.state_nonce=? AND s.consumed_at IS NULL AND s.expires_at > ?`,
	)
		.bind(state, new Date().toISOString())
		.first<{
			id: string;
			workspaceId: string;
			metaAppId: string;
			callbackOrigin: string;
			appId: string;
			appSecret: string;
		}>();
	if (!session)
		throw new ManageError("Facebook authorization has expired", 400);
	let appSecret: string;
	try {
		appSecret = await decryptChannelToken(
			session.appSecret,
			env.CHANNEL_TOKEN_ENCRYPTION_KEY,
		);
	} catch {
		throw new ManageError("Meta App secret encryption is unavailable", 503);
	}
	const redirectUri = `${session.callbackOrigin}/api/meta-oauth/callback`;
	const tokenUrl = new URL(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
	);
	tokenUrl.search = new URLSearchParams({
		client_id: session.appId,
		client_secret: appSecret,
		redirect_uri: redirectUri,
		code,
	}).toString();
	const tokenResponse = await fetch(tokenUrl, {
		signal: AbortSignal.timeout(10_000),
	});
	if (!tokenResponse.ok)
		throw new ManageError("Facebook authorization failed", 400);
	const token = (await tokenResponse.json()) as { access_token?: string };
	if (!token.access_token)
		throw new ManageError("Facebook authorization failed", 400);
	const pagesResponse = await fetch(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token.access_token)}`,
		{ signal: AbortSignal.timeout(10_000) },
	);
	if (!pagesResponse.ok)
		throw new ManageError("Facebook Page discovery failed", 400);
	const pages = (await pagesResponse.json()) as { data?: GraphPage[] };
	const approvedPages = (pages.data ?? []).flatMap((page) =>
		page.id && page.name && page.access_token
			? [{ id: page.id, name: page.name, accessToken: page.access_token }]
			: [],
	);
	const encryptedPages = await encryptChannelToken(
		JSON.stringify(approvedPages),
		env.CHANNEL_TOKEN_ENCRYPTION_KEY,
	);
	await env.DB.prepare(
		"UPDATE meta_oauth_sessions SET encrypted_pages=?, consumed_at=? WHERE id=?",
	)
		.bind(encryptedPages, new Date().toISOString(), session.id)
		.run();
	return { callbackOrigin: session.callbackOrigin, sessionId: session.id };
}

export async function listAuthorizedPages(
	env: Env,
	sessionId: string,
	actorUserId: string,
) {
	const session = await env.DB.prepare(
		`SELECT s.workspace_id AS workspaceId, s.actor_user_id AS actorUserId, s.encrypted_pages AS encryptedPages
		FROM meta_oauth_sessions s WHERE s.id=? AND s.expires_at > ? AND s.consumed_at IS NOT NULL`,
	)
		.bind(sessionId, new Date().toISOString())
		.first<{
			workspaceId: string;
			actorUserId: string;
			encryptedPages: string | null;
		}>();
	if (
		!session ||
		session.actorUserId !== actorUserId ||
		!session.encryptedPages
	)
		throw new ManageError("Facebook authorization not found", 404);
	await requireOwnerAccess(drizzle(env.DB), session.workspaceId, actorUserId);
	try {
		return JSON.parse(
			await decryptChannelToken(
				session.encryptedPages,
				env.CHANNEL_TOKEN_ENCRYPTION_KEY,
			),
		) as AuthorizedPage[];
	} catch {
		throw new ManageError("Facebook authorization is unavailable", 503);
	}
}

export async function connectAuthorizedPage(
	env: Env,
	sessionId: string,
	pageId: string,
	actorUserId: string,
) {
	const session = await env.DB.prepare(
		`SELECT workspace_id AS workspaceId, meta_app_id AS metaAppId, actor_user_id AS actorUserId, inbox_id AS inboxId, encrypted_pages AS encryptedPages
		FROM meta_oauth_sessions WHERE id=? AND expires_at > ? AND consumed_at IS NOT NULL`,
	)
		.bind(sessionId, new Date().toISOString())
		.first<{
			workspaceId: string;
			metaAppId: string;
			actorUserId: string;
			inboxId: string;
			encryptedPages: string | null;
		}>();
	if (
		!session ||
		session.actorUserId !== actorUserId ||
		!session.encryptedPages
	)
		throw new ManageError("Facebook authorization not found", 404);
	const pages = JSON.parse(
		await decryptChannelToken(
			session.encryptedPages,
			env.CHANNEL_TOKEN_ENCRYPTION_KEY,
		),
	) as AuthorizedPage[];
	const page = pages.find((candidate) => candidate.id === pageId);
	if (!page) throw new ManageError("Facebook Page not found", 404);
	const channel = await createFacebookChannel(
		env,
		session.workspaceId,
		{
			pageId: page.id,
			displayName: page.name,
			accessToken: page.accessToken,
			inboxId: session.inboxId,
			metaAppId: session.metaAppId,
		},
		actorUserId,
	);
	await env.DB.prepare(
		"UPDATE meta_oauth_sessions SET encrypted_pages=NULL WHERE id=?",
	)
		.bind(sessionId)
		.run();
	return channel;
}
