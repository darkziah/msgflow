import type { Attachment } from "@msgflow/contracts";
import type { ProviderImageAttachment } from "@msgflow/channel";
import type { Env } from "./env";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const IMAGE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export class AttachmentError extends Error {}

function isImageType(value: string): value is ImageType {
	return (IMAGE_TYPES as readonly string[]).includes(value.toLowerCase());
}

function publicBaseUrl(env: Env): string {
	const base = env.ATTACHMENT_PUBLIC_BASE_URL;
	if (!base || base.endsWith("/")) {
		throw new AttachmentError(
			"ATTACHMENT_PUBLIC_BASE_URL must be configured without a trailing slash",
		);
	}
	try {
		const url = new URL(base);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
	} catch {
		throw new AttachmentError("ATTACHMENT_PUBLIC_BASE_URL must be an absolute URL");
	}
	return base;
}

function safeFilename(name: string | null | undefined, type: ImageType): string {
	const fallback = `image.${type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1]}`;
	const candidate = (name ?? fallback)
		.normalize("NFKC")
		.split("")
		.map((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || code === 127 || char === "/" || char === "\\"
				? "-"
				: char;
		})
		.join("")
		.replace(/[^\p{L}\p{N}._ -]/gu, "-")
		.trim()
		.slice(0, 120);
	return candidate || fallback;
}

function extension(type: ImageType): string {
	return type === "image/jpeg" ? "jpg" : type.slice("image/".length);
}

export async function storeImageBlob(
	env: Env,
	blob: Blob,
	filename?: string | null,
): Promise<Attachment> {
	const type = blob.type.toLowerCase();
	if (!isImageType(type)) {
		throw new AttachmentError("only JPEG, PNG, GIF, and WebP images are accepted");
	}
	if (blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) {
		throw new AttachmentError("each image must be between 1 byte and 10 MiB");
	}
	const name = safeFilename(filename, type);
	const id = crypto.randomUUID();
	const key = `attachments/${id}.${extension(type)}`;
	// Pass the Blob itself so Workers and Miniflare know its content length.
	await env.ATTACHMENTS.put(key, blob, {
		httpMetadata: {
			contentType: type,
			contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
		},
	});
	return { id, key, type, url: `${publicBaseUrl(env)}/${key}`, name, size: blob.size };
}

export function validateAttachments(env: Env, value: unknown): Attachment[] {
	if (!Array.isArray(value)) throw new AttachmentError("attachments must be an array");
	if (value.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new AttachmentError(`a message can contain at most ${MAX_ATTACHMENTS_PER_MESSAGE} images`);
	}
	const base = publicBaseUrl(env);
	const seen = new Set<string>();
	return value.map((item) => {
		if (!item || typeof item !== "object") throw new AttachmentError("invalid attachment");
		const attachment = item as Partial<Attachment>;
		if (
			typeof attachment.id !== "string" ||
			typeof attachment.key !== "string" ||
			typeof attachment.url !== "string" ||
			typeof attachment.name !== "string" ||
			typeof attachment.size !== "number" ||
			!isImageType(attachment.type ?? "") ||
			attachment.size <= 0 ||
			attachment.size > MAX_IMAGE_BYTES ||
			!attachment.key.match(/^attachments\/[0-9a-f-]{36}\.(jpg|png|gif|webp)$/) ||
			attachment.url !== `${base}/${attachment.key}` ||
			seen.has(attachment.key)
		) {
			throw new AttachmentError("invalid attachment metadata");
		}
		seen.add(attachment.key);
		return attachment as Attachment;
	});
}

/** Best-effort provider copy: unsupported/broken provider media never blocks ingest. */
export async function copyProviderImages(
	env: Env,
	images: ProviderImageAttachment[] | undefined,
): Promise<Attachment[]> {
	const copied: Attachment[] = [];
	for (const image of (images ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
		try {
			const response = await fetch(image.url);
			if (!response.ok) continue;
			const blob = await response.blob();
			copied.push(await storeImageBlob(env, blob, image.name));
		} catch {
			// A provider URL can expire or reject the Worker. Keep the text message.
		}
	}
	return copied;
}

export async function readAttachment(
	env: Env,
	attachment: Attachment,
): Promise<ArrayBuffer | null> {
	const object = await env.ATTACHMENTS.get(attachment.key);
	if (!object || !isImageType(object.httpMetadata?.contentType ?? attachment.type)) return null;
	return object.arrayBuffer();
}
