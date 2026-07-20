CREATE TABLE `dinos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`lot_id` integer,
	`species_id` text NOT NULL,
	`nickname` text,
	`hunger` integer DEFAULT 100 NOT NULL,
	`last_fed_at_ms` integer NOT NULL,
	`escaped_at_ms` integer,
	`via_trade` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`hatched_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eggs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`rarity` text NOT NULL,
	`species_id` text,
	`source` text NOT NULL,
	`via_trade` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`obtained_at_ms` integer NOT NULL,
	`incubation_started_at_ms` integer,
	`hatches_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expeditions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`departed_at_ms` integer NOT NULL,
	`returns_at_ms` integer NOT NULL,
	`loot` text,
	`claimed_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`notify_channel_id` text
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`decor` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ref_id` integer NOT NULL,
	`origin_guild_id` text,
	`fires_at_ms` integer NOT NULL,
	`handled_at_ms` integer
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_user` text NOT NULL,
	`to_user` text NOT NULL,
	`offer` text NOT NULL,
	`request` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`resolved_at_ms` integer,
	FOREIGN KEY (`from_user`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_user`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tx_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`cash_delta` integer DEFAULT 0 NOT NULL,
	`food_delta` integer DEFAULT 0 NOT NULL,
	`shards_delta` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_guilds` (
	`user_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `guild_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`park_name` text DEFAULT 'New Park' NOT NULL,
	`park_rating` integer DEFAULT 0 NOT NULL,
	`rating_high_water` integer DEFAULT 0 NOT NULL,
	`cash` integer DEFAULT 500 NOT NULL,
	`food` integer DEFAULT 20 NOT NULL,
	`shards` integer DEFAULT 0 NOT NULL,
	`shards_window_start_ms` integer DEFAULT 0 NOT NULL,
	`shards_window_earned` integer DEFAULT 0 NOT NULL,
	`last_collect_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "cash_nonneg" CHECK("users"."cash" >= 0),
	CONSTRAINT "food_nonneg" CHECK("users"."food" >= 0),
	CONSTRAINT "shards_nonneg" CHECK("users"."shards" >= 0)
);
