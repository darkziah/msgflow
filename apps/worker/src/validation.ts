import { Either, Schema } from "effect";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyDecodeResult<A> =
	| { ok: true; value: A }
	| {
			ok: false;
			error:
				| "invalid json body"
				| "request body too large"
				| "invalid request body";
	  };

/**
 * Read and decode a JSON request at the HTTP boundary without throwing.
 *
 * Syntax, size, and schema failures deliberately map to the Worker’s existing
 * `{ success: false, error }` 400 convention. Parse details are not exposed:
 * Effect errors can contain invalid values, which may include PII.
 */
export async function decodeJsonBody<A, I>(
	request: Request,
	schema: Schema.Schema<A, I, never>,
	maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyDecodeResult<A>> {
	const contentLength = request.headers.get("content-length");
	if (contentLength && Number(contentLength) > maxBytes) {
		return { ok: false, error: "request body too large" };
	}

	let text: string;
	try {
		text = await readBodyAtMost(request, maxBytes);
	} catch (error) {
		if (error instanceof BodyTooLargeError) {
			return { ok: false, error: "request body too large" };
		}
		return { ok: false, error: "invalid json body" };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, error: "invalid json body" };
	}

	const decoded = Schema.decodeUnknownEither(schema)(raw);
	return Either.isRight(decoded)
		? { ok: true, value: decoded.right }
		: { ok: false, error: "invalid request body" };
}

class BodyTooLargeError extends Error {}

async function readBodyAtMost(
	request: Request,
	limit: number,
): Promise<string> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			size += value.byteLength;
			if (size > limit) throw new BodyTooLargeError();
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}
