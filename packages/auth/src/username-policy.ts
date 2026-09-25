/**
 * Private mailbox local-parts are lower-case ASCII identifiers. The equivalent
 * SQLite predicate is in migration 0010 for direct database writes.
 */
export function isValidUsername(value: string): boolean {
	return /^(?!.*\.\.)(?=.{3,30}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
}
