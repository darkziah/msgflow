import type {
	Comment,
	SendMessageRequest,
	UserSummary,
} from "@msgflow/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { emailApi } from "@/lib/email-api";

interface Props {
	noteOnly?: boolean;
	conversationId: string;
	showSubject?: boolean;
	onSent?: () => void;
	onCommentCreated?: (comment: Comment) => void;
}
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const EMAIL_TYPES = [...IMAGE_TYPES, "application/pdf"];
const empty = (): SendMessageRequest => ({
	text: "",
	attachments: [],
	confirmPrivateIdentity: false,
});
export function Composer({
	conversationId,
	showSubject = false,
	onSent,
	onCommentCreated,
	noteOnly,
}: Props) {
	const [mode, setMode] = useState<"reply" | "note">(
		noteOnly ? "note" : "reply",
	);
	const [draft, setDraft] = useState<SendMessageRequest>(empty);
	const [note, setNote] = useState("");
	const [mentionIds, setMentionIds] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saveStatus, setSaveStatus] = useState("");
	const [hydrated, setHydrated] = useState(!showSubject);
	const [accepted, setAccepted] = useState(false);
	const dirty = useRef(false);
	const busyRef = useRef(false);
	const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
	const revision = useRef(0);
	const serverRevision = useRef(0);
	const isNote = mode === "note";
	const locked = showSubject && !!draft.clientMessageId;
	const context = useQuery({
		queryKey: ["email-context", conversationId],
		queryFn: () => emailApi.context(conversationId),
		enabled: showSubject,
		refetchInterval: 5000,
	});
	const { data: usersData } = useQuery({
		queryKey: ["users"],
		queryFn: () => api.listUsers(),
	});
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
			.getDraft(conversationId)
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
	}, [conversationId, showSubject]);

	const persist = useCallback(
		(payload: SendMessageRequest) => {
			// Serialize writes so an older autosave cannot arrive after submission/deletion.
			const next = saveQueue.current
				.catch(() => {})
				.then(async () => {
					const request = { ...payload, draftRevision: serverRevision.current };
					let result: Awaited<ReturnType<typeof emailApi.saveDraft>>;
					try {
						result = await emailApi.saveDraft(conversationId, request);
					} catch (error) {
						if (!request.clientMessageId) throw error;
						// Retry only the identical persisted submission, never a fresh ID.
						result = await emailApi.saveDraft(conversationId, request);
					}
					serverRevision.current = result.draft.draftRevision ?? 0;
					return result;
				});
			saveQueue.current = next;
			return next;
		},
		[conversationId],
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
			await emailApi.deleteDraft(conversationId, expectedId);
			// Read back the exact target before claiming the durable draft was cleared.
			const saved = (await emailApi.getDraft(conversationId)).draft;
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
				? await emailApi.upload(conversationId, list)
				: await api.uploadAttachments(list);
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
	async function submit(event: React.FormEvent) {
		event.preventDefault();
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
					text: note.trim(),
					mentions: mentionIds,
				});
				setNote("");
				setMentionIds([]);
				onCommentCreated?.(comment);
				return;
			}
			const payload: SendMessageRequest = {
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
			const result = await api.sendMessage(conversationId, payload);
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
	return (
		<form onSubmit={submit} className="space-y-2">
			<fieldset
				disabled={busy}
				className="flex items-center gap-1"
				aria-label="Composer mode"
			>
				<Button
					type="button"
					variant={isNote ? "ghost" : "secondary"}
					size="sm"
					disabled={noteOnly}
					aria-pressed={!isNote}
					onClick={() => setMode("reply")}
				>
					Reply
				</Button>
				<Button
					type="button"
					variant={isNote ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={isNote}
					onClick={() => setMode("note")}
				>
					Comment
				</Button>
			</fieldset>
			{showSubject && !isNote ? (
				<fieldset
					disabled={busy || locked}
					className="space-y-2 rounded-md border p-3 text-sm"
				>
					<label className="flex items-center gap-2">
						From{" "}
						<select
							aria-label="Reply from mailbox"
							value={mailboxId}
							onChange={(e) =>
								edit({
									mailboxId: e.target.value,
									confirmPrivateIdentity: false,
								})
							}
							className="min-w-0 flex-1 rounded border p-1"
						>
							<option value="">Select authorized identity…</option>
							{context.data?.mailboxes.map((m) => (
								<option
									key={m.id}
									value={m.id}
									disabled={!m.isEnabled || !m.isSendEnabled}
								>
									{m.canonicalAddress} · {m.type}
									{m.id === context.data.receivingMailboxId
										? " · receiving mailbox"
										: ""}
									{!m.isSendEnabled ? " · sending disabled" : ""}
								</option>
							))}
						</select>
					</label>
					<p>To: {context.data?.recipient || "Unavailable"}</p>
					<label className="flex items-center gap-2">
						Subject{" "}
						<input
							value={subject}
							onChange={(e) => edit({ subject: e.target.value })}
							className="min-w-0 flex-1 rounded border p-1"
						/>
					</label>
					<p className="text-xs text-muted-foreground">
						Reply only. No reply-all, forwarding, Cc or Bcc.
					</p>
					{privateOverride ? (
						<label className="flex gap-2 text-amber-800">
							<input
								type="checkbox"
								checked={!!draft.confirmPrivateIdentity}
								onChange={(e) =>
									edit({ confirmPrivateIdentity: e.target.checked })
								}
							/>
							I confirm the reply to this shared conversation will use my
							authorized private identity ({from?.canonicalAddress}).
						</label>
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
			{!isNote ? (
				<div className="flex flex-wrap gap-2">
					{draft.attachments?.map((a) => (
						<div
							key={a.id}
							className="flex items-center gap-1 rounded border p-1 text-xs"
						>
							<a
								href={showSubject ? emailApi.attachmentUrl(a.id) : a.url}
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
								disabled={busy || locked}
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
				<p role="alert" className="text-sm text-red-600">
					{error}
				</p>
			) : null}
			<div className="flex items-end gap-2">
				{!isNote ? (
					<label className="cursor-pointer text-sm">
						📎<span className="sr-only">Add attachments</span>
						<input
							type="file"
							accept={(showSubject ? EMAIL_TYPES : IMAGE_TYPES).join(",")}
							multiple
							className="sr-only"
							disabled={busy || locked}
							onChange={(e) => {
								void upload(e.target.files);
								e.currentTarget.value = "";
							}}
						/>
					</label>
				) : null}
				<div className="relative flex-1">
					<textarea
						aria-label={isNote ? "Comment text" : "Reply text"}
						value={text}
						disabled={busy || (!isNote && locked)}
						onChange={(e) =>
							isNote ? setNote(e.target.value) : edit({ text: e.target.value })
						}
						onKeyDown={(e) => {
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
						className="w-full resize-none rounded-md border px-3 py-2 text-sm"
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
		</form>
	);
}
