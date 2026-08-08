CREATE TABLE `alerts_sent` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`tier` text NOT NULL,
	`fired_for_ms` integer NOT NULL,
	`sent_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `ref_id`, `tier`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `alerts_enabled` integer DEFAULT true NOT NULL;