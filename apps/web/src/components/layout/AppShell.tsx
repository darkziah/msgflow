import { type ReactNode, useState } from "react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { AppMobileHeader } from "./AppMobileHeader";

export function AppShell({
	header,
	sidebar,
	mobileSidebar,
	list,
	detail,
	hasDetail,
	onBack,
}: {
	header?: ReactNode;
	sidebar: ReactNode;
	mobileSidebar?: ReactNode;
	list: ReactNode;
	detail: ReactNode;
	hasDetail: boolean;
	onBack: () => void;
}) {
	const [navigationOpen, setNavigationOpen] = useState(false);

	return (
		<div className="h-dvh overflow-hidden bg-background">
			<div className="hidden h-full min-w-[1024px] flex-col lg:flex">
				{header}
				<div className="flex min-h-0 flex-1">
					<div className="shrink-0">{sidebar}</div>
					<section className="flex w-[360px] shrink-0 flex-col border-r">
						{list}
					</section>
					<main className="min-h-0 min-w-[432px] flex-1 overflow-hidden">
						{detail}
					</main>
				</div>
			</div>

			<div className="flex h-full flex-col lg:hidden">
				<AppMobileHeader
					hasDetail={hasDetail}
					onBack={onBack}
					onOpenNavigation={() => setNavigationOpen(true)}
				/>
				<div className="flex min-h-0 flex-1 flex-col">
					{hasDetail ? detail : list}
				</div>
				<Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
					<SheetContent
						side="left"
						className="w-[min(23rem,calc(100vw-2rem))] p-0"
					>
						<SheetHeader className="border-b pr-12">
							<SheetTitle>Navigation</SheetTitle>
						</SheetHeader>
						<div className="min-h-0 flex-1">{mobileSidebar ?? sidebar}</div>
					</SheetContent>
				</Sheet>
			</div>
		</div>
	);
}
