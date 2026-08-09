CREATE TABLE `species_seen` (
	`user_id` text NOT NULL,
	`species_id` text NOT NULL,
	`first_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `species_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
