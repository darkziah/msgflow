ALTER TABLE inboxes ADD COLUMN parent_inbox_id TEXT REFERENCES inboxes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE inboxes ADD COLUMN visibility_type TEXT NOT NULL DEFAULT 'shared' CHECK (visibility_type IN ('shared', 'team', 'private', 'system'));
--> statement-breakpoint
ALTER TABLE inboxes ADD COLUMN tree_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE user_sidebar_preferences ADD COLUMN collapsed_node_ids_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE user_sidebar_preferences ADD COLUMN last_open_branch_ids_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX idx_inboxes_workspace_parent_order
ON inboxes(workspace_id, parent_inbox_id, sort_order, id);
--> statement-breakpoint
CREATE INDEX idx_inboxes_workspace_visibility
ON inboxes(workspace_id, visibility_type, is_archived);
--> statement-breakpoint
CREATE TRIGGER inboxes_parent_workspace_insert
BEFORE INSERT ON inboxes
WHEN NEW.parent_inbox_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN NEW.parent_inbox_id = NEW.id
		THEN RAISE(ABORT, 'inbox cannot be its own parent')
	END;
	SELECT CASE
		WHEN EXISTS (
			SELECT 1 FROM inboxes WHERE id = NEW.parent_inbox_id
		) AND NOT EXISTS (
			SELECT 1 FROM inboxes
			WHERE id = NEW.parent_inbox_id AND workspace_id = NEW.workspace_id
		)
		THEN RAISE(ABORT, 'inbox parent must belong to the same workspace')
	END;
	SELECT CASE
		WHEN EXISTS (
			WITH RECURSIVE parent_chain(id, depth) AS (
				SELECT NEW.parent_inbox_id, 1
				UNION ALL
				SELECT inboxes.parent_inbox_id, parent_chain.depth + 1
				FROM inboxes
				JOIN parent_chain ON inboxes.id = parent_chain.id
				WHERE inboxes.parent_inbox_id IS NOT NULL
				AND parent_chain.depth < 64
			)
			SELECT 1 FROM parent_chain WHERE id = NEW.id
		)
		THEN RAISE(ABORT, 'inbox parent would create a cycle')
	END;
	SELECT CASE
		WHEN (
			WITH RECURSIVE
			parent_chain(id, depth) AS (
				SELECT NEW.parent_inbox_id, 1
				UNION ALL
				SELECT inboxes.parent_inbox_id, parent_chain.depth + 1
				FROM inboxes
				JOIN parent_chain ON inboxes.id = parent_chain.id
				WHERE inboxes.parent_inbox_id IS NOT NULL
				AND parent_chain.depth < 65
			),
			descendant_chain(depth) AS (SELECT 0)
			SELECT (SELECT MAX(depth) FROM parent_chain) + (SELECT MAX(depth) FROM descendant_chain) > 64
		)
		THEN RAISE(ABORT, 'inbox parent hierarchy exceeds maximum depth')
	END;
END;
--> statement-breakpoint
CREATE TRIGGER inboxes_parent_workspace_update
BEFORE UPDATE OF parent_inbox_id, workspace_id ON inboxes
WHEN NEW.parent_inbox_id IS NOT NULL
BEGIN
	SELECT CASE
		WHEN NEW.parent_inbox_id = NEW.id
		THEN RAISE(ABORT, 'inbox cannot be its own parent')
	END;
	SELECT CASE
		WHEN EXISTS (
			SELECT 1 FROM inboxes WHERE id = NEW.parent_inbox_id
		) AND NOT EXISTS (
			SELECT 1 FROM inboxes
			WHERE id = NEW.parent_inbox_id AND workspace_id = NEW.workspace_id
		)
		THEN RAISE(ABORT, 'inbox parent must belong to the same workspace')
	END;
	SELECT CASE
		WHEN EXISTS (
			WITH RECURSIVE parent_chain(id, depth) AS (
				SELECT NEW.parent_inbox_id, 1
				UNION ALL
				SELECT inboxes.parent_inbox_id, parent_chain.depth + 1
				FROM inboxes
				JOIN parent_chain ON inboxes.id = parent_chain.id
				WHERE inboxes.parent_inbox_id IS NOT NULL
				AND parent_chain.depth < 64
			)
			SELECT 1 FROM parent_chain WHERE id = NEW.id
		)
		THEN RAISE(ABORT, 'inbox parent would create a cycle')
	END;
	SELECT CASE
		WHEN (
			WITH RECURSIVE
			parent_chain(id, depth) AS (
				SELECT NEW.parent_inbox_id, 1
				UNION ALL
				SELECT inboxes.parent_inbox_id, parent_chain.depth + 1
				FROM inboxes
				JOIN parent_chain ON inboxes.id = parent_chain.id
				WHERE inboxes.parent_inbox_id IS NOT NULL
				AND parent_chain.depth < 65
			),
			descendant_chain(id, depth) AS (
				SELECT NEW.id, 0
				UNION ALL
				SELECT child.id, descendant_chain.depth + 1
				FROM inboxes AS child
				JOIN descendant_chain ON child.parent_inbox_id = descendant_chain.id
				-- Same-workspace parents are enforced by the tree triggers; retain this
				-- scope so traversal can use idx_inboxes_workspace_parent_order.
				WHERE child.workspace_id = NEW.workspace_id
				AND descendant_chain.depth < 65
			)
			SELECT (SELECT MAX(depth) FROM parent_chain) + (SELECT MAX(depth) FROM descendant_chain) > 64
		)
		THEN RAISE(ABORT, 'inbox parent hierarchy exceeds maximum depth')
	END;
END;
--> statement-breakpoint
CREATE TRIGGER inboxes_workspace_update_children
BEFORE UPDATE OF workspace_id ON inboxes
WHEN NEW.workspace_id <> OLD.workspace_id
AND EXISTS (
	SELECT 1 FROM inboxes AS child
	WHERE child.parent_inbox_id = OLD.id
	AND child.workspace_id <> NEW.workspace_id
)
BEGIN
	SELECT RAISE(ABORT, 'inbox workspace cannot change while children remain in another workspace');
END;
