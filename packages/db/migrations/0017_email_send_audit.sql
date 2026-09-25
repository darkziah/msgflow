-- Audit is append-only (0013); triggers keep evidence atomic with durable state.
CREATE TRIGGER email_send_requested AFTER INSERT ON email_outbound_metadata BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),NEW.workspace_id,o.sender_id,'outbound.requested',o.id,json_object('conversationId',o.conversation_id,'mailboxId',NEW.mailbox_id),NEW.created_at FROM outbound_intents o WHERE o.id=NEW.intent_id;
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),NEW.workspace_id,o.sender_id,'outbound.private_identity_override',o.id,json_object('receivingMailboxId',NEW.receiving_mailbox_id,'mailboxId',NEW.mailbox_id),NEW.created_at FROM outbound_intents o JOIN mailboxes m ON m.id=NEW.mailbox_id WHERE o.id=NEW.intent_id AND m.type='private' AND NEW.mailbox_id != NEW.receiving_mailbox_id AND NEW.confirm_private_identity=1;
END;
--> statement-breakpoint
CREATE TRIGGER email_send_transition AFTER UPDATE OF status ON outbound_intents
WHEN OLD.status != NEW.status AND NEW.status IN ('sending','provider_sent','failed','uncertain') BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),em.workspace_id,NEW.sender_id,
 CASE NEW.status WHEN 'sending' THEN 'outbound.attempt' WHEN 'provider_sent' THEN 'outbound.accepted' WHEN 'failed' THEN 'outbound.failed' ELSE 'outbound.uncertain' END,
 NEW.id,json_object('attempt',NEW.attempts,'providerMessageId',NEW.provider_message_id),NEW.updated_at
 FROM email_outbound_metadata em WHERE em.intent_id=NEW.id
 AND (NEW.status != 'provider_sent' OR OLD.status NOT IN ('accepted','provider_sent'));
END;
--> statement-breakpoint
CREATE TRIGGER email_bridge_granted AFTER INSERT ON email_identity_bridges BEGIN
 INSERT INTO email_audit(id,workspace_id,actor_user_id,action,target_id,detail_json,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.workspace_id,NEW.actor_id,'identity_bridge.granted',NEW.intent_id,json_object('mailboxId',NEW.mailbox_id,'conversationId',NEW.conversation_id),NEW.created_at);
END;
