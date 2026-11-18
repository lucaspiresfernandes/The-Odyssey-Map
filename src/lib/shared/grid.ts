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
