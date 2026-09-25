import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

// Same-origin by default (Vite proxies /api + /ws to the Worker in dev);
// VITE_SERVER_URL overrides for a separately-hosted API in production.
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL || undefined,
	plugins: [usernameClient({ displayUsername: false })],
});

export const { useSession, signIn, signUp, signOut } = authClient;
