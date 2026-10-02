import { ArrowLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppMobileHeader({
	hasDetail,
	onBack,
	onOpenNavigation,
}: {
	hasDetail: boolean;
	onBack: () => void;
	onOpenNavigation: () => void;
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
			{hasDetail ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onBack}
					aria-label="Back to conversations"
				>
					<ArrowLeft />
					Back
				</Button>
			) : (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={onOpenNavigation}
					aria-label="Open navigation"
				>
					<Menu />
				</Button>
			)}
			<span className="text-sm font-semibold">MsgFlow</span>
		</header>
	);
}
