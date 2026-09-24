import type { Comment, CreateCommentRequest, SendMessageRequest, UserSummary } from "@msgflow/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Props { conversationId: string; showSubject?: boolean; onSent?: () => void; onCommentCreated?: (comment: Comment) => void; }
type ComposerMode = "reply" | "note";
type PendingImage = { file: File; preview: string };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 5;

export function Composer({ conversationId, showSubject, onSent, onCommentCreated }: Props) {
	const [mode, setMode] = useState<ComposerMode>("reply");
	const [text, setText] = useState("");
	const [subject, setSubject] = useState("");
	const [images, setImages] = useState<PendingImage[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [mentionIds, setMentionIds] = useState<string[]>([]);
	const { data: usersData } = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
	const isNote = mode === "note";
	const match = isNote ? text.match(/(?:^|\s)@([^\s@]*)$/) : null;
	const query = match?.[1]?.toLowerCase() ?? null;
	const candidates = query === null ? [] : (usersData?.users ?? []).filter((u) => u.name.toLowerCase().includes(query)).slice(0, 6);
	const sendMessage = useMutation({ mutationFn: async () => api.sendMessage(conversationId, { text: text.trim(), attachments: images.length ? (await api.uploadAttachments(images.map((i) => i.file))).attachments : [], subject: showSubject && subject.trim() ? subject.trim() : undefined, clientMessageId: crypto.randomUUID() } satisfies SendMessageRequest), onSuccess: () => { setText(""); setError(null); setImages((current) => { current.forEach((i) => { URL.revokeObjectURL(i.preview); }); return []; }); onSent?.(); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to send.") });
	const createComment = useMutation({ mutationFn: (body: CreateCommentRequest) => api.createComment(conversationId, body), onSuccess: ({ comment }) => { setText(""); setMentionIds([]); setError(null); onCommentCreated?.(comment); }, onError: (err) => setError(err instanceof Error ? err.message : "Failed to add comment.") });
	const isPending = sendMessage.isPending || createComment.isPending;
	function changeMode(next: ComposerMode) { setMode(next); setError(null); }
	function selectImages(files: FileList | null) { if (!files || isNote) return; const additions = Array.from(files); if (images.length + additions.length > MAX_IMAGES) return setError(`A message can contain at most ${MAX_IMAGES} images.`); if (additions.some((file) => !IMAGE_TYPES.includes(file.type) || file.size === 0 || file.size > MAX_BYTES)) return setError("Images must be JPEG, PNG, GIF, or WebP and no larger than 10 MiB."); setImages((current) => [...current, ...additions.map((file) => ({ file, preview: URL.createObjectURL(file) }))]); setError(null); }
	function removeImage(index: number) { setImages((current) => { const image = current[index]; if (image) URL.revokeObjectURL(image.preview); return current.filter((_, i) => i !== index); }); }
	function selectMention(user: UserSummary) { setText((current) => current.replace(/(?:^|\s)@([^\s@]*)$/, (value) => `${value.startsWith(" ") ? " " : ""}@${user.name} `)); setMentionIds((current) => current.includes(user.id) ? current : [...current, user.id]); }
	function submit(event: React.FormEvent) { event.preventDefault(); if (isPending) return; const trimmed = text.trim(); if (isNote) { if (trimmed) createComment.mutate({ text: trimmed, mentions: mentionIds }); } else if (trimmed || images.length) sendMessage.mutate(); }
	return <form onSubmit={submit} className="space-y-2"><fieldset className="flex items-center gap-1" aria-label="Composer mode"><Button type="button" variant={isNote ? "ghost" : "secondary"} size="sm" aria-pressed={!isNote} onClick={() => changeMode("reply")}>Reply</Button><Button type="button" variant={isNote ? "secondary" : "ghost"} size="sm" aria-pressed={isNote} onClick={() => changeMode("note")}>Comment</Button></fieldset>{showSubject && !isNote ? <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full rounded-md border px-3 py-1.5 text-sm" /> : null}{!isNote ? <fieldset className="flex flex-wrap gap-2" aria-label="Selected images">{images.map((image, index) => <div key={image.preview} className="relative"><img src={image.preview} alt={`Selected ${index + 1}`} className="size-16 rounded border object-cover" /><button type="button" onClick={() => removeImage(index)} disabled={isPending} className="absolute -right-1 -top-1 rounded bg-white px-1 text-xs shadow" aria-label={`Remove ${image.file.name}`}>×</button></div>)}</fieldset> : null}{error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}<div className="flex items-end gap-2">{!isNote ? <label className="cursor-pointer text-sm" title="Add images">📎<span className="sr-only">Add images</span><input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="sr-only" disabled={isPending} onChange={(e) => { selectImages(e.target.files); e.currentTarget.value = ""; }} /></label> : null}<div className="relative flex-1"><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }} placeholder={isNote ? "Write a comment… Type @ to mention a teammate" : "Write a reply…"} rows={2} className="w-full resize-none rounded-md border px-3 py-2 text-sm" />{candidates.length > 0 ? <div className="absolute bottom-full left-0 mb-1 w-64 overflow-hidden rounded-md border bg-background shadow-lg">{candidates.map((user) => <button key={user.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => selectMention(user)}>@{user.name}</button>)}</div> : null}</div><Button type="submit" disabled={isPending || (!text.trim() && (isNote || images.length === 0))}>{isPending ? (isNote ? "Adding…" : "Uploading…") : isNote ? "Add comment" : "Send"}</Button></div></form>;
}
