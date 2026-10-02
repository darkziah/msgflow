import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export function NewEmailDialog({
	workspaceId,
	open,
	onOpenChange,
	onSent,
}: {
	workspaceId: string;
	open: boolean;
	onOpenChange(open: boolean): void;
	onSent(conversationId: string): void;
}) {
	const [to, setTo] = useState("");
	const [subject, setSubject] = useState("");
	const [text, setText] = useState("");
	const [mailboxId, setMailboxId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const mailboxes = useQuery({
		queryKey: ["mailboxes", workspaceId],
		queryFn: () => api.listMailboxes(workspaceId),
		enabled: open,
	});
	const available = (mailboxes.data?.mailboxes ?? []).filter(
		(mailbox) => mailbox.isEnabled && mailbox.isSendEnabled,
	);
	async function send(event: React.FormEvent) {
		event.preventDefault();
		if (!to.trim() || !text.trim() || !mailboxId || sending) return;
		setSending(true);
		setError(null);
		try {
			const result = await api.composeEmail(workspaceId, {
				to: to.trim(),
				subject: subject.trim(),
				text: text.trim(),
				mailboxId,
				clientMessageId: crypto.randomUUID(),
			});
			onOpenChange(false);
			setTo("");
			setSubject("");
			setText("");
			setMailboxId("");
			onSent(result.conversationId);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not send email.",
			);
		} finally {
			setSending(false);
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New email</DialogTitle>
					<DialogDescription>
						Send from an authorized mailbox. Delivery is confirmed only after
						the provider accepts it.
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-3" onSubmit={send}>
					<Input
						aria-label="To"
						value={to}
						onChange={(event) => setTo(event.target.value)}
						placeholder="recipient@example.com"
						type="email"
						required
					/>
					<Select value={mailboxId} onValueChange={setMailboxId}>
						<SelectTrigger aria-label="From">
							<SelectValue placeholder="Select From mailbox" />
						</SelectTrigger>
						<SelectContent>
							{available.map((mailbox) => (
								<SelectItem key={mailbox.id} value={mailbox.id}>
									{mailbox.canonicalAddress}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						aria-label="Subject"
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder="Subject"
					/>
					<Textarea
						aria-label="Message"
						value={text}
						onChange={(event) => setText(event.target.value)}
						placeholder="Write your email…"
						rows={8}
						required
					/>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					<Button
						type="submit"
						disabled={sending || !to.trim() || !text.trim() || !mailboxId}
					>
						{sending ? "Sending…" : "Send email"}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
