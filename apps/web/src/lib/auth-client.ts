import { createAuthClient } from "better-auth/react";

// Same-origin by default (Vite proxies /api + /ws to the Worker in dev);
// VITE_SERVER_URL overrides for a separately-hosted API in production.
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL || undefined,
});

export const { useSession, signIn, signUp, signOut } = authClient;
