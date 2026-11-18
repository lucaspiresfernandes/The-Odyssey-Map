// The whole permission model, as pure functions.
//
// The server enforces these in `server/world.ts` and `server/visibility.ts`.
// The browser imports the same functions only to decide which buttons to show.

import type { Marker, MarkerKind, Region, Role, StoredEvent, Token } from './types';

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
 * A token is moved, renamed, resized and taken off the map by the GM and by
 * the player it belongs to. Hiding it and handing it to someone else are
 * the GM's alone: the server checks those two apart.
 */
export function canMoveToken(role: Role, userId: string, token: Pick<Token, 'ownerId'>): boolean {
	return role === 'gm' || token.ownerId === userId;
}

/** Hidden tokens exist only for the GM: the ambush waiting behind the door. */
export function canSeeToken(role: Role, token: Pick<Token, 'hidden'>): boolean {
	return role === 'gm' || !token.hidden;
}

/**
 * Which past changes someone may undo. Players get the changes to the
 * table's own notes, and what they themselves did to a token. Everything
 * else is the GM's: the past of a world marker can hold text from before it
 * was revealed.
 */
export function canSeeEvent(
	role: Role,
	userId: string,
	event: Pick<StoredEvent, 'entity' | 'actorId' | 'before' | 'after'>
) {
	if (role === 'gm') return true;
	if (event.entity === 'token') return event.actorId === userId;
	if (event.entity !== 'marker') return false;
	const marker = (event.after ?? event.before) as Marker | null;
	return marker?.kind === 'player';
}
