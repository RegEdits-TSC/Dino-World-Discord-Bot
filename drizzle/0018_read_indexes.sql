CREATE INDEX `breedings_user_claimed` ON `breedings` (`user_id`,`claimed_at_ms`);--> statement-breakpoint
CREATE INDEX `dinos_user_lot` ON `dinos` (`user_id`,`lot_id`);--> statement-breakpoint
CREATE INDEX `eggs_user` ON `eggs` (`user_id`);--> statement-breakpoint
CREATE INDEX `lots_user` ON `lots` (`user_id`);--> statement-breakpoint
CREATE INDEX `season_progress_index` ON `season_progress` (`season_index`,`user_id`);--> statement-breakpoint
CREATE INDEX `timers_due` ON `timers` (`fires_at_ms`) WHERE "timers"."handled_at_ms" is null;--> statement-breakpoint
CREATE INDEX `trades_status_from` ON `trades` (`status`,`from_user`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `user_guilds_guild` ON `user_guilds` (`guild_id`);