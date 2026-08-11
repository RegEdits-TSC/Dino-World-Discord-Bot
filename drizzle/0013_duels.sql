CREATE TABLE `duels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`challenger_id` text NOT NULL,
	`defender_id` text NOT NULL,
	`mode` text NOT NULL,
	`result` text NOT NULL,
	`elo_delta` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`challenger_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`defender_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `duel_rating` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `duel_squad` text DEFAULT '[]' NOT NULL;