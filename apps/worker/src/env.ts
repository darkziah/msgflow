import type { ConversationDO } from "./conversation-do";

export interface Env {
	DB: D1Database;
	CONVERSATION_DO: DurableObjectNamespace<ConversationDO>;
	EMAIL: SendEmail;
	MESSENGER_APP_SECRET: string;
	MESSENGER_VERIFY_TOKEN: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL?: string;
	BETTER_AUTH_TRUSTED_ORIGINS?: string;
}
