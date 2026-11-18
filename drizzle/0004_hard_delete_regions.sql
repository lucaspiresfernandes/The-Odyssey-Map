-- Deleting a region used to keep it, with the map behind it, in case the
-- deletion was undone. It is for good now. The regions that were deleted
-- before this go the way one deleted today does: with every map that could
-- only be reached through them, what was on those maps, and their events.
CREATE TEMPORARY TABLE `doomed_maps` AS
WITH RECURSIVE `inside`(`id`) AS (
	SELECT `target_map_id` FROM `regions` WHERE `deleted_at` IS NOT NULL
	UNION
	SELECT `maps`.`id` FROM `maps` JOIN `inside` ON `maps`.`parent_id` = `inside`.`id`
)
SELECT `id` FROM `inside`;--> statement-breakpoint
DELETE FROM `events`
WHERE `map_id` IN (SELECT `id` FROM `doomed_maps`)
	OR (`entity` = 'region' AND `entity_id` IN (SELECT `id` FROM `regions` WHERE `deleted_at` IS NOT NULL));--> statement-breakpoint
DELETE FROM `regions` WHERE `target_map_id` IN (SELECT `id` FROM `doomed_maps`);--> statement-breakpoint
DELETE FROM `maps` WHERE `id` IN (SELECT `id` FROM `doomed_maps`);--> statement-breakpoint
DROP TABLE `doomed_maps`;--> statement-breakpoint
ALTER TABLE `regions` DROP COLUMN `deleted_at`;
