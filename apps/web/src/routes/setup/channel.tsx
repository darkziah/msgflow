import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

export const Route = createFileRoute("/setup/channel")({ component: ChannelSetup });

function ChannelSetup() {
	const router = useRouter();
	const { data: session, isPending } = useSession();
	const search = new URLSearchParams(window.location.search);
	const workspaceId = search.get("workspaceId") ?? "";
	const inboxId = search.get("inboxId") ?? "";
	const oauthSessionId = search.get("metaOauthSession");
	const [metaAppId, setMetaAppId] = useState("");
	const [selectedPageId, setSelectedPageId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [complete, setComplete] = useState(false);
	const { data: metaAppsData } = useQuery({
		queryKey: ["meta-apps", workspaceId],
		queryFn: () => api.listMetaApps(workspaceId),
		enabled: Boolean(workspaceId),
	});
	const { data: pagesData, isLoading: isLoadingPages } = useQuery({
		queryKey: ["meta-oauth-pages", oauthSessionId],
		queryFn: () => api.listAuthorizedFacebookPages(oauthSessionId ?? ""),
		enabled: Boolean(oauthSessionId),
	});

	async function startFacebookLogin() {
		if (!metaAppId) return;
		setBusy(true);
		setError(null);
		try {
			const { authorizationUrl } = await api.startMetaOAuth(workspaceId, { metaAppId, inboxId });
			window.location.assign(authorizationUrl);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to start Facebook Login.");
			setBusy(false);
		}
	}

	async function connectSelectedPage() {
		if (!oauthSessionId || !selectedPageId) return;
		setBusy(true);
		setError(null);
		try {
			await api.connectAuthorizedFacebookPage(oauthSessionId, selectedPageId);
			setComplete(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to connect Facebook Page.");
		} finally {
			setBusy(false);
		}
	}

	if (isPending) return null;
	if (!session || !workspaceId || !inboxId) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
				<div className="max-w-md space-y-4 rounded-xl border bg-white p-8 shadow-sm">
					<h1 className="text-xl font-black">Sign in to continue setup</h1>
					<p className="text-sm text-gray-600">The first Facebook Page can only be connected by an authenticated Workspace Owner or Administrator.</p>
					<Button onClick={() => router.navigate({ to: "/login" })}>Sign in</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
			<section className="w-full max-w-xl space-y-6 rounded-xl border bg-white p-8 shadow-sm">
				<div className="space-y-2">
					<p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Step 2 of 2</p>
					<h1 className="text-2xl font-black">Connect a Facebook Page</h1>
					<p className="text-sm text-gray-600">Choose a Meta App, sign in as that App’s developer or tester, then select an eligible Page. Meta App Review is not required while the App remains in development mode.</p>
				</div>
				{oauthSessionId ? (
					<div className="space-y-4">
						<label className="grid gap-1.5 text-sm font-medium">
							<span>Eligible Facebook Page</span>
							<select required value={selectedPageId} onChange={(event) => setSelectedPageId(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" disabled={isLoadingPages || complete}>
								<option value="">{isLoadingPages ? "Loading Pages…" : "Select a Page"}</option>
								{pagesData?.pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
							</select>
						</label>
						<p className="text-xs text-gray-500">The selected Page token is exchanged and stored encrypted by MsgFlow; it is never returned to this browser.</p>
						<Button disabled={busy || complete || !selectedPageId} onClick={connectSelectedPage}>{busy ? "Connecting…" : "Connect selected Page"}</Button>
					</div>
				) : (
					<div className="space-y-4">
						<label className="grid gap-1.5 text-sm font-medium">
							<span>Meta App</span>
							<select required value={metaAppId} onChange={(event) => setMetaAppId(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
								<option value="">Select a configured Meta App</option>
								{metaAppsData?.metaApps.map((app) => <option key={app.id} value={app.id}>{app.displayName} · {app.appId}</option>)}
							</select>
						</label>
						{metaAppsData?.metaApps.length === 0 ? <p className="text-sm text-amber-800">Add a Meta App in Settings → Channels before connecting a Page.</p> : null}
						<Button disabled={busy || !metaAppId} onClick={startFacebookLogin}>{busy ? "Opening Facebook…" : "Continue with Facebook Login"}</Button>
					</div>
				)}
				{error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
				{complete ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Facebook Page connected to the Shared Inbox.</p> : null}
				<div className="border-t pt-5"><button type="button" className="text-sm text-gray-600 hover:text-gray-900" onClick={() => router.navigate({ to: "/" })}>Skip for now</button></div>
			</section>
		</div>
	);
}
