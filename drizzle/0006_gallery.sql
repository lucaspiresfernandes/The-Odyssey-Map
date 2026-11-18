CREATE TABLE `gallery` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`file` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`hidden` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "gallery_kind" CHECK("gallery"."kind" IN ('map', 'token'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_file_unique` ON `gallery` (`file`);--> statement-breakpoint
CREATE INDEX `gallery_campaign` ON `gallery` (`campaign_id`);--> statement-breakpoint
ALTER TABLE `tokens` ADD `image` text;--> statement-breakpoint
-- Hand-written: the images maps already have become the first pictures in
-- the gallery, each under the name of its map. They keep their file names,
-- so every map goes on showing what it showed. Like any new picture they
-- start hidden from the players, who see them on the maps as before.
INSERT INTO `gallery` (`id`, `campaign_id`, `kind`, `name`, `file`, `width`, `height`, `created_at`)
SELECT lower(hex(randomblob(8))), `campaign_id`, 'map', `name`, `image_file`, `width`, `height`, `created_at`
FROM `maps` WHERE `image_file` IS NOT NULL;
