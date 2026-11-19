CREATE TABLE `seat_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seat_claims_token_hash_unique` ON `seat_claims` (`token_hash`);--> statement-breakpoint
CREATE INDEX `seat_claims_campaign` ON `seat_claims` (`campaign_id`);--> statement-breakpoint
ALTER TABLE `maps` ADD `day_miles` real;--> statement-breakpoint
ALTER TABLE `markers` ADD `image` text;