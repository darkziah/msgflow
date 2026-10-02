import type { ConversationDO } from "./conversation-do";
import type { CallDispatchDO } from "./call-dispatch-do";
import type { CallSessionDO } from "./call-session-do";
import type { WorkspaceEventsDO } from "./workspace-events-do";

export interface Env {
	DB: D1Database;
	CONVERSATION_DO: DurableObjectNamespace<ConversationDO>;
	CALL_DISPATCH_DO: DurableObjectNamespace<CallDispatchDO>;
	CALL_SESSION_DO: DurableObjectNamespace<CallSessionDO>;
	WORKSPACE_EVENTS_DO: DurableObjectNamespace<WorkspaceEventsDO>;
	EMAIL: SendEmail;
	/** Verified provider sender for recovery and invitation email. */
	AUTH_EMAIL_FROM?: string;
	ATTACHMENTS: R2Bucket;
	/** Private raw MIME and email-attachment archive; never exposed publicly. */
	EMAIL_ARCHIVE: R2Bucket;
	/** Public custom-domain base URL for ATTACHMENTS, without a trailing slash. */
	ATTACHMENT_PUBLIC_BASE_URL: string;
	MESSENGER_APP_SECRET: string;
	/** 32-byte base64url AES-GCM key; never stored in D1. ADR 0018. */
	CHANNEL_TOKEN_ENCRYPTION_KEY: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL?: string;
	BETTER_AUTH_TRUSTED_ORIGINS?: string;
}
