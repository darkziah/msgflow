import { gmailAccounts } from "@msgflow/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { decryptChannelToken } from "./channel-token-crypto";
import type { Env } from "./env";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GmailApiError extends Error {
	constructor(
		message: string,
		readonly kind: "authentication" | "retryable" | "definitive",
	) {
		super(message);
	}
}

export type GmailThreadListPage = {
	threads: { id: string }[];
	nextPageToken: string | null;
};

export type GmailMessage = {
	id: string;
	threadId: string;
	labelIds: string[];
	internalDate: string;
	payload: {
		headers?: { name: string; value: string }[];
		body?: { data?: string };
		parts?: GmailMessage["payload"][];
	};
};

export type GmailThread = {
	id: string;
	historyId: string | null;
	messages: GmailMessage[];
};

/**
 * Worker-private Gmail API client. It decrypts only the persisted refresh token
 * and never exposes it in errors. Access tokens are intentionally ephemeral.
 */
export class GmailApi {
	private constructor(
		private readonly env: Env,
		private readonly channelId: string,
		private readonly refreshToken: string,
	) {}

	static async forChannel(env: Env, channelId: string): Promise<GmailApi> {
		const account = await drizzle(env.DB)
			.select({ encryptedRefreshToken: gmailAccounts.encryptedRefreshToken })
			.from(gmailAccounts)
			.where(eq(gmailAccounts.channelId, channelId))
			.get();
		if (!account)
			throw new GmailApiError("Gmail account is unavailable", "definitive");
		try {
			return new GmailApi(
				env,
				channelId,
				await decryptChannelToken(
					account.encryptedRefreshToken,
					env.CHANNEL_TOKEN_ENCRYPTION_KEY,
				),
			);
		} catch {
			throw new GmailApiError(
				"Gmail account requires reconnection",
				"authentication",
			);
		}
	}

	async getProfile(): Promise<{ emailAddress: string; historyId: string }> {
		const value = await this.get("/profile");
		if (
			typeof value.emailAddress !== "string" ||
			typeof value.historyId !== "string"
		)
			throw new GmailApiError(
				"Gmail returned an invalid profile",
				"definitive",
			);
		return { emailAddress: value.emailAddress, historyId: value.historyId };
	}

	async listInboxThreads(
		query: string,
		pageToken?: string,
	): Promise<GmailThreadListPage> {
		const params = new URLSearchParams({
			labelIds: "INBOX",
			q: query,
			maxResults: "100",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const value = await this.get(`/threads?${params}`);
		const threads = Array.isArray(value.threads)
			? value.threads.flatMap((thread) =>
					thread &&
					typeof thread === "object" &&
					typeof (thread as { id?: unknown }).id === "string"
						? [{ id: (thread as { id: string }).id }]
						: [],
				)
			: [];
		return {
			threads,
			nextPageToken:
				typeof value.nextPageToken === "string" ? value.nextPageToken : null,
		};
	}

	async getThread(id: string): Promise<GmailThread> {
		const value = await this.get(
			`/threads/${encodeURIComponent(id)}?format=full`,
		);
		if (typeof value.id !== "string" || !Array.isArray(value.messages))
			throw new GmailApiError("Gmail returned an invalid thread", "definitive");
		return {
			id: value.id,
			historyId: typeof value.historyId === "string" ? value.historyId : null,
			messages: value.messages.filter(isGmailMessage),
		};
	}

	private async get(path: string): Promise<Record<string, unknown>> {
		const accessToken = await this.refreshAccessToken();
		let response: Response;
		try {
			response = await fetch(`${GMAIL_API_BASE}${path}`, {
				headers: { authorization: `Bearer ${accessToken}` },
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new GmailApiError(
				"Gmail request could not be completed",
				"retryable",
			);
		}
		if (!response.ok) throw this.requestError(response.status);
		try {
			return (await response.json()) as Record<string, unknown>;
		} catch {
			throw new GmailApiError(
				"Gmail returned an invalid response",
				"definitive",
			);
		}
	}

	private async refreshAccessToken(): Promise<string> {
		if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET)
			throw new GmailApiError("Gmail OAuth is not configured", "definitive");
		let response: Response;
		try {
			response = await fetch(TOKEN_URL, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: this.env.GOOGLE_CLIENT_ID,
					client_secret: this.env.GOOGLE_CLIENT_SECRET,
					grant_type: "refresh_token",
					refresh_token: this.refreshToken,
				}).toString(),
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new GmailApiError(
				"Gmail token refresh could not be completed",
				"retryable",
			);
		}
		if (!response.ok) {
			if (response.status === 400 || response.status === 401) {
				await this.env.DB.prepare(
					"UPDATE gmail_accounts SET sync_state='reconnect_required', last_error='Gmail authorization must be reconnected', updated_at=? WHERE channel_id=?",
				)
					.bind(new Date().toISOString(), this.channelId)
					.run();
				throw new GmailApiError(
					"Gmail account requires reconnection",
					"authentication",
				);
			}
			throw this.requestError(response.status);
		}
		const body = (await response.json()) as { access_token?: unknown };
		if (typeof body.access_token !== "string" || !body.access_token)
			throw new GmailApiError("Gmail token refresh failed", "definitive");
		return body.access_token;
	}

	private requestError(status: number): GmailApiError {
		if (status === 401 || status === 403)
			return new GmailApiError(
				"Gmail account requires reconnection",
				"authentication",
			);
		if (status === 429 || status >= 500)
			return new GmailApiError(
				"Gmail request could not be completed",
				"retryable",
			);
		return new GmailApiError("Gmail rejected the request", "definitive");
	}
}

function isGmailMessage(value: unknown): value is GmailMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Partial<GmailMessage>;
	return (
		typeof message.id === "string" &&
		typeof message.threadId === "string" &&
		Array.isArray(message.labelIds) &&
		typeof message.internalDate === "string" &&
		!!message.payload &&
		typeof message.payload === "object"
	);
}
