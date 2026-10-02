import type {
	CannedReplySummary,
	Comment,
	SendMessageRequest,
	UserSummary,
} from "@msgflow/contracts";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, Paperclip } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { emailApi } from "@/lib/email-api";

interface Props {
	noteOnly?: boolean;
	attachmentUnavailable?: boolean;
	conversationId: string;
	workspaceId: string;
	showSubject?: boolean;
	onSent?: () => void;
	onCommentCreated?: (comment: Comment) => void;
	onShortcutRequestChange?: (handler: ComposerShortcutHandler | null) => void;
}
export type ComposerShortcutRequest =
	| "focus-reply"
	| "focus-comment"
	| "saved-replies"
	| "submit-composer";
export type ComposerShortcutHandler = (
	request: ComposerShortcutRequest,
) => boolean;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EMAIL_TYPES = [...IMAGE_TYPES, "application/pdf"];
type Draft = Omit<SendMessageRequest, "workspaceId">;
const empty = (): Draft => ({
	text: "",
	attachments: [],
	confirmPrivateIdentity: false,
});
export function Composer({
	conversationId,
	workspaceId,
	showSubject = false,
	onSent,
	onCommentCreated,
	onShortcutRequestChange,
	noteOnly,
	attachmentUnavailable = false,
}: Props) {
	const [mode, setMode] = useState<"reply" | "note">(
		noteOnly ? "note" : "reply",
	);
	const [draft, setDraft] = useState<Draft>(empty);
	const [note, setNote] = useState("");
	const [mentionIds, setMentionIds] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saveStatus, setSaveStatus] = useState("");
	const [hydrated, setHydrated] = useState(!showSubject);
	const [accepted, setAccepted] = useState(false);
	const [showEmailSubject, setShowEmailSubject] = useState(false);
	const [cannedReplyDialogOpen, setCannedReplyDialogOpen] = useState(false);
	const [cannedReplySearch, setCannedReplySearch] = useState("");
	const dirty = useRef(false);
	const attachmentInputRef = useRef<HTMLInputElement>(null);
	const replyInputRef = useRef<HTMLTextAreaElement>(null);
	const busyRef = useRef(false);
	const submitRef = useRef<() => Promise<void>>(async () => {});
	const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
	const revision = useRef(0);
	const serverRevision = useRef(0);
	const isNote = mode === "note";
	const attachmentsUnavailable = !isNote && attachmentUnavailable;
	const locked = showSubject && !!draft.clientMessageId;
	const context = useQuery({
		queryKey: ["email-context", workspaceId, conversationId],
		queryFn: () => emailApi.context(conversationId, workspaceId),
		enabled: showSubject,
		refetchInterval: 5000,
	});
	const { data: usersData } = useQuery({
		queryKey: ["users", workspaceId],
		queryFn: () => api.listUsers(workspaceId),
	});
	const { data: cannedRepliesData } = useQuery({
		queryKey: ["canned-replies", workspaceId],
		queryFn: () => api.listCannedReplies(workspaceId),
	});
	const cannedReplies = cannedRepliesData?.cannedReplies ?? [];
	const normalizedCannedReplySearch = cannedReplySearch.trim().toLowerCase();
	const filteredCannedReplies = cannedReplies.filter(
		(reply) =>
			!normalizedCannedReplySearch ||
			reply.name.toLowerCase().includes(normalizedCannedReplySearch) ||
			reply.body.toLowerCase().includes(normalizedCannedReplySearch),
	);
	const mailboxId = draft.mailboxId || context.data?.receivingMailboxId || "";
	const from = context.data?.mailboxes.find((m) => m.id === mailboxId);
	const privateOverride =
		context.data?.receivingMailboxType === "shared" && from?.type === "private";
	const subject =
		draft.subject ??
		(context.data?.subject
			? /^re:/i.test(context.data.subject)
				? context.data.subject
				: `Re: ${context.data.subject}`
			: "");
	const delivery = context.data?.deliveryStates.find(
		(d) => d.id === draft.clientMessageId,
	);
	const text = isNote ? note : draft.text;
	const match = isNote ? text.match(/(?:^|\s)@([^\s@]*)$/) : null;
	const query = match?.[1]?.toLowerCase();
	const candidates =
		query === undefined
			? []
			: (usersData?.users ?? [])
					.filter((u) => u.name.toLowerCase().includes(query))
					.slice(0, 6);

	useEffect(() => {
		if (!showSubject) return;
		let active = true;
		void emailApi
			.getDraft(conversationId, workspaceId)
			.then(({ draft: saved }) => {
				if (!active) return;
				// Never silently overwrite keystrokes made while hydration was in flight.
				serverRevision.current = saved?.draftRevision ?? 0;
				if (saved && !dirty.current) setDraft(saved);
				else if (saved?.clientMessageId) {
					setError(
						"A submitted server draft exists. Reload to reconcile it before sending.",
					);
					return;
				}
				setHydrated(true);
			})
			.catch(() => {
				if (active)
					setError("Cannot load the server draft. Reload before sending.");
			});
		return () => {
			active = false;
		};
	}, [conversationId, showSubject, workspaceId]);

	const persist = useCallback(
		(payload: Draft) => {
			// Serialize writes so an older autosave cannot arrive after submission/deletion.
			const next = saveQueue.current
				.catch(() => {})
				.then(async () => {
					const request = { ...payload, draftRevision: serverRevision.current };
					let result: Awaited<ReturnType<typeof emailApi.saveDraft>>;
					try {
						result = await emailApi.saveDraft(
							conversationId,
							workspaceId,
							request,
						);
					} catch (error) {
						if (!request.clientMessageId) throw error;
						// Retry only the identical persisted submission, never a fresh ID.
						result = await emailApi.saveDraft(
							conversationId,
							workspaceId,
							request,
						);
					}
					serverRevision.current = result.draft.draftRevision ?? 0;
					return result;
				});
			saveQueue.current = next;
			return next;
		},
		[conversationId, workspaceId],
	);
	useEffect(() => {
		if (!showSubject || !hydrated || !dirty.current || locked || busy) return;
		const version = revision.current;
		const timer = setTimeout(() => {
			if (busyRef.current) return;
			setSaveStatus("Saving draft…");
			void persist(draft)
				.then(() => {
					if (version === revision.current)
						setSaveStatus("Draft saved to server");
				})
				.catch(() => setSaveStatus("Draft not saved — check your connection"));
		}, 600);
		return () => clearTimeout(timer);
	}, [draft, hydrated, locked, busy, showSubject, persist]);

	function edit(patch: Partial<SendMessageRequest>) {
		if (busyRef.current || locked) return;
		dirty.current = true;
		revision.current += 1;
		setDraft((current) => ({ ...current, ...patch }));
		setSaveStatus("Unsaved changes");
		setError(null);
	}
	async function clearAccepted(expectedId = draft.clientMessageId) {
		if (!expectedId) return;
		busyRef.current = true;
		setBusy(true);
		try {
			await saveQueue.current.catch(() => {});
			await emailApi.deleteDraft(conversationId, workspaceId, expectedId);
			// Read back the exact target before claiming the durable draft was cleared.
			const saved = (await emailApi.getDraft(conversationId, workspaceId))
				.draft;
			if (saved?.clientMessageId || saved?.text || saved?.attachments?.length)
				throw new Error(
					"Server draft was not cleared. Refresh before continuing.",
				);
			dirty.current = false;
			revision.current += 1;
			serverRevision.current = saved?.draftRevision ?? 0;
			setDraft(saved ?? empty());
			setAccepted(false);
			setError(null);
			setSaveStatus("Reply accepted by provider — delivery not confirmed");
			onSent?.();
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not clear accepted draft.",
			);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	async function upload(files: FileList | null) {
		if (!files?.length || busyRef.current || locked || isNote) return;
		if (showSubject && !hydrated) {
			setError("Wait for the server draft to load before attaching files.");
			return;
		}
		const list = Array.from(files);
		const attachments = draft.attachments ?? [];
		if (
			attachments.length + list.length > 5 ||
			list.some(
				(f) =>
					!(showSubject ? EMAIL_TYPES : IMAGE_TYPES).includes(f.type) ||
					!f.size ||
					f.size > (showSubject ? 5 : 10) * 1024 * 1024,
			) ||
			(showSubject &&
				attachments.reduce((n, a) => n + a.size, 0) +
					list.reduce((n, f) => n + f.size, 0) >
					5 * 1024 * 1024)
		) {
			setError(
				showSubject
					? "Choose up to five PDF or image files, at most 5 MiB combined. Encoded email has an additional provider size limit."
					: "Choose up to five JPEG, PNG, GIF or WebP images, at most 10 MiB each.",
			);
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError(null);
		try {
			const result = showSubject
				? await emailApi.upload(conversationId, workspaceId, list)
				: await api.uploadAttachments(workspaceId, list);
			dirty.current = true;
			revision.current += 1;
			setDraft((current) => ({
				...current,
				attachments: [...(current.attachments ?? []), ...result.attachments],
			}));
		} catch (e) {
			setError(e instanceof Error ? e.message : "Upload failed.");
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	function selectMention(user: UserSummary) {
		setNote((current) =>
			current.replace(
				/(?:^|\s)@([^\s@]*)$/,
				(value) => `${value.startsWith(" ") ? " " : ""}@${user.name} `,
			),
		);
		setMentionIds((current) =>
			current.includes(user.id) ? current : [...current, user.id],
		);
	}
	function insertCannedReply(reply: CannedReplySummary) {
		const input = replyInputRef.current;
		const start = input?.selectionStart ?? draft.text.length;
		const end = input?.selectionEnd ?? start;
		const nextText = `${draft.text.slice(0, start)}${reply.body}${draft.text.slice(end)}`;
		edit({ text: nextText });
		requestAnimationFrame(() => {
			input?.focus();
			const cursor = start + reply.body.length;
			input?.setSelectionRange(cursor, cursor);
		});
	}
	async function submit(event?: React.FormEvent) {
		event?.preventDefault();
		if (
			busyRef.current ||
			(!text.trim() && (isNote || !draft.attachments?.length))
		)
			return;
		if (
			!isNote &&
			showSubject &&
			(locked ||
				!hydrated ||
				!context.data ||
				context.isError ||
				!from?.isEnabled ||
				!from.isSendEnabled ||
				!context.data.recipient ||
				(privateOverride && !draft.confirmPrivateIdentity))
		)
			return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		let submitted = false;
		try {
			if (isNote) {
				const { comment } = await api.createComment(conversationId, {
					workspaceId,
					text: note.trim(),
					mentions: mentionIds,
				});
				setNote("");
				setMentionIds([]);
				onCommentCreated?.(comment);
				return;
			}
			const payload: Draft = {
				...draft,
				text: draft.text.trim(),
				clientMessageId: draft.clientMessageId ?? crypto.randomUUID(),
				...(showSubject
					? {
							mailboxId,
							subject,
							confirmPrivateIdentity: !!draft.confirmPrivateIdentity,
						}
					: {}),
			};
			if (showSubject) {
				// Store the immutable submitted payload before crossing the send boundary.
				setDraft(payload);
				await persist(payload);
			}
			submitted = true;
			const result = await api.sendMessage(
				conversationId,
				workspaceId,
				payload,
			);
			if (!result.success || !result.sent)
				throw new Error(
					!result.success
						? result.error
						: "Unexpected send response. Refresh status; do not resend.",
				);
			if (showSubject) {
				setAccepted(true);
				await clearAccepted(payload.clientMessageId);
			} else {
				setDraft(empty());
				onSent?.();
			}
		} catch (e) {
			setError(
				`${e instanceof Error ? e.message : "Send failed."}${showSubject && submitted ? " The outcome may be uncertain. Refresh server status; do not resend." : ""}`,
			);
		} finally {
			busyRef.current = false;
			setBusy(false);
			if (showSubject) void context.refetch();
		}
	}
	submitRef.current = () => submit();
	const canSend = isNote
		? !!note.trim()
		: (!!draft.text.trim() || !!draft.attachments?.length) &&
			(!showSubject ||
				(hydrated &&
					!locked &&
					!!from?.isEnabled &&
					!!from.isSendEnabled &&
					!!context.data?.recipient &&
					!context.isError &&
					(!privateOverride || !!draft.confirmPrivateIdentity)));
	useEffect(() => {
		if (!onShortcutRequestChange) return;

		onShortcutRequestChange((request) => {
			if (request === "focus-reply") {
				if (busy || noteOnly) return false;
				setMode("reply");
				requestAnimationFrame(() => replyInputRef.current?.focus());
				return true;
			}
			if (request === "focus-comment") {
				if (busy) return false;
				setMode("note");
				requestAnimationFrame(() => replyInputRef.current?.focus());
				return true;
			}
			if (request === "saved-replies") {
				if (
					isNote ||
					!cannedReplies.length ||
					busy ||
					locked ||
					attachmentsUnavailable
				)
					return false;
				setCannedReplyDialogOpen(true);
				return true;
			}
			if (request === "submit-composer") {
				if (busy || !canSend) return false;
				void submitRef.current();
				return true;
			}
			return false;
		});
		return () => onShortcutRequestChange(null);
	}, [
		attachmentsUnavailable,
		busy,
		canSend,
		cannedReplies.length,
		isNote,
		locked,
		noteOnly,
		onShortcutRequestChange,
	]);
	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<FieldGroup className="gap-2">
				<div className="flex items-center justify-between gap-2">
					<ToggleGroup
						type="single"
						value={mode}
						disabled={busy}
						aria-label="Composer mode"
						onValueChange={(value) => {
							if (value === "reply" || value === "note") setMode(value);
						}}
					>
						<ToggleGroupItem
							value="reply"
							variant="outline"
							size="sm"
							disabled={noteOnly}
						>
							Reply
						</ToggleGroupItem>
						<ToggleGroupItem value="note" variant="outline" size="sm">
							Comment
						</ToggleGroupItem>
					</ToggleGroup>
					{!isNote && cannedReplies.length ? (
						<Dialog
							open={cannedReplyDialogOpen}
							onOpenChange={(open) => {
								setCannedReplyDialogOpen(open);
								if (!open) setCannedReplySearch("");
							}}
						>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label="Saved replies"
										disabled={busy || locked || attachmentsUnavailable}
										onClick={() => setCannedReplyDialogOpen(true)}
									>
										<MessageSquareText />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Saved replies</TooltipContent>
							</Tooltip>
							<DialogContent className="max-w-md p-4">
								<DialogHeader>
									<DialogTitle>Saved replies</DialogTitle>
									<DialogDescription>
										Choose a reply to insert into this message.
									</DialogDescription>
								</DialogHeader>
								<Input
									autoFocus
									aria-label="Search saved replies"
									value={cannedReplySearch}
									onChange={(event) => setCannedReplySearch(event.target.value)}
									placeholder="Search saved replies…"
								/>
								<div className="max-h-72 overflow-y-auto">
									{filteredCannedReplies.length ? (
										<div className="flex flex-col gap-1">
											{filteredCannedReplies.map((reply) => (
												<Button
													key={reply.id}
													type="button"
													variant="ghost"
													className="h-auto w-full justify-start px-3 py-2 text-left"
													onClick={() => {
														insertCannedReply(reply);
														setCannedReplyDialogOpen(false);
														setCannedReplySearch("");
													}}
												>
													<span className="flex min-w-0 flex-col gap-0.5">
														<span className="font-medium">{reply.name}</span>
														<span className="line-clamp-2 text-xs text-muted-foreground whitespace-pre-wrap">
															{reply.body}
														</span>
													</span>
												</Button>
											))}
										</div>
									) : (
										<p className="px-3 py-6 text-center text-sm text-muted-foreground">
											No saved replies match your search.
										</p>
									)}
								</div>
							</DialogContent>
						</Dialog>
					) : null}
				</div>
				{showSubject && !isNote ? (
					<fieldset
						disabled={busy || locked}
						className="flex flex-col overflow-hidden rounded-lg border bg-card text-sm"
					>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
							<label
								htmlFor="reply-from-mailbox"
								className="flex min-w-0 flex-1 items-center gap-2"
							>
								<span className="shrink-0 text-xs font-medium text-muted-foreground">
									From
								</span>
								<Select
									aria-label="Reply from mailbox"
									value={mailboxId || undefined}
									onValueChange={(value) =>
										edit({ mailboxId: value, confirmPrivateIdentity: false })
									}
								>
									<SelectTrigger
										id="reply-from-mailbox"
										className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none"
										aria-label="Reply from mailbox"
									>
										<SelectValue placeholder="Select authorized identity…" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{context.data?.mailboxes.map((m) => (
												<SelectItem
													key={m.id}
													value={m.id}
													disabled={!m.isEnabled || !m.isSendEnabled}
												>
													{m.canonicalAddress} · {m.type}
													{m.id === context.data.receivingMailboxId
														? " · receiving mailbox"
														: ""}
													{!m.isSendEnabled ? " · sending disabled" : ""}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</label>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								aria-expanded={showEmailSubject}
								onClick={() => setShowEmailSubject((shown) => !shown)}
							>
								Subject
							</Button>
						</div>
						<div className="flex items-center gap-2 border-t px-3 py-2 text-xs">
							<span className="font-medium text-muted-foreground">To</span>
							<span className="truncate">
								{context.data?.recipient || "Unavailable"}
							</span>
						</div>
						{showEmailSubject ? (
							<label
								htmlFor="reply-subject"
								className="flex items-center gap-2 border-t px-3 py-2"
							>
								<span className="text-xs font-medium text-muted-foreground">
									Subject
								</span>
								<Input
									id="reply-subject"
									className="h-8 border-0 bg-transparent px-0 shadow-none"
									value={subject}
									onChange={(e) => edit({ subject: e.target.value })}
								/>
							</label>
						) : null}
						<p className="border-t px-3 py-2 text-xs text-muted-foreground">
							Reply only. No reply-all, forwarding, Cc or Bcc.
						</p>
						{privateOverride ? (
							<Field orientation="horizontal">
								<Checkbox
									id="confirm-private-identity"
									checked={!!draft.confirmPrivateIdentity}
									onCheckedChange={(checked) =>
										edit({ confirmPrivateIdentity: checked === true })
									}
								/>
								<FieldLabel htmlFor="confirm-private-identity">
									I confirm the reply to this shared conversation will use my
									authorized private identity ({from?.canonicalAddress}).
								</FieldLabel>
							</Field>
						) : null}
					</fieldset>
				) : null}
				{showSubject && !isNote && (!hydrated || context.isError) ? (
					<p role="status" className="text-sm">
						{context.isError
							? "Email context unavailable; sending disabled."
							: !hydrated
								? "Loading server draft…"
								: ""}
					</p>
				) : null}
				{attachmentsUnavailable ? (
					<p role="status" className="text-sm text-muted-foreground">
						WhatsApp supports text replies only; attachments are unavailable.
					</p>
				) : null}
				{!isNote ? (
					<div className="flex flex-wrap gap-2">
						{draft.attachments?.map((a) => (
							<div
								key={a.id}
								className="flex items-center gap-1 rounded border p-1 text-xs"
							>
								<a
									href={
										showSubject
											? emailApi.attachmentUrl(a.id, workspaceId)
											: a.url
									}
									target="_blank"
									rel="noopener noreferrer"
									className="underline"
								>
									{showSubject ? (
										a.name
									) : (
										<img
											src={a.url}
											alt={a.name}
											className="size-16 object-cover"
										/>
									)}
								</a>
								<button
									type="button"
									disabled={busy || locked || attachmentsUnavailable}
									aria-label={`Remove ${a.name}`}
									onClick={() =>
										edit({
											attachments: draft.attachments?.filter(
												(item) => item.id !== a.id,
											),
										})
									}
								>
									×
								</button>
							</div>
						))}
					</div>
				) : null}
				{error ? (
					<Alert variant="destructive">
						<AlertTitle>Unable to send</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
				<div className="flex items-end gap-2">
					{!isNote ? (
						<>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="icon"
										disabled={busy || locked || attachmentsUnavailable}
										aria-label="Add attachments"
										onClick={() => attachmentInputRef.current?.click()}
									>
										<Paperclip />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Add attachments</TooltipContent>
							</Tooltip>
							<input
								ref={attachmentInputRef}
								type="file"
								accept={(showSubject ? EMAIL_TYPES : IMAGE_TYPES).join(",")}
								multiple
								className="sr-only"
								disabled={busy || locked || attachmentsUnavailable}
								onChange={(e) => {
									void upload(e.target.files);
									e.currentTarget.value = "";
								}}
							/>
						</>
					) : null}
					<div className="relative flex-1">
						<Textarea
							ref={replyInputRef}
							aria-label={isNote ? "Comment text" : "Reply text"}
							value={text}
							disabled={busy || (!isNote && locked)}
							onChange={(e) =>
								isNote
									? setNote(e.target.value)
									: edit({ text: e.target.value })
							}
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									(e.metaKey || e.ctrlKey) &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									if (canSend && !busy) void submit(e);
									return;
								}
								if (
									e.key === "Enter" &&
									!e.shiftKey &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									void submit(e);
								}
							}}
							placeholder={
								isNote
									? "Write a comment… Type @ to mention a teammate"
									: "Write a reply…"
							}
							rows={3}
							className="resize-none"
						/>
						{candidates.length ? (
							<div className="absolute bottom-full mb-1 w-full rounded-md border bg-background p-1 shadow">
								{candidates.map((user) => (
									<button
										key={user.id}
										type="button"
										disabled={busy}
										onClick={() => selectMention(user)}
										className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
									>
										@{user.name}
									</button>
								))}
							</div>
						) : null}
					</div>
					<Button type="submit" size="sm" disabled={busy || !canSend}>
						{busy ? "Working…" : isNote ? "Comment" : "Send"}
					</Button>
				</div>
				{showSubject && !isNote ? (
					<>
						<p role="status" className="text-xs text-muted-foreground">
							{locked
								? `Attempt ${draft.clientMessageId}: ${delivery?.state ?? "uncertain"}. No resend until reconciled.`
								: saveStatus}{" "}
							· Private PDF/images, 5 MiB combined. Drafts are stored on the
							server, never in browser storage.
						</p>
						{locked ? (
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => void context.refetch()}
								>
									Refresh server status
								</Button>
								{accepted || delivery?.state === "accepted" ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={busy}
										onClick={() => void clearAccepted()}
									>
										Clear accepted draft
									</Button>
								) : null}
							</div>
						) : null}
					</>
				) : null}
			</FieldGroup>
		</form>
	);
}
