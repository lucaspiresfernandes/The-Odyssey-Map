// The whole permission model, as pure functions.
//
// The server enforces these in `server/world.ts` and `server/visibility.ts`.
// The browser imports the same functions only to decide which buttons to show.

import { isFogged, middleOf } from './fog';
import {
	NO_FOG,
	type Drawing,
	type Fog,
	type Marker,
	type MarkerKind,
	type Region,
	type Role,
	type StoredEvent,
	type Token,
	type Viewer
} from './types';

/**
 * Who is looking. A bare role is that role and nobody in particular: the GM,
 * or a player who is let in on no secret, which is what a table display is.
 */
export type Who = Role | Viewer;

export const roleOf = (who: Who): Role => (typeof who === 'string' ? who : who.role);

/**
 * Whether a hidden thing is a secret this person is in on. Things from
 * before there were such secrets name nobody.
 */
function letIn(who: Who, thing: { seenBy?: string[] }): boolean {
	const id = typeof who === 'string' ? null : who.userId;
	return id !== null && (thing.seenBy ?? []).includes(id);
}

/**
 * Something that can be hidden, as this person is sent it. The GM is told
 * which players a secret is shared with. A player who is in on one is told
 * that it is hidden, and not who else knows.
 */
export function forEyes<T extends { seenBy?: string[] }>(who: Who, thing: T): T {
	return { ...thing, seenBy: roleOf(who) === 'gm' ? (thing.seenBy ?? []) : [] };
}

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

/**
 * The table's own notes are everyone's to see. A world marker is the GM's
 * to show: a hidden one exists only for the GM and the players it is a
 * secret with, and one under the fog of its map is still to be found.
 */
export function canSeeMarker(
	who: Who,
	marker: Pick<Marker, 'kind' | 'hidden'> & Partial<Pick<Marker, 'seenBy' | 'x' | 'y'>>,
	fog: Fog = NO_FOG
): boolean {
	if (roleOf(who) === 'gm' || marker.kind === 'player') return true;
	if (marker.hidden && !letIn(who, marker)) return false;
	return marker.x === undefined || marker.y === undefined || !isFogged(fog, [marker.x, marker.y]);
}

/**
 * A hidden region exists only for the GM, and the players it is a secret
 * with. So does one whose middle is under the fog of the map it is drawn
 * on: nobody has been there yet. The server goes further than this one
 * region: players are kept out of the map behind it as well.
 */
export function canSeeRegion(
	who: Who,
	region: Pick<Region, 'hidden'> & Partial<Pick<Region, 'seenBy' | 'points'>>,
	fog: Fog = NO_FOG
): boolean {
	if (roleOf(who) === 'gm') return true;
	if (region.hidden && !letIn(who, region)) return false;
	return !region.points || !isFogged(fog, middleOf(region.points));
}

/**
 * Stepping into the map behind a region. A closed one is there to be seen
 * and wondered about: only the GM goes in, until it is opened.
 */
export function canEnterRegion(
	who: Who,
	region: Pick<Region, 'hidden'> & Partial<Pick<Region, 'seenBy' | 'points' | 'closed'>>,
	fog: Fog = NO_FOG
): boolean {
	return roleOf(who) === 'gm' || (canSeeRegion(who, region, fog) && !region.closed);
}

/**
 * A token is the whole table's: anyone who sees it can move it, resize it,
 * turn it, give it another look, label it, lock or unlock it, and put a copy
 * of it beside it, and take it off the map. A lock is all that holds it in
 * place.
 */
export function canMoveToken(token: Pick<Token, 'locked'>): boolean {
	return !token.locked;
}

/** Hiding a token from the players, and revealing it to them, are the GM's. */
export function canHideToken(role: Role): boolean {
	return role === 'gm';
}

/**
 * Putting back a token that was taken off the map is the GM's too. Whoever
 * took it off has undo for that, which is no one's but theirs.
 */
export function canRestoreToken(role: Role): boolean {
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
 * And for the players one is a secret with: the familiar only its master
 * sees. So do the ones standing under the fog of war, which is the fog of
 * the map the token is on.
 */
export function canSeeToken(
	who: Who,
	token: Pick<Token, 'hidden' | 'x' | 'y'> & Partial<Pick<Token, 'seenBy'>>,
	fog: Fog = NO_FOG
): boolean {
	if (roleOf(who) === 'gm') return true;
	return (!token.hidden || letIn(who, token)) && !isFogged(fog, [token.x, token.y]);
}

/**
 * The party is the GM's to move, and to take off the maps: it goes where
 * the story has taken everyone.
 */
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
