ALTER TABLE `drawings` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drawings` ADD `seen_by` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `maps` ADD `units` text;--> statement-breakpoint
ALTER TABLE `maps` ADD `diagonal` text;--> statement-breakpoint
ALTER TABLE `maps` ADD `sight` real;