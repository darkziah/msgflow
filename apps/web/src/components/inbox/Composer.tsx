import type { SendMessageRequest } from "@msgflow/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Props {
	conversationId: string;
	showSubject?: boolean;
	onSent?: () => void;
}

export function Composer({ conversationId, showSubject, onSent }: Props) {
	const [text, setText] = useState("");
	const [subject, setSubject] = useState("");
	const [error, setError] = useState<string | null>(null);

	const { mutate, isPending } = useMutation({
		mutationFn: (body: SendMessageRequest) =>
			api.sendMessage(conversationId, body),
		onSuccess: () => {
			setText("");
			setError(null);
			onSent?.();
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to send.");
		},
	});

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isPending) return;
		mutate({
			text: trimmed,
			subject: showSubject && subject.trim() ? subject.trim() : undefined,
			clientMessageId: crypto.randomUUID(),
		});
	}

	return (
		<form onSubmit={submit} className="space-y-2">
			{showSubject ? (
				<input
					value={subject}
					onChange={(event) => setSubject(event.target.value)}
					placeholder="Subject"
					className="w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
			) : null}
			{error ? <p className="text-sm text-red-600">{error}</p> : null}
			<div className="flex items-end gap-2">
				<textarea
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit(event);
						}
					}}
					placeholder="Write a reply… (Enter to send, Shift+Enter for newline)"
					rows={2}
					className="flex-1 resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
				/>
				<Button type="submit" disabled={isPending || !text.trim()}>
					{isPending ? "Sending…" : "Send"}
				</Button>
			</div>
		</form>
	);
}
