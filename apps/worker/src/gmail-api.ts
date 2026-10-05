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
		readonly kind:
			| "authentication"
			| "retryable"
			| "definitive"
			| "uncertain"
			| "historyExpired",
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

export type GmailHistoryPage = {
	history: {
		id: string;
		messagesAdded: { id: string; threadId: string }[];
	}[];
	nextPageToken: string | null;
	historyId: string | null;
};

/**
 * Worker-private Gmail API client. It decrypts only the persisted refresh token
 * and never exposes it in errors. Access tokens are intentionally ephemeral.
 */
export class GmailApi {
	private constructor(
		private readonly env: Env,
		private readonly channelId: string,
		private readonly claimToken: string | null,
		private readonly refreshToken: string,
		private readonly encryptedRefreshToken: string,
	) {}

	static async forChannel(
		env: Env,
		channelId: string,
		claimToken: string | null = null,
	): Promise<GmailApi> {
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
				claimToken,
				await decryptChannelToken(
					account.encryptedRefreshToken,
					env.CHANNEL_TOKEN_ENCRYPTION_KEY,
				),
				account.encryptedRefreshToken,
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

	async watch(
		topicName: string,
	): Promise<{ historyId: string; expiration: string }> {
		const value = await this.post("/watch", {
			topicName,
			labelIds: ["INBOX"],
		});
		if (typeof value.historyId !== "string" || !/^\d+$/.test(value.historyId))
			throw new GmailApiError("Gmail returned an invalid watch", "definitive");
		const expiration =
			typeof value.expiration === "string"
				? value.expiration
				: String(value.expiration);
		if (!/^\d+$/.test(expiration) || !Number.isSafeInteger(Number(expiration)))
			throw new GmailApiError("Gmail returned an invalid watch", "definitive");
		return { historyId: value.historyId, expiration };
	}

	async listHistory(
		startHistoryId: string,
		pageToken?: string,
	): Promise<GmailHistoryPage> {
		const params = new URLSearchParams({ startHistoryId, maxResults: "100" });
		if (pageToken) params.set("pageToken", pageToken);
		const value = await this.get(`/history?${params}`, true);
		const history = Array.isArray(value.history)
			? value.history.flatMap((entry) => {
					if (!entry || typeof entry !== "object") return [];
					const item = entry as { id?: unknown; messagesAdded?: unknown };
					if (typeof item.id !== "string") return [];
					const messagesAdded = Array.isArray(item.messagesAdded)
						? item.messagesAdded.flatMap((added) => {
								const message =
									added && typeof added === "object"
										? (added as { message?: unknown }).message
										: null;
								if (!message || typeof message !== "object") return [];
								const candidate = message as {
									id?: unknown;
									threadId?: unknown;
								};
								return typeof candidate.id === "string" &&
									typeof candidate.threadId === "string"
									? [{ id: candidate.id, threadId: candidate.threadId }]
									: [];
							})
						: [];
					return [{ id: item.id, messagesAdded }];
				})
			: [];
		return {
			history,
			nextPageToken:
				typeof value.nextPageToken === "string" ? value.nextPageToken : null,
			historyId: typeof value.historyId === "string" ? value.historyId : null,
		};
	}

	/** A send transport failure is ambiguous, unlike ordinary sync GET/POST work. */
	async sendMessage(
		raw: string,
		threadId: string,
	): Promise<{ id: string; threadId: string }> {
		const accessToken = await this.refreshAccessToken();
		let response: Response;
		try {
			response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ raw: base64Url(raw), threadId }),
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new GmailApiError("Gmail send outcome is uncertain", "uncertain");
		}
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				await this.markReconnectRequired();
			throw this.requestError(response.status);
		}
		try {
			const value = (await response.json()) as Record<string, unknown>;
			if (typeof value.id !== "string" || typeof value.threadId !== "string")
				throw new Error("invalid response");
			return { id: value.id, threadId: value.threadId };
		} catch {
			throw new GmailApiError("Gmail send outcome is uncertain", "uncertain");
		}
	}

	private async post(
		path: string,
		body: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const accessToken = await this.refreshAccessToken();
		let response: Response;
		try {
			response = await fetch(`${GMAIL_API_BASE}${path}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new GmailApiError(
				"Gmail request could not be completed",
				"retryable",
			);
		}
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				await this.markReconnectRequired();
			throw this.requestError(response.status);
		}
		try {
			return (await response.json()) as Record<string, unknown>;
		} catch {
			throw new GmailApiError(
				"Gmail returned an invalid response",
				"definitive",
			);
		}
	}

	private async get(
		path: string,
		historyNotFound = false,
	): Promise<Record<string, unknown>> {
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
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				await this.markReconnectRequired();
			if (response.status === 404 && historyNotFound)
				throw new GmailApiError(
					"Gmail history cursor expired",
					"historyExpired",
				);
			throw this.requestError(response.status);
		}
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
			const body = (await response.json().catch(() => ({}))) as {
				error?: unknown;
			};
			if (body.error === "invalid_grant") {
				await this.markReconnectRequired();
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

	private async markReconnectRequired(): Promise<void> {
		const guard = this.claimToken
			? "sync_claim_token=?"
			: "encrypted_refresh_token=?";
		await this.env.DB.prepare(
			`UPDATE gmail_accounts SET sync_state='reconnect_required', last_error='Gmail authorization must be reconnected', updated_at=? WHERE channel_id=? AND ${guard}`,
		)
			.bind(
				new Date().toISOString(),
				this.channelId,
				this.claimToken ?? this.encryptedRefreshToken,
			)
			.run();
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

function base64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
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
