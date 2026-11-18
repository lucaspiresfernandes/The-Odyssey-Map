CREATE TABLE `drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`kind` text NOT NULL,
	`points` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	`size` real NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drawings_map` ON `drawings` (`map_id`);--> statement-breakpoint
ALTER TABLE `tokens` ADD `rotation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `locked` integer DEFAULT false NOT NULL;