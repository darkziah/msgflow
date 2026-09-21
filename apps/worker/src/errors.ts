/** Shared API error: message + HTTP status. Lives in its own module so the
 * access-control layer and management CRUD can both use it without a cycle. */
export class ManageError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}
