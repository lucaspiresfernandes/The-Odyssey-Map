DELETE FROM `seat_claims` WHERE `user_id` IS NULL;--> statement-breakpoint
ALTER TABLE `seat_claims` DROP COLUMN `name`;