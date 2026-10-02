import { Schema } from "effect";
import { AttachmentSchema } from "@msgflow/contracts";

const AttachmentListSchema = Schema.Array(AttachmentSchema);

/**
 * Decode attachment metadata that survived a D1 round trip. Invalid legacy or
 * corrupted JSON is treated as absent rather than reaching a provider call.
 */
export function parseStoredAttachments(value: string): Array<
	Schema.Schema.Type<typeof AttachmentSchema>
> {
	try {
		const raw: unknown = JSON.parse(value);
		const decoded = Schema.decodeUnknownEither(AttachmentListSchema)(raw);
		return decoded._tag === "Right" ? [...decoded.right] : [];
	} catch {
		return [];
	}
}
