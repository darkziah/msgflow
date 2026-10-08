PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`avatar_url` text,
	`workspace_id` text NOT NULL REFERENCES workspaces(id), `display_name` text, `primary_email` text, `notes` text, `created_at` text NOT NULL, `updated_at` text NOT NULL);
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('42acd229-dc75-423c-98ed-f32dfb47eaa9','https://platform-lookaside.fbsbx.com/platform/profilepic/?eai=Aa37mQ-wS6VuQCaAGarb79EEYv4Z4w_2MHKA8wv6gzYmPiBCjLiZBLHvi0-TFWlq5vC-zyHCbAItLw&psid=28195936490078117&height=200&width=200&ext=1793412191&hash=AfvgHC8U5UQsg0vbgFoAohPe','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','アイロ-ジャイレ アビラ',NULL,NULL,'2026-10-01T02:03:10.356Z','2026-10-01T02:03:10.356Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('03af4f99-763d-412f-b258-64a2ecb05fe5',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T02:49:29.921Z','2026-10-01T02:49:29.921Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('d6e44b85-d9ee-4328-92ba-454e70cd0838',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T02:50:19.697Z','2026-10-01T02:50:19.697Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('0e80531b-5932-4a88-8cf1-d85a7bda56b8',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T02:54:41.296Z','2026-10-01T02:54:41.296Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('267ac51d-9ea3-4cd7-b251-161e0ca8e8c6',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T02:57:24.330Z','2026-10-01T02:57:24.330Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('f291ddf8-609d-48e5-accf-8d3d0a95db7a',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T02:58:52.476Z','2026-10-01T02:58:52.476Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('ad75cb54-4cc3-4ac4-a2f5-2fb082c5e5c8',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:03:22.037Z','2026-10-01T03:03:22.037Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('e15b67a8-dd23-41cd-9b7a-a15b06e1446f',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:05:32.067Z','2026-10-01T03:05:32.067Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('114e0687-2060-488f-8c36-7986be71bfd7',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:09:15.516Z','2026-10-01T03:09:15.516Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('74aec61e-f66e-491b-95fb-b68af053d8bd',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:13:35.177Z','2026-10-01T03:13:35.177Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('b8fd6c1b-df49-475c-bf1a-5d20d7f7195c',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:14:30.684Z','2026-10-01T03:14:30.684Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('0711c7dc-585d-429b-8b10-e421e937af0b',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:22:53.942Z','2026-10-01T03:22:53.942Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('cf71d32c-1562-4a7b-8889-19b881676a1a',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:23:22.639Z','2026-10-01T03:23:22.639Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('f56ccca3-4208-434e-941e-c90c401a72cd',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:31:29.023Z','2026-10-01T03:31:29.023Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('9940413a-fe6f-46db-8f8c-082e887799cf',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:34:47.936Z','2026-10-01T03:34:47.936Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('b8865152-4051-4e04-b6eb-4cf5e9419e8e',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:37:19.105Z','2026-10-01T03:37:19.105Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('e3b62f53-5817-45f0-bd8b-994b9adc25e0',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:40:13.056Z','2026-10-01T03:40:13.056Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('891668b0-890f-4b93-801e-0af172dbd910',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:43:53.397Z','2026-10-01T03:43:53.397Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('4d89aa39-5952-47a8-85d3-c14b3f208c22',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:44:32.655Z','2026-10-01T03:44:32.655Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('f664e8ab-a462-449f-9f56-af90acaec41d',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:44:53.851Z','2026-10-01T03:44:53.851Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('ff0b545e-fd88-4f7f-adfc-081fa8833196',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T03:55:14.274Z','2026-10-01T03:55:14.274Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('9578bb1e-a84b-4055-9805-09879907e5c8',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T04:06:07.956Z','2026-10-01T04:06:07.956Z');
INSERT INTO "contacts" ("id","avatar_url","workspace_id","display_name","primary_email","notes","created_at","updated_at") VALUES('640b98af-4ccd-4a33-bb63-7fa038f27ca2',NULL,'9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,NULL,'2026-10-01T04:11:39.647Z','2026-10-01T04:11:39.647Z');
CREATE TABLE `conversation_reads` (
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL
);
INSERT INTO "conversation_reads" ("conversation_id","agent_id","last_read_seq") VALUES('fb:111403048277258:28195936490078117','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',6);
INSERT INTO "conversation_reads" ("conversation_id","agent_id","last_read_seq") VALUES('fb:108463610739699:7729068300477497','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',1);
INSERT INTO "conversation_reads" ("conversation_id","agent_id","last_read_seq") VALUES('fb:108463610739699:6294811730555451','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',2);
CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
, `workspace_id` text NOT NULL REFERENCES workspaces(id), `team_id` text REFERENCES teams(id), `description` text, `color` text DEFAULT '#64748B' NOT NULL, `icon` text, `sort_order` integer DEFAULT 0 NOT NULL, `is_archived` integer DEFAULT 0 NOT NULL, `assignment_strategy` text DEFAULT 'manual' NOT NULL, `updated_at` integer, parent_inbox_id TEXT REFERENCES inboxes(id) ON DELETE SET NULL, visibility_type TEXT NOT NULL DEFAULT 'shared' CHECK (visibility_type IN ('shared', 'team', 'private', 'system')), tree_version INTEGER NOT NULL DEFAULT 0);
INSERT INTO "inboxes" ("id","name","created_at","workspace_id","team_id","description","color","icon","sort_order","is_archived","assignment_strategy","updated_at","parent_inbox_id","visibility_type","tree_version") VALUES('c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','PH','2026-09-29T08:26:31.019Z','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','57d1464e-0ca6-4e01-bf46-4f97c1f6c034',NULL,'#64748B',NULL,1,0,'manual',NULL,NULL,'shared',2);
INSERT INTO "inboxes" ("id","name","created_at","workspace_id","team_id","description","color","icon","sort_order","is_archived","assignment_strategy","updated_at","parent_inbox_id","visibility_type","tree_version") VALUES('049ac937-7912-4ac6-bd7f-188b39a9a3df','Nepal','2026-09-29T08:27:12.343Z','9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,'#64748B',NULL,0,0,'manual',1790670432433,NULL,'shared',0);
INSERT INTO "inboxes" ("id","name","created_at","workspace_id","team_id","description","color","icon","sort_order","is_archived","assignment_strategy","updated_at","parent_inbox_id","visibility_type","tree_version") VALUES('98d3c57a-a0f4-4d2f-8c9b-4f1e342ef776','Support (PH)','2026-09-29T08:27:44.809Z','9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,'#64748B',NULL,0,0,'manual',1790670465048,'c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','shared',2);
INSERT INTO "inboxes" ("id","name","created_at","workspace_id","team_id","description","color","icon","sort_order","is_archived","assignment_strategy","updated_at","parent_inbox_id","visibility_type","tree_version") VALUES('6bb4a0dc-eefc-404b-81a4-f2dfcfc95304','Support (NP)','2026-09-29T08:27:58.056Z','9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,'#64748B',NULL,0,0,'manual',1790670478295,'049ac937-7912-4ac6-bd7f-188b39a9a3df','shared',1);
INSERT INTO "inboxes" ("id","name","created_at","workspace_id","team_id","description","color","icon","sort_order","is_archived","assignment_strategy","updated_at","parent_inbox_id","visibility_type","tree_version") VALUES('1694203f-bedc-4c49-966e-4080708bdff1','YJ','2026-10-01T02:02:15.593Z','9206fe2a-11cb-41c6-be1b-6ccf7ab62514',NULL,NULL,'#64748B',NULL,0,0,'manual',1790820135650,NULL,'shared',0);
CREATE TABLE `scheduled_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`text` text NOT NULL,
	`send_at` text NOT NULL,
	`created_by` text
, `attempts` integer DEFAULT 0 NOT NULL, `claim_token` text, `claimed_at` text, `attachments_json` text DEFAULT '[]' NOT NULL);
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`workspace_id` text NOT NULL REFERENCES workspaces(id), `parent_tag_id` text REFERENCES tags(id), `visibility` text DEFAULT 'shared' NOT NULL, `owner_user_id` text REFERENCES user(id), `created_at` text NOT NULL);
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "account" ("id","account_id","provider_id","user_id","access_token","refresh_token","id_token","access_token_expires_at","refresh_token_expires_at","scope","password","created_at","updated_at") VALUES('hehHQ48LlDpI3UfcJ6mxCgXnJ6gQiwDE','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','credential','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',NULL,NULL,NULL,NULL,NULL,NULL,'0c5be83d5234c6d640a230417779eede:33a437dea5c90bfd111ba1571ff03146a7a27023abe23f57c307eb74cadc911fce00d9121b28a1a5dc69946f2711a477a4720375395a4b733c457078c81c3db0',1790670390876,1790670390876);
INSERT INTO "account" ("id","account_id","provider_id","user_id","access_token","refresh_token","id_token","access_token_expires_at","refresh_token_expires_at","scope","password","created_at","updated_at") VALUES('Y7eJLzJyqgYBiiyMdEhuEMWMZ5Ew0B3L','k9WynHBJPRO6GfUz9fBGBW449zagHlxj','credential','k9WynHBJPRO6GfUz9fBGBW449zagHlxj',NULL,NULL,NULL,NULL,NULL,NULL,'32d51b4bf21dd42e58d7c5422792b0c7:4878f3e94d2277b2403890cdf538044d97b047b222a041ccf862c35f3abee2b70f072465ebf8195257f2ec1457a2c1d7f21ea4f1578e70d28d2e0d9d84656604',1790756932036,1790827513426);
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('uX5g8s5tPssEBUcRuPwNLgECoyk4xt6L',1791369972571,'8aCpoRGjPEgRsLCv23T0BJnHFPYBgRrn',1790670404262,1790765172571,'','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('gE7GcLMNNBUo1aloqPn8hqYZLtqgZamq',1791348313474,'0DfE1CWGZCa9tAezUUu3w71kwnDhg4Ye',1790743513474,1790743513474,'','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('cvwNjr1CZ3YtKKqLDO7Pns2teKjBe0ga',1791422834774,'6F37HBk9OFRAHqjBSAvo4s6QKNvEGzNG',1790818034774,1790818034774,'','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('1EU75FYcLwI6s1muZio0rZhWWdjwZH4B',1791429093487,'07dvahuOLn5Flv8Pqu5TBHn1VZmknDds',1790824293487,1790824293487,'','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('ffYnpB0HE3FKVbxVo7c4nArXSpIgDTu6',1791432575481,'gsT4VHlCClznBpGbQyCXyeMCEkzZ7s8V',1790827775481,1790827775481,'','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36','k9WynHBJPRO6GfUz9fBGBW449zagHlxj');
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
, `username` text);
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at","username") VALUES('rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','abila.jireh','darkzephanziah@gmail.com',1,NULL,1790670390795,1790670390795,'abila.jireh');
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at","username") VALUES('k9WynHBJPRO6GfUz9fBGBW449zagHlxj','subedi.adhip','subedi.adhip@yehey.jp',1,NULL,1790756931924,1790817446721,'subedi.adhip');
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
CREATE TABLE `canned_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`external_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` text,
	`webhook_verify_token` text,
	`imap_smtp_config` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, meta_app_id TEXT REFERENCES meta_apps(id) ON DELETE RESTRICT,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "channels" ("id","workspace_id","type","display_name","external_id","access_token","refresh_token","token_expires_at","webhook_verify_token","imap_smtp_config","status","created_at","updated_at","meta_app_id") VALUES('c6fafa7d-d27c-404e-9bd5-e55ebdb78558','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','facebook_page','YeheyRemit Nepal','768102323033574','enc:v1:lFIZKPE5x0pD_7_P:DODByEITI99a5difDyFwpYN9g5LLSCi90ecrlLgbwt3KYMrhFQM8Hx7rLbWgWCjCooxophf69mIoGsvDUgC7itMrrc-Q6dtxyiDoFZYshEqqvcWc8afAEbS1RcH8OWoUcnpK_2MGqak5khlKH5Immo-1iQRwrJOXqQQbZDQ3GQBbgNwXvoVk7ts6YUWh9DxAM47hNt0mjKqgQoDQGVD2D7YvFtMAGtJstQkjOsWG5qTIvYrzUbLhYlgHz13_qj0-fdyPwsx0B4WV1FK6qIOxnh7-LDHF1rQ5lmCILoFNv-RONtGC9Khc5MpIOz_x0wFYtFDg4Q',NULL,NULL,NULL,NULL,'active','2026-09-30T13:05:28.013Z','2026-09-30T13:05:28.013Z','dd24f530-71eb-4e56-8af4-8cba99f1adf8');
INSERT INTO "channels" ("id","workspace_id","type","display_name","external_id","access_token","refresh_token","token_expires_at","webhook_verify_token","imap_smtp_config","status","created_at","updated_at","meta_app_id") VALUES('2e5d9346-0e96-42a3-93e3-227a810af6c6','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','facebook_page','YeheyRemit Philippines','108463610739699','enc:v1:UxYu4DxL0VjxmKwJ:-vsoZeBkHObbMGfc_fYZnSv4xw2L8WAWVWb5f8SoNGrh0EYyuJVT_KP3zlc2fwPz8yqBc4WmrgO9g6eV0vyn4TYjQwujX3JmPsAEKk9TIl-RlZbhhdB2RoshTld3gwJ5lWZvulNr0QxXY3cQy46vNq_to5aHnZNSNWx-qwxqALXX5ZE4OT-OsH2LF_VjBwhwgjbL9Kxo_0b6VbLWmgdZIti6tLeg7khURcraTCDVuPSGT1dSszXsVaQrkxf0_-WHCembCVQYqIQQWaKn5KqzjhiLLM8C6hIOQz2T93SatoY8bQJoryaRoNww-1MuFEAJ0A',NULL,NULL,NULL,NULL,'active','2026-09-30T13:06:44.195Z','2026-10-01T02:01:09.043Z','dd24f530-71eb-4e56-8af4-8cba99f1adf8');
INSERT INTO "channels" ("id","workspace_id","type","display_name","external_id","access_token","refresh_token","token_expires_at","webhook_verify_token","imap_smtp_config","status","created_at","updated_at","meta_app_id") VALUES('739493ec-2637-4601-bfcc-0b4dbd356d4c','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','facebook_page','YJS APP','111403048277258','enc:v1:6hJhA90eUEMWL8Eu:Ctq1SHwqK6Arm-AG54c8E8rvYSffHVlkXUM9d_lDIi8bb6NeI9yynvk5hpd1yUEOHa9RomrIYzFUzcxV7J0hHOskdyHNOrI32_g9p5N1_u7wfS94dEPzuBwI8xJPuJjMsRScaRcIuxOoYD4_KiqSbPeOUuTGz3Tp2FfCZLL8zo-rYkimXTK73fZr0WRm_DqCUrNIKEN4B0OsLql5Y3K3M-yhb3JK9_HDMH7GlZTfk3hpfcF8AWyKcvPfTiCLjPb2vKMuwFZcA6CaUC1a_vxhG9r3NqEzahZfMVZplIYA1fZvlJ1Yok4a6fOE6BFU',NULL,NULL,NULL,NULL,'active','2026-10-01T02:02:34.583Z','2026-10-01T02:02:34.583Z','dd24f530-71eb-4e56-8af4-8cba99f1adf8');
CREATE TABLE `contact_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`external_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('d83b5d95-a365-419e-95af-ead79b9524e9','42acd229-dc75-423c-98ed-f32dfb47eaa9','739493ec-2637-4601-bfcc-0b4dbd356d4c','facebook_page','28195936490078117','2026-10-01T02:03:10.356Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('b5a5fecf-0084-4125-93af-ffa1abf043e9','03af4f99-763d-412f-b258-64a2ecb05fe5','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','7729068300477497','2026-10-01T02:49:29.921Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('55033f01-8e87-4794-9d17-2bedb004d2a3','d6e44b85-d9ee-4328-92ba-454e70cd0838','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','6294811730555451','2026-10-01T02:50:19.697Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('26800eaa-750b-45f0-b9dd-84b476854cc3','0e80531b-5932-4a88-8cf1-d85a7bda56b8','c6fafa7d-d27c-404e-9bd5-e55ebdb78558','facebook_page','29078580908445851','2026-10-01T02:54:41.296Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('bacef3b4-fda2-4689-ab9d-8ec738e0642d','267ac51d-9ea3-4cd7-b251-161e0ca8e8c6','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','3497703073600819','2026-10-01T02:57:24.330Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('b9160dc1-c865-4ce3-b269-d4b5f68c4888','f291ddf8-609d-48e5-accf-8d3d0a95db7a','c6fafa7d-d27c-404e-9bd5-e55ebdb78558','facebook_page','38875503448761927','2026-10-01T02:58:52.476Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('cadaaa11-53ab-4016-a768-ba23508d7931','ad75cb54-4cc3-4ac4-a2f5-2fb082c5e5c8','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','4655229887898417','2026-10-01T03:03:22.037Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('79b23646-af9b-4848-8412-4175311bcda5','e15b67a8-dd23-41cd-9b7a-a15b06e1446f','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','3517886304913667','2026-10-01T03:05:32.067Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('5aefa0b4-d474-404d-882a-b4925b9dc6b1','114e0687-2060-488f-8c36-7986be71bfd7','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','26839307649022413','2026-10-01T03:09:15.516Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('6bef35e0-873b-477c-a315-c905a1b1f5e9','74aec61e-f66e-491b-95fb-b68af053d8bd','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','5239232962774290','2026-10-01T03:13:35.177Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('9b342dda-31b8-4a29-852c-5657a77cd9e4','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','8025756390798223','2026-10-01T03:14:30.684Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('9da0db9f-af69-4b27-8e2b-828fbaea8fc0','0711c7dc-585d-429b-8b10-e421e937af0b','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','5067140526630798','2026-10-01T03:22:53.942Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('c52730da-ec5b-4214-a1a1-be10eeb29931','cf71d32c-1562-4a7b-8889-19b881676a1a','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','5139400409412757','2026-10-01T03:23:22.639Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('ab8b305e-5fcd-4616-90ee-6773075b205c','f56ccca3-4208-434e-941e-c90c401a72cd','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','5066645713380445','2026-10-01T03:31:29.023Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('a9c86b67-4359-4802-9904-e3e2765da664','9940413a-fe6f-46db-8f8c-082e887799cf','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','9307366972618523','2026-10-01T03:34:47.936Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('3564d431-42f9-4a3f-911b-0108db1e4aa6','b8865152-4051-4e04-b6eb-4cf5e9419e8e','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','4339141052788681','2026-10-01T03:37:19.105Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('1012ccfe-a9a5-4055-bdeb-570bc0e488f6','e3b62f53-5817-45f0-bd8b-994b9adc25e0','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','32408928102040001','2026-10-01T03:40:13.056Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('240b5cb6-ec69-4e8b-ab01-6297f6a34821','891668b0-890f-4b93-801e-0af172dbd910','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','7410985352313369','2026-10-01T03:43:53.397Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('fb91c8f2-4faa-4cd7-a70c-3109eb820fb6','4d89aa39-5952-47a8-85d3-c14b3f208c22','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','7331805146901115','2026-10-01T03:44:32.655Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('898b135b-a947-4eb8-a6d9-a2ce0227b1a8','f664e8ab-a462-449f-9f56-af90acaec41d','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','5350730004977967','2026-10-01T03:44:53.851Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('5eb299fd-58a3-4e48-a518-84876e7a0186','ff0b545e-fd88-4f7f-adfc-081fa8833196','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','29085251174391757','2026-10-01T03:55:14.274Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('f62847b4-af6a-418a-9f8b-f53ec52b3a3a','9578bb1e-a84b-4055-9805-09879907e5c8','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','32136699559277512','2026-10-01T04:06:07.956Z');
INSERT INTO "contact_identities" ("id","contact_id","channel_id","channel_type","external_user_id","created_at") VALUES('d80e0617-b46c-4320-b619-14ab575a79fd','640b98af-4ccd-4a33-bb63-7fa038f27ca2','2e5d9346-0e96-42a3-93e3-227a810af6c6','facebook_page','8355772047796730','2026-10-01T04:11:39.647Z');
CREATE TABLE `inbox_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "inbox_channels" ("id","inbox_id","channel_id","is_default") VALUES('99d62a84-9c3e-4946-84cd-8da23389719c','049ac937-7912-4ac6-bd7f-188b39a9a3df','c6fafa7d-d27c-404e-9bd5-e55ebdb78558',1);
INSERT INTO "inbox_channels" ("id","inbox_id","channel_id","is_default") VALUES('fc5cdbc4-0e83-45fb-8160-d9b4bf51a912','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','2e5d9346-0e96-42a3-93e3-227a810af6c6',1);
INSERT INTO "inbox_channels" ("id","inbox_id","channel_id","is_default") VALUES('3cfd5ebd-55a4-4daf-b1a1-18e5961bbbe8','1694203f-bedc-4c49-966e-4080708bdff1','739493ec-2637-4601-bfcc-0b4dbd356d4c',1);
CREATE TABLE `inbox_members` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "inbox_members" ("id","inbox_id","user_id") VALUES('bbe5d8ab-0710-4fda-88e0-55f034c3f148','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "inbox_members" ("id","inbox_id","user_id") VALUES('8d9eaab4-5f1f-442d-8562-3eb612eec1db','049ac937-7912-4ac6-bd7f-188b39a9a3df','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "inbox_members" ("id","inbox_id","user_id") VALUES('7bc74284-a6bf-4aca-a281-eca06f54a71f','98d3c57a-a0f4-4d2f-8c9b-4f1e342ef776','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "inbox_members" ("id","inbox_id","user_id") VALUES('0a01b01b-d77d-4e8c-93ba-39cc044fb3fa','6bb4a0dc-eefc-404b-81a4-f2dfcfc95304','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
INSERT INTO "inbox_members" ("id","inbox_id","user_id") VALUES('b721da4d-727a-44fc-ba25-af3504db5690','1694203f-bedc-4c49-966e-4080708bdff1','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn');
CREATE TABLE `messages_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`seq` integer NOT NULL,
	`direction` text NOT NULL,
	`sender_type` text NOT NULL,
	`sender_id` text NOT NULL,
	`preview` text NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('93beab97-3707-4410-877a-b7063d2906ba','fb:111403048277258:28195936490078117',6,'inbound','contact','42acd229-dc75-423c-98ed-f32dfb47eaa9','hello',0,'2026-10-01T02:03:07.546Z','2026-10-01T02:03:07.546Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('4d96e193-aa66-49ab-9818-362578828ecd','fb:108463610739699:7729068300477497',1,'inbound','contact','03af4f99-763d-412f-b258-64a2ecb05fe5','I already changed the transaction pin but I haven''t tried using it yet. Probably this afternoon pag nag send ako money sa pinas. Thank you po. Is transaction pin different from the pin you use when yo',0,'2026-10-01T02:49:28.137Z','2026-10-01T02:49:28.137Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('c66d5534-f28e-4ab3-80b2-aa6faef6e6ef','fb:108463610739699:6294811730555451',1,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T02:50:16.019Z','2026-10-01T02:50:16.019Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('c73606b0-e133-43b2-b2e0-71591b5231f1','fb:108463610739699:6294811730555451',2,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Wala pong notification maam dalawang nefes akong nag send ng GCash 😥😥🙏🙏',0,'2026-10-01T02:50:46.791Z','2026-10-01T02:50:46.791Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2decf3f0-7fbd-4708-ad22-b894b151e8d1','fb:768102323033574:29078580908445851',1,'inbound','contact','0e80531b-5932-4a88-8cf1-d85a7bda56b8','Kasari apply garne ho Hajur',0,'2026-10-01T02:54:39.219Z','2026-10-01T02:54:39.219Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5940b698-14fb-4c6e-a31f-5bba7c48c595','fb:108463610739699:3497703073600819',1,'inbound','contact','267ac51d-9ea3-4cd7-b251-161e0ca8e8c6','Thank you',0,'2026-10-01T02:57:22.926Z','2026-10-01T02:57:22.926Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('80ec44ac-1ed4-4ec4-8a6a-d8e721dad127','fb:768102323033574:38875503448761927',1,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Lock hoina account delete garne',0,'2026-10-01T02:58:50.950Z','2026-10-01T02:58:50.950Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('86c015f2-36f6-44db-a28a-9dfd7b359e3e','fb:108463610739699:4655229887898417',1,'inbound','contact','ad75cb54-4cc3-4ac4-a2f5-2fb082c5e5c8','Wala naman po problem ngayon ang gcash?nagsend po ako.',0,'2026-10-01T03:03:20.136Z','2026-10-01T03:03:20.136Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('7b1e0824-4502-4fec-8b37-ef03cd053e43','fb:108463610739699:6294811730555451',3,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ok po 😥🙏',0,'2026-10-01T03:04:11.182Z','2026-10-01T03:04:11.182Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('f97c924f-52c8-453c-b71a-4f38e6f52c13','fb:108463610739699:3517886304913667',1,'inbound','contact','e15b67a8-dd23-41cd-9b7a-a15b06e1446f','yes mam kakarating lang kahapon',0,'2026-10-01T03:05:30.623Z','2026-10-01T03:05:30.623Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2500d361-0c88-411f-a11a-6f9328c6d6f4','fb:108463610739699:6294811730555451',4,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T03:06:01.665Z','2026-10-01T03:06:01.665Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2072e2c4-7daa-4145-8438-9390622e0ca9','fb:108463610739699:6294811730555451',5,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T03:06:07.464Z','2026-10-01T03:06:07.464Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('dc868c84-8603-4639-932a-a8b6fdd9e8ee','fb:108463610739699:6294811730555451',6,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T03:06:21.750Z','2026-10-01T03:06:21.750Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('bb0d767d-c4ff-4233-9b07-53779588c205','fb:108463610739699:6294811730555451',7,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T03:06:30.549Z','2026-10-01T03:06:30.549Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('1e82d6c9-c8f8-4011-9b5d-7e92ab888968','fb:108463610739699:6294811730555451',8,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Yan po ma’am',0,'2026-10-01T03:06:36.412Z','2026-10-01T03:06:36.412Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('a9ab2da1-3c62-4b89-930c-18ae041a52fb','fb:768102323033574:29078580908445851',2,'inbound','contact','0e80531b-5932-4a88-8cf1-d85a7bda56b8','Namste',0,'2026-10-01T03:06:54.887Z','2026-10-01T03:06:54.887Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5be0ab06-927f-4e87-b6ba-336371bad133','fb:768102323033574:38875503448761927',2,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Malai service ramro lagena tesaile ho',0,'2026-10-01T03:07:07.327Z','2026-10-01T03:07:07.327Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('fb20be1a-6915-40e9-b372-362fdd78e2a6','fb:108463610739699:6294811730555451',9,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','',1,'2026-10-01T03:07:58.402Z','2026-10-01T03:07:58.402Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5bacc5ef-efda-4cc2-9f96-f7c3fc7f8414','fb:108463610739699:6294811730555451',10,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito yon lumalabas 😥🙏',0,'2026-10-01T03:08:09.644Z','2026-10-01T03:08:09.644Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2c7f228c-0f94-4112-a1ef-803ccb8291ae','fb:768102323033574:38875503448761927',3,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Account delete garnu paryo',0,'2026-10-01T03:08:25.203Z','2026-10-01T03:08:25.203Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('89cb14ee-7a2a-4f6b-8b5e-bfcd14e96c8a','fb:108463610739699:6294811730555451',11,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Paano pag open po maam ayaw po 😥🙏',0,'2026-10-01T03:08:33.281Z','2026-10-01T03:08:33.281Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('8fb26b52-d417-4cf6-a380-ccc698ea6f69','fb:108463610739699:26839307649022413',1,'inbound','contact','114e0687-2060-488f-8c36-7986be71bfd7','ohayo po pa process po ako onegaishimasu',0,'2026-10-01T03:08:53.974Z','2026-10-01T03:08:53.974Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('24cf8905-fe18-42b7-bd9a-e1a27e83fc66','fb:108463610739699:6294811730555451',12,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Saan po Gagawin maam ?',0,'2026-10-01T03:11:19.476Z','2026-10-01T03:11:19.476Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('c105ec48-45ec-4d7b-9e66-9f5e6b06d0fa','fb:108463610739699:5239232962774290',1,'inbound','contact','74aec61e-f66e-491b-95fb-b68af053d8bd','ok po 👍🏼salamat po♥️',0,'2026-10-01T03:13:33.850Z','2026-10-01T03:13:33.850Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('bab060eb-04f9-4560-9607-683c89efe4fa','fb:768102323033574:38875503448761927',4,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Suru ma garnuna ma sudar garnu parne thau dherai xa tapai haruko',0,'2026-10-01T03:14:19.609Z','2026-10-01T03:14:19.609Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('398fec06-9880-47e2-8d48-a51bc0abe993','fb:108463610739699:8025756390798223',1,'inbound','contact','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','Yn po bago Kong zairyu card',0,'2026-10-01T03:14:29.019Z','2026-10-01T03:14:29.019Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('7c1b3ac2-c0f1-428e-a849-3fd28a591702','fb:108463610739699:6294811730555451',13,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Na click ko na po ayaw po 😥🙏',0,'2026-10-01T03:14:45.081Z','2026-10-01T03:14:45.081Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('9a0bb43e-fda6-42ca-9483-dd654f98726e','fb:108463610739699:6294811730555451',14,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito po Yong lumabas😥😍',0,'2026-10-01T03:15:26.232Z','2026-10-01T03:15:26.232Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('0a7b62bd-6d21-4426-8939-b1a054d8c5a6','fb:768102323033574:38875503448761927',5,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Locked hoina delete garnu parne xa sie',0,'2026-10-01T03:16:58.586Z','2026-10-01T03:16:58.586Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('bcf79c03-033b-4f6e-b409-b07340535424','fb:768102323033574:38875503448761927',6,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Sir',0,'2026-10-01T03:17:00.218Z','2026-10-01T03:17:00.218Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('4c181af3-c49e-4d74-bf26-ac56b5334a88','fb:108463610739699:5067140526630798',1,'inbound','contact','0711c7dc-585d-429b-8b10-e421e937af0b','pwede ulit  padalhan  nyo  ako  this  year  na  statement  of receipts  na mga  pinadala  ko  this  year  in  Japanese  translation  please.  Isa submit  ko  lang  sana  kasi samen  company  sa  Novem',0,'2026-10-01T03:22:52.494Z','2026-10-01T03:22:52.494Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('a9b83e93-91f4-44f0-91ff-5699cd0167f9','fb:108463610739699:26839307649022413',2,'inbound','contact','114e0687-2060-488f-8c36-7986be71bfd7','ok na po maam completed na po slamaat',0,'2026-10-01T03:22:58.182Z','2026-10-01T03:22:58.182Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('051b1543-26f4-4a92-98e3-c30a9fd459e7','fb:108463610739699:5139400409412757',1,'inbound','contact','cf71d32c-1562-4a7b-8889-19b881676a1a','ano  po bng nangyayari?',0,'2026-10-01T03:23:20.957Z','2026-10-01T03:23:20.957Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('05812987-47c1-4ea8-a41c-caf67e72212d','fb:768102323033574:38875503448761927',7,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Hello khai ta sir gardinu vako delete',0,'2026-10-01T03:23:27.254Z','2026-10-01T03:23:27.254Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('fce9a322-8cc3-4c5a-9d0b-3391f66b688f','fb:108463610739699:5139400409412757',2,'inbound','contact','cf71d32c-1562-4a7b-8889-19b881676a1a','first time n ganito katagal dumating ang padala ko',0,'2026-10-01T03:23:51.196Z','2026-10-01T03:23:51.196Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('8b2cfc93-52b5-4deb-b56c-5a984d23cade','fb:108463610739699:5139400409412757',3,'inbound','contact','cf71d32c-1562-4a7b-8889-19b881676a1a','pwede kayong tawagan?',0,'2026-10-01T03:24:06.933Z','2026-10-01T03:24:06.933Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('78f83bc3-e1f6-40c4-bcf1-753b37e845d6','fb:108463610739699:5139400409412757',4,'inbound','contact','cf71d32c-1562-4a7b-8889-19b881676a1a','pahingi ng phone number',0,'2026-10-01T03:24:33.790Z','2026-10-01T03:24:33.790Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('398c47fb-46d0-4f77-ae30-bdc333fb9bfe','fb:768102323033574:38875503448761927',8,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Hello',0,'2026-10-01T03:30:18.167Z','2026-10-01T03:30:18.167Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5b1d0782-450b-42d6-8a02-9ccc805d6945','fb:108463610739699:4655229887898417',2,'inbound','contact','ad75cb54-4cc3-4ac4-a2f5-2fb082c5e5c8','Salamat,pakicheck nalang po padala.',0,'2026-10-01T03:30:23.992Z','2026-10-01T03:30:23.992Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('676872e7-9ea5-4567-9c66-f27122867cda','fb:108463610739699:8025756390798223',2,'inbound','contact','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','So pwede pa aq mgremit Hanggang December 6 s dati Kong zairyu card?',0,'2026-10-01T03:30:57.781Z','2026-10-01T03:30:57.781Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2de133c7-4ae4-4515-bd57-45d401b0353a','fb:108463610739699:5066645713380445',1,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Nd po makuha',0,'2026-10-01T03:31:27.156Z','2026-10-01T03:31:27.156Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2feda9e9-0a66-4c47-88b7-4be570564555','fb:108463610739699:5066645713380445',2,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Masm',0,'2026-10-01T03:31:29.201Z','2026-10-01T03:31:29.201Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2570a79e-e3f1-421f-a151-1c09556a7eaf','fb:108463610739699:5066645713380445',3,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Pera',0,'2026-10-01T03:31:33.826Z','2026-10-01T03:31:33.826Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('8468be51-9cc4-4f26-85ba-fc92705222bb','fb:108463610739699:6294811730555451',15,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito lang po Naka lagay wala po yong sa September 30 po 🙏😥',0,'2026-10-01T03:32:39.298Z','2026-10-01T03:32:39.298Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('1953dc03-f1ee-45e9-b8f2-3ad9d947b533','fb:768102323033574:38875503448761927',9,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a',replace('Dear Yehey Remit Support Team,\n\nI would like to request the deletion of my Yehey Remit account.\n\nUnfortunately, due to the poor service and my unsatisfactory experience with your service, I have decid','\n',char(10)),0,'2026-10-01T03:34:26.226Z','2026-10-01T03:34:26.226Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('ea77040d-1d37-48c2-86e2-f257c5de81a4','fb:108463610739699:9307366972618523',1,'inbound','contact','9940413a-fe6f-46db-8f8c-082e887799cf','Hi po ask lang po ako pano po kaya yun pinoprocess pa po yung alien card ko eh need ko po magpadala this october 4 or 5 di po ako makapag transact sa app',0,'2026-10-01T03:34:46.697Z','2026-10-01T03:34:46.697Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('caece6c4-148b-4752-ad29-5e1f30d33508','fb:108463610739699:8025756390798223',3,'inbound','contact','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','Mghuhulog po sana aq Ng Pera today ?',0,'2026-10-01T03:35:27.861Z','2026-10-01T03:35:27.861Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('dbc754c6-fa2f-42db-b243-020a57d13109','fb:108463610739699:6294811730555451',16,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Hindi po naka lagay Yong sa sept 30 na 2beses po akong nag send ng GCash 🙏😥paano po yon 😥🙏😭',0,'2026-10-01T03:35:53.577Z','2026-10-01T03:35:53.577Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5b6e0864-bfea-4835-9e86-02ffcdbac380','fb:108463610739699:4339141052788681',1,'inbound','contact','b8865152-4051-4e04-b6eb-4cf5e9419e8e','Good day po nag load ko ako toda',0,'2026-10-01T03:37:15.997Z','2026-10-01T03:37:15.997Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('4057a99a-572b-45c2-8224-b414284b7b44','fb:108463610739699:4339141052788681',2,'inbound','contact','b8865152-4051-4e04-b6eb-4cf5e9419e8e','Today',0,'2026-10-01T03:37:18.198Z','2026-10-01T03:37:18.198Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('d2165b57-37e0-4137-9555-45466d445ed2','fb:108463610739699:8025756390798223',4,'inbound','contact','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','Ok po...thank u',0,'2026-10-01T03:39:49.914Z','2026-10-01T03:39:49.914Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('4b5b7fce-4f81-483f-9c9f-6f35013c5dd1','fb:108463610739699:32408928102040001',1,'inbound','contact','e3b62f53-5817-45f0-bd8b-994b9adc25e0','Hi',0,'2026-10-01T03:40:11.280Z','2026-10-01T03:40:11.280Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('36bf78ed-1946-4170-b0be-f58ab2bda7c9','fb:108463610739699:32408928102040001',2,'inbound','contact','e3b62f53-5817-45f0-bd8b-994b9adc25e0','Salamat po',0,'2026-10-01T03:42:12.736Z','2026-10-01T03:42:12.736Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('aca655bf-ed59-4c79-bca0-752c490e7050','fb:108463610739699:7410985352313369',1,'inbound','contact','891668b0-890f-4b93-801e-0af172dbd910','thank you po',0,'2026-10-01T03:43:52.046Z','2026-10-01T03:43:52.046Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('30cd7d43-90f3-4d3f-92de-c61a09c41804','fb:108463610739699:7331805146901115',1,'inbound','contact','4d89aa39-5952-47a8-85d3-c14b3f208c22','Ako yon yung kahapon pa ko hinulog',0,'2026-10-01T03:44:30.952Z','2026-10-01T03:44:30.952Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('929c9016-0e79-460a-a5e2-b74c55adf6dd','fb:108463610739699:5350730004977967',1,'inbound','contact','f664e8ab-a462-449f-9f56-af90acaec41d','Wlaprin daw sagcash',0,'2026-10-01T03:44:52.386Z','2026-10-01T03:44:52.386Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('49656c11-c777-47c2-a863-f9b90c82f8a9','fb:108463610739699:7331805146901115',2,'inbound','contact','4d89aa39-5952-47a8-85d3-c14b3f208c22','Oo inabot n ng ng 2 days now di ko alam ano problema eh',0,'2026-10-01T03:46:23.824Z','2026-10-01T03:46:23.824Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('b6b07403-1c65-47b9-aa4a-0dfc498640d6','fb:108463610739699:5066645713380445',4,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Nd po',0,'2026-10-01T03:47:22.359Z','2026-10-01T03:47:22.359Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('b7107613-c9ff-4b96-82d7-46a973d3dc3d','fb:768102323033574:38875503448761927',10,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a',replace('I have decided to stop using Yehey Remit because I am not satisfied with the service and exchange rates compared with other remittance services.\n\nFor example, today’s exchange rates I found are:\n\n• SB','\n',char(10)),0,'2026-10-01T03:48:29.733Z','2026-10-01T03:48:29.733Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('2d2daca7-09e4-4e6c-94bb-a43c08172f6b','fb:108463610739699:5066645713380445',5,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Mli dw po ref. Maam',0,'2026-10-01T03:50:11.296Z','2026-10-01T03:50:11.296Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('b2e36ff6-7b1f-4997-8485-f5b944836907','fb:108463610739699:5066645713380445',6,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Maam paulit po n ref.',0,'2026-10-01T03:50:23.462Z','2026-10-01T03:50:23.462Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('a3139c03-e0a9-42f0-8970-d08041d3cb64','fb:108463610739699:5066645713380445',7,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Pki send mo',0,'2026-10-01T03:50:28.391Z','2026-10-01T03:50:28.391Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('eb433599-87cd-480c-ac40-2bcfcfee5d90','fb:108463610739699:5066645713380445',8,'inbound','contact','f56ccca3-4208-434e-941e-c90c401a72cd','Po',0,'2026-10-01T03:50:32.105Z','2026-10-01T03:50:32.105Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('9aa4dabb-e0fa-4029-ba3e-ef0bfbbeb5ec','fb:108463610739699:6294811730555451',17,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito ma’am nasa work po kasi Ako 😥🙏🙏🙏',0,'2026-10-01T03:50:50.213Z','2026-10-01T03:50:50.213Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('3e421cba-cc0c-47ea-8fa8-e28f6436470e','fb:108463610739699:5350730004977967',2,'inbound','contact','f664e8ab-a462-449f-9f56-af90acaec41d','Ayn po',0,'2026-10-01T03:55:07.313Z','2026-10-01T03:55:07.313Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('662f655a-5850-46f0-aff9-c7e720e49c3d','fb:108463610739699:29085251174391757',1,'inbound','contact','ff0b545e-fd88-4f7f-adfc-081fa8833196','good afternoon po magtanong lang po sana ako kong pano po makahulog hinde na po ba kelangan ng member card ? at san po magdeposit sa convenience poba?',0,'2026-10-01T03:55:12.738Z','2026-10-01T03:55:12.738Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('deeb75cf-893c-4fc9-a828-3d54c3872ae8','fb:108463610739699:7331805146901115',3,'inbound','contact','4d89aa39-5952-47a8-85d3-c14b3f208c22','Kahapon pa checking na yan',0,'2026-10-01T03:57:31.446Z','2026-10-01T03:57:31.446Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('85ae60f4-d01d-48ef-8959-87c35c48f604','fb:768102323033574:38875503448761927',11,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Reason yehi ho hai sir',0,'2026-10-01T03:58:27.677Z','2026-10-01T03:58:27.677Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5cf6c919-65c5-4390-8d8b-f2b363d8578c','fb:108463610739699:6294811730555451',18,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito po maam',0,'2026-10-01T03:59:26.037Z','2026-10-01T03:59:26.037Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('7e1878b0-30df-4d21-a95b-644eeac3f78a','fb:108463610739699:5350730004977967',3,'inbound','contact','f664e8ab-a462-449f-9f56-af90acaec41d','Yan po gcash nya',0,'2026-10-01T04:00:57.773Z','2026-10-01T04:00:57.773Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('1a9fe9e5-a2f1-4745-8d6a-2b4405281d56','fb:108463610739699:6294811730555451',19,'inbound','contact','d6e44b85-d9ee-4328-92ba-454e70cd0838','Ito po maam?',0,'2026-10-01T04:02:16.083Z','2026-10-01T04:02:16.083Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('04227e9f-7cec-466d-8992-e71dcfa671a5','fb:108463610739699:5350730004977967',4,'inbound','contact','f664e8ab-a462-449f-9f56-af90acaec41d','',1,'2026-10-01T04:05:41.134Z','2026-10-01T04:05:41.134Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('59c54913-f3fc-4861-ad64-7cd314849c9b','fb:108463610739699:32136699559277512',1,'inbound','contact','9578bb1e-a84b-4055-9805-09879907e5c8','Gud pm po sir mam may inadd po ako reciever kaso gcash po tama po ba cya',0,'2026-10-01T04:06:05.666Z','2026-10-01T04:06:05.666Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('9a606d22-1cb5-4be9-9c8c-f97f572f8e9e','fb:108463610739699:32136699559277512',2,'inbound','contact','9578bb1e-a84b-4055-9805-09879907e5c8','Pwede ko na po ba cya hulugan',0,'2026-10-01T04:07:57.330Z','2026-10-01T04:07:57.330Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('9f703c1d-cef5-4eb6-9edb-df222c72f1bf','fb:108463610739699:5350730004977967',5,'inbound','contact','f664e8ab-a462-449f-9f56-af90acaec41d','Magpapdala ko ulit baka mgkaroon nmn ng problma sa bank',0,'2026-10-01T04:09:07.620Z','2026-10-01T04:09:07.620Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('5670acaf-83cd-4486-8060-0b7825c7c0c8','fb:108463610739699:8355772047796730',1,'inbound','contact','640b98af-4ccd-4a33-bb63-7fa038f27ca2','Hello po okay npo ba  mag padla sa gcash ?',0,'2026-10-01T04:11:37.946Z','2026-10-01T04:11:37.946Z');
INSERT INTO "messages_summary" ("id","conversation_id","seq","direction","sender_type","sender_id","preview","has_attachments","sent_at","created_at") VALUES('d7b2ac41-9b26-4d23-af9e-ef441d31eaa5','fb:768102323033574:38875503448761927',12,'inbound','contact','f291ddf8-609d-48e5-accf-8d3d0a95db7a','Kati time lagxa hola',0,'2026-10-01T04:12:12.766Z','2026-10-01T04:12:12.766Z');
CREATE TABLE `rule_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`action_type` text NOT NULL,
	`action_value` text NOT NULL,
	`execution_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `rule_conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`field` text NOT NULL,
	`operator` text NOT NULL,
	`value` text NOT NULL,
	`match_group` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `rule_execution_log` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`executed_at` text NOT NULL,
	`result` text NOT NULL,
	`detail` text,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text,
	`name` text NOT NULL,
	`trigger_type` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `stop_processing` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "team_members" ("id","team_id","user_id","role","created_at") VALUES('2d249f94-6437-4413-8762-99853dfc6da9','57d1464e-0ca6-4e01-bf46-4f97c1f6c034','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','admin','2026-09-29T08:26:31.019Z');
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "teams" ("id","workspace_id","name","created_at") VALUES('57d1464e-0ca6-4e01-bf46-4f97c1f6c034','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','PH','2026-09-29T08:26:31.019Z');
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "workspace_members" ("id","workspace_id","user_id","role","created_at") VALUES('51aae0be-abe6-4c48-bf82-e01c3b065148','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','owner','2026-09-29T08:26:31.019Z');
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
INSERT INTO "workspaces" ("id","name","slug","created_at","updated_at") VALUES('9206fe2a-11cb-41c6-be1b-6ccf7ab62514','Remit','remit','2026-09-29T08:26:31.019Z','2026-09-29T08:26:31.019Z');
CREATE TABLE IF NOT EXISTS "conversations" (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`do_binding_id` text NOT NULL,
	`subject` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`last_message_at` text,
	`last_message_preview` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`snoozed_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:111403048277258:28195936490078117','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','739493ec-2637-4601-bfcc-0b4dbd356d4c','1694203f-bedc-4c49-966e-4080708bdff1','42acd229-dc75-423c-98ed-f32dfb47eaa9','fb:111403048277258:28195936490078117',NULL,'open',NULL,'2026-10-01T02:03:07.546Z','hello',6,NULL,'2026-10-01T02:03:10.356Z','2026-10-01T02:03:10.356Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:7729068300477497','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','03af4f99-763d-412f-b258-64a2ecb05fe5','fb:108463610739699:7729068300477497',NULL,'open',NULL,'2026-10-01T02:49:28.137Z','I already changed the transaction pin but I haven''t tried using it yet. Probably this afternoon pag nag send ako money sa pinas. Thank you po. Is transaction pin different from the pin you use when yo',1,NULL,'2026-10-01T02:49:29.921Z','2026-10-01T02:49:29.921Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:6294811730555451','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','d6e44b85-d9ee-4328-92ba-454e70cd0838','fb:108463610739699:6294811730555451',NULL,'open',NULL,'2026-10-01T04:02:16.083Z','Ito po maam?',19,NULL,'2026-10-01T02:50:19.697Z','2026-10-01T02:50:19.697Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:768102323033574:29078580908445851','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','c6fafa7d-d27c-404e-9bd5-e55ebdb78558','049ac937-7912-4ac6-bd7f-188b39a9a3df','0e80531b-5932-4a88-8cf1-d85a7bda56b8','fb:768102323033574:29078580908445851',NULL,'open',NULL,'2026-10-01T03:06:54.887Z','Namste',2,NULL,'2026-10-01T02:54:41.296Z','2026-10-01T02:54:41.296Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:3497703073600819','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','267ac51d-9ea3-4cd7-b251-161e0ca8e8c6','fb:108463610739699:3497703073600819',NULL,'open',NULL,'2026-10-01T02:57:22.926Z','Thank you',1,NULL,'2026-10-01T02:57:24.330Z','2026-10-01T02:57:24.330Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:768102323033574:38875503448761927','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','c6fafa7d-d27c-404e-9bd5-e55ebdb78558','049ac937-7912-4ac6-bd7f-188b39a9a3df','f291ddf8-609d-48e5-accf-8d3d0a95db7a','fb:768102323033574:38875503448761927',NULL,'open',NULL,'2026-10-01T04:12:12.766Z','Kati time lagxa hola',12,NULL,'2026-10-01T02:58:52.476Z','2026-10-01T02:58:52.476Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:4655229887898417','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','ad75cb54-4cc3-4ac4-a2f5-2fb082c5e5c8','fb:108463610739699:4655229887898417',NULL,'open',NULL,'2026-10-01T03:30:23.992Z','Salamat,pakicheck nalang po padala.',2,NULL,'2026-10-01T03:03:22.037Z','2026-10-01T03:03:22.037Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:3517886304913667','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','e15b67a8-dd23-41cd-9b7a-a15b06e1446f','fb:108463610739699:3517886304913667',NULL,'open',NULL,'2026-10-01T03:05:30.623Z','yes mam kakarating lang kahapon',1,NULL,'2026-10-01T03:05:32.067Z','2026-10-01T03:05:32.067Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:26839307649022413','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','114e0687-2060-488f-8c36-7986be71bfd7','fb:108463610739699:26839307649022413',NULL,'open',NULL,'2026-10-01T03:22:58.182Z','ok na po maam completed na po slamaat',2,NULL,'2026-10-01T03:09:15.516Z','2026-10-01T03:09:15.516Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:5239232962774290','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','74aec61e-f66e-491b-95fb-b68af053d8bd','fb:108463610739699:5239232962774290',NULL,'open',NULL,'2026-10-01T03:13:33.850Z','ok po 👍🏼salamat po♥️',1,NULL,'2026-10-01T03:13:35.177Z','2026-10-01T03:13:35.177Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:8025756390798223','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','b8fd6c1b-df49-475c-bf1a-5d20d7f7195c','fb:108463610739699:8025756390798223',NULL,'open',NULL,'2026-10-01T03:39:49.914Z','Ok po...thank u',4,NULL,'2026-10-01T03:14:30.684Z','2026-10-01T03:14:30.684Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:5067140526630798','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','0711c7dc-585d-429b-8b10-e421e937af0b','fb:108463610739699:5067140526630798',NULL,'open',NULL,'2026-10-01T03:22:52.494Z','pwede ulit  padalhan  nyo  ako  this  year  na  statement  of receipts  na mga  pinadala  ko  this  year  in  Japanese  translation  please.  Isa submit  ko  lang  sana  kasi samen  company  sa  Novem',1,NULL,'2026-10-01T03:22:53.942Z','2026-10-01T03:22:53.942Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:5139400409412757','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','cf71d32c-1562-4a7b-8889-19b881676a1a','fb:108463610739699:5139400409412757',NULL,'open',NULL,'2026-10-01T03:24:33.790Z','pahingi ng phone number',4,NULL,'2026-10-01T03:23:22.639Z','2026-10-01T03:23:22.639Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:5066645713380445','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','f56ccca3-4208-434e-941e-c90c401a72cd','fb:108463610739699:5066645713380445',NULL,'open',NULL,'2026-10-01T03:50:32.105Z','Po',8,NULL,'2026-10-01T03:31:29.023Z','2026-10-01T03:31:29.023Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:9307366972618523','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','9940413a-fe6f-46db-8f8c-082e887799cf','fb:108463610739699:9307366972618523',NULL,'open',NULL,'2026-10-01T03:34:46.697Z','Hi po ask lang po ako pano po kaya yun pinoprocess pa po yung alien card ko eh need ko po magpadala this october 4 or 5 di po ako makapag transact sa app',1,NULL,'2026-10-01T03:34:47.936Z','2026-10-01T03:34:47.936Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:4339141052788681','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','b8865152-4051-4e04-b6eb-4cf5e9419e8e','fb:108463610739699:4339141052788681',NULL,'open',NULL,'2026-10-01T03:37:18.198Z','Today',2,NULL,'2026-10-01T03:37:19.105Z','2026-10-01T03:37:19.105Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:32408928102040001','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','e3b62f53-5817-45f0-bd8b-994b9adc25e0','fb:108463610739699:32408928102040001',NULL,'open',NULL,'2026-10-01T03:42:12.736Z','Salamat po',2,NULL,'2026-10-01T03:40:13.056Z','2026-10-01T03:40:13.056Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:7410985352313369','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','891668b0-890f-4b93-801e-0af172dbd910','fb:108463610739699:7410985352313369',NULL,'open',NULL,'2026-10-01T03:43:52.046Z','thank you po',1,NULL,'2026-10-01T03:43:53.397Z','2026-10-01T03:43:53.397Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:7331805146901115','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','4d89aa39-5952-47a8-85d3-c14b3f208c22','fb:108463610739699:7331805146901115',NULL,'open',NULL,'2026-10-01T03:57:31.446Z','Kahapon pa checking na yan',3,NULL,'2026-10-01T03:44:32.655Z','2026-10-01T03:44:32.655Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:5350730004977967','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','f664e8ab-a462-449f-9f56-af90acaec41d','fb:108463610739699:5350730004977967',NULL,'open',NULL,'2026-10-01T04:09:07.620Z','Magpapdala ko ulit baka mgkaroon nmn ng problma sa bank',5,NULL,'2026-10-01T03:44:53.851Z','2026-10-01T03:44:53.851Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:29085251174391757','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','ff0b545e-fd88-4f7f-adfc-081fa8833196','fb:108463610739699:29085251174391757',NULL,'open',NULL,'2026-10-01T03:55:12.738Z','good afternoon po magtanong lang po sana ako kong pano po makahulog hinde na po ba kelangan ng member card ? at san po magdeposit sa convenience poba?',1,NULL,'2026-10-01T03:55:14.274Z','2026-10-01T03:55:14.274Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:32136699559277512','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','9578bb1e-a84b-4055-9805-09879907e5c8','fb:108463610739699:32136699559277512',NULL,'open',NULL,'2026-10-01T04:07:57.330Z','Pwede ko na po ba cya hulugan',2,NULL,'2026-10-01T04:06:07.956Z','2026-10-01T04:06:07.956Z');
INSERT INTO "conversations" ("id","workspace_id","channel_id","inbox_id","contact_id","do_binding_id","subject","status","assignee_id","last_message_at","last_message_preview","message_count","snoozed_until","created_at","updated_at") VALUES('fb:108463610739699:8355772047796730','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2e5d9346-0e96-42a3-93e3-227a810af6c6','c3417a51-c3fd-4b00-ba45-16a6f0f2ea8a','640b98af-4ccd-4a33-bb63-7fa038f27ca2','fb:108463610739699:8355772047796730',NULL,'open',NULL,'2026-10-01T04:11:37.946Z','Hello po okay npo ba  mag padla sa gcash ?',1,NULL,'2026-10-01T04:11:39.647Z','2026-10-01T04:11:39.647Z');
CREATE TABLE IF NOT EXISTS "conversation_tags" (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `processed_messages` (
	`conversation_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`message_id` text NOT NULL,
	`processed_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `provider_message_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:111403048277258:28195936490078117','m_mP9vozew3wzK2StG31t6X6yZTiUHIAPkOSxdMbP9ECkW_hwOCFPdSY_Rn--hplv3vkmv2AjoFIq4hdIWi6IHjw','93beab97-3707-4410-877a-b7063d2906ba',1790820193152);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:7729068300477497','m_v4rfigDsAo95Kfuu1gLuUx0Zsy70FBBmJ8_T8U83Drt3ZADBEWbeaAJnA7ziFJ7wKAWY_nJHdyAdIXBXmEHpZQ','4d96e193-aa66-49ab-9818-362578828ecd',1790822972077);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_shCcwdZGHC6pzsM7o6C7lRfvTupqx_m2YVbtlnyOUzYNKF_0IjJyOYCEHpD6ajX3y68ibkByVpCvaFgRMHQ_Qw','c66d5534-f28e-4ab3-80b2-aa6faef6e6ef',1790823021727);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_5NQs0F4yp0PMwUJMcRqOphfvTupqx_m2YVbtlnyOUzblypuUJ3-hHyVXkuqcCbMZXy3DkqopGFb-GSHKQOyRSg','c73606b0-e133-43b2-b2e0-71591b5231f1',1790823049819);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:29078580908445851','m_EsTCgTZLKS_sbe-U9cPfOHl2awVxbWDgFxOFAyPfwNhDe0YsdLQyBwMeqoZlnsK5rxjwzhRozfjfsw2M7ut08w','2decf3f0-7fbd-4708-ad22-b894b151e8d1',1790823283563);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:3497703073600819','m_o54fxjY_on1tPNXuTDuCjOYR52CydthjvF01-Q80gANyU81d1F02J4NpKdt_VxO_d7laImydov0Af8VxIIn-EA','5940b698-14fb-4c6e-a31f-5bba7c48c595',1790823446326);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_YcjKWQpc1aFRtdn3J8TAzapxDVbo1o4T_3revrYgX0tEhxQ5EUYHQ7oRY02n8KWimfCZDhAi4IRsf_jURgTzjQ','80ec44ac-1ed4-4ec4-8a6a-d8e721dad127',1790823534072);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:4655229887898417','m_QBM2TpueIlAOdL-A74Wyjwbh3GCIWbpYdJKArDt9n_kyA5r9nUjIh9nbJxM2TH9LO3YQPR8-166123b8IAT7ag','86c015f2-36f6-44db-a28a-9dfd7b359e3e',1790823803861);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_LF3Y1mnHeXjvoUVpdbFcRhfvTupqx_m2YVbtlnyOUzb78jw8de-95lSR1XgJ-nOCjnIcxQyWEEitxOWh2lH6ow','7b1e0824-4502-4fec-8b37-ef03cd053e43',1790823854000);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:3517886304913667','m_Z2nrGza43xUjvSV8V9Xjv3JdMGQPMdj_xX4TG4jWaFmk6VtDy50ocOz1tXssuFFf2krA0Q5a2J_8X1fIkg0uRQ','f97c924f-52c8-453c-b71a-4f38e6f52c13',1790823934030);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_g1k6w_kuESDFprUr8iqrxhfvTupqx_m2YVbtlnyOUzaLaANtAlXeibR5cHx12mlbezFdDYWtHLtNtYri_osbGA','2500d361-0c88-411f-a11a-6f9328c6d6f4',1790823966030);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_atBZmV_YulvpF1v7dR1d8BfvTupqx_m2YVbtlnyOUzbu7kvNUM9FKrAbKrsGOg67Ui5iHMS8urY4LtaAchrP9g','2072e2c4-7daa-4145-8438-9390622e0ca9',1790823971645);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_P_Cs19W1Qb9_QOS7pKZG7xfvTupqx_m2YVbtlnyOUzZxv-ETKoleqnFBTTkmnj4mnwDArTAD1GX_fTYkFdA7zA','dc868c84-8603-4639-932a-a8b6fdd9e8ee',1790823985697);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_tqHqTRqV4D0m2yL5yKJ4RhfvTupqx_m2YVbtlnyOUzZfuqy4KG-zSMlixNbuPUuVbnALg0i4dyhdPgxWXyX_qw','bb0d767d-c4ff-4233-9b07-53779588c205',1790823994986);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_ejNydTGag-v2ZMFBiikbPRfvTupqx_m2YVbtlnyOUzb39Aeo2b8JOEwArL9dQla9fhcQ0FJNhv8h1O38teZFug','1e82d6c9-c8f8-4011-9b5d-7e92ab888968',1790823999339);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:29078580908445851','m_9x4bULvV413ukN_zn9ErS3l2awVxbWDgFxOFAyPfwNjXOshGAVUFP_OpTTZSinmFRVB-DkdPjyl1bAo0SMZZeg','a9ab2da1-3c62-4b89-930c-18ae041a52fb',1790824017536);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_UWzfGRYSv89gzz-oFPk4iKpxDVbo1o4T_3revrYgX0vYCSFQym0M49EPxqjYCuNHAOzlf2s_q_vK7lSUuKxfqg','5be0ab06-927f-4e87-b6ba-336371bad133',1790824030401);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_xOH9xSAKG4jka4Bn-4GSARfvTupqx_m2YVbtlnyOUzYHIVTlV1hBe_M40CEHGwxS5tnhPU3vfuowgv7R4SVHaw','fb20be1a-6915-40e9-b372-362fdd78e2a6',1790824093911);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_geX1AtuGbcMZiLMih0dGURfvTupqx_m2YVbtlnyOUzb2w0UHq8DIynh0ZVfut6EHPxGHzls6jFO_XFcNJTCnbg','5bacc5ef-efda-4cc2-9f96-f7c3fc7f8414',1790824097650);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_Jn1DUblRELXPpN9KpSwh-apxDVbo1o4T_3revrYgX0vQQ0EvxZJqXQa--jC9Ns4uMI_f7_D2IGE4AE1yqdPxwA','2c7f228c-0f94-4112-a1ef-803ccb8291ae',1790824107590);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_W9IhSW8fm8TIBjh8BIf3axfvTupqx_m2YVbtlnyOUzayAkIQe5mG_YUcNzJDrIJJHSyU8RyhxOL_3sTQ8bCwrA','89cb14ee-7a2a-4f6b-8b5e-bfcd14e96c8a',1790824136717);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:26839307649022413','m_J9Tqcmu9w6J6Dlk0G4E0dLXD_dOMFlq9jmpn-XGkjslcg5EGm84eNJV0N-GA-n6RPxDOhTHtPQdTk71h1c13LQ','8fb26b52-d417-4cf6-a380-ccc698ea6f69',1790824156806);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_3iTZrsGQoM_rO8DZRQnMkBfvTupqx_m2YVbtlnyOUzbyK8q7bXXRzO-nhli1m7DalH82otwcFFcegVVcCP_Biw','24cf8905-fe18-42b7-bd9a-e1a27e83fc66',1790824282818);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5239232962774290','m_Rm1kYqwN72eVH6wDY0L92yNU76i7_Fj_LozbDVQIzdsDp94aSyHTYwBSb_IxCb7LFMZ4DrWsM3cw7ijq2UkHNg','c105ec48-45ec-4d7b-9e66-9f5e6b06d0fa',1790824417338);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_C-Pmg6rLSx-S5NolnqTl0apxDVbo1o4T_3revrYgX0tUCkf5Dl-ctPXgZM-MMX6ozWL-xatCO86UtACi0_lBEg','bab060eb-04f9-4560-9607-683c89efe4fa',1790824461902);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:8025756390798223','m_HYtdcQyEA41Hj6mqm7jezPmNf-D-TmbB7KE1nTH8vRiOAU8j2NZHga9CeIU6TgQ-wZx7RBvTa9Xq_GL1Og__EA','398fec06-9880-47e2-8d48-a51bc0abe993',1790824472740);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_bQ5SfdhjOh6hSjUiaTpK_hfvTupqx_m2YVbtlnyOUzaCkaqO1wT6HVhacf0KpMsuJUrWxG-vtvkuMlDZaDkcKA','7c1b3ac2-c0f1-428e-a849-3fd28a591702',1790824487897);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_UFc-y64Q_pUUGPaAvrcMUBfvTupqx_m2YVbtlnyOUzZYv7DKxQThBfx2beCWEbG3NNpGGMWcxllzgmSgcgoBoA','9a0bb43e-fda6-42ca-9483-dd654f98726e',1790824529055);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_j86LfQJG3w6P4CyjIiuaIKpxDVbo1o4T_3revrYgX0u05aEesrVuNQ--szVFf2YZbEwXlwDL8WKeLzZAPwlGWQ','0a7b62bd-6d21-4426-8939-b1a054d8c5a6',1790824620824);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_bArR_6-G1awdJAU1quSfJqpxDVbo1o4T_3revrYgX0vnEjA2Xi0xuX6gpPfQCrwa7Q-0kccBTloZTdJRy20Ykg','bcf79c03-033b-4f6e-b409-b07340535424',1790824624260);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5067140526630798','m_S-OjgV9n0GJvxooguyz7BvC2ntsE-TETvdchJh_jaRAZ8t6fOwMcyityXDxFJwKjyL92rEhBN4f7mAKiO83MFQ','4c181af3-c49e-4d74-bf26-ac56b5334a88',1790824975860);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:26839307649022413','m_nE7215_tdqlUJJBP4UOrabXD_dOMFlq9jmpn-XGkjsm5YQRG19_CkZ5QKC4r4h4bflqIdRTcfggRdNLXMO8ecQ','a9b83e93-91f4-44f0-91ff-5699cd0167f9',1790824980272);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5139400409412757','m_4yu3s5lruvUfTngt-lmXzq72OXuoxpy8Uxc4Tw_CvQS7wTKJYK34vgWbLb3haDdUVfW3_sdOhHUQW-XS3a0m-A','051b1543-26f4-4a92-98e3-c30a9fd459e7',1790825004533);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_9DxLYHSewcKrStZ_C3_b1apxDVbo1o4T_3revrYgX0t3neiWLUlBI8eaEOkgTTzlDGRfmPcH-9YlWBm7yIzByw','05812987-47c1-4ea8-a41c-caf67e72212d',1790825009380);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5139400409412757','m_rEmuLvyiyItEm-JIomvVRK72OXuoxpy8Uxc4Tw_CvQTHJvV47a_lpo-kaEOECxUsXzQV6muIpTymkvsLlrfFeA','fce9a322-8cc3-4c5a-9d0b-3391f66b688f',1790825033987);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5139400409412757','m_A0RU4l2Q19z_eO9vghes6K72OXuoxpy8Uxc4Tw_CvQTbh1C77ePQ3bpsCqGqZChEG3iW0EdkIfKeeIUJraziPw','8b2cfc93-52b5-4deb-b56c-5a984d23cade',1790825049760);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5139400409412757','m_DBt6M6Tguos7JOYopruheq72OXuoxpy8Uxc4Tw_CvQQpaYP9KoFTVlyPLVITCMaN7YwwNW915nNY0uDNcb4gsA','78f83bc3-e1f6-40c4-bcf1-753b37e845d6',1790825077177);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_47LnpnCmPXb9JeDxw2XOLKpxDVbo1o4T_3revrYgX0vqQc9L8Wwr0PNSZW4EY0Bs9eVVLjh2uN0sCJlrSxvMhw','398c47fb-46d0-4f77-ae30-bdc333fb9bfe',1790825420704);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:4655229887898417','m_Dv490zuju03A-ZoMSMU3Ewbh3GCIWbpYdJKArDt9n_ly_cdFxcuamnc0seSwQw67qP4Ft24jRVulJZ655VPRyw','5b1d0782-450b-42d6-8a02-9ccc805d6945',1790825426910);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:8025756390798223','m_fPyWyxAQMAXAV-DlC7cfRfmNf-D-TmbB7KE1nTH8vRh6qACv5XrC3vbBilRpm1fr8hWQ98_aFYLXVxyVbMh9Hw','676872e7-9ea5-4567-9c66-f27122867cda',1790825461084);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_eb3u7_JqNBG-YVErnORK1vfbCo1Vw68rPeKgo1I7wIYPxNY6kzJmuIz4nrt1jC6swiJA0JqdcT667qqu68y0UA','2de133c7-4ae4-4515-bd57-45d401b0353a',1790825490945);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_5x5nt5CLLBrjq3PiBc6PgPfbCo1Vw68rPeKgo1I7wIZG6jnSAxAclMdbxRgxdmSfULe3KUPVsapidO6vHHDBcQ','2feda9e9-0a66-4c47-88b7-4be570564555',1790825495505);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_jYAMAO7AxbycZ2O0aihFxPfbCo1Vw68rPeKgo1I7wIYIma2i_qzXSkgmS7oF0hTaynh9C285WHOSMOFPmlhXmA','2570a79e-e3f1-421f-a151-1c09556a7eaf',1790825499024);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_scWXb5vpo4RfVG108wz4QhfvTupqx_m2YVbtlnyOUzZ7t5RUu1wWQNr1fH9WJ_lOo73mSZ1MRsGngB9P_WqTZA','8468be51-9cc4-4f26-85ba-fc92705222bb',1790825561848);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_0OlHdS47x6IXEP0ALmgHX6pxDVbo1o4T_3revrYgX0uuP7fVLzEYAXSLcmEflYQmUiwefJAmc20W00D5mYPPvQ','1953dc03-f1ee-45e9-b8f2-3ad9d947b533',1790825668666);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:9307366972618523','m_yGYPVeRmHVV7Gowm6dUi8shS3jTMzrARfne3_tfDE3NGCb6kESSlDJJpaOJf0UyEznXRbSjr764K1EsP8tDCNg','ea77040d-1d37-48c2-86e2-f257c5de81a4',1790825689968);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:8025756390798223','m_falfJmUmqEBlMEcKBaCgMfmNf-D-TmbB7KE1nTH8vRiDpOIb5RI35-WEHMt10h4GTWskQsu8VOMjv41wTHXSlw','caece6c4-148b-4752-ad29-5e1f30d33508',1790825730598);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_KJYolFT1dU_g9O7wvCd5qRfvTupqx_m2YVbtlnyOUzZodRLrd4HTHwgABTuBevsHfgaUuF74A4a2VYjJGMISfg','dbc754c6-fa2f-42db-b243-020a57d13109',1790825756528);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:4339141052788681','m_UXxHTxj1yJcpNI11fyJN6tPagqt3KqzNxxLUJTvFXLLNz3XJtr5ubw7lRgvdhw0j1fWrEMJPeTkwUNZGJS0FyA','5b6e0864-bfea-4835-9e86-02ffcdbac380',1790825841024);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:4339141052788681','m_apPrbghK1IIeY2UNskWNxdPagqt3KqzNxxLUJTvFXLIaiwuL1rGFjOdfxMuIhau4dvUvm843rXfmjgmT6hXHfg','4057a99a-572b-45c2-8224-b414284b7b44',1790825845104);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:8025756390798223','m_rqTE7vuzt4aQologu1peH_mNf-D-TmbB7KE1nTH8vRhFuiv5o_n69uBgZNj0UvoQKLEYCUWjPYZU_br6Hxy6cg','d2165b57-37e0-4137-9555-45466d445ed2',1790825992231);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:32408928102040001','m_TcCwbx66_oTAN2V76Hss8Vo3WT-uHzx73Bf1Kwk2KVvF3Myksscta74wb_fzs7lowtPJGg0ohCDYS-z1Uy3Ubg','4b5b7fce-4f81-483f-9c9f-6f35013c5dd1',1790826015036);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:32408928102040001','m_ij4ZZ-MmaNhfWssimoIurlo3WT-uHzx73Bf1Kwk2KVuB94NL23xG8elObRre17p8pMrFwIpywgKdlvt5cxtgHg','36bf78ed-1946-4170-b0be-f58ab2bda7c9',1790826135411);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:7410985352313369','m_zOEWW8DhIOHEaq82y1LWFnS6Ou9Pn2NQtzJuhgf2FUc7DZEqLrx6jxy5UuD2tKXHaS1mglh2fZ9lXyToxRfXOQ','aca655bf-ed59-4c79-bca0-752c490e7050',1790826235271);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:7331805146901115','m_qv_WoM1b4_Mo1Jrxa297zvwCm6AfNXZaJB-bFP6c7Q5MhP2xkfVJVbufjmzVx0bnAb2bc-vvehu9ei17k1C2Lg','30cd7d43-90f3-4d3f-92de-c61a09c41804',1790826274601);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5350730004977967','m_OFIgNgkzmN6LTDSMfERSMF2nHxld58femsg-WcSMzAmdFJnRpN9xl5S5hjcNAr-L9n2anVKe36-jSFCV4UJitA','929c9016-0e79-460a-a5e2-b74c55adf6dd',1790826295804);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:7331805146901115','m_3eVgE6gR5KX_t2sez1gWyfwCm6AfNXZaJB-bFP6c7Q7CxDNKvGtpCfILTYcEztlWGdf6hX2ptBBbIEfJ2HXk6g','49656c11-c777-47c2-a863-f9b90c82f8a9',1790826386836);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_Ur_7tPyldVMYnZr0iakVnvfbCo1Vw68rPeKgo1I7wIaNJxWJ1TvJxQYloHs06LV8fS_h6MVXMakV3IfD9CSc7w','b6b07403-1c65-47b9-aa4a-0dfc498640d6',1790826445566);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_GEEseZvqmyKN4DhRFrF6dKpxDVbo1o4T_3revrYgX0ulECO4OqhWU6zTUgg6hYSBUD85k3tyri_VOE7FJwtnNA','b7107613-c9ff-4b96-82d7-46a973d3dc3d',1790826511925);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_hrSVMfTIbn1qBcX1ZecBEffbCo1Vw68rPeKgo1I7wIa3pVzGNvSurHR1GPDLP3qSEk-ydQ6wvaGgZqwQEOzU3Q','2d2daca7-09e4-4e6c-94bb-a43c08172f6b',1790826614141);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_7ksKm9s8zxm3uTHNn2PvBPfbCo1Vw68rPeKgo1I7wIYOgj3i65GxRbIE9tLz5OcI92ijkLFCBKwGhanzRVt26g','b2e36ff6-7b1f-4997-8485-f5b944836907',1790826626358);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_fBs7h6FX2ISdTsDvqOLSFvfbCo1Vw68rPeKgo1I7wIbSTpwlJT5WcAdUmwrGo_vedH6TNarSlnJV0Pitib_VOQ','a3139c03-e0a9-42f0-8970-d08041d3cb64',1790826631190);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5066645713380445','m_9dn-6XoScnYBtJuqJgBgdvfbCo1Vw68rPeKgo1I7wIa8YuHXQ-Iu1v00Cg9EeGg3ZycllzSxVkwB_lwJf8e1OA','eb433599-87cd-480c-ac40-2bcfcfee5d90',1790826634953);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_b8Dt87K4a2aQ3-cc61dkABfvTupqx_m2YVbtlnyOUzaLEFlO-DTkXuCY7JYXJIyGIF6o7_EQv4DvNqpdRUCsRw','9aa4dabb-e0fa-4029-ba3e-ef0bfbbeb5ec',1790826653276);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5350730004977967','m_PyhS7RTvwPe6CERV57fi712nHxld58femsg-WcSMzAnNwQm70wG92aPJr8C2DmS4sGsGz6Wn3MOIW-KUiyK9BQ','3e421cba-cc0c-47ea-8fa8-e28f6436470e',1790826909880);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:29085251174391757','m_elVBMwykmzjiTBAvhjGrq1aXTIIOJ-Zj48wuKul5RjB0UP7Ej9AmRO-2tvEd37pCNa8JTrw1h95co6wnIreR6g','662f655a-5850-46f0-aff9-c7e720e49c3d',1790826916467);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:7331805146901115','m_iEIkk29cLBbf_Bsy1yRMofwCm6AfNXZaJB-bFP6c7Q6WjfRyffNOLHbMWSxR0UKcwNg_JktCPNY7xfAkLnDT2Q','deeb75cf-893c-4fc9-a828-3d54c3872ae8',1790827054289);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_ypGT2WZtpnL9GzQYwH8JLapxDVbo1o4T_3revrYgX0tLlmhUoeEsIQ064txt8FFG_5teIsZp2IpaqHO62VUwhg','85ae60f4-d01d-48ef-8959-87c35c48f604',1790827110018);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_V3wH2MhLxLVJXKuYStmIZRfvTupqx_m2YVbtlnyOUzZgDXLCmQuD-iEb61h1sSVPNYRHgeiHVmDMF4cL7Rxt_w','5cf6c919-65c5-4390-8d8b-f2b363d8578c',1790827170817);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5350730004977967','m__8RgPbTujGDVv7YTykZo812nHxld58femsg-WcSMzAnJUHKNH74WXZCNjW9DNZNHRh24oKfuOxYJMsZbghhKqg','7e1878b0-30df-4d21-a95b-644eeac3f78a',1790827260133);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:6294811730555451','m_BhrYQ5lQWBAOZedgGq7KkRfvTupqx_m2YVbtlnyOUzbbEzRW3dMF54pWBsgSxyKgkZQx2P6LzX2z-64a73xlAQ','1a9fe9e5-a2f1-4745-8d6a-2b4405281d56',1790827338747);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5350730004977967','m_HPT30qdXxSDkc_tZrkSU0F2nHxld58femsg-WcSMzAnz827SM1pXaATQbDLFElliEYg9i180sOVTtiRZcv52uA','04227e9f-7cec-466d-8992-e71dcfa671a5',1790827545612);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:32136699559277512','m_8Cf9y2T8e25vL15mNf67PF2mNCLcvBOzHDI-ETZQBiKBRGRhvc2s4SLb8JqdAVkeKuz3Mlhqysn-2UVP-PbDtg','59c54913-f3fc-4861-ad64-7cd314849c9b',1790827569541);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:32136699559277512','m_T0415P-6ibz7YU-UKt2Pn12mNCLcvBOzHDI-ETZQBiI1KCab0uy1eZHjlXsmof0bIr7BMsREzBmJ_npg8e6JZw','9a606d22-1cb5-4be9-9c8c-f97f572f8e9e',1790827679753);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:5350730004977967','m_VkEZVwRpuFGgh5K0zR9YbV2nHxld58femsg-WcSMzAkz1W_o2a9HYqx3OQCPN3GkELS0_Jz7VPpwpVhv0Q7rqw','9f703c1d-cef5-4eb6-9edb-df222c72f1bf',1790827750435);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:108463610739699:8355772047796730','m_GUoPGuVYCq0HoJkXr-UGjqIXHK9eLSqIaQN0TmrvjjqTMWrb_0tKIKAo6f1aIgiNmJizEtt2XAcI9f17_5XZOQ','5670acaf-83cd-4486-8060-0b7825c7c0c8',1790827900988);
INSERT INTO "processed_messages" ("conversation_id","provider_message_id","message_id","processed_at") VALUES('fb:768102323033574:38875503448761927','m_PifF9QJLJs-mWWBkDJUphKpxDVbo1o4T_3revrYgX0vwA4S1lG5PsnUDyTEf0S4d5Difx4CMNQfOEVz4rGCFmg','d7b2ac41-9b26-4d23-af9e-ef441d31eaa5',1790827935138);
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`filters_json` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `user_sidebar_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`collapsed_sections_json` text DEFAULT '[]' NOT NULL,
	`pinned_item_ids_json` text DEFAULT '[]' NOT NULL,
	`hidden_item_ids_json` text DEFAULT '[]' NOT NULL,
	`item_order_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL, collapsed_node_ids_json TEXT NOT NULL DEFAULT '[]', last_open_branch_ids_json TEXT NOT NULL DEFAULT '[]',
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO "user_sidebar_preferences" ("id","user_id","workspace_id","collapsed_sections_json","pinned_item_ids_json","hidden_item_ids_json","item_order_json","updated_at","collapsed_node_ids_json","last_open_branch_ids_json") VALUES('7fc66f41-28ea-49f4-9759-3cbb2ba85ed3','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','["section:tags"]','[]','[]','{}',1790818194978,'[]','[]');
INSERT INTO "user_sidebar_preferences" ("id","user_id","workspace_id","collapsed_sections_json","pinned_item_ids_json","hidden_item_ids_json","item_order_json","updated_at","collapsed_node_ids_json","last_open_branch_ids_json") VALUES('f92b7ba7-35bc-4680-b320-02420785e23f','k9WynHBJPRO6GfUz9fBGBW449zagHlxj','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','["section:channels"]','[]','[]','{}',1790827701195,'[]','[]');
CREATE TABLE `outbound_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`text` text NOT NULL,
	`subject` text,
	`sender_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`provider_message_id` text,
	`scheduled_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`provider_sent_at` text,
	`delivered_at` text
, `attachments_json` text DEFAULT '[]' NOT NULL, command_json TEXT);
CREATE TABLE `comment_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	`conversation_id` text NOT NULL REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	`comment_id` text NOT NULL,
	`author_id` text NOT NULL REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	`comment_text` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
CREATE TABLE `email_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`canonical_domain` text NOT NULL UNIQUE,
	`inbound_state` text NOT NULL DEFAULT 'pending' CHECK (`inbound_state` IN ('pending','ready','suspended')),
	`outbound_state` text NOT NULL DEFAULT 'pending' CHECK (`outbound_state` IN ('pending','ready','suspended')),
	`dns_status_json` text NOT NULL DEFAULT '{}',
	`operator_confirmed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
INSERT INTO "email_domains" ("id","workspace_id","canonical_domain","inbound_state","outbound_state","dns_status_json","operator_confirmed_at","created_at","updated_at") VALUES('ff9558b1-eec6-4a26-8201-a0b394d720f6','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','msgflow.yeheyremit.jp','pending','ready','{"checkedAt":"2026-09-30T05:08:48.530Z","dkimSelector":"cf-bounce","routingConfirmed":true,"sendingConfirmed":true,"routingDns":false,"sendingDns":true,"records":{"msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"_dmarc.msgflow.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}',NULL,'2026-09-30T04:45:34.804Z','2026-09-30T05:08:54.700Z');
INSERT INTO "email_domains" ("id","workspace_id","canonical_domain","inbound_state","outbound_state","dns_status_json","operator_confirmed_at","created_at","updated_at") VALUES('7dcbaece-7dad-4f76-b6b1-3d7953021c15','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','yeheyremit.jp','ready','ready','{"checkedAt":"2026-09-30T05:12:46.810Z","dkimSelector":"cf-bounce","routingConfirmed":true,"sendingConfirmed":true,"routingDns":true,"sendingDns":true,"records":{"yeheyremit.jp/TXT":["_pjd54n01x2yz4nndelw3knvgf1argbl","google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw","google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE","hosting-site=yeheyremit","v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf-bounce._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"cf-bounce.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf2024-1._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"_dmarc.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}',NULL,'2026-09-30T05:10:11.124Z','2026-09-30T05:12:52.984Z');
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`email_domain_id` text NOT NULL REFERENCES `email_domains`(`id`) ON DELETE RESTRICT,
	`local_part` text NOT NULL,
	`canonical_address` text NOT NULL UNIQUE,
	`type` text NOT NULL CHECK (`type` IN ('private','shared')),
	`owner_user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`inbox_id` text REFERENCES `inboxes`(`id`) ON DELETE RESTRICT,
	`team_id` text REFERENCES `teams`(`id`) ON DELETE RESTRICT,
	`is_enabled` integer NOT NULL DEFAULT 0,
	`is_send_enabled` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CHECK ((`type` = 'private' AND `owner_user_id` IS NOT NULL AND `inbox_id` IS NULL AND `team_id` IS NULL) OR (`type` = 'shared' AND `owner_user_id` IS NULL AND `inbox_id` IS NOT NULL))
);
CREATE TABLE `mailbox_delegates` (
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`created_by` text NOT NULL REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`created_at` text NOT NULL,
	PRIMARY KEY (`mailbox_id`,`user_id`)
);
CREATE TABLE `email_ingress` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`mailbox_id` text NOT NULL REFERENCES `mailboxes`(`id`) ON DELETE RESTRICT,
	`dedupe_key` text NOT NULL,
	`raw_object_key` text NOT NULL,
	`state` text NOT NULL DEFAULT 'stored' CHECK (`state` IN ('stored','processing','quarantined','processed','failed')),
	`error` text,
	`received_at` text NOT NULL,
	`processed_at` text
, `raw_sha256` text NOT NULL DEFAULT '', `raw_bytes` integer NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, envelope_from TEXT);
CREATE TABLE `workspace_setup_claim` (
	`id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
	`email` text NOT NULL,
	`user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT,
	`workspace_id` text REFERENCES `workspaces`(`id`) ON DELETE RESTRICT,
	`claimed_at` text NOT NULL,
	`completed_at` text
);
INSERT INTO "workspace_setup_claim" ("id","email","user_id","workspace_id","claimed_at","completed_at") VALUES(1,'darkzephanziah@gmail.com','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','2026-09-29T08:26:30.459Z','2026-09-29T08:26:30.459Z');
CREATE TABLE email_audit (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL,
 actor_user_id TEXT,
 action TEXT NOT NULL,
 target_id TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('99599b75-e4c7-4a70-9004-e4153f3d4e57','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.create','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"canonicalDomain":"msgflow.yeheyremit.jp"}','2026-09-30T04:45:34.804Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('ab313784-2aa9-409d-8c04-3b9372b33ee1','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T04:45:52.773Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"msgflow.yeheyremit.jp/MX":[],"msgflow.yeheyremit.jp/TXT":[],"cf-bounce.msgflow.yeheyremit.jp/MX":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"cf-bounce.msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":[]}}','2026-09-30T04:45:52.773Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('ac5d8d08-8f46-42f8-8eb5-4f39478599dd','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T04:46:54.406Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/MX":[],"cf-bounce.msgflow.yeheyremit.jp/MX":[],"cf-bounce.msgflow.yeheyremit.jp/TXT":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[]}}','2026-09-30T04:46:54.406Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('c6c112c1-0217-4e56-b1d5-50db3de2c8c0','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T04:46:56.171Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"cf-bounce.msgflow.yeheyremit.jp/MX":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/TXT":[],"cf-bounce.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/MX":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":[]}}','2026-09-30T04:46:56.171Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('6406b3c0-3791-4a0b-909f-fc9ef2265db5','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T04:47:07.942Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"cf-bounce.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/TXT":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/MX":[],"cf-bounce.msgflow.yeheyremit.jp/MX":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":[]}}','2026-09-30T04:47:07.942Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('3d974553-0538-40a1-9c49-8f7b8acfd49a','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T04:47:18.458Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"cf-bounce.msgflow.yeheyremit.jp/MX":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/MX":[],"cf-bounce.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":[]}}','2026-09-30T04:47:18.458Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('5ea4d862-0855-4177-b91a-a7f7edae5376','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.create','898cdb08-819c-4c58-be71-98c0a61ab5e4','{"canonicalDomain":"messangflow.dev"}','2026-09-30T04:56:07.936Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('b48453be-f0db-4d7d-b860-a32b6d9232b1','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','898cdb08-819c-4c58-be71-98c0a61ab5e4','{"checkedAt":"2026-09-30T04:56:10.399Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":false,"records":{"cf-bounce.messangflow.dev/TXT":[],"cf-bounce.messangflow.dev/MX":[],"cf-bounce._domainkey.messangflow.dev/TXT":[],"cf2024-1._domainkey.messangflow.dev/TXT":[],"messangflow.dev/MX":[],"messangflow.dev/TXT":[],"_dmarc.messangflow.dev/TXT":[]}}','2026-09-30T04:56:10.399Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('ed558f60-4875-4847-9625-52549f5b890e','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.create','303330e5-0f50-456e-8b97-04dba2c42256','{"canonicalDomain":"messageflow.dev"}','2026-09-30T04:56:36.920Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('edb5da22-1eae-4301-9a70-5475e60091ad','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','303330e5-0f50-456e-8b97-04dba2c42256','{"checkedAt":"2026-09-30T04:56:40.069Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":true,"sendingDns":true,"records":{"cf2024-1._domainkey.messageflow.dev/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"messageflow.dev/MX":["100 route2.mx.cloudflare.net.","63 route3.mx.cloudflare.net.","89 route1.mx.cloudflare.net."],"cf-bounce.messageflow.dev/MX":["100 route2.mx.cloudflare.net.","63 route3.mx.cloudflare.net.","89 route1.mx.cloudflare.net."],"cf-bounce.messageflow.dev/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"messageflow.dev/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce._domainkey.messageflow.dev/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"_dmarc.messageflow.dev/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T04:56:40.069Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('2a96a2ad-aa6d-4eb9-83b9-389363088208','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','303330e5-0f50-456e-8b97-04dba2c42256','{"checkedAt":"2026-09-30T04:56:46.148Z","dkimSelector":"cf-bounce","routingConfirmed":true,"sendingConfirmed":true,"routingDns":true,"sendingDns":true,"records":{"cf-bounce.messageflow.dev/MX":["100 route2.mx.cloudflare.net.","63 route3.mx.cloudflare.net.","89 route1.mx.cloudflare.net."],"cf-bounce._domainkey.messageflow.dev/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"cf-bounce.messageflow.dev/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf2024-1._domainkey.messageflow.dev/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"messageflow.dev/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"messageflow.dev/MX":["100 route2.mx.cloudflare.net.","63 route3.mx.cloudflare.net.","89 route1.mx.cloudflare.net."],"_dmarc.messageflow.dev/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T04:56:46.148Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('95a881a7-b701-489a-9eee-4be47d3f91c4','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T05:07:33.120Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":true,"records":{"msgflow.yeheyremit.jp/MX":[],"cf-bounce.msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf-bounce.msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"msgflow.yeheyremit.jp/TXT":[],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"_dmarc.msgflow.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T05:07:33.120Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('ae830444-bf49-44c3-a3c3-ed7a294cbd0a','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T05:08:44.293Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":false,"sendingDns":true,"records":{"cf-bounce.msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf-bounce.msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"_dmarc.msgflow.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T05:08:44.293Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('68add49c-f986-4e61-8ccb-555099673a05','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"checkedAt":"2026-09-30T05:08:48.530Z","dkimSelector":"cf-bounce","routingConfirmed":true,"sendingConfirmed":true,"routingDns":false,"sendingDns":true,"records":{"msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.msgflow.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.msgflow.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT":[],"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"_dmarc.msgflow.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T05:08:48.530Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('96a38864-4f38-4475-8f3e-86e5116bd785','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.state','ff9558b1-eec6-4a26-8201-a0b394d720f6','{"before":{"id":"ff9558b1-eec6-4a26-8201-a0b394d720f6","workspaceId":"9206fe2a-11cb-41c6-be1b-6ccf7ab62514","canonicalDomain":"msgflow.yeheyremit.jp","inboundState":"pending","outboundState":"pending","dnsStatusJson":"{\"checkedAt\":\"2026-09-30T05:08:48.530Z\",\"dkimSelector\":\"cf-bounce\",\"routingConfirmed\":true,\"sendingConfirmed\":true,\"routingDns\":false,\"sendingDns\":true,\"records\":{\"msgflow.yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"msgflow.yeheyremit.jp/TXT\":[\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf-bounce.msgflow.yeheyremit.jp/TXT\":[\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf-bounce.msgflow.yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"cf2024-1._domainkey.msgflow.yeheyremit.jp/TXT\":[],\"cf-bounce._domainkey.msgflow.yeheyremit.jp/TXT\":[\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\"],\"_dmarc.msgflow.yeheyremit.jp/TXT\":[\"v=DMARC1; p=reject;\"]}}","operatorConfirmedAt":null,"createdAt":"2026-09-30T04:45:34.804Z","updatedAt":"2026-09-30T05:08:48.530Z"},"input":{"outboundState":"ready"}}','2026-09-30T05:08:54.700Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('8c8ce836-9159-46e0-a5d4-3c7c505fdfd9','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.create','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"canonicalDomain":"yeheyremit.jp"}','2026-09-30T05:10:11.124Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('2425c1a6-23e5-4823-95db-252ca278c8bd','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"checkedAt":"2026-09-30T05:10:17.734Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":true,"sendingDns":false,"records":{"yeheyremit.jp/TXT":["_pjd54n01x2yz4nndelw3knvgf1argbl","google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw","google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE","hosting-site=yeheyremit","v=spf1 include:_spf.mx.cloudflare.net ~all"],"yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf-bounce.yeheyremit.jp/TXT":[],"cf-bounce.yeheyremit.jp/MX":[],"cf2024-1._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"cf-bounce._domainkey.yeheyremit.jp/TXT":[],"_dmarc.yeheyremit.jp/TXT":[]}}','2026-09-30T05:10:17.734Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('23b1bc86-9f13-4d18-bf7a-a6978dca6e10','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"checkedAt":"2026-09-30T05:12:41.882Z","dkimSelector":"cf-bounce","routingConfirmed":false,"sendingConfirmed":false,"routingDns":true,"sendingDns":true,"records":{"cf-bounce.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf2024-1._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"cf-bounce._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"yeheyremit.jp/TXT":["_pjd54n01x2yz4nndelw3knvgf1argbl","google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw","google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE","hosting-site=yeheyremit","v=spf1 include:_spf.mx.cloudflare.net ~all"],"yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"_dmarc.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T05:12:41.882Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('d78bac07-c713-4e5f-9027-90a6ffeaa38c','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.verify','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"checkedAt":"2026-09-30T05:12:46.810Z","dkimSelector":"cf-bounce","routingConfirmed":true,"sendingConfirmed":true,"routingDns":true,"sendingDns":true,"records":{"yeheyremit.jp/TXT":["_pjd54n01x2yz4nndelw3knvgf1argbl","google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw","google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE","hosting-site=yeheyremit","v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf-bounce.yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"cf-bounce._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"cf-bounce.yeheyremit.jp/TXT":["v=spf1 include:_spf.mx.cloudflare.net ~all"],"cf2024-1._domainkey.yeheyremit.jp/TXT":["v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB"],"yeheyremit.jp/MX":["39 route3.mx.cloudflare.net.","42 route2.mx.cloudflare.net.","71 route1.mx.cloudflare.net."],"_dmarc.yeheyremit.jp/TXT":["v=DMARC1; p=reject;"]}}','2026-09-30T05:12:46.810Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('5b54efcc-e26c-40a8-9144-0c4172de26a8','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.state','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"before":{"id":"7dcbaece-7dad-4f76-b6b1-3d7953021c15","workspaceId":"9206fe2a-11cb-41c6-be1b-6ccf7ab62514","canonicalDomain":"yeheyremit.jp","inboundState":"pending","outboundState":"pending","dnsStatusJson":"{\"checkedAt\":\"2026-09-30T05:12:46.810Z\",\"dkimSelector\":\"cf-bounce\",\"routingConfirmed\":true,\"sendingConfirmed\":true,\"routingDns\":true,\"sendingDns\":true,\"records\":{\"yeheyremit.jp/TXT\":[\"_pjd54n01x2yz4nndelw3knvgf1argbl\",\"google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw\",\"google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE\",\"hosting-site=yeheyremit\",\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf-bounce.yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"cf-bounce._domainkey.yeheyremit.jp/TXT\":[\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\"],\"cf-bounce.yeheyremit.jp/TXT\":[\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf2024-1._domainkey.yeheyremit.jp/TXT\":[\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\"],\"yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"_dmarc.yeheyremit.jp/TXT\":[\"v=DMARC1; p=reject;\"]}}","operatorConfirmedAt":null,"createdAt":"2026-09-30T05:10:11.124Z","updatedAt":"2026-09-30T05:12:46.810Z"},"input":{"inboundState":"ready"}}','2026-09-30T05:12:49.926Z');
INSERT INTO "email_audit" ("id","workspace_id","actor_user_id","action","target_id","detail_json","created_at") VALUES('c6329836-d167-4ab0-a5f2-dda0d349c077','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','domain.state','7dcbaece-7dad-4f76-b6b1-3d7953021c15','{"before":{"id":"7dcbaece-7dad-4f76-b6b1-3d7953021c15","workspaceId":"9206fe2a-11cb-41c6-be1b-6ccf7ab62514","canonicalDomain":"yeheyremit.jp","inboundState":"ready","outboundState":"pending","dnsStatusJson":"{\"checkedAt\":\"2026-09-30T05:12:46.810Z\",\"dkimSelector\":\"cf-bounce\",\"routingConfirmed\":true,\"sendingConfirmed\":true,\"routingDns\":true,\"sendingDns\":true,\"records\":{\"yeheyremit.jp/TXT\":[\"_pjd54n01x2yz4nndelw3knvgf1argbl\",\"google-site-verification=DhwKiFNEp_l30RrkbmgAPFDwL87mGtSPcLUtZjCwyLw\",\"google-site-verification=bTAX2MwV8OhX8AUMiB9NrqvMNc2OWGqwcHrtvi38pCE\",\"hosting-site=yeheyremit\",\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf-bounce.yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"cf-bounce._domainkey.yeheyremit.jp/TXT\":[\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\"],\"cf-bounce.yeheyremit.jp/TXT\":[\"v=spf1 include:_spf.mx.cloudflare.net ~all\"],\"cf2024-1._domainkey.yeheyremit.jp/TXT\":[\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78km4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\"],\"yeheyremit.jp/MX\":[\"39 route3.mx.cloudflare.net.\",\"42 route2.mx.cloudflare.net.\",\"71 route1.mx.cloudflare.net.\"],\"_dmarc.yeheyremit.jp/TXT\":[\"v=DMARC1; p=reject;\"]}}","operatorConfirmedAt":null,"createdAt":"2026-09-30T05:10:11.124Z","updatedAt":"2026-09-30T05:12:49.926Z"},"input":{"outboundState":"ready"}}','2026-09-30T05:12:52.984Z');
CREATE TABLE email_canonical_messages (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), mailbox_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, ingress_id TEXT UNIQUE, rfc_message_id TEXT,
 message_json TEXT NOT NULL CHECK(json_valid(message_json)), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL,
 routing_done INTEGER NOT NULL DEFAULT 0 CHECK(routing_done IN (0,1)), projected_at TEXT,
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id),
 FOREIGN KEY(ingress_id,workspace_id,mailbox_id) REFERENCES email_ingress(id,workspace_id,mailbox_id)
);
CREATE TABLE email_private_attachments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), mailbox_id TEXT NOT NULL,
 conversation_id TEXT, ingress_id TEXT, actor_id TEXT REFERENCES user(id), object_key TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/gif','image/webp','application/pdf')),
 size INTEGER NOT NULL CHECK(size >= 0 AND size <= 5242880), created_at TEXT NOT NULL,
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id),
 FOREIGN KEY(ingress_id,workspace_id,mailbox_id) REFERENCES email_ingress(id,workspace_id,mailbox_id)
);
CREATE TABLE email_outbound_metadata (
 intent_id TEXT PRIMARY KEY REFERENCES outbound_intents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 receiving_mailbox_id TEXT NOT NULL, mailbox_id TEXT NOT NULL,
 from_address TEXT NOT NULL, to_address TEXT NOT NULL, in_reply_to TEXT,
 references_json TEXT NOT NULL CHECK(json_valid(references_json)), confirm_private_identity INTEGER NOT NULL DEFAULT 0 CHECK(confirm_private_identity IN (0,1)),
 created_at TEXT NOT NULL,
 FOREIGN KEY(receiving_mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id)
);
CREATE TABLE email_routing_commits (message_id TEXT PRIMARY KEY REFERENCES email_canonical_messages(id));
CREATE TABLE email_identity_bridges (
 intent_id TEXT PRIMARY KEY REFERENCES outbound_intents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 mailbox_id TEXT NOT NULL, conversation_id TEXT NOT NULL, provider_message_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES user(id), created_at TEXT NOT NULL,
 UNIQUE(mailbox_id,provider_message_id),
 FOREIGN KEY(mailbox_id,workspace_id) REFERENCES mailboxes(id,workspace_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES conversations(id,workspace_id)
);
CREATE TABLE agent_invitations (
 id TEXT PRIMARY KEY NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 invited_by TEXT NOT NULL REFERENCES user(id),
 expires_at INTEGER NOT NULL,
 claimed_at INTEGER,
 user_id TEXT REFERENCES user(id),
 accepted_at INTEGER,
 created_at INTEGER NOT NULL
, reserved_username TEXT, revoked_at INTEGER, cooldown_until INTEGER);
INSERT INTO "agent_invitations" ("id","token_hash","workspace_id","email","invited_by","expires_at","claimed_at","user_id","accepted_at","created_at","reserved_username","revoked_at","cooldown_until") VALUES('78c47f20-7b63-4b01-a1db-2e9425128192','11b69d6cc422e3ea085a8e78f23f0a1c60646174567a7e1583cebc6e0f686a65','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','subedi.adhip@yehey.jp','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',1790929369797,1790756931768,'k9WynHBJPRO6GfUz9fBGBW449zagHlxj',1790824141000,1790756569797,'subedi.adhip',NULL,NULL);
INSERT INTO "agent_invitations" ("id","token_hash","workspace_id","email","invited_by","expires_at","claimed_at","user_id","accepted_at","created_at","reserved_username","revoked_at","cooldown_until") VALUES('f042d91b-9b91-4853-b691-274951ea8579','5e15f0d34baee357521a51a486486a561e5ad63d6fa65e8ab30ae9d0b41434e8','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','subedi.adhip@yehey.jp','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn',1791000813803,NULL,NULL,NULL,1790828013803,'subedi.adhip',NULL,NULL);
CREATE TABLE email_drafts (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 payload_json TEXT NOT NULL,
 updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE meta_apps (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, webhook_verify_token_hash TEXT, `webhook_subscription_confirmed_at` text);
INSERT INTO "meta_apps" ("id","workspace_id","display_name","app_id","app_secret","created_at","updated_at","webhook_verify_token_hash","webhook_subscription_confirmed_at") VALUES('dd24f530-71eb-4e56-8af4-8cba99f1adf8','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','MsgFlow','2992433274435470','enc:v1:CJHEZMlLxFGISMPv:GyyF4SF_NPr7Q4GJRpibgBNBDma0Bf6ghu_i39w_N93t-fPCCVGhZn9nAfY9RlIY','2026-09-30T05:26:41.998Z','2026-10-01T01:58:04.039Z','90b7d0f332b7643f90e79a9913f7ea8f0bda892b8a5a7502334a480fab641d36',NULL);
CREATE TABLE meta_oauth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meta_app_id TEXT NOT NULL REFERENCES meta_apps(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  callback_origin TEXT NOT NULL,
  state_nonce TEXT NOT NULL UNIQUE,
  encrypted_pages TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE workspace_member_offboardings (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  prior_role TEXT NOT NULL CHECK (prior_role IN ('owner', 'admin', 'member')),
  confirmation_identifier TEXT NOT NULL,
  private_mailboxes_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
INSERT INTO "workspace_member_offboardings" ("id","workspace_id","user_id","actor_user_id","prior_role","confirmation_identifier","private_mailboxes_disabled","created_at") VALUES('b3a2d6f7-1597-44ba-a8c7-5fad89ad594f','9206fe2a-11cb-41c6-be1b-6ccf7ab62514','k9WynHBJPRO6GfUz9fBGBW449zagHlxj','rBQ5RnAlS4I94rcKsXS6xluT04GI85gn','member','subedi.adhip',0,'2026-10-01T04:08:53.827Z');
CREATE TABLE `ring_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`strategy` text NOT NULL CHECK (`strategy` IN ('simultaneous', 'round_robin')),
	`next_member_cursor` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE TABLE `ring_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`ring_group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ring_group_id`) REFERENCES `ring_groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE TABLE `call_queues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`is_enabled` integer NOT NULL DEFAULT 0,
	`provisioning_lease_token` text,
	`no_agent_reply_text` text NOT NULL,
	`timezone_id` text NOT NULL,
	`weekly_operating_hours_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE TABLE `call_queue_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`queue_id` text NOT NULL,
	`ring_group_id` text NOT NULL,
	`stage_order` integer NOT NULL,
	`ring_duration_seconds` integer NOT NULL CHECK (`ring_duration_seconds` BETWEEN 1 AND 50),
	`created_at` text NOT NULL,
	FOREIGN KEY (`queue_id`) REFERENCES `call_queues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ring_group_id`) REFERENCES `ring_groups`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE TABLE `agent_call_presence` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'offline' CHECK (`status` IN ('available', 'away', 'offline')),
	`socket_connected_at` text,
	`heartbeat_expires_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE TABLE `call_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`conversation_id` text,
	`queue_id` text,
	`provider_call_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`direction` text NOT NULL CHECK (`direction` IN ('consumer_to_business')),
	`state` text NOT NULL CHECK (`state` IN ('ringing', 'accepted', 'rejected', 'timed_out', 'terminated', 'failed')),
	`accepted_by_user_id` text,
	`terminal_reason` text,
	`quality_summary_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`queue_id`) REFERENCES `call_queues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `idx_conversation_reads` ON `conversation_reads` (`conversation_id`,`agent_id`);
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
CREATE UNIQUE INDEX `idx_channels_workspace_external` ON `channels` (`workspace_id`,`external_id`);
CREATE UNIQUE INDEX `idx_contact_identities_channel_external` ON `contact_identities` (`channel_id`,`external_user_id`);
CREATE UNIQUE INDEX `idx_inbox_channels` ON `inbox_channels` (`inbox_id`,`channel_id`);
CREATE UNIQUE INDEX `idx_inbox_members_unique` ON `inbox_members` (`inbox_id`,`user_id`);
CREATE INDEX `idx_messages_summary_conv` ON `messages_summary` (`conversation_id`,`sent_at`);
CREATE UNIQUE INDEX `idx_team_members_unique` ON `team_members` (`team_id`,`user_id`);
CREATE UNIQUE INDEX `idx_workspace_members_unique` ON `workspace_members` (`workspace_id`,`user_id`);
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);
CREATE INDEX `idx_conversations_inbox_status` ON `conversations` (`inbox_id`,`status`);
CREATE INDEX `idx_conversations_assignee` ON `conversations` (`assignee_id`);
CREATE INDEX `idx_conversations_contact` ON `conversations` (`contact_id`);
CREATE INDEX `idx_conversations_last_activity` ON `conversations` (`last_message_at`);
CREATE UNIQUE INDEX `idx_conversation_tags` ON `conversation_tags` (`conversation_id`,`tag_id`);
CREATE UNIQUE INDEX `idx_user_sidebar_preferences_unique` ON `user_sidebar_preferences` (`user_id`,`workspace_id`);
CREATE UNIQUE INDEX `idx_inbox_channels_one_default_per_channel`
ON `inbox_channels` (`channel_id`) WHERE `is_default` = 1;
CREATE UNIQUE INDEX `idx_outbound_intents_scheduled_message` ON `outbound_intents` (`scheduled_message_id`);
CREATE INDEX `idx_outbound_intents_status` ON `outbound_intents` (`status`,`updated_at`);
CREATE UNIQUE INDEX `idx_comment_notifications_comment_user` ON `comment_notifications` (`comment_id`,`user_id`);
CREATE INDEX `idx_comment_notifications_user_unread` ON `comment_notifications` (`user_id`,`read_at`,`created_at`);
CREATE INDEX `idx_email_domains_workspace` ON `email_domains` (`workspace_id`);
CREATE UNIQUE INDEX `idx_mailboxes_domain_local_part` ON `mailboxes` (`email_domain_id`,`local_part`);
CREATE INDEX `idx_mailboxes_workspace_owner` ON `mailboxes` (`workspace_id`,`owner_user_id`);
CREATE UNIQUE INDEX `idx_email_ingress_mailbox_dedupe` ON `email_ingress` (`mailbox_id`,`dedupe_key`);
CREATE INDEX `idx_email_ingress_state` ON `email_ingress` (`state`,`received_at`);
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);
CREATE INDEX `idx_email_ingress_mailbox_state_received`
ON `email_ingress` (`mailbox_id`, `state`, `received_at`);
CREATE INDEX idx_email_audit_workspace_time ON email_audit(workspace_id, created_at);
CREATE UNIQUE INDEX idx_mailbox_workspace_identity ON mailboxes(id,workspace_id);
CREATE UNIQUE INDEX idx_conversation_workspace_identity ON conversations(id,workspace_id);
CREATE UNIQUE INDEX idx_ingress_scope_identity ON email_ingress(id,workspace_id,mailbox_id);
CREATE INDEX idx_email_canonical_thread ON email_canonical_messages(mailbox_id,rfc_message_id);
CREATE INDEX idx_email_canonical_conversation ON email_canonical_messages(conversation_id,created_at);
CREATE INDEX agent_invitations_workspace ON agent_invitations(workspace_id);
CREATE INDEX idx_email_drafts_workspace_user ON email_drafts(workspace_id, user_id);
CREATE UNIQUE INDEX idx_agent_invitations_active_username
ON agent_invitations(reserved_username)
WHERE accepted_at IS NULL AND revoked_at IS NULL AND reserved_username IS NOT NULL;
CREATE UNIQUE INDEX idx_agent_invitations_active_email
ON agent_invitations(email)
WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_channels_meta_app ON channels(meta_app_id);
CREATE INDEX idx_meta_oauth_sessions_actor ON meta_oauth_sessions(actor_user_id, expires_at);
CREATE UNIQUE INDEX idx_meta_apps_webhook_verify_token_hash
  ON meta_apps(webhook_verify_token_hash)
  WHERE webhook_verify_token_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_meta_apps_app_id ON meta_apps(app_id);
CREATE UNIQUE INDEX idx_channels_facebook_page_identity
ON channels(external_id)
WHERE type = 'facebook_page' AND status <> 'deleted';
CREATE INDEX idx_workspace_member_offboardings_workspace_time
ON workspace_member_offboardings(workspace_id, created_at);
CREATE INDEX idx_inboxes_workspace_parent_order
ON inboxes(workspace_id, parent_inbox_id, sort_order, id);
CREATE INDEX idx_inboxes_workspace_visibility
ON inboxes(workspace_id, visibility_type, is_archived);
CREATE INDEX `idx_ring_groups_workspace_team` ON `ring_groups` (`workspace_id`,`team_id`);
CREATE UNIQUE INDEX `idx_ring_group_members_group_user` ON `ring_group_members` (`ring_group_id`,`user_id`);
CREATE INDEX `idx_call_queues_workspace_team` ON `call_queues` (`workspace_id`,`team_id`);
CREATE UNIQUE INDEX `idx_call_queues_enabled_channel` ON `call_queues` (`channel_id`) WHERE `is_enabled` = 1;
CREATE UNIQUE INDEX `idx_call_queues_provisioning_channel` ON `call_queues` (`channel_id`) WHERE `provisioning_lease_token` IS NOT NULL;
CREATE UNIQUE INDEX `idx_call_queue_stages_queue_order` ON `call_queue_stages` (`queue_id`,`stage_order`);
CREATE INDEX `idx_agent_call_presence_eligible` ON `agent_call_presence` (`workspace_id`,`status`,`heartbeat_expires_at`);
CREATE UNIQUE INDEX `idx_call_events_provider_event` ON `call_events` (`channel_id`,`provider_event_id`);
CREATE TRIGGER `user_username_insert_valid`
BEFORE INSERT ON `user`
WHEN NEW.`username` IS NOT NULL AND (
	length(NEW.`username`) < 3
	OR length(NEW.`username`) > 30
	OR NEW.`username` <> lower(NEW.`username`)
	OR NEW.`username` GLOB '*[^a-z0-9.-]*'
	OR NEW.`username` GLOB '.*'
	OR NEW.`username` GLOB '*.'
	OR NEW.`username` GLOB '*..*'
)
BEGIN
	SELECT RAISE(ABORT, 'invalid username');
END;
CREATE TRIGGER `user_username_update_valid`
BEFORE UPDATE OF `username` ON `user`
WHEN NEW.`username` IS NOT NULL AND (
	length(NEW.`username`) < 3
	OR length(NEW.`username`) > 30
	OR NEW.`username` <> lower(NEW.`username`)
	OR NEW.`username` GLOB '*[^a-z0-9.-]*'
	OR NEW.`username` GLOB '.*'
	OR NEW.`username` GLOB '*.'
	OR NEW.`username` GLOB '*..*'
)
BEGIN
	SELECT RAISE(ABORT, 'invalid username');
END;
CREATE TRIGGER `user_username_immutable`
BEFORE UPDATE OF `username` ON `user`
WHEN OLD.`username` IS NOT NULL AND NEW.`username` IS NOT OLD.`username`
BEGIN
	SELECT RAISE(ABORT, 'username is immutable');
END;
CREATE TRIGGER email_audit_no_update BEFORE UPDATE ON email_audit BEGIN SELECT RAISE(ABORT, 'email audit is immutable'); END;
CREATE TRIGGER mailbox_transport_provision AFTER INSERT ON mailboxes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM email_domains WHERE id = NEW.email_domain_id AND workspace_id = NEW.workspace_id) THEN RAISE(ABORT, 'mailbox domain workspace mismatch') END;
 SELECT CASE WHEN NEW.type = 'shared' AND NOT EXISTS(SELECT 1 FROM inboxes WHERE id = NEW.inbox_id AND workspace_id = NEW.workspace_id AND is_archived = 0) THEN RAISE(ABORT, 'mailbox inbox unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM channels c JOIN inbox_channels ic ON ic.channel_id = c.id WHERE c.workspace_id = NEW.workspace_id AND c.external_id = NEW.canonical_address AND ic.is_default = 1 AND ic.inbox_id != CASE WHEN NEW.type = 'private' THEN 'mailbox-inbox:' || NEW.id ELSE NEW.inbox_id END) THEN RAISE(ABORT, 'mailbox default inbox collision') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM channels WHERE workspace_id = NEW.workspace_id AND external_id = NEW.canonical_address AND type != 'email') THEN RAISE(ABORT, 'mailbox channel collision') END;
 INSERT OR IGNORE INTO channels(id, workspace_id, type, display_name, external_id, status, created_at, updated_at)
 VALUES ('mailbox-channel:' || NEW.id, NEW.workspace_id, 'email', NEW.canonical_address, NEW.canonical_address, 'active', NEW.created_at, NEW.updated_at);
 INSERT OR IGNORE INTO inboxes(id, workspace_id, name, created_at)
 SELECT 'mailbox-inbox:' || NEW.id, NEW.workspace_id, NEW.canonical_address, NEW.created_at WHERE NEW.type = 'private';
 INSERT OR IGNORE INTO inbox_channels(id, inbox_id, channel_id, is_default)
 SELECT 'mailbox-link:' || NEW.id, CASE WHEN NEW.type = 'private' THEN 'mailbox-inbox:' || NEW.id ELSE NEW.inbox_id END, id, 1 FROM channels
 WHERE workspace_id = NEW.workspace_id AND external_id = NEW.canonical_address
 AND NOT EXISTS (SELECT 1 FROM inbox_channels ic WHERE ic.channel_id = channels.id AND ic.is_default = 1);
END;
CREATE TRIGGER email_outbound_metadata_scope BEFORE INSERT ON email_outbound_metadata
WHEN NOT EXISTS (
 SELECT 1 FROM outbound_intents o JOIN conversations c ON c.id=o.conversation_id
 JOIN channels ch ON ch.id=c.channel_id
 JOIN mailboxes receiving ON receiving.id=NEW.receiving_mailbox_id AND receiving.canonical_address=ch.external_id AND receiving.workspace_id=c.workspace_id
 JOIN mailboxes sending ON sending.id=NEW.mailbox_id AND sending.workspace_id=c.workspace_id AND sending.canonical_address=NEW.from_address
 WHERE o.id=NEW.intent_id AND c.workspace_id=NEW.workspace_id AND ch.type='email'
) BEGIN SELECT RAISE(ABORT,'email outbound scope mismatch'); END;
CREATE TRIGGER email_outbound_metadata_immutable BEFORE UPDATE ON email_outbound_metadata
BEGIN SELECT RAISE(ABORT,'email outbound metadata is immutable'); END;
CREATE TRIGGER agent_invitation_accept_membership AFTER UPDATE OF accepted_at ON agent_invitations
WHEN OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
BEGIN
 INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
 VALUES (NEW.id, NEW.workspace_id, NEW.user_id, 'member', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER email_send_requested AFTER INSERT ON email_outbound_metadata BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),NEW.workspace_id,o.sender_id,'outbound.requested',o.id,json_object('conversationId',o.conversation_id,'mailboxId',NEW.mailbox_id),NEW.created_at FROM outbound_intents o WHERE o.id=NEW.intent_id;
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),NEW.workspace_id,o.sender_id,'outbound.private_identity_override',o.id,json_object('receivingMailboxId',NEW.receiving_mailbox_id,'mailboxId',NEW.mailbox_id),NEW.created_at FROM outbound_intents o JOIN mailboxes m ON m.id=NEW.mailbox_id WHERE o.id=NEW.intent_id AND m.type='private' AND NEW.mailbox_id != NEW.receiving_mailbox_id AND NEW.confirm_private_identity=1;
END;
CREATE TRIGGER email_send_transition AFTER UPDATE OF status ON outbound_intents
WHEN OLD.status != NEW.status AND NEW.status IN ('sending','provider_sent','failed','uncertain') BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),em.workspace_id,NEW.sender_id,
 CASE NEW.status WHEN 'sending' THEN 'outbound.attempt' WHEN 'provider_sent' THEN 'outbound.accepted' WHEN 'failed' THEN 'outbound.failed' ELSE 'outbound.uncertain' END,
 NEW.id,json_object('attempt',NEW.attempts,'providerMessageId',NEW.provider_message_id),NEW.updated_at
 FROM email_outbound_metadata em WHERE em.intent_id=NEW.id
 AND (NEW.status != 'provider_sent' OR OLD.status NOT IN ('accepted','provider_sent'));
END;
CREATE TRIGGER email_bridge_granted AFTER INSERT ON email_identity_bridges BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.actor_id,'identity_bridge.granted',NEW.intent_id,json_object('mailboxId',NEW.mailbox_id,'conversationId',NEW.conversation_id),NEW.created_at);
END;
CREATE TRIGGER agent_invitation_accept_guard BEFORE UPDATE OF accepted_at ON agent_invitations
WHEN NEW.accepted_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
 OR NEW.expires_at <= NEW.accepted_at OR NEW.reserved_username IS NULL
 OR NOT EXISTS (SELECT 1 FROM user WHERE id = NEW.user_id AND lower(email) = NEW.email AND email_verified = 1 AND username IS NULL)
 THEN RAISE(ABORT, 'invitation acceptance requires an unexpired invitation, verified matching user, and unassigned username') END;
 UPDATE user SET username = NEW.reserved_username WHERE id = NEW.user_id;
END;
CREATE TRIGGER workspace_member_offboardings_no_update
BEFORE UPDATE ON workspace_member_offboardings
BEGIN SELECT RAISE(ABORT, 'workspace member offboarding audit is immutable'); END;
CREATE TRIGGER workspace_members_retain_owner_on_role_change
BEFORE UPDATE OF role ON workspace_members
WHEN OLD.role = 'owner' AND NEW.role != 'owner'
AND NOT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND user_id != OLD.user_id
)
BEGIN SELECT RAISE(ABORT, 'a workspace must retain at least one owner'); END;
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
CREATE TRIGGER email_audit_no_delete
BEFORE DELETE ON email_audit
BEGIN SELECT RAISE(ABORT, 'email audit is immutable'); END;
CREATE TRIGGER workspace_member_offboardings_no_delete
BEFORE DELETE ON workspace_member_offboardings
BEGIN SELECT RAISE(ABORT, 'workspace member offboarding audit is immutable'); END;
CREATE TRIGGER workspace_members_retain_owner_on_removal
BEFORE DELETE ON workspace_members
WHEN OLD.role = 'owner'
AND NOT EXISTS (
  SELECT 1 FROM workspace_members
  WHERE workspace_id = OLD.workspace_id
    AND role = 'owner'
    AND user_id != OLD.user_id
)
BEGIN SELECT RAISE(ABORT, 'a workspace must retain at least one owner'); END;
CREATE TRIGGER `ring_groups_team_workspace_insert`
BEFORE INSERT ON `ring_groups`
FOR EACH ROW WHEN (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT RAISE(ABORT, 'ring group team must belong to its workspace');
END;
CREATE TRIGGER `ring_groups_team_workspace_update`
BEFORE UPDATE OF workspace_id, team_id ON `ring_groups`
FOR EACH ROW WHEN (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT RAISE(ABORT, 'ring group team must belong to its workspace');
END;
CREATE TRIGGER `ring_group_members_team_insert`
BEFORE INSERT ON `ring_group_members`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM ring_groups AS rg
	INNER JOIN team_members AS tm ON tm.team_id = rg.team_id AND tm.user_id = NEW.user_id
	WHERE rg.id = NEW.ring_group_id
)
BEGIN
	SELECT RAISE(ABORT, 'ring group member must be an active member of the group team');
END;
CREATE TRIGGER `ring_group_members_team_update`
BEFORE UPDATE OF ring_group_id, user_id ON `ring_group_members`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM ring_groups AS rg
	INNER JOIN team_members AS tm ON tm.team_id = rg.team_id AND tm.user_id = NEW.user_id
	WHERE rg.id = NEW.ring_group_id
)
BEGIN
	SELECT RAISE(ABORT, 'ring group member must be an active member of the group team');
END;
CREATE TRIGGER `call_queues_scope_insert`
BEFORE INSERT ON `call_queues`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active')
		THEN RAISE(ABORT, 'call queue channel must be an active Facebook Page in its workspace')
		ELSE RAISE(ABORT, 'call queue team must belong to its workspace') END;
END;
CREATE TRIGGER `call_queues_scope_update`
BEFORE UPDATE OF workspace_id, channel_id, team_id ON `call_queues`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (SELECT workspace_id FROM teams WHERE id = NEW.team_id) IS NOT NEW.workspace_id
BEGIN
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active')
		THEN RAISE(ABORT, 'call queue channel must be an active Facebook Page in its workspace')
		ELSE RAISE(ABORT, 'call queue team must belong to its workspace') END;
END;
CREATE TRIGGER `call_queue_stages_scope_insert`
BEFORE INSERT ON `call_queue_stages`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM call_queues AS cq
	INNER JOIN ring_groups AS rg ON rg.id = NEW.ring_group_id AND rg.workspace_id = cq.workspace_id AND rg.team_id = cq.team_id
	WHERE cq.id = NEW.queue_id
)
BEGIN
	SELECT RAISE(ABORT, 'call queue stage ring group must belong to the queue workspace and team');
END;
CREATE TRIGGER `call_queue_stages_scope_update`
BEFORE UPDATE OF queue_id, ring_group_id ON `call_queue_stages`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM call_queues AS cq
	INNER JOIN ring_groups AS rg ON rg.id = NEW.ring_group_id AND rg.workspace_id = cq.workspace_id AND rg.team_id = cq.team_id
	WHERE cq.id = NEW.queue_id
)
BEGIN
	SELECT RAISE(ABORT, 'call queue stage ring group must belong to the queue workspace and team');
END;
CREATE TRIGGER `call_queue_stages_total_insert`
BEFORE INSERT ON `call_queue_stages`
FOR EACH ROW WHEN COALESCE((SELECT SUM(ring_duration_seconds) FROM call_queue_stages WHERE queue_id = NEW.queue_id), 0) + NEW.ring_duration_seconds > 50
BEGIN
	SELECT RAISE(ABORT, 'call queue stages may not exceed 50 seconds');
END;
CREATE TRIGGER `call_queue_stages_total_update`
BEFORE UPDATE OF queue_id, ring_duration_seconds ON `call_queue_stages`
FOR EACH ROW WHEN COALESCE((SELECT SUM(ring_duration_seconds) FROM call_queue_stages WHERE queue_id = NEW.queue_id AND id <> OLD.id), 0) + NEW.ring_duration_seconds > 50
BEGIN
	SELECT RAISE(ABORT, 'call queue stages may not exceed 50 seconds');
END;
CREATE TRIGGER `call_events_scope_insert`
BEFORE INSERT ON `call_events`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
)) OR (NEW.queue_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM call_queues WHERE id = NEW.queue_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
))
BEGIN
	SELECT CASE
		WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active') THEN RAISE(ABORT, 'call event channel must be an active Facebook Page in its workspace')
		WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id) THEN RAISE(ABORT, 'call event conversation must belong to its workspace and channel')
		ELSE RAISE(ABORT, 'call event queue must belong to its workspace and channel') END;
END;
CREATE TRIGGER `call_events_scope_update`
BEFORE UPDATE OF workspace_id, channel_id, conversation_id, queue_id ON `call_events`
FOR EACH ROW WHEN NOT EXISTS (
	SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active'
) OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
)) OR (NEW.queue_id IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM call_queues WHERE id = NEW.queue_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id
))
BEGIN
	SELECT CASE
		WHEN NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND workspace_id = NEW.workspace_id AND type = 'facebook_page' AND status = 'active') THEN RAISE(ABORT, 'call event channel must be an active Facebook Page in its workspace')
		WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id AND workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id) THEN RAISE(ABORT, 'call event conversation must belong to its workspace and channel')
		ELSE RAISE(ABORT, 'call event queue must belong to its workspace and channel') END;
END;
