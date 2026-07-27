PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`park_name` text DEFAULT 'New Park' NOT NULL,
	`park_rating` integer DEFAULT 0 NOT NULL,
	`rating_high_water` integer DEFAULT 0 NOT NULL,
	`cash` integer DEFAULT 500 NOT NULL,
	`shards` integer DEFAULT 0 NOT NULL,
	`shards_window_start_ms` integer DEFAULT 0 NOT NULL,
	`shards_window_earned` integer DEFAULT 0 NOT NULL,
	`energy` integer DEFAULT 10 NOT NULL,
	`energy_updated_at_ms` integer DEFAULT 0 NOT NULL,
	`last_collect_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "cash_nonneg" CHECK("__new_users"."cash" >= 0),
	CONSTRAINT "shards_nonneg" CHECK("__new_users"."shards" >= 0),
	CONSTRAINT "energy_nonneg" CHECK("__new_users"."energy" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_users`("discord_id", "display_name", "park_name", "park_rating", "rating_high_water", "cash", "shards", "shards_window_start_ms", "shards_window_earned", "energy", "energy_updated_at_ms", "last_collect_at_ms", "created_at_ms") SELECT "discord_id", "display_name", "park_name", "park_rating", "rating_high_water", "cash", "shards", "shards_window_start_ms", "shards_window_earned", "energy", "energy_updated_at_ms", "last_collect_at_ms", "created_at_ms" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;