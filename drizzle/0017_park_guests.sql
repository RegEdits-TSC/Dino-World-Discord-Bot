CREATE TABLE `attendance_claims` (
	`user_id` text NOT NULL,
	`milestone` integer NOT NULL,
	`claimed_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `milestone`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `attractions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`built_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `attendance_high_water` integer DEFAULT 0 NOT NULL;