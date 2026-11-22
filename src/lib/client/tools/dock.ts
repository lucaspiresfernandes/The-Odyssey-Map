// Putting tokens down on a battle map out of the dock: one token, or every
// token of an encounter. These work out the commands that do it.

import { freeCell, snapToGrid } from '#lib/shared/grid.ts';
import {
	LIMITS,
	type Command,
	type Encounter,
	type GalleryItem,
	type MapInfo,
	type Point,
	type Token
} from '#lib/shared/types.ts';

/**
 * A token out of the dock: of that picture, or with none, a plain one. It
 * goes down at `dropped`, or for a click, in the free cell nearest
 * `middle`, the middle of the view. Either way squarely on the grid.
 * `plain` is what a token with no picture is called, and `color` what it
 * is filled with.
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
	const name = (item?.name ?? look.plain).slice(0, LIMITS.tokenName);
	return {
		t: 'token.create',
		mapId: map.id,
		name: name.trim() || 'Token',
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
 * encounter keeps its shape.
 */
export function encounterFromDock(map: MapInfo, encounter: Encounter, centre: Point): Command[] {
	const [cx, cy] = centre;
	const stepX = map.grid.size / map.width;
	const stepY = map.grid.size / map.height;
	const lead = encounter.tokens[0];
	const from: Point = [cx + lead.dx * stepX, cy + lead.dy * stepY];
	const onGrid = snapToGrid(map, from, lead.size);
	const within = (at: number) => Math.min(1, Math.max(0, at));
	return encounter.tokens.map(
		({ dx, dy, ...token }): Command => ({
			t: 'token.create',
			mapId: map.id,
			...token,
			hidden: true,
			x: within(cx + dx * stepX + onGrid[0] - from[0]),
			y: within(cy + dy * stepY + onGrid[1] - from[1])
		})
	);
}
