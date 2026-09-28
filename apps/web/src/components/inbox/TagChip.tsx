import type { TagSummary } from "@msgflow/contracts";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TAG_COLOR_OPTIONS = [
	"slate",
	"gray",
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
] as const;

export function TagChip({
	tag,
	onRemove,
	className,
}: {
	tag: TagSummary;
	onRemove?: () => void;
	className?: string;
}) {
	return (
		<Badge variant="secondary" className={cn("max-w-full", className)}>
			<span className="truncate">{tag.name}</span>
			{onRemove ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={(event) => {
						event.stopPropagation();
						onRemove();
					}}
					className="size-4 rounded-full"
					aria-label={`Remove tag ${tag.name}`}
					title={`Remove tag ${tag.name}`}
				>
					<X aria-hidden="true" />
				</Button>
			) : null}
		</Badge>
	);
}

/** Color options exposed to tag editors. */
export { TAG_COLOR_OPTIONS };
