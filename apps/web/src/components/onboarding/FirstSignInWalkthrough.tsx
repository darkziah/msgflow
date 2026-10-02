import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type WalkthroughTarget =
	| "sidebar"
	| "conversation-list"
	| "conversation-detail"
	| "settings";

type Step = {
	title: string;
	description: string;
	target: WalkthroughTarget;
};

const steps: readonly Step[] = [
	{
		title: "Find your inboxes",
		description:
			"Use the sidebar to choose the inbox or saved view that needs attention.",
		target: "sidebar",
	},
	{
		title: "Choose a conversation",
		description:
			"This list shows the conversations in the selected inbox. Search and filters narrow it down.",
		target: "conversation-list",
	},
	{
		title: "Read, reply, and collaborate",
		description:
			"Open a conversation to read its timeline, reply to the customer, or leave a private comment for your team.",
		target: "conversation-detail",
	},
	{
		title: "Set up your workspace",
		description:
			"Settings is where you manage team access, inboxes, channels, and automation. Available actions depend on your role.",
		target: "settings",
	},
];

type Spotlight = { top: number; left: number; width: number; height: number };

function findSpotlight(target: WalkthroughTarget): Spotlight | null {
	const element = document.querySelector<HTMLElement>(
		`[data-onboarding-target="${target}"]`,
	);
	if (!element) return null;
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return null;
	return {
		top: Math.max(4, rect.top - 6),
		left: Math.max(4, rect.left - 6),
		width: rect.width + 12,
		height: rect.height + 12,
	};
}

export function FirstSignInWalkthrough({
	onComplete,
}: {
	onComplete: () => Promise<unknown>;
}) {
	const [stepIndex, setStepIndex] = useState(0);
	const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
	const [finishing, setFinishing] = useState(false);
	const step = steps[stepIndex];
	const isLastStep = stepIndex === steps.length - 1;

	useLayoutEffect(() => {
		const update = () => setSpotlight(findSpotlight(step.target));
		update();
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		return () => {
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [step.target]);

	async function complete() {
		if (finishing) return;
		setFinishing(true);
		try {
			await onComplete();
		} finally {
			setFinishing(false);
		}
	}

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") void complete();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	return (
		<div
			aria-labelledby="first-sign-in-walkthrough-title"
			aria-modal="true"
			role="dialog"
		>
			<div className="fixed inset-0 z-40 bg-black/55" />
			{spotlight ? (
				<div
					aria-hidden="true"
					className="pointer-events-none fixed z-50 rounded-md ring-2 ring-primary ring-offset-4 ring-offset-background"
					style={spotlight}
				/>
			) : null}
			<section className="fixed right-4 bottom-4 z-50 w-[calc(100%-2rem)] max-w-md rounded-lg border bg-background p-6 shadow-xl sm:right-6 sm:bottom-6">
				<p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
					Step {stepIndex + 1} of {steps.length}
				</p>
				<h2
					className="mt-2 text-lg font-semibold"
					id="first-sign-in-walkthrough-title"
				>
					{step.title}
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
				<div className="mt-6 flex flex-wrap justify-end gap-2">
					<Button
						disabled={finishing}
						onClick={() => void complete()}
						type="button"
						variant="ghost"
					>
						Skip tour
					</Button>
					{stepIndex > 0 ? (
						<Button
							onClick={() => setStepIndex((current) => current - 1)}
							type="button"
							variant="outline"
						>
							Back
						</Button>
					) : null}
					<Button
						disabled={finishing}
						onClick={() => {
							if (isLastStep) {
								void complete();
								return;
							}
							setStepIndex((current) => current + 1);
						}}
						type="button"
					>
						{finishing ? "Saving…" : isLastStep ? "Finish" : "Next"}
					</Button>
				</div>
			</section>
		</div>
	);
}
