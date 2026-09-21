# Unread: dense sequence + D1 read cursor

Unread counts are per-agent and D1-computable. The DO keeps a monotonic `seq` per conversation and upserts `message_count` (latest seq) into the D1 summary row on each append. D1 `conversation_reads` holds a per-agent cursor (conversation_id, agent_id, last_read_seq); unread = `summary.message_count - reads.last_read_seq`, with a missing row meaning all-unread. Marking read is a D1 write of `last_read_seq = message_count` when the agent opens or replies. No per-agent state lives in the DO.
