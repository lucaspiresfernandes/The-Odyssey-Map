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

import { and, count, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import { newId } from './ids';
import { encounters, gallery, maps, markers, tokens } from './schema';
import {
	ActionError,
	asOutline,
	asText,
	asTokenSize,
	isConcealed,
	wornByOwn,
	type Actor
} from './world';
import { canEditWorld, canSeeMarker, canSeeToken, roleOf, type Who } from '../shared/rules';
import { LIMITS, type GalleryItem, type GalleryKind } from '../shared/types';

const itemColumns = {
	id: gallery.id,
	kind: gallery.kind,
	name: gallery.name,
	file: gallery.file,
	width: gallery.width,
	height: gallery.height,
	hidden: gallery.hidden,
	tokenSize: gallery.tokenSize,
	tokenOutline: gallery.tokenOutline,
	ownerId: gallery.ownerId
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

/**
 * What is in the gallery, by name: all of it for the GM. For a player, what
 * has been revealed, and the token pictures they added themself.
 */
export function listGallery(db: Db, actor: Actor): GalleryItem[] {
	return db
		.select(itemColumns)
		.from(gallery)
		.where(
			and(
				eq(gallery.campaignId, actor.campaignId),
				isNull(gallery.deletedAt),
				canEditWorld(actor.role)
					? undefined
					: or(eq(gallery.hidden, false), eq(gallery.ownerId, actor.userId))
			)
		)
		.orderBy(sql`${gallery.name} COLLATE NOCASE`, gallery.createdAt)
		.all();
}

/**
 * Whether this person may put a picture of that kind in the gallery, which
 * is asked before the file is read. The GM may, of either kind. A player
 * may add a token picture, for a token of their own, and keeps only so many.
 */
export function requireRoomFor(db: Db, actor: Actor, kind: GalleryKind) {
	if (canEditWorld(actor.role)) return;
	if (kind !== 'token') throw new ActionError('forbidden', 'Map images are the GM’s to add.');
	const [{ n }] = db
		.select({ n: count() })
		.from(gallery)
		.where(
			and(
				eq(gallery.campaignId, actor.campaignId),
				eq(gallery.ownerId, actor.userId),
				isNull(gallery.deletedAt)
			)
		)
		.all();
	if (n >= LIMITS.playerPictures) {
		throw new ActionError(
			'conflict',
			`You keep up to ${LIMITS.playerPictures} pictures here. Take one out first.`
		);
	}
}

/**
 * Puts a picture in the gallery, hidden from the players until the GM
 * reveals it. Its file is already in the uploads directory. One a player
 * adds is their own: it is in the gallery for them and for the GM, and the
 * rest of the table sees it on the tokens that wear it.
 */
export function addToGallery(
	db: Db,
	actor: Actor,
	picture: { kind: GalleryKind; name: string; file: string; width: number; height: number }
): GalleryItem {
	requireRoomFor(db, actor, picture.kind);
	const item = {
		id: newId(),
		kind: picture.kind,
		name: asText(picture.name, 'The name', LIMITS.name, true),
		file: picture.file,
		width: picture.width,
		height: picture.height,
		hidden: true,
		tokenSize: null,
		tokenOutline: null,
		ownerId: canEditWorld(actor.role) ? null : actor.userId
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

/**
 * True while a map shows this picture, a token wears it, the card of a
 * marker shows it, or an encounter has a token that wears it: one of those
 * that was deleted may come back.
 */
function inUse(db: Db, file: string): boolean {
	const map = db.select({ id: maps.id }).from(maps).where(eq(maps.imageFile, file)).get();
	const token = db.select({ id: tokens.id }).from(tokens).where(eq(tokens.image, file)).get();
	const marker = db.select({ id: markers.id }).from(markers).where(eq(markers.image, file)).get();
	// An encounter keeps the pictures of its tokens, for when it is put down.
	const encounter = db
		.select({ id: encounters.id })
		.from(encounters)
		.where(sql`instr(${encounters.tokens}, ${JSON.stringify(file)}) > 0`)
		.get();
	return Boolean(map || token || marker || encounter);
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
	const item = findItem(db, actor, id);
	// A player takes out what they added themself. To them, any other
	// picture they were not shown is one that isn't there.
	if (!canEditWorld(actor.role) && item.ownerId !== actor.userId) {
		if (item.hidden) throw new ActionError('not_found', 'That picture is not in the gallery.');
		requireGm(actor);
	}
	db.update(gallery).set({ deletedAt: Date.now() }).where(eq(gallery.id, item.id)).run();
	return sweepGallery(db, actor.campaignId);
}

/**
 * Whether someone may load a picture of this campaign's. The GM may load
 * any of them. A player may load the ones the GM has revealed in the
 * gallery, and whatever is in front of them: the image of a map they can
 * open, the picture on a token they can see, and the one on the card of a
 * marker they can see.
 */
export function canLoadImage(db: Db, campaignId: string, who: Who, file: string): boolean {
	const kept = db
		.select({ hidden: gallery.hidden, deletedAt: gallery.deletedAt, ownerId: gallery.ownerId })
		.from(gallery)
		.where(and(eq(gallery.file, file), eq(gallery.campaignId, campaignId)))
		.get();
	if (!kept) return false;
	if (roleOf(who) === 'gm') return true;
	// One taken out of the gallery is no longer on show there, revealed or not.
	if (!kept.hidden && kept.deletedAt === null) return true;
	// What a player added themself is theirs to look at, and so is the
	// picture a token of their own wears, wherever that token is now: the
	// face of their character, which goes down again on the next battle map.
	const me = typeof who === 'string' ? null : who.userId;
	if (me !== null && kept.ownerId === me && kept.deletedAt === null) return true;
	if (me !== null && wornByOwn(db, campaignId, me, file)) return true;

	const shown = db
		.select({ id: maps.id })
		.from(maps)
		.where(and(eq(maps.campaignId, campaignId), eq(maps.imageFile, file)))
		.all();
	// The fog hides a token, not the picture it wears: that is weighed as if there were none.
	const worn = db
		.select({ id: tokens.mapId, hidden: tokens.hidden, seenBy: tokens.seenBy })
		.from(tokens)
		.innerJoin(maps, eq(maps.id, tokens.mapId))
		.where(and(eq(maps.campaignId, campaignId), eq(tokens.image, file), isNull(tokens.deletedAt)))
		.all()
		.filter((token) => canSeeToken(who, { ...token, x: 0, y: 0 }));
	// A marker under the fog is not on the map for them yet, and neither is its picture.
	const carried = db
		.select({
			id: markers.mapId,
			kind: markers.kind,
			hidden: markers.hidden,
			seenBy: markers.seenBy,
			x: markers.x,
			y: markers.y,
			fog: maps.fog
		})
		.from(markers)
		.innerJoin(maps, eq(maps.id, markers.mapId))
		.where(and(eq(maps.campaignId, campaignId), eq(markers.image, file), isNull(markers.deletedAt)))
		.all()
		.filter((marker) => canSeeMarker(who, marker, marker.fog));
	// A map someone is kept out of keeps its picture from them, and those of what is on it.
	const open = new Map<string, boolean>();
	return [...shown, ...worn, ...carried].some((map) => {
		if (!open.has(map.id)) open.set(map.id, !isConcealed(db, map.id, who));
		return open.get(map.id);
	});
}
