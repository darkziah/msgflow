import { ManageError } from "./errors";

export const RESERVED_PRIVATE_LOCAL_PARTS = new Set([
	"postmaster",
	"abuse",
	"admin",
	"administrator",
	"root",
	"hostmaster",
	"webmaster",
	"security",
	"mailer-daemon",
	"noreply",
	"no-reply",
	"support",
	"sales",
]);

const LOCAL_PART = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

export function normalizeEmailDomain(input: string): string {
	const value = input.trim().toLowerCase().replace(/\.$/, "");
	if (!value || /[\s/@\\:?#%[\]]/.test(value)) {
		throw new ManageError("invalid email domain");
	}
	let hostname: string;
	try {
		hostname = new URL(`https://${value}`).hostname.toLowerCase();
	} catch {
		throw new ManageError("invalid email domain");
	}
	if (
		!hostname.includes(".") ||
		hostname.length > 253 ||
		/^[0-9.]+$/.test(hostname) ||
		hostname
			.split(".")
			.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	) {
		throw new ManageError("invalid email domain");
	}
	return hostname;
}

export function normalizeLocalPart(
	input: string,
	kind: "private" | "shared",
): string {
	const localPart = input.trim().toLowerCase();
	if (
		!LOCAL_PART.test(localPart) ||
		localPart.includes("..") ||
		localPart.endsWith(".")
	) {
		throw new ManageError(
			"local part must be lowercase ASCII letters, numbers, dots, or hyphens",
		);
	}
	if (kind === "private" && RESERVED_PRIVATE_LOCAL_PARTS.has(localPart)) {
		throw new ManageError(
			"local part is reserved for operational or shared use",
			409,
		);
	}
	return localPart;
}

export function canonicalAddress(
	localPart: string,
	canonicalDomain: string,
): string {
	return `${normalizeLocalPart(localPart, "shared")}@${normalizeEmailDomain(canonicalDomain)}`;
}
