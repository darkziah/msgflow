# Send later: scheduled messages in D1, dispatched by Cron Trigger

A "send later" reply is stored as a D1 `scheduled_messages` row — not in the DO — and dispatched by a Cron Trigger that scans for due rows, sends via the Worker → adapter, then appends the outbound Message to the DO. This mirrors snooze revival (both are future timestamps on D1 state revived by a scheduled Worker), keeps the DO's storage strictly for the live timeline, and makes scheduled sends a filterable D1 list. The snooze-revival and send-later scans can be one scheduled Worker.
