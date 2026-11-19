PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_seat_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text,
	`name` text,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_seat_claims`("id", "campaign_id", "user_id", "name", "token_hash", "status", "created_at") SELECT "id", "campaign_id", "user_id", NULL, "token_hash", "status", "created_at" FROM `seat_claims`;--> statement-breakpoint
DROP TABLE `seat_claims`;--> statement-breakpoint
ALTER TABLE `__new_seat_claims` RENAME TO `seat_claims`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `seat_claims_token_hash_unique` ON `seat_claims` (`token_hash`);--> statement-breakpoint
CREATE INDEX `seat_claims_campaign` ON `seat_claims` (`campaign_id`);