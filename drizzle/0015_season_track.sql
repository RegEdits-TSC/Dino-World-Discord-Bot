CREATE TABLE `season_claims` (
	`user_id` text NOT NULL,
	`season_index` integer NOT NULL,
	`rung` integer NOT NULL,
	`claimed_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `season_index`, `rung`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `season_progress` (
	`user_id` text NOT NULL,
	`season_index` integer NOT NULL,
	`baselines` text DEFAULT '{}' NOT NULL,
	`head_start` integer DEFAULT 0 NOT NULL,
	`badge_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `season_index`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
