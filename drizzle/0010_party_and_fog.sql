CREATE TABLE `parties` (
	`campaign_id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `maps` ADD `fog` text DEFAULT '{"on":false,"clear":[]}' NOT NULL;