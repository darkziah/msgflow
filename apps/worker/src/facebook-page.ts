const GRAPH_API_VERSION = "v26.0";

/**
 * Checks that a supplied Page token addresses the requested Page, then creates
 * the Page-level Messenger webhook subscription. Meta still requires the app
 * itself to be subscribed to `messages` in its dashboard.
 */
export async function validateAndSubscribeFacebookPage(
	pageId: string,
	accessToken: string,
): Promise<void> {
	const page = await fetch(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}?fields=id&access_token=${encodeURIComponent(accessToken)}`,
		{ signal: AbortSignal.timeout(10_000) },
	);
	if (!page.ok) throw new Error("Facebook Page validation failed");
	const identity = (await page.json()) as { id?: string };
	if (identity.id !== pageId)
		throw new Error("Facebook Page validation failed");

	const subscription = await fetch(
		`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`,
		{
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				access_token: accessToken,
				subscribed_fields: "messages,messaging_postbacks",
			}),
			signal: AbortSignal.timeout(10_000),
		},
	);
	if (!subscription.ok) throw new Error("Facebook Page subscription failed");
	const result = (await subscription.json()) as { success?: boolean };
	if (!result.success) throw new Error("Facebook Page subscription failed");
}
