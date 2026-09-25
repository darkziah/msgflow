import {
	Navigate,
	createRootRoute,
	Outlet,
	useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useSession } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export const Route = createRootRoute({
	component: Root,
});

function Root() {
	const router = useRouter();
	const { data: session, isPending } = useSession();
	const cache = useQueryClient();
	const identity = session?.user.id ?? null;
	const [cacheOwner, setCacheOwner] = useState<string | null | undefined>(undefined);
	useEffect(() => {
		if (isPending || cacheOwner === identity) return;
		cache.clear();
		setCacheOwner(identity);
	}, [cache, cacheOwner, identity, isPending]);

	if (isPending || cacheOwner !== identity) {
		return (
			<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
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
		<>
			<Outlet key={identity ?? "anonymous"} />
			<TanStackRouterDevtools />
		</>
	);
}
