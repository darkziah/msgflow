import { afterEach, expect, test } from "bun:test";
import { fetchFacebookProfile } from "../src/ingest";

let restoreFetch: typeof fetch | null = null;

afterEach(() => {
	if (restoreFetch) {
		globalThis.fetch = restoreFetch;
		restoreFetch = null;
	}
});

test("retrieves the Messenger profile fields authorized by Business Asset User Profile Access", async () => {
	restoreFetch = globalThis.fetch;
	let requestedUrl = "";
	globalThis.fetch = (async (input) => {
		requestedUrl = String(input);
		return Response.json({
			name: "Messenger Customer",
			profile_pic: "https://cdn.example.test/customer.jpg",
		});
	}) as typeof fetch;

	await expect(fetchFacebookProfile("psid-123", "page-token")).resolves.toEqual({
		displayName: "Messenger Customer",
		avatarUrl: "https://cdn.example.test/customer.jpg",
	});
	expect(requestedUrl).toContain("psid-123");
	expect(requestedUrl).toContain("fields=name,profile_pic");
});
