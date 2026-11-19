ALTER TABLE `campaigns` ADD `shown_to` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `markers` ADD `seen_by` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `regions` ADD `seen_by` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `regions` ADD `closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `count` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `seen_by` text DEFAULT '[]' NOT NULL;