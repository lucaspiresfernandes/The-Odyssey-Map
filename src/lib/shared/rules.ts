// The whole permission model, as pure functions.
//
// The server enforces these in `server/world.ts` and `server/visibility.ts`.
// The browser imports the same functions only to decide which buttons to show.

import { isFogged } from './fog';
import {
	NO_FOG,
	type Drawing,
	type Fog,
	type Marker,
	type MarkerKind,
	type Region,
	type Role,
	type StoredEvent,
	type Token
} from './types';

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
 * A token is the whole table's: anyone who sees it can move it, resize it,
 * turn it, give it another look, label it, lock or unlock it, and put a copy
 * of it beside it. A lock is all that holds it in place.
 */
export function canMoveToken(token: Pick<Token, 'locked'>): boolean {
	return !token.locked;
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

/**
 * Hidden tokens exist only for the GM: the ambush waiting behind the door.
 * So do the ones standing under the fog of war, which is the fog of the
 * map the token is on.
 */
export function canSeeToken(
	role: Role,
	token: Pick<Token, 'hidden' | 'x' | 'y'>,
	fog: Fog = NO_FOG
): boolean {
	return role === 'gm' || (!token.hidden && !isFogged(fog, [token.x, token.y]));
}

/** The party is the GM's to move: it goes where the story has taken everyone. */
export function canMoveParty(role: Role): boolean {
	return role === 'gm';
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
