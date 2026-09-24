# ADR 0019: Scheduled Snooze Revival

Status: Accepted

Date: 2026-09-22

## Context

A snooze hides an open conversation until its `snoozed_until` timestamp. The
field is D1-owned metadata (ADR 0004), while the Conversation Durable Object
owns only the live timeline. Snoozes must become visible without relying on a
user opening the conversation or on a per-conversation Durable Object alarm.

## Decision

The Worker Cron Trigger runs once per minute and clears due snoozes as part of
the scheduled Worker path. At the cron timestamp it updates only conversations
where `status = 'open'` and `snoozed_until <= now`, setting
`snoozed_until` to `NULL` and `updated_at` to that timestamp.

Clearing the field revives the conversation: normal D1-backed inbox queries
include it again, and it leaves the Snoozed virtual queue. No status change,
timeline message, or Durable Object alarm is created. Archived conversations
are not revived by this job, and future snoozes remain untouched.

A future snooze is exclusive: an open conversation with `snoozed_until > now`
appears only in the Snoozed virtual queue. Standard Inbox, All Messages,
Assigned, Unassigned, tag, and saved-filter queries exclude it, as do their
sidebar counts. This exclusion also applies to the `status=all` list. An
archived conversation is never part of the Snoozed queue and remains visible
through Archived/All even if it retains a stale snooze timestamp.

The update is safe to run repeatedly: a successfully revived row no longer
matches the due-snooze predicate. The same scheduled invocation may also
perform send-later delivery (ADR 0011), but snooze revival has no provider call
or retry state of its own.

## Consequences

- Snooze accuracy is bounded by the one-minute Cron cadence.
- Revival remains queryable, centralized D1 metadata instead of distributed DO
  alarm state.
- A delayed or repeated Cron invocation cannot revive a conversation twice or
  alter an archived/future-snoozed conversation.
- Snoozed work cannot be counted or acted on from a normal queue before its
  due timestamp; revival makes it visible again through the normal query path.
