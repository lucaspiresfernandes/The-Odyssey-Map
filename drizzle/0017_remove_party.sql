DROP TABLE `parties`;--> statement-breakpoint
DELETE FROM `events` WHERE `entity` = 'party';--> statement-breakpoint
UPDATE `maps` SET `fog` = json_remove(`fog`, '$.spots') WHERE json_type(`fog`, '$.spots') IS NOT NULL;
