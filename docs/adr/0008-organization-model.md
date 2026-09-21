# Organization model: Front-style assignee, open/archived, inbox as required grouping

We follow Front's organization model. Each Conversation has at most one Assignee (null = unassigned); multi-person collaboration happens through @mentions and internal comments rather than multiple assignees. Multiple assignees would be a later join-table migration.

Status is open | archived — Front has no distinct "closed" state. Snoozing is orthogonal: an open Conversation with a `snoozed_until` timestamp is hidden from the active view until that time.

Every Conversation belongs to exactly one Inbox (`inbox_id` NOT NULL); each Channel (Page or mailbox) has a default Inbox, overridable by rules. "Unassigned" is an assignment state rendered as a filtered view, not a separate Inbox — preserving the "exactly one inbox" invariant.
