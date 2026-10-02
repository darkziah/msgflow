import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";

const MAX_FORMATTED_EMAIL_BYTES = 256 * 1024;
const INLINE_IMAGE_ORIGIN = "https://msgflow.invalid";

function normalizeContentId(value: string | undefined): string | null {
	const id = value?.trim().replace(/^<|>$/g, "");
	return id && /^[A-Za-z0-9._@+-]{1,200}$/.test(id) ? id : null;
}

/**
 * Produces a stored, safe display fragment for inbound email. Raw HTML remains
 * only in the private MIME archive. Images may only refer to an exact stored
 * inline CID attachment; all other src values are removed before sanitization.
 */
export async function sanitizeInboundEmailHtml(
	html: string | undefined,
	inlineCidUrls: ReadonlyMap<string, string>,
): Promise<string | undefined> {
	if (!html || new TextEncoder().encode(html).byteLength > MAX_FORMATTED_EMAIL_BYTES)
		return undefined;

	const cidSource = html.replace(
		/\bsrc\s*=\s*(["'])\s*cid:([^"'\s>]+)\1/gi,
		(_, quote: string, rawCid: string) => {
			const cid = normalizeContentId(rawCid);
			const url = cid ? inlineCidUrls.get(cid) : undefined;
			return url ? `src=${quote}${INLINE_IMAGE_ORIGIN}${url}${quote}` : "";
		},
	);
	// Email HTML must never load remote, data, blob, or protocol-relative assets.
	const withoutRemoteSources = cidSource.replace(
		/\bsrc\s*=\s*(["'])(?!(?:https:\/\/msgflow\.invalid\/api\/email-attachments\/))[^"']*\1/gi,
		"",
	);
	const schema = structuredClone(defaultSchema);
	schema.tagNames = [
		"a",
		"b",
		"blockquote",
		"br",
		"code",
		"div",
		"em",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"img",
		"li",
		"ol",
		"p",
		"pre",
		"span",
		"strong",
		"table",
		"tbody",
		"td",
		"th",
		"thead",
		"tr",
		"ul",
	];
	schema.attributes = {
		...schema.attributes,
		a: ["href", "title"],
		img: ["src", "alt", "title", "width", "height"],
	};
	schema.protocols = {
		...schema.protocols,
		src: ["https"],
	};

	const result = await unified()
		.use(rehypeParse, { fragment: true })
		.use(rehypeSanitize, schema)
		.use(rehypeStringify)
		.process(withoutRemoteSources);
	return String(result).replaceAll(INLINE_IMAGE_ORIGIN, "").trim() || undefined;
}

export { normalizeContentId };
