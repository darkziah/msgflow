import type { TagSummary } from "@msgflow/contracts";
import { cn } from "@/lib/utils";

const TAG_COLORS: Record<string, string> = {
	// Tailwind bg/text pairs; gray is the fallback for null/unknown colors.
	slate: "bg-slate-100 text-slate-700",
	gray: "bg-gray-100 text-gray-700",
	red: "bg-red-100 text-red-700",
	orange: "bg-orange-100 text-orange-700",
	amber: "bg-amber-100 text-amber-700",
	yellow: "bg-yellow-100 text-yellow-700",
	lime: "bg-lime-100 text-lime-700",
	green: "bg-green-100 text-green-700",
	emerald: "bg-emerald-100 text-emerald-700",
	teal: "bg-teal-100 text-teal-700",
	cyan: "bg-cyan-100 text-cyan-700",
	sky: "bg-sky-100 text-sky-700",
	blue: "bg-blue-100 text-blue-700",
	indigo: "bg-indigo-100 text-indigo-700",
	violet: "bg-violet-100 text-violet-700",
	purple: "bg-purple-100 text-purple-700",
	fuchsia: "bg-fuchsia-100 text-fuchsia-700",
	pink: "bg-pink-100 text-pink-700",
	rose: "bg-rose-100 text-rose-700",
};

function tagClasses(color: string | null): string {
	// Stored colors are the bare name (e.g. "blue"); unknown names fall back.
	return TAG_COLORS[color ?? ""] ?? TAG_COLORS.gray;
}

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
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
				tagClasses(tag.color),
				className,
			)}
		>
			{tag.name}
			{onRemove ? (
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onRemove();
					}}
					className="rounded-sm leading-none opacity-60 hover:opacity-100"
					aria-label={`Remove tag ${tag.name}`}
				>
					×
				</button>
			) : null}
		</span>
	);
}

/** Color options exposed to tag editors (bare names, matching TAG_COLORS keys). */
export const TAG_COLOR_OPTIONS = Object.keys(TAG_COLORS);

/** Hex fallback used by the tag color input in editors. */
export const TAG_COLOR_HEX: Record<string, string> = {
	slate: "#64748b",
	gray: "#6b7280",
	red: "#ef4444",
	orange: "#f97316",
	amber: "#f59e0b",
	yellow: "#eab308",
	lime: "#84cc16",
	green: "#22c55e",
	emerald: "#10b981",
	teal: "#14b8a6",
	cyan: "#06b6d4",
	sky: "#0ea5e9",
	blue: "#3b82f6",
	indigo: "#6366f1",
	violet: "#8b5cf6",
	purple: "#a855f7",
	fuchsia: "#d946ef",
	pink: "#ec4899",
	rose: "#f43f5e",
};
