// The gallery: the pictures a campaign keeps, to lay under its maps and put
// on its tokens as often as it likes. It is the GM's to fill and to tidy.
// Every picture starts hidden from the players. The ones the GM reveals
// are theirs to look through, and to pick from for their own tokens.
//
// A hidden picture is, to a player, not in the gallery. They are shown it
// only where the GM has put it in front of them: under a map they can
// open, or on a token they can see.
//
// What is in the gallery is not part of the world's history. Adding a
// picture, renaming it and taking it out are not events, and there is no
// undo for them. Putting a picture to use is: that goes through
// `server/world.ts` like every other change to a map or a token.
//
// This module keeps the rows. The files behind them are the caller's to
// write and to remove: see `server/tiles.ts`.

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from './db';
import { newId } from './ids';
import { campaigns, gallery, maps, tokens } from './schema';
import { ActionError, asOutline, asText, asTokenSize, isConcealed, type Actor } from './world';
import { canEditWorld } from '../shared/rules';
import {
	LIMITS,
	type GalleryItem,
	type GalleryKind,
	type Role,
	type Shown
} from '../shared/types';

const itemColumns = {
	id: gallery.id,
	kind: gallery.kind,
	name: gallery.name,
	file: gallery.file,
	width: gallery.width,
	height: gallery.height,
	hidden: gallery.hidden,
	tokenSize: gallery.tokenSize,
	tokenOutline: gallery.tokenOutline
};

function requireGm(actor: Actor) {
	if (!canEditWorld(actor.role)) {
		throw new ActionError('forbidden', 'The gallery is the GM’s to look after.');
	}
}

export function asGalleryKind(value: unknown): GalleryKind {
	if (value !== 'map' && value !== 'token') {
		throw new ActionError('invalid', 'Unknown kind of picture.');
	}
	return value;
}

/** A name for a picture, made from the name of the file it came in. */
export function nameFromFile(fileName: string): string {
	const name = fileName
		.replace(/\.[A-Za-z0-9]{1,5}$/, '')
		.replace(/[_\s]+/g, ' ')
		.trim()
		.slice(0, LIMITS.name)
		.trim();
	return name || 'Untitled';
}

/** A file name no picture has had before. `extension` comes without its dot. */
export function newImageFile(extension: string): string {
	return `${newId(10)}-${newId(12)}.${extension}`;
}

/** What is in the gallery, by name: all of it for the GM, what has been revealed for a player. */
export function listGallery(db: Db, actor: Actor): GalleryItem[] {
	return db
		.select(itemColumns)
		.from(gallery)
		.where(
			and(
				eq(gallery.campaignId, actor.campaignId),
				isNull(gallery.deletedAt),
				canEditWorld(actor.role) ? undefined : eq(gallery.hidden, false)
			)
		)
		.orderBy(sql`${gallery.name} COLLATE NOCASE`, gallery.createdAt)
		.all();
}

/**
 * Puts a picture in the gallery, hidden from the players until the GM
 * reveals it. Its file is already in the uploads directory.
 */
export function addToGallery(
	db: Db,
	actor: Actor,
	picture: { kind: GalleryKind; name: string; file: string; width: number; height: number }
): GalleryItem {
	requireGm(actor);
	const item = {
		id: newId(),
		kind: picture.kind,
		name: asText(picture.name, 'The name', LIMITS.name, true),
		file: picture.file,
		width: picture.width,
		height: picture.height,
		hidden: true,
		tokenSize: null,
		tokenOutline: null
	};
	db.insert(gallery)
		.values({ ...item, campaignId: actor.campaignId, createdAt: Date.now() })
		.run();
	return item;
}

function findItem(db: Db, actor: Actor, id: string): GalleryItem {
	const item = db
		.select(itemColumns)
		.from(gallery)
		.where(
			and(
				eq(gallery.id, id),
				eq(gallery.campaignId, actor.campaignId),
				isNull(gallery.deletedAt)
			)
		)
		.get();
	if (!item) throw new ActionError('not_found', 'That picture is not in the gallery.');
	return item;
}

export function renameInGallery(db: Db, actor: Actor, id: string, name: unknown): void {
	requireGm(actor);
	const item = findItem(db, actor, id);
	db.update(gallery)
		.set({ name: asText(name, 'The name', LIMITS.name, true) })
		.where(eq(gallery.id, item.id))
		.run();
}

/** Reveals a picture to the players, or hides it from them again. */
export function hideInGallery(db: Db, actor: Actor, id: string, hidden: unknown): void {
	requireGm(actor);
	const item = findItem(db, actor, id);
	if (typeof hidden !== 'boolean') throw new ActionError('invalid', 'Malformed request.');
	// The tokens that wear it already keep it either way.
	db.update(gallery).set({ hidden }).where(eq(gallery.id, item.id)).run();
}

/**
 * Says what a token made from this picture starts out as: how many cells
 * across, and the colour of its ring. Null for either goes back to the
 * usual. The tokens already on the maps stay as they are.
 */
export function presetInGallery(
	db: Db,
	actor: Actor,
	id: string,
	preset: { size?: unknown; outline?: unknown }
): void {
	requireGm(actor);
	const item = findItem(db, actor, id);
	if (item.kind !== 'token') throw new ActionError('invalid', 'Only a token picture has a size.');
	db.update(gallery)
		.set({
			tokenSize: preset.size == null ? null : asTokenSize(preset.size),
			tokenOutline: preset.outline == null ? null : asOutline(preset.outline)
		})
		.where(eq(gallery.id, item.id))
		.run();
}

// ------------------------------------------------- a picture for the table

/** The picture the GM is holding up for the whole table, if any. */
export function shownTo(db: Db, campaignId: string): Shown | null {
	const row = db
		.select({
			file: gallery.file,
			name: gallery.name,
			width: gallery.width,
			height: gallery.height
		})
		.from(campaigns)
		.innerJoin(gallery, eq(gallery.file, campaigns.shownFile))
		.where(and(eq(campaigns.id, campaignId), eq(gallery.campaignId, campaignId)))
		.get();
	return row ?? null;
}

/**
 * Holds a picture of the gallery up for the whole table, by its id, or with
 * null puts away the one that is up. Showing a picture does not reveal it
 * in the gallery: players see it for as long as it is held up, and can't
 * pick it for a token.
 */
export function showToTable(db: Db, actor: Actor, id: string | null): Shown | null {
	requireGm(actor);
	const item = id === null ? null : findItem(db, actor, id);
	db.update(campaigns)
		.set({ shownFile: item?.file ?? null })
		.where(eq(campaigns.id, actor.campaignId))
		.run();
	return item && { file: item.file, name: item.name, width: item.width, height: item.height };
}

/** True while a map shows this picture, or a token wears it: one that was deleted may come back. */
function inUse(db: Db, file: string): boolean {
	const map = db.select({ id: maps.id }).from(maps).where(eq(maps.imageFile, file)).get();
	const token = db.select({ id: tokens.id }).from(tokens).where(eq(tokens.image, file)).get();
	return Boolean(map || token);
}

/**
 * Lets go of the pictures that were taken out of the gallery and are no
 * longer shown anywhere. Returns their file names: the files are the
 * caller's to remove.
 */
export function sweepGallery(db: Db, campaignId: string): string[] {
	return db.transaction(
		(tx) => {
			const idle = tx
				.select({ id: gallery.id, file: gallery.file })
				.from(gallery)
				.where(and(eq(gallery.campaignId, campaignId), isNotNull(gallery.deletedAt)))
				.all()
				.filter((picture) => !inUse(tx, picture.file));
			for (const picture of idle) tx.delete(gallery).where(eq(gallery.id, picture.id)).run();
			return idle.map((picture) => picture.file);
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Takes a picture out of the gallery. The maps and tokens that show it keep
 * it: it is only gone from the gallery, and goes for good once the last of
 * them has let go of it. Returns the files that can be removed right away.
 */
export function removeFromGallery(db: Db, actor: Actor, id: string): string[] {
	requireGm(actor);
	const item = findItem(db, actor, id);
	db.update(gallery).set({ deletedAt: Date.now() }).where(eq(gallery.id, item.id)).run();
	// A picture taken out is no longer held up for the table either.
	db.update(campaigns)
		.set({ shownFile: null })
		.where(and(eq(campaigns.id, actor.campaignId), eq(campaigns.shownFile, item.file)))
		.run();
	return sweepGallery(db, actor.campaignId);
}

/**
 * Whether someone may load a picture of this campaign's. The GM may load
 * any of them. A player may load the ones the GM has revealed in the
 * gallery, and whatever is in front of them: the picture the GM is holding
 * up for the table, the image of a map they can open, and the picture on a
 * token they can see.
 */
export function canLoadImage(db: Db, campaignId: string, role: Role, file: string): boolean {
	const kept = db
		.select({ hidden: gallery.hidden, deletedAt: gallery.deletedAt })
		.from(gallery)
		.where(and(eq(gallery.file, file), eq(gallery.campaignId, campaignId)))
		.get();
	if (!kept) return false;
	if (role === 'gm') return true;
	// One taken out of the gallery is no longer on show there, revealed or not.
	if (!kept.hidden && kept.deletedAt === null) return true;
	// The one the GM is holding up for the table is in front of everyone.
	const held = db
		.select({ file: campaigns.shownFile })
		.from(campaigns)
		.where(eq(campaigns.id, campaignId))
		.get();
	if (held?.file === file && kept.deletedAt === null) return true;

	const shown = db
		.select({ id: maps.id })
		.from(maps)
		.where(and(eq(maps.campaignId, campaignId), eq(maps.imageFile, file)))
		.all();
	const worn = db
		.selectDistinct({ id: tokens.mapId })
		.from(tokens)
		.innerJoin(maps, eq(maps.id, tokens.mapId))
		.where(
			and(
				eq(maps.campaignId, campaignId),
				eq(tokens.image, file),
				eq(tokens.hidden, false),
				isNull(tokens.deletedAt)
			)
		)
		.all();
	// A map behind a hidden region keeps its picture, and its tokens', from players.
	return [...shown, ...worn].some((map) => !isConcealed(db, map.id));
}
