CREATE TABLE `breedings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`parent_a` integer NOT NULL,
	`parent_b` integer NOT NULL,
	`rarity` text NOT NULL,
	`species_id` text,
	`traits` text DEFAULT '[]' NOT NULL,
	`via_trade` integer DEFAULT false NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ready_at_ms` integer NOT NULL,
	`claimed_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `dinos` ADD `traits` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `eggs` ADD `traits` text DEFAULT '[]' NOT NULL;