import type { TagSummary, UserSummary } from "@msgflow/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";

export interface SearchFilters {
	q?: string;
	assigneeId?: string;
	channel?: "facebook" | "email";
	tagId?: string;
	dateFrom?: string;
	dateTo?: string;
}

/**
 * Faceted search bar (ADR 0013): free text plus assignee / channel / tag /
 * date-range filters. Changes apply immediately to the inbox list query.
 */
export function SearchBar({
	filters,
	onChange,
}: {
	filters: SearchFilters;
	onChange: (filters: SearchFilters) => void;
}) {
	const [text, setText] = useState(filters.q ?? "");

	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});
	const { data: tagsData } = useQuery({
		queryKey: ["tags"],
		queryFn: () => api.listTags(),
	});

	function set<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
		onChange({ ...filters, [key]: value });
	}

	const active =
		Object.values(filters).some((value) => value !== undefined) || text !== "";

	return (
		<div className="flex flex-wrap items-center gap-2 px-4 py-2">
			<div className="relative min-w-52 flex-1">
				<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
				<input
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							onChange({ ...filters, q: text.trim() || undefined });
						}
					}}
					placeholder="Search conversations… (Enter)"
					className="w-full rounded-md border py-1.5 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
				{text ? (
					<button
						type="button"
						onClick={() => {
							setText("");
							onChange({ ...filters, q: undefined });
						}}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
						aria-label="Clear search"
					>
						<X className="size-4" />
					</button>
				) : null}
			</div>

			<select
				value={filters.assigneeId ?? ""}
				onChange={(event) => set("assigneeId", event.target.value || undefined)}
				className="rounded-md border px-2 py-1.5 text-sm"
			>
				<option value="">Any assignee</option>
				{usersData?.users.map((user) => (
					<option key={user.id} value={user.id}>
						{user.name}
					</option>
				))}
			</select>

			<select
				value={filters.channel ?? ""}
				onChange={(event) =>
					set(
						"channel",
						event.target.value
							? (event.target.value as "facebook" | "email")
							: undefined,
					)
				}
				className="rounded-md border px-2 py-1.5 text-sm"
			>
				<option value="">Any channel</option>
				<option value="facebook">Facebook</option>
				<option value="email">Email</option>
			</select>

			<select
				value={filters.tagId ?? ""}
				onChange={(event) => set("tagId", event.target.value || undefined)}
				className="rounded-md border px-2 py-1.5 text-sm"
			>
				<option value="">Any tag</option>
				{tagsData?.tags.map((tag) => (
					<option key={tag.id} value={tag.id}>
						{tag.name}
					</option>
				))}
			</select>

			<input
				type="date"
				value={filters.dateFrom ?? ""}
				onChange={(event) => set("dateFrom", event.target.value || undefined)}
				className="rounded-md border px-2 py-1.5 text-sm"
				aria-label="From date"
			/>
			<input
				type="date"
				value={filters.dateTo ?? ""}
				onChange={(event) => set("dateTo", event.target.value || undefined)}
				className="rounded-md border px-2 py-1.5 text-sm"
				aria-label="To date"
			/>

			{active ? (
				<button
					type="button"
					onClick={() => {
						setText("");
						onChange({});
					}}
					className="text-sm text-gray-500 underline-offset-2 hover:underline"
				>
					Clear
				</button>
			) : null}
		</div>
	);
}

export function activeFilterCount(filters: SearchFilters): number {
	return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Tags for the filter dropdown, kept here so SearchBar stays self-contained. */
export type { TagSummary, UserSummary };
