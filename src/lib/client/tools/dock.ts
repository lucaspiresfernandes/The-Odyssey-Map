// Putting tokens down on a battle map out of the dock: one token, every
// token of an encounter, or the party. These work out the commands that do it.

import { arrangeInCells, freeCell, snapToGrid } from '#lib/shared/grid.ts';
import { numberedNames } from '#lib/shared/naming.ts';
import {
	LIMITS,
	type Command,
	type Encounter,
	type GalleryItem,
	type MapInfo,
	type PartyMember,
	type Point,
	type Token
} from '#lib/shared/types.ts';

/**
 * A token out of the dock: of that picture, or with none, a plain one. It
 * goes down at `dropped`, or for a click, in the free cell nearest
 * `middle`, the middle of the view. Either way squarely on the grid.
 * `plain` is what a token with no picture is called, and `color` what it
 * is filled with. One whose name is taken on the map gets the next number:
 * the second goblin is "Goblin 2".
 */
export function tokenFromDock(
	map: MapInfo,
	tokens: Token[],
	item: GalleryItem | null,
	dropped: Point | null,
	middle: Point,
	look: { plain: string; color: string }
): Command {
	const here = tokens.map((token): Point => [token.x, token.y]);
	// A picture may say what its tokens start out as: how big, and ringed in what.
	const size = item?.tokenSize ?? 1;
	const [x, y] = snapToGrid(map, dropped ?? freeCell(map, middle, here), size);
	// A token is called what its picture is.
	const name = (item?.name ?? look.plain).slice(0, LIMITS.tokenName).trim() || 'Token';
	const [called] = numberedNames(
		[name],
		tokens.map((token) => token.name)
	);
	return {
		t: 'token.create',
		mapId: map.id,
		name: called,
		image: item?.file ?? null,
		color: look.color,
		outline: item?.tokenOutline ?? null,
		size,
		x,
		y
	};
}

/**
 * An encounter out of the dock: every token of it, as it was made in the
 * gallery, around `centre`. Hidden from the players. The first of them
 * goes squarely on the grid and the rest keep their places from it, so the
 * encounter keeps its shape. Tokens of one name are numbered, going on from
 * the ones of that name already on the map: "Goblin 1", "Goblin 2".
 */
export function encounterFromDock(
	map: MapInfo,
	tokens: Token[],
	encounter: Encounter,
	centre: Point
): Command[] {
	const [cx, cy] = centre;
	const stepX = map.grid.size / map.width;
	const stepY = map.grid.size / map.height;
	const lead = encounter.tokens[0];
	const from: Point = [cx + lead.dx * stepX, cy + lead.dy * stepY];
	const onGrid = snapToGrid(map, from, lead.size);
	const within = (at: number) => Math.min(1, Math.max(0, at));
	const names = numberedNames(
		encounter.tokens.map((token) => token.name),
		tokens.map((token) => token.name)
	);
	return encounter.tokens.map(
		({ dx, dy, ...token }, i): Command => ({
			t: 'token.create',
			mapId: map.id,
			...token,
			name: names[i],
			hidden: true,
			x: within(cx + dx * stepX + onGrid[0] - from[0]),
			y: within(cy + dy * stepY + onGrid[1] - from[1])
		})
	);
}

/**
 * A player's own character out of the dock, as it looks on the token that
 * is their character now. It goes down where a token out of the dock does,
 * and is their character from then on.
 */
export function characterFromDock(
	map: MapInfo,
	tokens: Token[],
	member: PartyMember,
	dropped: Point | null,
	middle: Point
): Command {
	const here = tokens.map((token): Point => [token.x, token.y]);
	const [x, y] = snapToGrid(map, dropped ?? freeCell(map, middle, here), member.size);
	return {
		t: 'token.create',
		mapId: map.id,
		name: member.name,
		color: member.color,
		outline: member.outline,
		image: member.image,
		size: member.size,
		character: true,
		x,
		y
	};
}

/**
 * The players of the party who have no token of their own on this map yet:
 * the ones putting the party down would put one down for.
 */
export function partyMissing(tokens: Token[], party: PartyMember[]): PartyMember[] {
	return party.filter((member) => !tokens.some((token) => token.ownerId === member.userId));
}

/**
 * The party out of the dock: the character of each of these players, side
 * by side around `centre`, each handed to its player and in plain sight.
 * Each is its player's character from now on, so that what they change about
 * it here is what goes down for them the next time.
 */
export function partyFromDock(map: MapInfo, party: PartyMember[], centre: Point): Command[] {
	if (party.length === 0) return [];
	const [cx, cy] = centre;
	const stepX = map.grid.size / map.width;
	const stepY = map.grid.size / map.height;
	const spots = arrangeInCells(party.map((member) => member.size));
	const from: Point = [cx + spots[0][0] * stepX, cy + spots[0][1] * stepY];
	const onGrid = snapToGrid(map, from, party[0].size);
	const within = (at: number) => Math.min(1, Math.max(0, at));
	return party.map(
		(member, i): Command => ({
			t: 'token.create',
			mapId: map.id,
			name: member.name,
			color: member.color,
			outline: member.outline,
			image: member.image,
			size: member.size,
			ownerId: member.userId,
			character: true,
			x: within(cx + spots[i][0] * stepX + onGrid[0] - from[0]),
			y: within(cy + spots[i][1] * stepY + onGrid[1] - from[1])
		})
	);
}
