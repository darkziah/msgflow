import type { Attachment, SendMessageRequest } from "@msgflow/contracts";
import { type EmailDomainSummary, type MailboxSummary, request } from "./api";

export type DeliveryState =
	| "pending"
	| "sending"
	| "accepted"
	| "failed"
	| "uncertain";
export interface Delivery {
	clientMessageId: string;
	state: DeliveryState;
	error?: string | null;
	providerMessageId?: string | null;
}
export interface EmailContext {
	mailboxes: MailboxSummary[];
	receivingMailboxId: string;
	recipient: string;
	subject: string | null;
	deliveryStates: Delivery[];
}
export interface DnsObservation {
	name: string;
	type: string;
	values: string[];
	expected?: string;
	status: string;
}
export interface DomainVerification {
	observations: DnsObservation[];
	checkedAt: string;
	routingConfirmed: boolean;
	sendingConfirmed: boolean;
	ready: boolean;
}
export interface ProvisionInput {
	emailDomainId: string;
	userIds: string[];
	excludeUserIds: string[];
}
export interface ProvisionPreview {
	entries: {
		userId: string;
		address: string | null;
		action: "create" | "skip" | "error";
		reason?: string;
	}[];
}
export interface EmailOperations {
	ingress: {
		id: string;
		state: string;
		receivedAt: string;
		reason?: string | null;
		replayable: boolean;
	}[];
	outbound: (Delivery & { conversationId: string; updatedAt?: string })[];
	audit: {
		id: string;
		action: string;
		actorId: string | null;
		createdAt: string;
		targetId?: string;
	}[];
}
const ws = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
const post = (body: unknown): RequestInit => ({
	method: "POST",
	body: JSON.stringify(body),
});
export const emailApi = {
	assigned(workspaceId: string) {
		return request<{
			mailboxes: (MailboxSummary & { openCount: number; totalCount: number })[];
		}>(`${ws(workspaceId)}/mailboxes/assigned`);
	},
	async context(id: string, workspaceId: string) {
		const data = await request<
			Omit<EmailContext, "deliveryStates"> & {
				receivingMailboxType: "shared" | "private";
				deliveryStates: {
					id: string;
					status: string;
					error: string | null;
					fromAddress: string | null;
					providerMessageId: string | null;
					updatedAt: string;
				}[];
			}
		>(`/api/conversations/${encodeURIComponent(id)}/email-context?workspaceId=${encodeURIComponent(workspaceId)}`);
		return {
			...data,
			deliveryStates: data.deliveryStates.map((d) => ({
				...d,
				clientMessageId: d.id,
				state: (d.status === "provider_sent" || d.status === "sent"
					? "accepted"
					: d.status) as DeliveryState,
			})),
		};
	},
	getDraft(id: string, workspaceId: string) {
		return request<{ draft: Omit<SendMessageRequest, "workspaceId"> | null }>(
			`/api/conversations/${encodeURIComponent(id)}/draft?workspaceId=${encodeURIComponent(workspaceId)}`,
		);
	},
	saveDraft(
		id: string,
		workspaceId: string,
		body: Omit<SendMessageRequest, "workspaceId">,
	) {
		return request<{ draft: Omit<SendMessageRequest, "workspaceId"> }>(
			`/api/conversations/${encodeURIComponent(id)}/draft?workspaceId=${encodeURIComponent(workspaceId)}`,
			{ method: "PUT", body: JSON.stringify(body) },
		);
	},
	deleteDraft(id: string, workspaceId: string, clientMessageId: string) {
		return request<{ success: boolean }>(
			`/api/conversations/${encodeURIComponent(id)}/draft?workspaceId=${encodeURIComponent(workspaceId)}&clientMessageId=${encodeURIComponent(clientMessageId)}`,
			{ method: "DELETE" },
		);
	},
	send(
		id: string,
		workspaceId: string,
		body: Omit<SendMessageRequest, "workspaceId"> & {
			mailboxId: string;
			confirmPrivateIdentity: boolean;
		},
	) {
		return request<{
			state?: DeliveryState;
			deliveryState?: DeliveryState;
			success?: boolean;
		}>(
			`/api/conversations/${encodeURIComponent(id)}/messages`,
			post({ ...body, workspaceId }),
		);
	},
	upload(conversationId: string, workspaceId: string, files: File[]) {
		const form = new FormData();
		form.append("conversationId", conversationId);
		form.append("workspaceId", workspaceId);
		for (const file of files) form.append("files", file);
		return request<{ attachments: Attachment[] }>("/api/email-attachments", {
			method: "POST",
			body: form,
		});
	},
	attachmentUrl(id: string, workspaceId: string) {
		return `${import.meta.env.VITE_SERVER_URL ?? ""}/api/email-attachments/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`;
	},
	verify(
		workspaceId: string,
		id: string,
		body: {
			routingConfirmed: boolean;
			sendingConfirmed: boolean;
			dkimSelector?: string;
		},
	) {
		return request<DomainVerification>(
			`${ws(workspaceId)}/email-domains/${id}/verify`,
			post(body),
		);
	},
	domainState(
		workspaceId: string,
		id: string,
		body: {
			inboundState?: EmailDomainSummary["inboundState"];
			outboundState?: EmailDomainSummary["outboundState"];
			operatorConfirmed?: boolean;
		},
	) {
		return request<{ emailDomain: EmailDomainSummary }>(
			`${ws(workspaceId)}/email-domains/${id}/state`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	mailboxState(
		workspaceId: string,
		id: string,
		body: { isEnabled?: boolean; isSendEnabled?: boolean },
	) {
		return request<{ mailbox: MailboxSummary }>(
			`${ws(workspaceId)}/mailboxes/${id}/state`,
			{ method: "PATCH", body: JSON.stringify(body) },
		);
	},
	delegates(workspaceId: string, id: string) {
		return request<{ delegates: { userId: string }[] }>(
			`${ws(workspaceId)}/mailboxes/${id}/delegates`,
		);
	},
	grant(workspaceId: string, id: string, userId: string) {
		return request(
			`${ws(workspaceId)}/mailboxes/${id}/delegates`,
			post({ userId }),
		);
	},
	revoke(workspaceId: string, id: string, userId: string) {
		return request(
			`${ws(workspaceId)}/mailboxes/${id}/delegates/${encodeURIComponent(userId)}`,
			{ method: "DELETE" },
		);
	},
	preview(workspaceId: string, body: ProvisionInput) {
		return request<ProvisionPreview>(
			`${ws(workspaceId)}/mailboxes/provision-preview`,
			post(body),
		);
	},
	provision(workspaceId: string, body: ProvisionInput) {
		return request<ProvisionPreview>(
			`${ws(workspaceId)}/mailboxes/provision`,
			post(body),
		);
	},
	operations(workspaceId: string) {
		return request<EmailOperations>(`${ws(workspaceId)}/email-operations`);
	},
	replay(workspaceId: string, id: string) {
		return request(`${ws(workspaceId)}/email-ingress/${id}/replay`, post({}));
	},
};
