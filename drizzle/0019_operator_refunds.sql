ALTER TABLE `tx_log` ADD `reverses_id` integer;--> statement-breakpoint
ALTER TABLE `tx_log` ADD `note` text;--> statement-breakpoint
CREATE INDEX `tx_log_reverses` ON `tx_log` (`reverses_id`) WHERE "tx_log"."reverses_id" is not null;