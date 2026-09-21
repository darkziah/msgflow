-- MsgFlow demo seed — local development / demo data ONLY.
--
-- Apply AFTER the migration chain (0000 → 0004), e.g.:
--   bunx wrangler d1 execute msgflow --local --file=packages/db/seed/demo.sql
--
-- Design notes:
-- * Everything is keyed off the lazy single-tenant workspace (slug 'default'),
--   so the seed works whether the worker already bootstrapped it or not. All
--   child rows resolve the workspace id with `(SELECT id FROM workspaces
--   WHERE slug = 'default')`.
-- * Every insert uses INSERT OR IGNORE with fixed ids — re-running the seed is
--   a no-op rather than a duplicate factory.
-- * team_members links the FIRST registered user to both demo teams, so the
--   assign_team rule action has someone to assign; it is skipped when no user
--   has signed up yet.
--
-- Channel -> General inbox -> rule -> destination flow (see CONTEXT.md):
--   Main Facebook Page -> Facebook - General -> (rule: invoice/payment/refund)
--     -> Billing ; (rule: error/cannot login/technical) -> Technical Support
--   sales@example.com -> Email - General -> (rule: quote/quotation/price/buy)
--     -> Sales Leads (assigned to Sales team)
--   support@example.com -> Email - General
--   (rule: conversation carries the VIP tag) -> VIP Customers + Priority tag

-- ---------------------------------------------------------------------------
-- Workspace (MsgFlow Demo = the 'default' workspace)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at)
VALUES ('ws-demo', 'MsgFlow Demo', 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Channels (created lazily by ingest; seeded here so the demo starts wired)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO channels (id, workspace_id, type, display_name, external_id, status, created_at, updated_at)
SELECT 'ch-fb-main', id, 'facebook_page', 'Main Facebook Page', 'page-demo-main', 'active',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO channels (id, workspace_id, type, display_name, external_id, status, created_at, updated_at)
SELECT 'ch-sales-mail', id, 'email', 'sales@example.com', 'sales@example.com', 'active',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO channels (id, workspace_id, type, display_name, external_id, status, created_at, updated_at)
SELECT 'ch-support-mail', id, 'email', 'support@example.com', 'support@example.com', 'active',
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO teams (id, workspace_id, name, created_at)
SELECT 'team-sales', id, 'Sales', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO teams (id, workspace_id, name, created_at)
SELECT 'team-support', id, 'Support', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

-- First registered user joins both teams (assign_team needs a member).
INSERT OR IGNORE INTO team_members (id, team_id, user_id, role, created_at)
SELECT 'tm-sales', 'team-sales', u.id, 'member', '2026-01-01T00:00:00.000Z'
FROM (SELECT id FROM user ORDER BY created_at ASC LIMIT 1) u
WHERE EXISTS (SELECT 1 FROM user);

INSERT OR IGNORE INTO team_members (id, team_id, user_id, role, created_at)
SELECT 'tm-support', 'team-support', u.id, 'member', '2026-01-01T00:00:00.000Z'
FROM (SELECT id FROM user ORDER BY created_at ASC LIMIT 1) u
WHERE EXISTS (SELECT 1 FROM user);

-- ---------------------------------------------------------------------------
-- Inboxes (colors/icons are the controlled library keys; updated_at is Unix ms)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-fb-general', id, NULL, 'Facebook - General',
       'Default queue for the Main Facebook Page.', '#3B82F6', 'inbox', 0, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-email-general', id, NULL, 'Email - General',
       'Default queue for sales@ and support@.', '#22C55E', 'inbox', 1, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-sales-leads', id, 'team-sales', 'Sales Leads',
       'Quotes and price requests (rule destination; no channel attached).', '#F97316', 'badge-dollar-sign', 2, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-billing', id, NULL, 'Billing',
       'Invoice, payment and refund requests (rule destination).', '#EAB308', 'receipt-text', 3, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-tech-support', id, 'team-support', 'Technical Support',
       'Login and technical issues (rule destination).', '#A855F7', 'headphones', 4, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO inboxes (id, workspace_id, team_id, name, description, color, icon, sort_order, is_archived, assignment_strategy, created_at, updated_at)
SELECT 'in-vip', id, 'team-sales', 'VIP Customers',
       'High-value contacts (rule destination).', '#EF4444', 'briefcase', 5, 0, 'manual',
       '2026-01-01T00:00:00.000Z', 1767225600000
FROM workspaces WHERE slug = 'default';

-- ---------------------------------------------------------------------------
-- Channel → default inbox links (exactly one default per channel)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO inbox_channels (id, inbox_id, channel_id, is_default)
SELECT 'link-fb', 'in-fb-general', 'ch-fb-main', 1;

INSERT OR IGNORE INTO inbox_channels (id, inbox_id, channel_id, is_default)
SELECT 'link-sales', 'in-email-general', 'ch-sales-mail', 1;

INSERT OR IGNORE INTO inbox_channels (id, inbox_id, channel_id, is_default)
SELECT 'link-support', 'in-email-general', 'ch-support-mail', 1;

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-billing', id, NULL, 'Billing', '#EAB308', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-priority', id, NULL, 'Priority', '#EF4444', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-vip', id, NULL, 'VIP', '#A855F7', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-urgent', id, NULL, 'Urgent', '#EF4444', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-followup', id, NULL, 'Follow-up', '#F97316', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-support', id, NULL, 'Support', '#64748B', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-technical', id, 'tag-support', 'Technical', '#3B82F6', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO tags (id, workspace_id, parent_tag_id, name, color, visibility, owner_user_id, created_at)
SELECT 'tag-account', id, 'tag-support', 'Account issue', '#F97316', 'shared', NULL, '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

-- ---------------------------------------------------------------------------
-- Routing rules, priority order (conditions: groups OR'd inside, AND'd across)
-- ---------------------------------------------------------------------------

-- 1. Body mentions invoice/payment/refund -> Billing + tag Billing
INSERT OR IGNORE INTO rules (id, workspace_id, inbox_id, name, trigger_type, is_active, priority, stop_processing, created_by, created_at, updated_at)
SELECT 'rule-billing', id, NULL, 'Billing keywords', 'message_received', 1, 1, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-billing-1', 'rule-billing', 'message.body', 'contains', 'invoice', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-billing-2', 'rule-billing', 'message.body', 'contains', 'payment', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-billing-3', 'rule-billing', 'message.body', 'contains', 'refund', 0, '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-billing-1', 'rule-billing', 'move_inbox', 'in-billing', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-billing-2', 'rule-billing', 'add_tag', 'tag-billing', 1, '2026-01-01T00:00:00.000Z');

-- 2. Subject OR body mentions quote/quotation/price/buy -> Sales Leads + Sales team
INSERT OR IGNORE INTO rules (id, workspace_id, inbox_id, name, trigger_type, is_active, priority, stop_processing, created_by, created_at, updated_at)
SELECT 'rule-quote', id, NULL, 'Sales lead keywords', 'message_received', 1, 2, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-s1', 'rule-quote', 'subject', 'contains', 'quote', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-s2', 'rule-quote', 'subject', 'contains', 'quotation', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-s3', 'rule-quote', 'subject', 'contains', 'price', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-s4', 'rule-quote', 'subject', 'contains', 'buy', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-b1', 'rule-quote', 'message.body', 'contains', 'quote', 1, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-b2', 'rule-quote', 'message.body', 'contains', 'quotation', 1, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-b3', 'rule-quote', 'message.body', 'contains', 'price', 1, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-quote-b4', 'rule-quote', 'message.body', 'contains', 'buy', 1, '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-quote-1', 'rule-quote', 'move_inbox', 'in-sales-leads', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-quote-2', 'rule-quote', 'assign_team', 'team-sales', 1, '2026-01-01T00:00:00.000Z');

-- 3. Conversation carries the VIP tag -> VIP Customers + tag Priority
INSERT OR IGNORE INTO rules (id, workspace_id, inbox_id, name, trigger_type, is_active, priority, stop_processing, created_by, created_at, updated_at)
SELECT 'rule-vip', id, NULL, 'VIP customers', 'message_received', 1, 3, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-vip-1', 'rule-vip', 'tags', 'contains', 'tag-vip', 0, '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-vip-1', 'rule-vip', 'move_inbox', 'in-vip', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-vip-2', 'rule-vip', 'add_tag', 'tag-priority', 1, '2026-01-01T00:00:00.000Z');

-- 4. Facebook body mentions error/cannot login/technical -> Technical Support
INSERT OR IGNORE INTO rules (id, workspace_id, inbox_id, name, trigger_type, is_active, priority, stop_processing, created_by, created_at, updated_at)
SELECT 'rule-tech', id, NULL, 'Technical issues', 'message_received', 1, 4, 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
FROM workspaces WHERE slug = 'default';

INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-tech-1', 'rule-tech', 'message.body', 'contains', 'error', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-tech-2', 'rule-tech', 'message.body', 'contains', 'cannot login', 0, '2026-01-01T00:00:00.000Z');
INSERT OR IGNORE INTO rule_conditions (id, rule_id, field, operator, value, match_group, created_at)
VALUES ('rc-tech-3', 'rule-tech', 'message.body', 'contains', 'technical', 0, '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO rule_actions (id, rule_id, action_type, action_value, execution_order, created_at)
VALUES ('ra-tech-1', 'rule-tech', 'move_inbox', 'in-tech-support', 0, '2026-01-01T00:00:00.000Z');