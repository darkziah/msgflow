import type { CannedReplySummary, RuleSummary } from "@msgflow/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RuleForm } from "@/components/rules/RuleForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export const Route = createFileRoute("/rules")({ component: RulesPage });

type RulesTab = "rules" | "canned-replies";

function getActiveTab(hash: string): RulesTab {
	return hash === "#canned-replies" ? "canned-replies" : "rules";
}

function RulesPage() {
	const [activeTab, setActiveTab] = useState<RulesTab>(() =>
		getActiveTab(window.location.hash),
	);

	useEffect(() => {
		const syncTab = () => setActiveTab(getActiveTab(window.location.hash));
		window.addEventListener("hashchange", syncTab);
		return () => window.removeEventListener("hashchange", syncTab);
	}, []);

	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
			<header className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-4">
					<h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
					<Button variant="link" size="sm" asChild>
						<Link to="/">Back to inbox</Link>
					</Button>
				</div>
				<Alert>
					<AlertCircle />
					<AlertTitle>Inbound automation</AlertTitle>
					<AlertDescription>
						Rules are evaluated before a message reaches a conversation (ADR 0009).
					</AlertDescription>
				</Alert>
			</header>

			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					const tab = value as RulesTab;
					if (window.location.hash !== `#${tab}`) window.location.hash = tab;
				}}
			>
				<TabsList variant="line" aria-label="Rules settings">
					<TabsTrigger value="rules">Rules</TabsTrigger>
					<TabsTrigger value="canned-replies">Canned replies</TabsTrigger>
				</TabsList>
				<TabsContent value="rules" className="pt-4">
					<RulesSection />
				</TabsContent>
				<TabsContent value="canned-replies" className="pt-4">
					<CannedRepliesSection />
				</TabsContent>
			</Tabs>
		</main>
	);
}

function RulesSection() {
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const { data, error, isPending } = useQuery({
		queryKey: ["rules"],
		queryFn: () => api.listRules(),
	});
	const { mutate: remove, isPending: removing } = useMutation({
		mutationFn: (id: string) => api.deleteRule(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
	});

	return (
		<section className="flex flex-col gap-4" aria-label="Automation rules">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-semibold">Automation rules</h2>
					<p className="text-sm text-muted-foreground">
						Route, tag, or assign inbound messages automatically.
					</p>
				</div>
				{creating ? null : (
					<Button onClick={() => setCreating(true)}>
						<Plus data-icon="inline-start" />
						New rule
					</Button>
				)}
			</div>

			{creating ? (
				<RuleForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
			) : null}
			{error ? <QueryError message="Rules could not be loaded." /> : null}
			{isPending ? <LoadingCards /> : null}
			{data && data.rules.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon"><FileText /></EmptyMedia>
						<EmptyTitle>No rules yet</EmptyTitle>
						<EmptyDescription>
							Create a rule to auto-assign, tag, or route inbound messages.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
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
		</section>
	);
}

function RuleCard({ rule, onEdit, onDelete, deleting }: {
	rule: RuleSummary;
	onEdit: () => void;
	onDelete: () => void;
	deleting: boolean;
}) {
	const summary = [
		rule.conditions.length > 0
			? `${rule.conditions.length} condition${rule.conditions.length === 1 ? "" : "s"}`
			: "Any message",
		`${rule.actions.length} action${rule.actions.length === 1 ? "" : "s"}`,
		rule.priority !== 0 ? `Priority ${rule.priority}` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{rule.name}
					{!rule.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
				</CardTitle>
				<CardDescription>{summary}</CardDescription>
				<CardAction>
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
							<Pencil />
						</Button>
						<Button variant="outline" size="sm" disabled={deleting} onClick={onDelete} aria-label={`Delete ${rule.name}`}>
							<Trash2 />
						</Button>
					</div>
				</CardAction>
			</CardHeader>
		</Card>
	);
}

function CannedRepliesSection() {
	const queryClient = useQueryClient();
	const { data, error, isPending } = useQuery({
		queryKey: ["canned-replies"],
		queryFn: () => api.listCannedReplies(),
	});
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const { mutate: remove } = useMutation({
		mutationFn: (id: string) => api.deleteCannedReply(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["canned-replies"] }),
	});

	return (
		<section className="flex flex-col gap-4" aria-label="Canned replies">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-semibold">Canned replies</h2>
					<p className="text-sm text-muted-foreground">
						Saved bodies referenced by the send canned reply rule action.
					</p>
				</div>
				{creating ? null : (
					<Button variant="outline" onClick={() => setCreating(true)}>
						<Plus data-icon="inline-start" />
						New reply
					</Button>
				)}
			</div>

			{creating ? <CannedReplyForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} /> : null}
			{error ? <QueryError message="Canned replies could not be loaded." /> : null}
			{isPending ? <LoadingCards /> : null}
			{data && data.cannedReplies.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon"><FileText /></EmptyMedia>
						<EmptyTitle>No canned replies yet</EmptyTitle>
						<EmptyDescription>Create a reusable response for your automation rules.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{data?.cannedReplies.map((reply) =>
				editingId === reply.id ? (
					<CannedReplyForm key={reply.id} initial={reply} onDone={() => setEditingId(null)} onCancel={() => setEditingId(null)} />
				) : (
					<CannedReplyCard
						key={reply.id}
						reply={reply}
						onEdit={() => setEditingId(reply.id)}
						onDelete={() => {
							if (confirm(`Delete canned reply "${reply.name}"?`)) remove(reply.id);
						}}
					/>
				),
			)}
		</section>
	);
}

function CannedReplyCard({ reply, onEdit, onDelete }: {
	reply: CannedReplySummary;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{reply.name}</CardTitle>
				<CardDescription className="line-clamp-2 whitespace-pre-wrap">{reply.body}</CardDescription>
				<CardAction>
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${reply.name}`}><Pencil /></Button>
						<Button variant="outline" size="sm" onClick={onDelete} aria-label={`Delete ${reply.name}`}><Trash2 /></Button>
					</div>
				</CardAction>
			</CardHeader>
		</Card>
	);
}

function CannedReplyForm({ initial, onDone, onCancel }: {
	initial?: CannedReplySummary;
	onDone: () => void;
	onCancel: () => void;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(initial?.name ?? "");
	const [body, setBody] = useState(initial?.body ?? "");
	const [error, setError] = useState<string | null>(null);
	const { mutate: save, isPending } = useMutation({
		mutationFn: () => {
			const payload = { name: name.trim(), body: body.trim() };
			return initial ? api.updateCannedReply(initial.id, payload) : api.createCannedReply(payload);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["canned-replies"] });
			onDone();
		},
		onError: (err) => setError(err instanceof Error ? err.message : "Failed to save canned reply."),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{initial ? "Edit canned reply" : "New canned reply"}</CardTitle>
				<CardDescription>Use a clear name so it is easy to select in a rule action.</CardDescription>
			</CardHeader>
			<form onSubmit={(event) => { event.preventDefault(); setError(null); save(); }}>
				<CardContent>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="canned-reply-name">Reply name</FieldLabel>
							<Input id="canned-reply-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Reply name" required />
						</Field>
						<Field>
							<FieldLabel htmlFor="canned-reply-body">Reply body</FieldLabel>
							<Textarea id="canned-reply-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Reply body" required rows={4} />
						</Field>
						{error ? <QueryError message={error} /> : null}
					</FieldGroup>
				</CardContent>
				<CardFooter className="justify-end gap-2 border-t">
					<Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
					<Button type="submit" disabled={isPending || !name.trim() || !body.trim()}>{isPending ? "Saving…" : initial ? "Save changes" : "Create"}</Button>
				</CardFooter>
			</form>
		</Card>
	);
}

function QueryError({ message }: { message: string }) {
	return (
		<Alert variant="destructive">
			<AlertCircle />
			<AlertTitle>Something went wrong</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}

function LoadingCards() {
	return (
		<div className="flex flex-col gap-3" role="status" aria-label="Loading" aria-busy="true">
			{["one", "two", "three"].map((key) => (
				<Card key={key}>
					<CardHeader>
						<Skeleton className="h-5 w-1/3" />
						<Skeleton className="h-4 w-2/3" />
					</CardHeader>
				</Card>
			))}
		</div>
	);
}
