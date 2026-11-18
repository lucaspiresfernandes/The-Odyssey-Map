CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`size` integer DEFAULT 1 NOT NULL,
	`owner_id` text,
	`owner_name` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tokens_map` ON `tokens` (`map_id`);--> statement-breakpoint
ALTER TABLE `maps` ADD `kind` text DEFAULT 'world' NOT NULL;--> statement-breakpoint
ALTER TABLE `maps` ADD `grid` text DEFAULT '{"size":50,"x":0,"y":0,"shown":true}' NOT NULL;