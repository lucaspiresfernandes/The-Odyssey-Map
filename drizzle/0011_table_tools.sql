ALTER TABLE `campaigns` ADD `shown_file` text;--> statement-breakpoint
ALTER TABLE `gallery` ADD `token_size` real;--> statement-breakpoint
ALTER TABLE `gallery` ADD `token_outline` text;--> statement-breakpoint
ALTER TABLE `maps` ADD `turns` text DEFAULT '{"order":[],"current":null,"round":1}' NOT NULL;--> statement-breakpoint
ALTER TABLE `maps` ADD `miles` real;--> statement-breakpoint
ALTER TABLE `tokens` ADD `marks` text DEFAULT '[]' NOT NULL;