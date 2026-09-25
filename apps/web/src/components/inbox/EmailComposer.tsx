import type { Comment } from "@msgflow/contracts";
import { Composer } from "./Composer";

interface Props {
	conversationId: string;
	onSent?: () => void;
	onCommentCreated?: (comment: Comment) => void;
}

/** Compatibility entry point; the unified composer owns server drafts. */
export function EmailComposer(props: Props) {
	return <Composer key={props.conversationId} {...props} showSubject />;
}
