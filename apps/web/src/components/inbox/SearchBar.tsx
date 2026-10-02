import type { TagSummary, UserSummary } from "@msgflow/contracts";
import { useQuery } from "@tanstack/react-query";
import { Filter, Search, X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

export interface SearchFilters {
	q?: string;
	assigneeId?: string;
	channel?: "facebook" | "email" | "whatsapp";
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
	workspaceId,
	inputRef,
}: {
	filters: SearchFilters;
	onChange: (filters: SearchFilters) => void;
	workspaceId: string;
	inputRef?: RefObject<HTMLInputElement | null>;
}) {
	const [text, setText] = useState(filters.q ?? "");
	useEffect(() => {
		setText(filters.q ?? "");
	}, [filters.q]);
	const { data: usersData } = useQuery({
		queryKey: ["users", workspaceId],
		queryFn: () => api.listUsers(workspaceId),
		enabled: Boolean(workspaceId),
	});
	const { data: tagsData } = useQuery({
		queryKey: ["tags", workspaceId],
		queryFn: () => api.listTags(workspaceId),
		enabled: Boolean(workspaceId),
	});
	const activeCount = activeFilterCount(filters);

	function set<K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) {
		onChange({ ...filters, [key]: value });
	}

	function clear() {
		setText("");
		onChange({});
	}

	return (
		<div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
			<div className="relative min-w-52 flex-1">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					ref={inputRef}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							onChange({ ...filters, q: text.trim() || undefined });
						}
					}}
					placeholder="Search conversations… (Enter)"
					aria-label="Search conversations"
					className="pr-9 pl-9"
				/>
				{text ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => {
							setText("");
							onChange({ ...filters, q: undefined });
						}}
						className="absolute top-0.5 right-0.5 size-8"
						aria-label="Clear search"
						title="Clear search"
					>
						<X aria-hidden="true" />
					</Button>
				) : null}
			</div>

			<Popover>
				<PopoverTrigger asChild>
					<Button type="button" variant="outline" size="sm">
						<Filter aria-hidden="true" data-icon="inline-start" />
						Filters
						{activeCount > 0 ? <Badge variant="secondary">{activeCount}</Badge> : null}
					</Button>
				</PopoverTrigger>
				<PopoverContent aria-label="Advanced filters" align="end" className="w-80">
					<FieldGroup className="gap-4">
						<Field>
							<FieldLabel htmlFor="assignee-filter">Assignee</FieldLabel>
							<Select
								value={filters.assigneeId ?? "all"}
								onValueChange={(value) => set("assigneeId", value === "all" ? undefined : value)}
							>
								<SelectTrigger id="assignee-filter" className="w-full">
									<SelectValue placeholder="Any assignee" />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										<SelectItem value="all">Any assignee</SelectItem>
										{usersData?.users.map((user) => (
											<SelectItem key={user.id} value={user.id}>
												{user.name}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel htmlFor="channel-filter">Channel</FieldLabel>
							<Select
								value={filters.channel ?? "all"}
								onValueChange={(value) =>
									set(
										"channel",
										value === "all"
											? undefined
											: (value as "facebook" | "email" | "whatsapp"),
									)
								}
							>
								<SelectTrigger id="channel-filter" className="w-full">
									<SelectValue placeholder="Any channel" />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										<SelectItem value="all">Any channel</SelectItem>
										<SelectItem value="facebook">Facebook</SelectItem>
										<SelectItem value="email">Email</SelectItem>
										<SelectItem value="whatsapp">WhatsApp</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel htmlFor="tag-filter">Tag</FieldLabel>
							<Select
								value={filters.tagId ?? "all"}
								onValueChange={(value) => set("tagId", value === "all" ? undefined : value)}
							>
								<SelectTrigger id="tag-filter" className="w-full">
									<SelectValue placeholder="Any tag" />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										<SelectItem value="all">Any tag</SelectItem>
										{tagsData?.tags.map((tag) => (
											<SelectItem key={tag.id} value={tag.id}>
												{tag.name}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						<Field>
							<FieldLabel htmlFor="date-from-filter">Date range</FieldLabel>
							<div className="flex gap-2">
								<Input
									id="date-from-filter"
									type="date"
									value={filters.dateFrom ?? ""}
									onChange={(event) => set("dateFrom", event.target.value || undefined)}
									aria-label="From date"
								/>
								<Input
									type="date"
									value={filters.dateTo ?? ""}
									onChange={(event) => set("dateTo", event.target.value || undefined)}
									aria-label="To date"
								/>
							</div>
						</Field>
						<Button type="button" variant="secondary" onClick={clear}>
							Clear
						</Button>
					</FieldGroup>
				</PopoverContent>
			</Popover>
		</div>
	);
}

export function activeFilterCount(filters: SearchFilters): number {
	return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Tags for the filter dropdown, kept here so SearchBar stays self-contained. */
export type { TagSummary, UserSummary };
