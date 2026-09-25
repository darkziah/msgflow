import type { EmailDomainSummary, MailboxSummary } from "./api";

export type Domain = EmailDomainSummary & {
	dnsStatusJson: string;
	updatedAt: string;
};
export interface Evidence {
	checkedAt?: string;
	dkimSelector?: string;
	routingConfirmed?: boolean;
	sendingConfirmed?: boolean;
	routingDns?: boolean;
	sendingDns?: boolean;
	records?: Record<string, string[]>;
}
export function evidenceFor(domain: Domain): Evidence {
	try {
		return JSON.parse(domain.dnsStatusJson || "{}");
	} catch {
		return {};
	}
}
export interface ProvisionInput {
	emailDomainId: string;
	userIds: string[];
	excludeUserIds: string[];
}
export interface PreviewRow {
	userId: string;
	username: string | null;
	canonicalAddress: string | null;
	eligible: boolean;
	reason: string | null;
}
export interface OperationsData {
	ingress: {
		id: string;
		mailboxId: string;
		address: string;
		state: string;
		error: string | null;
		receivedAt: string;
		attempts: number;
	}[];
	audit: {
		id: string;
		actorUserId: string | null;
		action: string;
		targetId: string;
		createdAt: string;
	}[];
	counts: Record<string, number>;
	limits: { messageBytes: number; providerQuota: string };
}
const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
const enc = encodeURIComponent;
async function request<T>(
	path: string,
	method = "GET",
	body?: unknown,
): Promise<T> {
	const response = await fetch(
		`${import.meta.env.VITE_SERVER_URL ?? ""}${path}`,
		{
			method,
			credentials: "include",
			headers: { "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
	);
	const data = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(data?.error ?? `Request failed (${response.status})`);
	if (!data) throw new Error("The server returned no JSON response");
	return data as T;
}
export const emailAdminApi = {
	domains: (w: string) =>
		request<{ emailDomains: Domain[] }>(`${ws(w)}/email-domains`),
	verify: (
		w: string,
		id: string,
		body: {
			routingConfirmed: boolean;
			sendingConfirmed: boolean;
			dkimSelector?: string;
		},
	) =>
		request<{ domain: Domain }>(
			`${ws(w)}/email-domains/${enc(id)}/verify`,
			"POST",
			body,
		),
	domainState: (
		w: string,
		id: string,
		body: {
			inboundState?: Domain["inboundState"];
			outboundState?: Domain["outboundState"];
			operatorConfirmed?: boolean;
		},
	) =>
		request<{ emailDomain: Domain }>(
			`${ws(w)}/email-domains/${enc(id)}/state`,
			"PATCH",
			body,
		),
	mailboxState: (
		w: string,
		id: string,
		body: { isEnabled?: boolean; isSendEnabled?: boolean },
	) =>
		request<{ mailbox: MailboxSummary }>(
			`${ws(w)}/mailboxes/${enc(id)}/state`,
			"PATCH",
			body,
		),
	grant: (w: string, id: string, userId: string) =>
		request(`${ws(w)}/mailboxes/${enc(id)}/delegates`, "POST", { userId }),
	revoke: (w: string, id: string, userId: string) =>
		request(`${ws(w)}/mailboxes/${enc(id)}/delegates/${enc(userId)}`, "DELETE"),
	preview: (w: string, body: ProvisionInput) =>
		request<{ preview: PreviewRow[] }>(
			`${ws(w)}/mailboxes/provision-preview`,
			"POST",
			body,
		),
	provision: (w: string, body: ProvisionInput) =>
		request<{ mailboxes: MailboxSummary[] }>(
			`${ws(w)}/mailboxes/provision`,
			"POST",
			body,
		),
	operations: (w: string) =>
		request<OperationsData>(`${ws(w)}/email-operations`),
	replay: (w: string, id: string) =>
		request<{ processed: number; attempted: number }>(
			`${ws(w)}/email-ingress/${enc(id)}/replay`,
			"POST",
			{},
		),
	invite: (w: string, email: string) =>
		request<{
			success: true;
			data: {
				invitationUrl: string;
				expiresAt: number;
				delivery: "copy_link" | "email_sent" | "email_delivery_failed";
			};
		}>(`${ws(w)}/invitations`, "POST", { email }),
	username: (w: string, id: string, username: string) =>
		request(`${ws(w)}/users/${enc(id)}/username`, "POST", { username }),
};
