import {
	Navigate,
	createRootRoute,
	Outlet,
	useRouter,
} from "@tanstack/react-router";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createRootRoute({
	component: Root,
});

function pageTitle(pathname: string): string {
	if (pathname === "/login") return "Sign in";
	if (pathname === "/setup") return "Set up MsgFlow";
	if (pathname === "/settings") return "Settings";
	if (pathname === "/rules") return "Rules and canned replies";
	return "Shared inbox";
}

function Root() {
	const router = useRouter();
	const { data: session, isPending } = useSession();
	const cache = useQueryClient();
	const identity = session?.user.id ?? null;
	const [cacheOwner, setCacheOwner] = useState<string | null | undefined>(undefined);
	const pathname = router.state.location.pathname;
	useEffect(() => {
		document.title = `${pageTitle(pathname)} · MsgFlow`;
	}, [pathname]);
	useEffect(() => {
		if (isPending || cacheOwner === identity) return;
		cache.clear();
		setCacheOwner(identity);
	}, [cache, cacheOwner, identity, isPending]);

	if (isPending || cacheOwner !== identity) {
		return (
			<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
				Loading…
			</div>
		);
	}
	if (
		!session &&
		!["/login", "/setup"].includes(router.state.location.pathname)
	) {
		return <Navigate to="/login" />;
	}
	return (
		<TooltipProvider>
			<Outlet key={identity ?? "anonymous"} />
		</TooltipProvider>
	);
}
