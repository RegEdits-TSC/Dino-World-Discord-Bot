CREATE TABLE `achievement_claims` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`tier` integer NOT NULL,
	`claimed_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`, `tier`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`day_key` text NOT NULL,
	`slot` integer NOT NULL,
	`quest_id` text NOT NULL,
	`baseline` integer NOT NULL,
	`target` integer NOT NULL,
	`claimed_at_ms` integer,
	`notified_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_quests_user_day_slot` ON `daily_quests` (`user_id`,`day_key`,`slot`);--> statement-breakpoint
CREATE TABLE `user_stats` (
	`user_id` text NOT NULL,
	`stat` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `stat`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stat_value_nonneg" CHECK("user_stats"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `quest_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `quest_streak_best` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_quest_claim_at_ms` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'stages_first_cleared', COUNT(*) FROM battle_progress
WHERE first_cleared_at_ms IS NOT NULL GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'lots_built', COUNT(*) FROM lots GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT u, 'trades_completed', SUM(c) FROM (
  SELECT from_user AS u, COUNT(*) AS c FROM trades WHERE status = 'accepted' GROUP BY from_user
  UNION ALL
  SELECT to_user AS u, COUNT(*) AS c FROM trades WHERE status = 'accepted' GROUP BY to_user
) GROUP BY u;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'breedings_started', COUNT(*) FROM breedings GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'breedings_claimed', COUNT(*) FROM breedings
WHERE claimed_at_ms IS NOT NULL GROUP BY user_id;
--> statement-breakpoint
INSERT INTO user_stats (user_id, stat, value)
SELECT user_id, 'expeditions_claimed', COUNT(*) FROM expeditions
WHERE claimed_at_ms IS NOT NULL GROUP BY user_id;