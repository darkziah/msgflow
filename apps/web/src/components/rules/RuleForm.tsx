import type {
	CannedReplySummary,
	RuleActionInput,
	RuleConditionInput,
	RuleSummary,
	RuleWriteRequest,
	TagSummary,
	UserSummary,
} from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const FIELDS = [
	{ value: "sender.email", label: "Sender email" },
	{ value: "channel.type", label: "Channel type" },
	{ value: "message.body", label: "Message body" },
	{ value: "subject", label: "Subject" },
	{ value: "status", label: "Status" },
	{ value: "inbox.id", label: "Inbox" },
] as const;

const OPERATORS = [
	{ value: "equals", label: "equals" },
	{ value: "not_equals", label: "not equals" },
	{ value: "contains", label: "contains" },
	{ value: "not_contains", label: "not contains" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
	{ value: "regex", label: "regex" },
] as const;

const ACTION_TYPES = [
	{ value: "assign_user", label: "Assign user" },
	{ value: "assign_team", label: "Assign team" },
	{ value: "move_inbox", label: "Move to inbox" },
	{ value: "add_tag", label: "Add tag" },
	{ value: "remove_tag", label: "Remove tag" },
	{ value: "set_status", label: "Set status" },
	{ value: "send_canned_reply", label: "Send canned reply" },
] as const;

const TRIGGER_TYPES = [
	{ value: "message_received", label: "Message received" },
	{ value: "conversation_created", label: "Conversation created" },
	{ value: "tag_added", label: "Tag added" },
	{ value: "manual", label: "Manual" },
] as const;

interface Props {
	/** Existing rule when editing; undefined when creating. */
	initial?: RuleSummary;
	onDone: () => void;
	onCancel: () => void;
}

/** Stable per-row key so editing rows never remount on reorder/filter. */
function rowKey(prefix: string, value: string, index: number): string {
	return `${prefix}-${index}-${value}`;
}

export function RuleForm({ initial, onDone, onCancel }: Props) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initial?.name ?? "");
	const [triggerType, setTriggerType] = useState<
		RuleWriteRequest["triggerType"]
	>(initial?.triggerType ?? "message_received");
	const [isActive, setIsActive] = useState(initial?.isActive ?? true);
	const [priority, setPriority] = useState(initial?.priority ?? 0);
	const [conditions, setConditions] = useState<RuleConditionInput[]>(
		initial?.conditions ?? [
			{ field: "message.body", operator: "contains", value: "", matchGroup: 0 },
		],
	);
	const [actions, setActions] = useState<RuleActionInput[]>(
		initial?.actions ?? [
			{ actionType: "assign_user", actionValue: "", executionOrder: 0 },
		],
	);

	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});
	const { data: tagsData } = useQuery({
		queryKey: ["tags"],
		queryFn: () => api.listTags(),
	});
	const { data: repliesData } = useQuery({
		queryKey: ["canned-replies"],
		queryFn: () => api.listCannedReplies(),
	});

	const { mutate: save, isPending } = useMutation({
		mutationFn: (body: RuleWriteRequest) =>
			initial ? api.updateRule(initial.id, body) : api.createRule(body),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["rules"] });
			onDone();
		},
		onError: (err) => {
			alert(err instanceof Error ? err.message : "Failed to save rule.");
		},
	});

	function submit(event: React.FormEvent) {
		event.preventDefault();
		save({
			name: name.trim(),
			triggerType,
			isActive,
			priority: Number(priority) || 0,
			conditions,
			actions,
		});
	}

	return (
		<form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
			<div className="flex flex-wrap items-center gap-2">
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Rule name"
					required
					className="min-w-40 flex-1 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
				<select
					value={triggerType}
					onChange={(event) =>
						setTriggerType(
							event.target.value as RuleWriteRequest["triggerType"],
						)
					}
					className="rounded-md border px-2 py-1.5 text-sm"
				>
					{TRIGGER_TYPES.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<label className="flex items-center gap-1.5 text-sm">
					<input
						type="checkbox"
						checked={isActive}
						onChange={(event) => setIsActive(event.target.checked)}
					/>
					Active
				</label>
				<label className="flex items-center gap-1.5 text-sm">
					Priority
					<input
						type="number"
						value={priority}
						onChange={(event) => setPriority(Number(event.target.value))}
						className="w-16 rounded-md border px-2 py-1.5 text-sm"
					/>
				</label>
			</div>

			<div>
				<div className="mb-1 flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						Conditions (match ANY in a group, ALL groups)
					</h3>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							setConditions((prev) => [
								...prev,
								{
									field: "message.body",
									operator: "contains",
									value: "",
									matchGroup: 0,
								},
							])
						}
					>
						<Plus /> Add condition
					</Button>
				</div>
				<div className="space-y-2">
					{conditions.map((condition, index) => (
						<div
							key={rowKey("cond", condition.value, index)}
							className="flex flex-wrap items-center gap-2"
						>
							<select
								value={condition.field}
								onChange={(event) =>
									setConditions((prev) =>
										prev.map((c, i) =>
											i === index ? { ...c, field: event.target.value } : c,
										),
									)
								}
								className="rounded-md border px-2 py-1.5 text-sm"
							>
								{FIELDS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<select
								value={condition.operator}
								onChange={(event) =>
									setConditions((prev) =>
										prev.map((c, i) =>
											i === index ? { ...c, operator: event.target.value } : c,
										),
									)
								}
								className="rounded-md border px-2 py-1.5 text-sm"
							>
								{OPERATORS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<input
								value={condition.value}
								onChange={(event) =>
									setConditions((prev) =>
										prev.map((c, i) =>
											i === index ? { ...c, value: event.target.value } : c,
										),
									)
								}
								placeholder="value"
								className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
							/>
							<label className="flex items-center gap-1 text-xs text-gray-500">
								Group
								<input
									type="number"
									value={condition.matchGroup}
									onChange={(event) =>
										setConditions((prev) =>
											prev.map((c, i) =>
												i === index
													? {
															...c,
															matchGroup: Number(event.target.value) || 0,
														}
													: c,
											),
										)
									}
									className="w-12 rounded-md border px-1.5 py-1 text-sm"
								/>
							</label>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() =>
									setConditions((prev) => prev.filter((_, i) => i !== index))
								}
								aria-label="Remove condition"
							>
								<Trash2 className="size-4" />
							</Button>
						</div>
					))}
				</div>
			</div>

			<div>
				<div className="mb-1 flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						Actions (routing first-match-wins; additive all apply)
					</h3>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							setActions((prev) => [
								...prev,
								{
									actionType: "assign_user",
									actionValue: "",
									executionOrder: prev.length,
								},
							])
						}
					>
						<Plus /> Add action
					</Button>
				</div>
				<div className="space-y-2">
					{actions.map((action, index) => (
						<ActionRow
							key={rowKey("act", action.actionType, index)}
							action={action}
							users={usersData?.users ?? []}
							tags={tagsData?.tags ?? []}
							replies={repliesData?.cannedReplies ?? []}
							onChange={(next) =>
								setActions((prev) =>
									prev.map((a, i) => (i === index ? next : a)),
								)
							}
							onRemove={() =>
								setActions((prev) => prev.filter((_, i) => i !== index))
							}
						/>
					))}
				</div>
			</div>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={isPending || !name.trim()}>
					{isPending ? "Saving…" : initial ? "Save changes" : "Create rule"}
				</Button>
			</div>
		</form>
	);
}

function ActionRow({
	action,
	users,
	tags,
	replies,
	onChange,
	onRemove,
}: {
	action: RuleActionInput;
	users: UserSummary[];
	tags: TagSummary[];
	replies: CannedReplySummary[];
	onChange: (action: RuleActionInput) => void;
	onRemove: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<select
				value={action.actionType}
				onChange={(event) =>
					onChange({
						...action,
						actionType: event.target.value,
						actionValue: "",
					})
				}
				className="rounded-md border px-2 py-1.5 text-sm"
			>
				{ACTION_TYPES.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>

			{action.actionType === "assign_user" ? (
				<select
					value={action.actionValue}
					onChange={(event) =>
						onChange({ ...action, actionValue: event.target.value })
					}
					className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
				>
					<option value="">Select user…</option>
					{users.map((user) => (
						<option key={user.id} value={user.id}>
							{user.name}
						</option>
					))}
				</select>
			) : action.actionType === "add_tag" ||
				action.actionType === "remove_tag" ? (
				<select
					value={action.actionValue}
					onChange={(event) =>
						onChange({ ...action, actionValue: event.target.value })
					}
					className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
				>
					<option value="">Select tag…</option>
					{tags.map((tag) => (
						<option key={tag.id} value={tag.id}>
							{tag.name}
						</option>
					))}
				</select>
			) : action.actionType === "send_canned_reply" ? (
				<select
					value={action.actionValue}
					onChange={(event) =>
						onChange({ ...action, actionValue: event.target.value })
					}
					className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
				>
					<option value="">Select reply…</option>
					{replies.map((reply) => (
						<option key={reply.id} value={reply.id}>
							{reply.name}
						</option>
					))}
				</select>
			) : action.actionType === "set_status" ? (
				<select
					value={action.actionValue}
					onChange={(event) =>
						onChange({ ...action, actionValue: event.target.value })
					}
					className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
				>
					<option value="">Select status…</option>
					<option value="open">Open</option>
					<option value="archived">Archived</option>
				</select>
			) : (
				<input
					value={action.actionValue}
					onChange={(event) =>
						onChange({ ...action, actionValue: event.target.value })
					}
					placeholder={
						action.actionType === "assign_team"
							? "Team id"
							: action.actionType === "move_inbox"
								? "Inbox id"
								: "Value"
					}
					className="min-w-32 flex-1 rounded-md border px-2 py-1.5 text-sm"
				/>
			)}

			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={onRemove}
				aria-label="Remove action"
			>
				<Trash2 className="size-4" />
			</Button>
		</div>
	);
}
