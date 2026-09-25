import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
import { workspaces } from "./schema";

/** SQL migration 0015 also installs atomic verified-membership acceptance triggers. */
export const agentInvitations = sqliteTable(
	"agent_invitations",
	{
		id: text("id").primaryKey(),
		tokenHash: text("token_hash").notNull().unique(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		invitedBy: text("invited_by")
			.notNull()
			.references(() => user.id),
		expiresAt: integer("expires_at").notNull(),
		claimedAt: integer("claimed_at"),
		userId: text("user_id").references(() => user.id),
		acceptedAt: integer("accepted_at"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("agent_invitations_workspace").on(table.workspaceId)],
);
