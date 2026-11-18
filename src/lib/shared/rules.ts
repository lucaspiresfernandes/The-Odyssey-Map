// The whole permission model, as pure functions.
//
// The server enforces these in `server/world.ts` and `server/visibility.ts`.
// The browser imports the same functions only to decide which buttons to show.

import type { Drawing, Marker, MarkerKind, Region, Role, StoredEvent, Token } from './types';

/** The GM owns world markers. Anyone at the table can add notes and edit them. */
export function canEditMarkerKind(role: Role, kind: MarkerKind): boolean {
	return kind === 'player' || role === 'gm';
}

/**
 * Taking a marker off the map, or putting a deleted one back. The GM can do
 * that to any marker. A player can do it to the table notes they added
 * themselves, and to nobody else's.
 */
export function canRemoveMarker(
	role: Role,
	userId: string,
	marker: Pick<Marker, 'kind' | 'authorId'>
): boolean {
	return role === 'gm' || (marker.kind === 'player' && marker.authorId === userId);
}

/** Maps, their images and their regions are the GM's to shape. */
export function canEditWorld(role: Role): boolean {
	return role === 'gm';
}

/** Hidden world markers exist only for the GM. */
export function canSeeMarker(role: Role, marker: Pick<Marker, 'kind' | 'hidden'>): boolean {
	return role === 'gm' || marker.kind === 'player' || !marker.hidden;
}

/**
 * Hidden regions exist only for the GM too. The server goes further than
 * this one region: players are kept out of the map behind it as well.
 */
export function canSeeRegion(role: Role, region: Pick<Region, 'hidden'>): boolean {
	return role === 'gm' || !region.hidden;
}

/**
 * A token is moved, resized, turned and given another look by the GM and by
 * the player it belongs to, as long as it isn't locked.
 *
 * Two things about a token are the whole table's: anyone who sees it can
 * label it and lock or unlock it, and anyone can put a copy of it beside
 * it. Three are the GM's alone: hiding it, handing it to someone else, and
 * taking it off the map. The server checks each of these apart.
 */
export function canMoveToken(role: Role, userId: string, token: Pick<Token, 'ownerId'>): boolean {
	return role === 'gm' || token.ownerId === userId;
}

/** Taking a token off the map, and hiding or revealing it, are the GM's. */
export function canRemoveToken(role: Role): boolean {
	return role === 'gm';
}

/**
 * Anyone at the table draws and writes on a battle map. What is there is
 * changed, moved and rubbed out by whoever made it, and by the GM.
 */
export function canChangeDrawing(
	role: Role,
	userId: string,
	drawing: Pick<Drawing, 'authorId'>
): boolean {
	return role === 'gm' || drawing.authorId === userId;
}

/** Hidden tokens exist only for the GM: the ambush waiting behind the door. */
export function canSeeToken(role: Role, token: Pick<Token, 'hidden'>): boolean {
	return role === 'gm' || !token.hidden;
}

/**
 * Which past changes someone may undo. Players get the changes to the
 * table's own notes, and what they themselves did to a token or a drawing. Everything
 * else is the GM's: the past of a world marker can hold text from before it
 * was revealed.
 */
export function canSeeEvent(
	role: Role,
	userId: string,
	event: Pick<StoredEvent, 'entity' | 'actorId' | 'before' | 'after'>
) {
	if (role === 'gm') return true;
	if (event.entity === 'token' || event.entity === 'drawing') return event.actorId === userId;
	if (event.entity !== 'marker') return false;
	const marker = (event.after ?? event.before) as Marker | null;
	return marker?.kind === 'player';
}
