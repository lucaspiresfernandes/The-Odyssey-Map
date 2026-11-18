ALTER TABLE `tokens` ADD `outline` text;--> statement-breakpoint
-- A token with a picture used to be ringed in its colour. Where that colour
-- was chosen, the ring stays, as its outline. Where it is still the one a new
-- token starts out in (the GM's red, a player's blue), nobody chose it, and
-- the token comes out with no outline.
UPDATE `tokens` SET `outline` = `color` WHERE `image` IS NOT NULL AND `color` NOT IN ('#e5544b', '#5b8def');
