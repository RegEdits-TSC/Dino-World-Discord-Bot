CREATE TABLE `battle_progress` (
	`user_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`first_cleared_at_ms` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `stage_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stars_range" CHECK("battle_progress"."stars" >= 0 AND "battle_progress"."stars" <= 3)
);
--> statement-breakpoint
ALTER TABLE `dinos` ADD `battle_xp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `energy` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `energy_updated_at_ms` integer DEFAULT 0 NOT NULL;