CREATE TABLE `token_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`tokens` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_groups_campaign` ON `token_groups` (`campaign_id`);--> statement-breakpoint
ALTER TABLE `tokens` ADD `count_hidden` integer DEFAULT false NOT NULL;