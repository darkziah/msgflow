import {
	emailDomains,
	inboxes,
	mailboxDelegates,
	mailboxes,
	teams,
	user,
	workspaceMembers,
} from "@msgflow/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
	requireOwnerAccess,
	requireWorkspaceAccess,
	userBelongsToWorkspace,
} from "./access";
import {
	canonicalAddress,
	normalizeEmailDomain,
	normalizeLocalPart,
} from "./email-address";
import { mailboxReadPredicate } from "./email-transport";
import type { Env } from "./env";
import { ManageError } from "./errors";

type DomainState = "pending" | "ready" | "suspended";

export interface EmailDomainCreateInput {
	canonicalDomain: string;
}

export interface EmailDomainStateUpdateInput {
	inboundState?: DomainState;
	outboundState?: DomainState;
	operatorConfirmed?: boolean;
}

export interface PrivateMailboxCreateInput {
	ownerUserId: string;
	emailDomainId: string;
}

export interface SharedMailboxCreateInput {
	emailDomainId: string;
	localPart: string;
	inboxId: string;
	teamId?: string | null;
}

export interface MailboxStateUpdateInput {
	isEnabled?: boolean;
	isSendEnabled?: boolean;
}

export interface MailboxDelegateInput {
	userId: string;
}

function dbFor(env: Env) {
	return drizzle(env.DB);
}

type Db = ReturnType<typeof dbFor>;
type EmailDomain = typeof emailDomains.$inferSelect;
type Mailbox = typeof mailboxes.$inferSelect;

export interface EmailDomainVerifyInput {
	routingConfirmed: boolean;
	sendingConfirmed: boolean;
	dkimSelector?: string;
}
export interface DomainDnsEvidence {
	checkedAt: string;
	dkimSelector: string;
	routingConfirmed: boolean;
	sendingConfirmed: boolean;
	routingDns: boolean;
	sendingDns: boolean;
	records: Record<string, string[]>;
}
function parseDnsEvidence(value: string): Partial<DomainDnsEvidence> {
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

export function emailAuditStatement(
	env: Env,
	workspaceId: string,
	actorUserId: string | null,
	action: string,
	targetId: string,
	detail: unknown = {},
) {
	return env.DB.prepare(
		"INSERT INTO email_audit (id, workspace_id, actor_user_id, action, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).bind(
		crypto.randomUUID(),
		workspaceId,
		actorUserId,
		action,
		targetId,
		JSON.stringify(detail),
		new Date().toISOString(),
	);
}
export async function appendEmailAudit(
	env: Env,
	workspaceId: string,
	actorUserId: string | null,
	action: string,
	targetId: string,
	detail: unknown = {},
): Promise<void> {
	await emailAuditStatement(
		env,
		workspaceId,
		actorUserId,
		action,
		targetId,
		detail,
	).run();
}

async function auditedMutation(
	env: Env,
	workspaceId: string,
	actorUserId: string,
	action: string,
	targetId: string,
	detail: unknown,
	mutation: { toSQL(): { sql: string; params: unknown[] } },
) {
	const query = mutation.toSQL();
	await env.DB.batch([
		env.DB.prepare(query.sql).bind(...query.params),
		emailAuditStatement(
			env,
			workspaceId,
			actorUserId,
			action,
			targetId,
			detail,
		),
	]);
}

/** Public DNS is evidence, never proof of dashboard/Worker routing configuration. */
export async function verifyEmailDomain(
	env: Env,
	workspaceId: string,
	domainId: string,
	input: EmailDomainVerifyInput,
	actorUserId: string,
	dnsFetch: typeof fetch = fetch,
): Promise<EmailDomain> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const domain = await getDomainInWorkspace(db, workspaceId, domainId);
	const selector =
		input.dkimSelector ??
		parseDnsEvidence(domain.dnsStatusJson).dkimSelector ??
		"cf-bounce";
	if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(selector))
		throw new ManageError("invalid DKIM selector");
	const name = domain.canonicalDomain;
	const queries: [string, string][] = [
		[name, "MX"],
		[name, "TXT"],
		[`cf2024-1._domainkey.${name}`, "TXT"],
		[`cf-bounce.${name}`, "MX"],
		[`cf-bounce.${name}`, "TXT"],
		[`${selector}._domainkey.${name}`, "TXT"],
		[`_dmarc.${name}`, "TXT"],
	];
	const records: Record<string, string[]> = {};
	await Promise.all(
		queries.map(async ([host, type]) => {
			const key = `${host}/${type}`;
			try {
				const response = await dnsFetch(
					`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
					{
						headers: { accept: "application/dns-json" },
						signal: AbortSignal.timeout(5000),
					},
				);
				if (!response.ok) throw new Error("DNS lookup failed");
				const result = (await response.json()) as {
					Status?: number;
					Answer?: { type: number; data: string }[];
				};
				records[key] =
					result.Status === 0
						? (result.Answer ?? [])
								.filter((r) => r.type === (type === "MX" ? 15 : 16))
								.map((r) => r.data.replace(/"\s*"/g, "").replace(/^"|"$/g, ""))
						: [];
			} catch {
				records[key] = [];
			}
		}),
	);
	const mx = (host: string) => {
		const rows = records[`${host}/MX`] ?? [];
		return (
			rows.length > 0 &&
			rows.every((r) => /^\d+\s+route[123]\.mx\.cloudflare\.net\.?$/i.test(r))
		);
	};
	const spf = (host: string) => {
		const rows = (records[`${host}/TXT`] ?? []).filter((r) =>
			/^v=spf1\s/i.test(r),
		);
		return (
			rows.length === 1 &&
			/(?:^|\s)include:_spf\.mx\.cloudflare\.net(?:\s|$)/i.test(
				rows[0] ?? "",
			) &&
			/\s[~-]all$/i.test(rows[0] ?? "")
		);
	};
	const dkim = (host: string) =>
		(records[`${host}/TXT`] ?? []).some(
			(r) =>
				/^v=DKIM1;/i.test(r) &&
				/(?:^|;)\s*p=[A-Za-z0-9+/]{32,}={0,2}(?:;|$)/.test(r),
		);
	const dmarc = (records[`_dmarc.${name}/TXT`] ?? []).filter((r) =>
		/^v=DMARC1;/i.test(r),
	);
	const evidence: DomainDnsEvidence = {
		checkedAt: new Date().toISOString(),
		dkimSelector: selector,
		routingConfirmed: input.routingConfirmed === true,
		sendingConfirmed: input.sendingConfirmed === true,
		routingDns: mx(name) && spf(name) && dkim(`cf2024-1._domainkey.${name}`),
		sendingDns:
			mx(`cf-bounce.${name}`) &&
			spf(`cf-bounce.${name}`) &&
			dkim(`${selector}._domainkey.${name}`) &&
			dmarc.length === 1 &&
			/;\s*p=(none|quarantine|reject)(;|$)/i.test(dmarc[0] ?? ""),
		records,
	};
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE email_domains SET dns_status_json = ?, updated_at = ?, inbound_state = CASE WHEN inbound_state = 'ready' AND ? = 0 THEN 'pending' ELSE inbound_state END, outbound_state = CASE WHEN outbound_state = 'ready' AND ? = 0 THEN 'pending' ELSE outbound_state END WHERE id = ? AND workspace_id = ?",
		).bind(
			JSON.stringify(evidence),
			evidence.checkedAt,
			Number(evidence.routingDns && evidence.routingConfirmed),
			Number(evidence.sendingDns && evidence.sendingConfirmed),
			domainId,
			workspaceId,
		),
		emailAuditStatement(
			env,
			workspaceId,
			actorUserId,
			"domain.verify",
			domainId,
			evidence,
		),
	]);
	return getDomainInWorkspace(db, workspaceId, domainId);
}

/** Only explicit logical rows can be repaired; never creates an address on ingress. */
export async function repairMailboxTransport(
	env: Env,
	mailboxId: string,
): Promise<void> {
	const mailbox = await dbFor(env)
		.select()
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.get();
	if (!mailbox || mailbox.isEnabled || mailbox.isSendEnabled) return;
	const existing = await env.DB.prepare(
		"SELECT id, type FROM channels WHERE workspace_id = ? AND external_id = ?",
	)
		.bind(mailbox.workspaceId, mailbox.canonicalAddress)
		.first<{ id: string; type: string }>();
	if (existing && existing.type !== "email")
		throw new ManageError("mailbox channel collision", 409);
	const channelId = existing?.id ?? `mailbox-channel:${mailbox.id}`;
	const inboxId = mailbox.inboxId ?? `mailbox-inbox:${mailbox.id}`;
	const defaultLink = await env.DB.prepare(
		"SELECT inbox_id FROM inbox_channels WHERE channel_id = ? AND is_default = 1",
	)
		.bind(channelId)
		.first<{ inbox_id: string }>();
	if (defaultLink && defaultLink.inbox_id !== inboxId)
		throw new ManageError("mailbox default inbox collision", 409);
	const statements = [
		env.DB.prepare(
			"INSERT OR IGNORE INTO channels(id, workspace_id, type, display_name, external_id, status, created_at, updated_at) SELECT ?, workspace_id, 'email', canonical_address, canonical_address, 'active', created_at, updated_at FROM mailboxes WHERE id = ? AND is_enabled = 0 AND is_send_enabled = 0",
		).bind(channelId, mailboxId),
	];
	if (mailbox.type === "private")
		statements.push(
			env.DB.prepare(
				"INSERT OR IGNORE INTO inboxes(id, workspace_id, name, created_at) SELECT ?, workspace_id, canonical_address, created_at FROM mailboxes WHERE id = ? AND is_enabled = 0 AND is_send_enabled = 0",
			).bind(inboxId, mailboxId),
		);
	statements.push(
		env.DB.prepare(
			"INSERT OR IGNORE INTO inbox_channels(id, inbox_id, channel_id, is_default) SELECT ?, ?, c.id, 1 FROM channels c JOIN mailboxes m ON m.workspace_id = c.workspace_id AND m.canonical_address = c.external_id WHERE m.id = ? AND m.is_enabled = 0 AND m.is_send_enabled = 0 AND NOT EXISTS (SELECT 1 FROM inbox_channels ic WHERE ic.channel_id = c.id AND ic.is_default = 1)",
		).bind(`mailbox-link:${mailboxId}`, inboxId, mailboxId),
	);
	await env.DB.batch(statements);
}

export async function listReadableMailboxes(
	env: Env,
	workspaceId: string,
	userId: string,
) {
	const db = dbFor(env);
	await requireWorkspaceAccess(db, workspaceId, userId);
	const rows = await db
		.select()
		.from(mailboxes)
		.where(
			and(eq(mailboxes.workspaceId, workspaceId), mailboxReadPredicate(userId)),
		)
		.orderBy(asc(mailboxes.canonicalAddress))
		.all();
	return Promise.all(
		rows.map(async (mailbox) => {
			const counts = await env.DB.prepare(
				"SELECT count(*) AS totalCount, sum(CASE WHEN cv.status = 'open' AND (cv.snoozed_until IS NULL OR cv.snoozed_until <= ?) THEN 1 ELSE 0 END) AS openCount FROM conversations cv JOIN channels c ON c.id = cv.channel_id WHERE cv.workspace_id = ? AND c.workspace_id = ? AND c.type = 'email' AND c.external_id = ?",
			)
				.bind(
					new Date().toISOString(),
					workspaceId,
					workspaceId,
					mailbox.canonicalAddress,
				)
				.first<{ totalCount: number; openCount: number | null }>();
			return {
				...mailbox,
				totalCount: counts?.totalCount ?? 0,
				openCount: counts?.openCount ?? 0,
			};
		}),
	);
}

export interface BulkPrivateMailboxInput {
	emailDomainId: string;
	excludeUserIds?: string[];
}
export interface BulkPrivateMailboxPreviewRow {
	userId: string;
	username: string | null;
	canonicalAddress: string | null;
	eligible: boolean;
	reason: string | null;
}
export async function previewBulkPrivateMailboxes(
	env: Env,
	workspaceId: string,
	input: BulkPrivateMailboxInput,
	actorUserId: string,
): Promise<BulkPrivateMailboxPreviewRow[]> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const domain = await getDomainInWorkspace(
		db,
		workspaceId,
		input.emailDomainId,
	);
	const members = await db
		.select({ userId: user.id, username: user.username })
		.from(workspaceMembers)
		.innerJoin(user, eq(user.id, workspaceMembers.userId))
		.where(eq(workspaceMembers.workspaceId, workspaceId))
		.all();
	const existing = new Set(
		(
			await db
				.select({ address: mailboxes.canonicalAddress })
				.from(mailboxes)
				.where(eq(mailboxes.emailDomainId, domain.id))
				.all()
		).map((r) => r.address),
	);
	return members.map((member) => {
		let address: string | null = null;
		let reason: string | null = null;
		try {
			if (!member.username) throw new Error();
			address = canonicalAddress(
				normalizeLocalPart(member.username, "private"),
				domain.canonicalDomain,
			);
		} catch {
			reason = "username missing or invalid";
		}
		if (address && existing.has(address)) reason = "address collision";
		if (input.excludeUserIds?.includes(member.userId)) reason = "excluded";
		return {
			...member,
			canonicalAddress: address,
			eligible: reason === null,
			reason,
		};
	});
}
export async function commitBulkPrivateMailboxes(
	env: Env,
	workspaceId: string,
	input: BulkPrivateMailboxInput & { userIds: string[] },
	actorUserId: string,
): Promise<Mailbox[]> {
	const preview = await previewBulkPrivateMailboxes(
		env,
		workspaceId,
		input,
		actorUserId,
	);
	const selected = [...new Set(input.userIds)];
	if (selected.length > 100)
		throw new ManageError("bulk commit is limited to 100 mailboxes");
	if (
		selected.some(
			(id) => !preview.some((row) => row.userId === id && row.eligible),
		)
	)
		throw new ManageError(
			"bulk selection contains an excluded or colliding account; preview again",
			409,
		);
	const now = new Date().toISOString();
	const statements = selected.flatMap((userId) => {
		const row = preview.find((r) => r.userId === userId)!;
		const id = crypto.randomUUID();
		return [
			env.DB.prepare(
				"INSERT INTO mailboxes(id, workspace_id, email_domain_id, local_part, canonical_address, type, owner_user_id, is_enabled, is_send_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'private', ?, 0, 0, ?, ?)",
			).bind(
				id,
				workspaceId,
				input.emailDomainId,
				row.username,
				row.canonicalAddress,
				userId,
				now,
				now,
			),
			emailAuditStatement(env, workspaceId, actorUserId, "mailbox.create", id, {
				ownerUserId: userId,
			}),
		];
	});
	if (statements.length) await env.DB.batch(statements);
	return dbFor(env)
		.select()
		.from(mailboxes)
		.where(
			and(
				eq(mailboxes.workspaceId, workspaceId),
				eq(mailboxes.emailDomainId, input.emailDomainId),
				inArray(mailboxes.ownerUserId, selected),
			),
		)
		.all();
}

export async function assignLegacyUsername(
	env: Env,
	workspaceId: string,
	userId: string,
	username: string,
	actorUserId: string,
): Promise<void> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	if (!(await userBelongsToWorkspace(db, workspaceId, userId)))
		throw new ManageError("user not found", 404);
	const normalized = normalizeLocalPart(username, "private");
	if (normalized !== username)
		throw new ManageError("username must already be canonical");
	const existing = await db
		.select({ username: user.username })
		.from(user)
		.where(eq(user.id, userId))
		.get();
	if (existing?.username) throw new ManageError("username is immutable", 409);
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE user SET username = ? WHERE id = ? AND username IS NULL",
		).bind(username, userId),
		emailAuditStatement(
			env,
			workspaceId,
			actorUserId,
			"username.assign",
			userId,
			{ username },
		),
	]);
}

async function getDomainInWorkspace(
	db: Db,
	workspaceId: string,
	id: string,
): Promise<EmailDomain> {
	const domain = await db
		.select()
		.from(emailDomains)
		.where(
			and(eq(emailDomains.id, id), eq(emailDomains.workspaceId, workspaceId)),
		)
		.get();
	if (!domain) throw new ManageError("email domain not found", 404);
	return domain;
}

async function getMailboxInWorkspace(
	db: Db,
	workspaceId: string,
	id: string,
): Promise<Mailbox> {
	const mailbox = await db
		.select()
		.from(mailboxes)
		.where(and(eq(mailboxes.id, id), eq(mailboxes.workspaceId, workspaceId)))
		.get();
	if (!mailbox) throw new ManageError("mailbox not found", 404);
	return mailbox;
}

async function assertMailboxAddressUnused(
	db: Db,
	canonical: string,
): Promise<void> {
	const existing = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(eq(mailboxes.canonicalAddress, canonical))
		.get();
	if (existing)
		throw new ManageError("mailbox address is already assigned", 409);
}

export async function createEmailDomain(
	env: Env,
	workspaceId: string,
	input: EmailDomainCreateInput,
	actorUserId: string,
): Promise<EmailDomain> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const canonicalDomain = normalizeEmailDomain(input.canonicalDomain);
	const existing = await db
		.select()
		.from(emailDomains)
		.where(eq(emailDomains.canonicalDomain, canonicalDomain))
		.get();
	if (existing)
		throw new ManageError(
			"email domain is already assigned to a workspace",
			409,
		);

	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"domain.create",
		id,
		{ canonicalDomain },
		db.insert(emailDomains).values({
			id,
			workspaceId,
			canonicalDomain,
			inboundState: "pending",
			outboundState: "pending",
			dnsStatusJson: "{}",
			createdAt: now,
			updatedAt: now,
		}),
	);
	const created = await db
		.select()
		.from(emailDomains)
		.where(eq(emailDomains.canonicalDomain, canonicalDomain))
		.get();
	if (!created) throw new ManageError("email domain create failed", 500);
	if (created.id !== id)
		throw new ManageError(
			"email domain is already assigned to a workspace",
			409,
		);
	return created;
}

export async function listEmailDomains(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<EmailDomain[]> {
	const db = dbFor(env);
	await requireWorkspaceAccess(db, workspaceId, userId);
	return db
		.select()
		.from(emailDomains)
		.where(eq(emailDomains.workspaceId, workspaceId))
		.orderBy(asc(emailDomains.canonicalDomain))
		.all();
}

export async function updateEmailDomainState(
	env: Env,
	workspaceId: string,
	domainId: string,
	input: EmailDomainStateUpdateInput,
	actorUserId: string,
): Promise<EmailDomain> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const existing = await getDomainInWorkspace(db, workspaceId, domainId);
	const now = new Date().toISOString();
	const inboundState = input.inboundState ?? existing.inboundState;
	const outboundState = input.outboundState ?? existing.outboundState;
	const evidence = parseDnsEvidence(existing.dnsStatusJson);
	const fresh =
		evidence.checkedAt &&
		Date.now() - Date.parse(evidence.checkedAt) < 15 * 60_000 &&
		Date.parse(evidence.checkedAt) <= Date.now();
	if (
		(input.inboundState === "ready" &&
			(!fresh || !evidence.routingDns || !evidence.routingConfirmed)) ||
		(input.outboundState === "ready" &&
			(!fresh || !evidence.sendingDns || !evidence.sendingConfirmed))
	) {
		throw new ManageError(
			"fresh DNS evidence and separate dashboard confirmations are required",
			409,
		);
	}
	const set: Partial<typeof emailDomains.$inferInsert> = { updatedAt: now };
	if (input.inboundState !== undefined) set.inboundState = input.inboundState;
	if (input.outboundState !== undefined)
		set.outboundState = input.outboundState;
	if (input.operatorConfirmed !== undefined)
		set.operatorConfirmedAt = input.operatorConfirmed ? now : null;
	const mutation = db
		.update(emailDomains)
		.set(set)
		.where(
			and(
				eq(emailDomains.id, domainId),
				eq(emailDomains.workspaceId, workspaceId),
			),
		)
		.toSQL();
	const suspended =
		inboundState === "suspended" || outboundState === "suspended";
	// Lifecycle and its audit/capability revocations commit as one D1 transaction.
	await env.DB.batch([
		env.DB.prepare(mutation.sql).bind(...mutation.params),
		env.DB.prepare(
			"UPDATE mailboxes SET is_enabled = CASE WHEN ? THEN 0 ELSE is_enabled END, is_send_enabled = CASE WHEN ? THEN 0 ELSE is_send_enabled END, updated_at = ? WHERE workspace_id = ? AND email_domain_id = ?",
		).bind(
			Number(suspended || inboundState !== "ready"),
			Number(suspended || outboundState !== "ready"),
			now,
			workspaceId,
			domainId,
		),
		emailAuditStatement(
			env,
			workspaceId,
			actorUserId,
			"domain.state",
			domainId,
			{ before: existing, input },
		),
	]);
	return getDomainInWorkspace(db, workspaceId, domainId);
}

export async function createPrivateMailbox(
	env: Env,
	workspaceId: string,
	input: PrivateMailboxCreateInput,
	actorUserId: string,
): Promise<Mailbox> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const domain = await getDomainInWorkspace(
		db,
		workspaceId,
		input.emailDomainId,
	);
	if (!(await userBelongsToWorkspace(db, workspaceId, input.ownerUserId))) {
		throw new ManageError(
			"private mailbox owner must be an active workspace member",
			404,
		);
	}
	const owner = await db
		.select({ username: user.username })
		.from(user)
		.where(eq(user.id, input.ownerUserId))
		.get();
	if (!owner?.username) {
		throw new ManageError("private mailbox owner must have a username", 409);
	}
	const localPart = normalizeLocalPart(owner.username, "private");
	const address = canonicalAddress(localPart, domain.canonicalDomain);
	await assertMailboxAddressUnused(db, address);
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"mailbox.create",
		id,
		input,
		db.insert(mailboxes).values({
			id,
			workspaceId,
			emailDomainId: domain.id,
			localPart,
			canonicalAddress: address,
			type: "private",
			ownerUserId: input.ownerUserId,
			inboxId: null,
			teamId: null,
			isEnabled: false,
			isSendEnabled: false,
			createdAt: now,
			updatedAt: now,
		}),
	);
	const created = await db
		.select()
		.from(mailboxes)
		.where(eq(mailboxes.canonicalAddress, address))
		.get();
	if (!created) throw new ManageError("mailbox create failed", 500);
	if (created.id !== id)
		throw new ManageError("mailbox address is already assigned", 409);
	return created;
}

export async function createSharedMailbox(
	env: Env,
	workspaceId: string,
	input: SharedMailboxCreateInput,
	actorUserId: string,
): Promise<Mailbox> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const domain = await getDomainInWorkspace(
		db,
		workspaceId,
		input.emailDomainId,
	);
	const inbox = await db
		.select({ id: inboxes.id })
		.from(inboxes)
		.where(
			and(eq(inboxes.id, input.inboxId), eq(inboxes.workspaceId, workspaceId)),
		)
		.get();
	if (!inbox) throw new ManageError("inbox not found", 404);
	if (input.teamId) {
		const team = await db
			.select({ id: teams.id })
			.from(teams)
			.where(
				and(eq(teams.id, input.teamId), eq(teams.workspaceId, workspaceId)),
			)
			.get();
		if (!team) throw new ManageError("team not found", 404);
	}
	const localPart = normalizeLocalPart(input.localPart, "shared");
	const address = canonicalAddress(localPart, domain.canonicalDomain);
	await assertMailboxAddressUnused(db, address);
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"mailbox.create",
		id,
		input,
		db.insert(mailboxes).values({
			id,
			workspaceId,
			emailDomainId: domain.id,
			localPart,
			canonicalAddress: address,
			type: "shared",
			ownerUserId: null,
			inboxId: input.inboxId,
			teamId: input.teamId ?? null,
			isEnabled: false,
			isSendEnabled: false,
			createdAt: now,
			updatedAt: now,
		}),
	);
	const created = await db
		.select()
		.from(mailboxes)
		.where(eq(mailboxes.canonicalAddress, address))
		.get();
	if (!created) throw new ManageError("mailbox create failed", 500);
	if (created.id !== id)
		throw new ManageError("mailbox address is already assigned", 409);
	return created;
}

export async function listMailboxes(
	env: Env,
	workspaceId: string,
	userId: string,
): Promise<Mailbox[]> {
	const db = dbFor(env);
	await requireWorkspaceAccess(db, workspaceId, userId);
	return db
		.select()
		.from(mailboxes)
		.where(eq(mailboxes.workspaceId, workspaceId))
		.orderBy(asc(mailboxes.canonicalAddress))
		.all();
}

export async function updateMailboxState(
	env: Env,
	workspaceId: string,
	mailboxId: string,
	input: MailboxStateUpdateInput,
	actorUserId: string,
): Promise<Mailbox> {
	const db = dbFor(env);
	await requireOwnerAccess(db, workspaceId, actorUserId);
	const mailbox = await getMailboxInWorkspace(db, workspaceId, mailboxId);
	const domain = await getDomainInWorkspace(
		db,
		workspaceId,
		mailbox.emailDomainId,
	);
	if (
		(input.isEnabled || input.isSendEnabled) &&
		(domain.inboundState === "suspended" ||
			domain.outboundState === "suspended")
	)
		throw new ManageError("domain is suspended", 409);
	await repairMailboxTransport(env, mailboxId);
	if (input.isEnabled === true && domain.inboundState !== "ready") {
		throw new ManageError(
			"mailbox cannot enable inbound until its domain is inbound-ready",
			409,
		);
	}
	if (input.isSendEnabled === true && domain.outboundState !== "ready") {
		throw new ManageError(
			"mailbox cannot enable sending until its domain is outbound-ready",
			409,
		);
	}
	const set: Partial<typeof mailboxes.$inferInsert> = {
		updatedAt: new Date().toISOString(),
	};
	if (input.isEnabled !== undefined) set.isEnabled = input.isEnabled;
	if (input.isSendEnabled !== undefined)
		set.isSendEnabled = input.isSendEnabled;
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"mailbox.state",
		mailboxId,
		{ before: mailbox, input },
		db
			.update(mailboxes)
			.set(set)
			.where(
				and(
					eq(mailboxes.id, mailboxId),
					eq(mailboxes.workspaceId, workspaceId),
				),
			),
	);
	return getMailboxInWorkspace(db, workspaceId, mailboxId);
}

async function assertPrivateMailboxOwner(
	db: Db,
	workspaceId: string,
	mailboxId: string,
	actorUserId: string,
): Promise<void> {
	await requireWorkspaceAccess(db, workspaceId, actorUserId);
	const mailbox = await getMailboxInWorkspace(db, workspaceId, mailboxId);
	if (mailbox.type !== "private" || mailbox.ownerUserId !== actorUserId) {
		throw new ManageError(
			"only the private mailbox owner may manage delegates",
			403,
		);
	}
}

export async function addPrivateMailboxDelegate(
	env: Env,
	workspaceId: string,
	mailboxId: string,
	input: MailboxDelegateInput,
	actorUserId: string,
): Promise<void> {
	const db = dbFor(env);
	await assertPrivateMailboxOwner(db, workspaceId, mailboxId, actorUserId);
	if (!(await userBelongsToWorkspace(db, workspaceId, input.userId))) {
		throw new ManageError(
			"delegate must be an active member of this workspace",
			404,
		);
	}
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"delegate.add",
		mailboxId,
		input,
		db
			.insert(mailboxDelegates)
			.values({
				mailboxId,
				userId: input.userId,
				createdBy: actorUserId,
				createdAt: new Date().toISOString(),
			})
			.onConflictDoNothing(),
	);
}

export async function removePrivateMailboxDelegate(
	env: Env,
	workspaceId: string,
	mailboxId: string,
	delegateUserId: string,
	actorUserId: string,
): Promise<void> {
	const db = dbFor(env);
	await assertPrivateMailboxOwner(db, workspaceId, mailboxId, actorUserId);
	await auditedMutation(
		env,
		workspaceId,
		actorUserId,
		"delegate.remove",
		mailboxId,
		{ userId: delegateUserId },
		db
			.delete(mailboxDelegates)
			.where(
				and(
					eq(mailboxDelegates.mailboxId, mailboxId),
					eq(mailboxDelegates.userId, delegateUserId),
				),
			),
	);
}
