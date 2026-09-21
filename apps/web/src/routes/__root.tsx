import {
	Navigate,
	createRootRoute,
	Outlet,
	useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useSession } from "@/lib/auth-client";
import { AppShellV2 } from "@/components/v2/AppShellV2";
import "@/styles/theme-v2.css";

export const Route = createRootRoute({
	component: Root,
});

function Root() {
	const router = useRouter();
	const { data: session, isPending } = useSession();

	if (isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
				Loading…
			</div>
		);
	}
	if (!session && router.state.location.pathname !== "/login") {
		return <Navigate to="/login" />;
	}
	return (
		<>
			<AppShellV2>
				<Outlet />
			</AppShellV2>
			<TanStackRouterDevtools />
		</>
	);
}
