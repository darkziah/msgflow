import { MessageCircleMore } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";

export function AccountFlowShell({
	eyebrow,
	title,
	description,
	children,
}: {
	eyebrow: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8 sm:px-6">
			<Card className="w-full max-w-md">
				<CardHeader className="gap-3">
					<div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<MessageCircleMore aria-hidden="true" />
					</div>
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
						<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
						<CardDescription>{description}</CardDescription>
					</div>
				</CardHeader>
				{children}
			</Card>
		</main>
	);
}
