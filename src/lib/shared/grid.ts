// The arithmetic of a battle map's grid: where a token comes to rest, and
// how far one spot is from another. Positions are in map space (0..1), the
// grid is in the map's pixels, and these functions go between the two.

import type { Grid, MapInfo, Point } from './types';

type Sheet = Pick<MapInfo, 'width' | 'height' | 'grid'>;

/** Brings a grid offset back to less than one cell: lines repeat, so that is the same grid. */
export function wrapOffset(offset: number, size: number): number {
	return ((offset % size) + size) % size;
}

/**
 * The nearest spot a token of this size sits squarely on the grid. One that
 * is an odd number of cells across has its middle in the middle of a cell.
 * An even one has it where four cells meet.
 */
export function snapToGrid(map: Sheet, [x, y]: Point, size = 1): Point {
	const { grid, width, height } = map;
	const half = size % 2 === 1 ? 0.5 : 0;
	const snap = (at: number, offset: number, span: number) => {
		const cells = (at * span - offset) / grid.size;
		const snapped = (Math.round(cells - half) + half) * grid.size + offset;
		return Math.min(1, Math.max(0, snapped / span));
	};
	return [snap(x, grid.x, width), snap(y, grid.y, height)];
}

/**
 * Somewhere to put a new one-cell token down near `at`: the nearest cell
 * that none of the `taken` spots is standing in. If every cell around is
 * full, it goes down at `at` regardless.
 */
export function freeCell(map: Sheet, at: Point, taken: Point[]): Point {
	const home = snapToGrid(map, at);
	const stepX = map.grid.size / map.width;
	const stepY = map.grid.size / map.height;
	const reach = 6;
	const around: Point[] = [];
	for (let dx = -reach; dx <= reach; dx++) {
		for (let dy = -reach; dy <= reach; dy++) around.push([dx, dy]);
	}
	around.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
	for (const [dx, dy] of around) {
		const x = home[0] + dx * stepX;
		const y = home[1] + dy * stepY;
		if (x < 0 || x > 1 || y < 0 || y > 1) continue;
		const full = taken.some(
			([tx, ty]) => Math.abs(tx - x) < stepX / 2 && Math.abs(ty - y) < stepY / 2
		);
		if (!full) return [x, y];
	}
	return home;
}

/**
 * How many cells apart two spots are, counting a diagonal step as one: the
 * way most tabletop games count movement on squares. To one decimal place.
 */
export function cellsBetween(map: Sheet, a: Point, b: Point): number {
	const dx = Math.abs(a[0] - b[0]) * map.width;
	const dy = Math.abs(a[1] - b[1]) * map.height;
	return Math.round((Math.max(dx, dy) / map.grid.size) * 10) / 10;
}

/** "1 cell", "6 cells", "2.5 cells". */
export function cellCount(cells: number): string {
	return `${cells} ${cells === 1 ? 'cell' : 'cells'}`;
}

/** How many whole cells fit across and down a map. */
export function cellsAcross(map: Sheet, grid: Pick<Grid, 'size'> = map.grid): [number, number] {
	return [Math.floor(map.width / grid.size), Math.floor(map.height / grid.size)];
}
