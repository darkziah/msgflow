import type { CannedReplySummary, RuleSummary } from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RuleForm } from "@/components/rules/RuleForm";
import { api } from "@/lib/api";

export const Route = createFileRoute("/rules")({ component: RulesPage });

function RulesPage() {
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const { data, isPending } = useQuery({
		queryKey: ["rules"],
		queryFn: () => api.listRules(),
	});

	const { mutate: remove, isPending: removing } = useMutation({
		mutationFn: (id: string) => api.deleteRule(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
	});

	return (
		<div className="mx-auto max-w-3xl px-6 py-8">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-black">Rules</h1>
				<Link
					to="/"
					className="text-sm text-gray-500 underline-offset-2 hover:underline"
				>
					← Back to inbox
				</Link>
			</div>
			<p className="mt-1 text-sm text-gray-500">
				Automatic routing for inbound messages: evaluated before a message
				reaches a conversation (ADR 0009).
			</p>

			{creating ? (
				<div className="mt-4">
					<RuleForm
						onDone={() => setCreating(false)}
						onCancel={() => setCreating(false)}
					/>
				</div>
			) : (
				<Button className="mt-4" onClick={() => setCreating(true)}>
					<Plus /> New rule
				</Button>
			)}

			<div className="mt-6 space-y-3">
				{isPending ? <p className="text-sm text-gray-400">Loading…</p> : null}
				{data && data.rules.length === 0 ? (
					<p className="text-sm text-gray-400">
						No rules yet. Create one to auto-assign, tag, or route inbound
						messages.
					</p>
				) : null}
				{data?.rules.map((rule) =>
					editingId === rule.id ? (
						<RuleForm
							key={rule.id}
							initial={rule}
							onDone={() => setEditingId(null)}
							onCancel={() => setEditingId(null)}
						/>
					) : (
						<RuleCard
							key={rule.id}
							rule={rule}
							onEdit={() => setEditingId(rule.id)}
							onDelete={() => {
								if (confirm(`Delete rule "${rule.name}"?`)) remove(rule.id);
							}}
							deleting={removing}
						/>
					),
				)}
			</div>

			<CannedRepliesSection />
		</div>
	);
}

function RuleCard({
	rule,
	onEdit,
	onDelete,
	deleting,
}: {
	rule: RuleSummary;
	onEdit: () => void;
	onDelete: () => void;
	deleting: boolean;
}) {
	const summary = [
		rule.conditions.length > 0
			? `${rule.conditions.length} condition${rule.conditions.length === 1 ? "" : "s"}`
			: "any message",
		`${rule.actions.length} action${rule.actions.length === 1 ? "" : "s"}`,
		rule.priority !== 0 ? `priority ${rule.priority}` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
			<div className="min-w-0">
				<p className="flex items-center gap-2 font-semibold">
					{rule.name}
					{!rule.isActive ? (
						<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
							inactive
						</span>
					) : null}
				</p>
				<p className="truncate text-xs text-gray-500">{summary}</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Button variant="ghost" size="sm" onClick={onEdit}>
					<Pencil className="size-4" />
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={deleting}
					onClick={onDelete}
				>
					<Trash2 className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function CannedRepliesSection() {
	const queryClient = useQueryClient();
	const { data, isPending } = useQuery({
		queryKey: ["canned-replies"],
		queryFn: () => api.listCannedReplies(),
	});
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const { mutate: remove } = useMutation({
		mutationFn: (id: string) => api.deleteCannedReply(id),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["canned-replies"] }),
	});

	return (
		<section className="mt-10">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-bold">Canned replies</h2>
				<Button variant="outline" size="sm" onClick={() => setCreating(true)}>
					<Plus /> New reply
				</Button>
			</div>
			<p className="mt-1 text-sm text-gray-500">
				Saved bodies referenced by the "send canned reply" rule action.
			</p>

			<div className="mt-4 space-y-3">
				{creating ? (
					<CannedReplyForm
						onDone={() => setCreating(false)}
						onCancel={() => setCreating(false)}
					/>
				) : null}
				{isPending ? <p className="text-sm text-gray-400">Loading…</p> : null}
				{data && data.cannedReplies.length === 0 ? (
					<p className="text-sm text-gray-400">No canned replies yet.</p>
				) : null}
				{data?.cannedReplies.map((reply) =>
					editingId === reply.id ? (
						<CannedReplyForm
							key={reply.id}
							initial={reply}
							onDone={() => setEditingId(null)}
							onCancel={() => setEditingId(null)}
						/>
					) : (
						<CannedReplyCard
							key={reply.id}
							reply={reply}
							onEdit={() => setEditingId(reply.id)}
							onDelete={() => {
								if (confirm(`Delete canned reply "${reply.name}"?`)) {
									remove(reply.id);
								}
							}}
						/>
					),
				)}
			</div>
		</section>
	);
}

function CannedReplyCard({
	reply,
	onEdit,
	onDelete,
}: {
	reply: CannedReplySummary;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
			<div className="min-w-0">
				<p className="font-semibold">{reply.name}</p>
				<p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-gray-500">
					{reply.body}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Button variant="ghost" size="sm" onClick={onEdit}>
					<Pencil className="size-4" />
				</Button>
				<Button variant="outline" size="sm" onClick={onDelete}>
					<Trash2 className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function CannedReplyForm({
	initial,
	onDone,
	onCancel,
}: {
	initial?: CannedReplySummary;
	onDone: () => void;
	onCancel: () => void;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initial?.name ?? "");
	const [body, setBody] = useState(initial?.body ?? "");

	const { mutate: save, isPending } = useMutation({
		mutationFn: () => {
			const payload = { name: name.trim(), body: body.trim() };
			return initial
				? api.updateCannedReply(initial.id, payload)
				: api.createCannedReply(payload);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["canned-replies"] });
			onDone();
		},
		onError: (err) => {
			alert(
				err instanceof Error ? err.message : "Failed to save canned reply.",
			);
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
			className="space-y-2 rounded-lg border p-4"
		>
			<input
				value={name}
				onChange={(event) => setName(event.target.value)}
				placeholder="Reply name"
				required
				className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
			/>
			<textarea
				value={body}
				onChange={(event) => setBody(event.target.value)}
				placeholder="Reply body"
				required
				rows={3}
				className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
			/>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="submit"
					size="sm"
					disabled={isPending || !name.trim() || !body.trim()}
				>
					{isPending ? "Saving…" : initial ? "Save changes" : "Create"}
				</Button>
			</div>
		</form>
	);
}
