import { decryptChannelToken } from "./channel-token-crypto";
import { ManageError } from "./errors";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_TIMEOUT_MS = 10_000;

interface EncryptedPageCredential {
	pageId: string;
	encryptedPageAccessToken: string | null;
	channelTokenEncryptionKey: string;
}

export interface MessengerInboundCallingInput extends Omit<EncryptedPageCredential, "encryptedPageAccessToken"> {
	encryptedPageAccessToken: string;
	timezoneId: string;
	weeklyOperatingHours: ReadonlyArray<{
		day_of_week: string;
		open_time: string;
		close_time: string;
	}>;
}

/**
 * The Graph provider is the credential boundary. Configuration code supplies
 * ciphertext and the Worker cryptographic secret; no caller receives plaintext.
 */
export async function configureMessengerInboundCalling(
	input: MessengerInboundCallingInput,
): Promise<void> {
	let pageAccessToken: string;
	try {
		pageAccessToken = await decryptChannelToken(
			input.encryptedPageAccessToken,
			input.channelTokenEncryptionKey,
		);
	} catch {
		throw new ManageError("Messenger Page credential is unavailable", 503);
	}

	const eligibilityResponse = await postToPage(
		input.pageId,
		"business_messaging_feature_status",
		pageAccessToken,
		{ features: [{ feature: "messenger_api_calling" }] },
		"eligibility",
	);
	const eligibility = eligibilityFrom(
		await confirmedJson(eligibilityResponse, "eligibility"),
	);
	if (eligibility === null) {
		throw new ManageError(
			"Messenger calling eligibility response is uncertain; retry",
			502,
		);
	}
	if (!eligibility) {
		throw new ManageError(
			"This Page is not eligible for Messenger calling",
			409,
		);
	}

	const settingsResponse = await postToPage(
		input.pageId,
		"messenger_call_settings",
		pageAccessToken,
		{
			call_hours: {
				timezone_id: input.timezoneId,
				weekly_operating_hours: input.weeklyOperatingHours,
			},
			call_routing: { ring_target: "PARTNERS" },
		},
		"call settings",
	);
	const settings = await confirmedJson(settingsResponse, "call settings");
	if (!isRecord(settings) || settings.result !== "success") {
		throw new ManageError(
			"Messenger call settings response is uncertain; retry",
			502,
		);
	}
}

/** Accept returns Meta's answer SDP to the winning request only; callers must not persist it. */
export interface MessengerCallSignalInput extends EncryptedPageCredential { providerCallId: string; offerSdp?: string; }
export async function acceptMessengerInboundCall(input: MessengerCallSignalInput): Promise<string> {
	if (!input.offerSdp) throw new ManageError("call offer is required", 400);
	const response = await postToPage(input.pageId, "calls", await decryptCredential(input), { call_id: input.providerCallId, action: "accept", sdp: input.offerSdp }, "accept call");
	const result = await confirmedJson(response, "accept call");
	if (!isRecord(result) || typeof result.sdp !== "string" || !result.sdp) throw new ManageError("Messenger accept response is uncertain; retry", 502);
	return result.sdp;
}
export async function rejectMessengerInboundCall(input: Omit<MessengerCallSignalInput, "offerSdp">): Promise<boolean> { return terminalSignal(input, "reject"); }
export async function terminateMessengerCall(input: Omit<MessengerCallSignalInput, "offerSdp">): Promise<boolean> { return terminalSignal(input, "terminate"); }
async function terminalSignal(input: Omit<MessengerCallSignalInput, "offerSdp">, action: "reject" | "terminate"): Promise<boolean> {
	try { await confirmedJson(await postToPage(input.pageId, "calls", await decryptCredential(input), { call_id: input.providerCallId, action }, `${action} call`), `${action} call`); return true; }
	catch (error) { return error instanceof ManageError && error.status === 400; }
}
async function decryptCredential(input: EncryptedPageCredential): Promise<string> {
	if (!input.encryptedPageAccessToken) throw new ManageError("Messenger Page credential is unavailable", 503);
	try { return await decryptChannelToken(input.encryptedPageAccessToken, input.channelTokenEncryptionKey); }
	catch { throw new ManageError("Messenger Page credential is unavailable", 503); }
}

async function postToPage(
	pageId: string,
	edge: string,
	pageAccessToken: string,
	body: Record<string, unknown>,
	operation: string,
): Promise<Response> {
	try {
		const response = await fetch(
			`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/${edge}`,
			{
				method: "POST",
				headers: Object.fromEntries([["content-type", "application/json"], ["authorization", `Bearer ${pageAccessToken}`]]),
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
			},
		);
		if (response.status >= 500) {
			throw new ManageError(`Messenger ${operation} is uncertain; retry`, 502);
		}
		if (!response.ok)
			throw new ManageError(`Meta rejected Messenger ${operation}`, 400);
		return response;
	} catch (error) {
		if (error instanceof ManageError) throw error;
		throw new ManageError(`Messenger ${operation} is uncertain; retry`, 502);
	}
}

async function confirmedJson(
	response: Response,
	operation: string,
): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new ManageError(
			`Messenger ${operation} response is uncertain; retry`,
			502,
		);
	}
}

/** Accept only the documented matching data item with an enabled status. */
function eligibilityFrom(value: unknown): boolean | null {
	if (!isRecord(value) || !Array.isArray(value.data)) return null;
	const feature = value.data.find(
		(item) => isRecord(item) && item.feature === "messenger_api_calling",
	);
	if (!isRecord(feature) || typeof feature.status !== "string") return null;
	if (feature.status === "ENABLED") return true;
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
