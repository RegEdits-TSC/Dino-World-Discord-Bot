CREATE TABLE `food_inventory` (
	`user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `food_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_qty_nonneg" CHECK("food_inventory"."qty" >= 0)
);
--> statement-breakpoint
INSERT INTO `tx_log` (`user_id`, `cash_delta`, `food_delta`, `reason`, `created_at_ms`)
SELECT `discord_id`, `food` * 10, -`food`, 'food-refund:migration', CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `users` WHERE `food` > 0;
--> statement-breakpoint
UPDATE `users` SET `cash` = `cash` + `food` * 10;
--> statement-breakpoint
UPDATE `trades` SET
  `offer` = json_set(json_remove(`offer`, '$.food'), '$.foods', json('{}'),
    '$.cash', json_extract(`offer`, '$.cash') + (CASE WHEN `status` = 'pending' THEN json_extract(`offer`, '$.food') * 10 ELSE 0 END)),
  `request` = json_set(json_remove(`request`, '$.food'), '$.foods', json('{}'),
    '$.cash', json_extract(`request`, '$.cash') + (CASE WHEN `status` = 'pending' THEN json_extract(`request`, '$.food') * 10 ELSE 0 END));
--> statement-breakpoint
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
	`last_collect_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "cash_nonneg" CHECK("__new_users"."cash" >= 0),
	CONSTRAINT "shards_nonneg" CHECK("__new_users"."shards" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_users`("discord_id", "display_name", "park_name", "park_rating", "rating_high_water", "cash", "shards", "shards_window_start_ms", "shards_window_earned", "last_collect_at_ms", "created_at_ms") SELECT "discord_id", "display_name", "park_name", "park_rating", "rating_high_water", "cash", "shards", "shards_window_start_ms", "shards_window_earned", "last_collect_at_ms", "created_at_ms" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `tx_log` ADD `food_id` text;