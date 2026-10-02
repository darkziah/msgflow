-- Existing users may remain without a username. Once assigned, a username is a
-- permanent private-mailbox-compatible login identifier.
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER `user_username_immutable`
BEFORE UPDATE OF `username` ON `user`
WHEN OLD.`username` IS NOT NULL AND NEW.`username` IS NOT OLD.`username`
BEGIN
	SELECT RAISE(ABORT, 'username is immutable');
END;