/**
 * Username values are also private-mailbox local-parts: lower-case ASCII
 * letters/numbers with internal dots or hyphens only. Keep this in step with
 * migration 0010, which enforces it for direct database writes.
 */
export function isValidUsername(value: string): boolean {
	return /^(?!.*\.\.)(?=.{3,30}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value);
}