// The arithmetic of a battle map's grid: where a token comes to rest, and
// how far one spot is from another. Positions are in map space (0..1), the
// grid is in the map's pixels, distances are told in feet, and these
// functions go between them.

import type { Grid, MapInfo, Point, TemplateKind } from './types';

type Sheet = Pick<MapInfo, 'width' | 'height' | 'grid'>;
type Scale = Pick<MapInfo, 'cellFeet'>;

/** Brings a grid offset back to less than one cell: lines repeat, so that is the same grid. */
export function wrapOffset(offset: number, size: number): number {
	return ((offset % size) + size) % size;
}

/** Whether a token this many cells across has its middle where four cells meet. */
export function sitsOnCorner(size: number): boolean {
	return size % 2 === 0;
}

/**
 * The nearest spot a token of this size sits squarely on the grid. One that
 * is an even number of cells across has its middle where four cells meet.
 * Any other, a half size among them, has it in the middle of a cell.
 */
export function snapToGrid(map: Sheet, [x, y]: Point, size = 1): Point {
	const { grid, width, height } = map;
	const half = sitsOnCorner(size) ? 0 : 0.5;
	const snap = (at: number, offset: number, span: number) => {
		const cells = (at * span - offset) / grid.size;
		const snapped = (Math.round(cells - half) + half) * grid.size + offset;
		return Math.min(1, Math.max(0, snapped / span));
	};
	return [snap(x, grid.x, width), snap(y, grid.y, height)];
}

/**
 * The nearest spot a template can start from: a corner of a cell, the
 * middle of one, or the middle of one of its sides.
 */
export function snapToHalfCell(map: Sheet, [x, y]: Point): Point {
	const { grid, width, height } = map;
	const half = grid.size / 2;
	const snap = (at: number, offset: number, span: number) => {
		const snapped = Math.round((at * span - offset) / half) * half + offset;
		return Math.min(1, Math.max(0, snapped / span));
	};
	return [snap(x, grid.x, width), snap(y, grid.y, height)];
}

/**
 * The two points a template is kept as, for one dragged from `from` to
 * `to`. It starts on the grid and is a whole number of cells long, and a
 * box runs from one corner of a cell to another. `free` leaves it exactly
 * as dragged. Either way both points stay on the map: a cone that would
 * end beyond the edge is made shorter, and a circle is still a circle of
 * the size dragged, with its second point put where there is room for it.
 */
export function templatePoints(
	map: Sheet,
	kind: TemplateKind,
	from: Point,
	to: Point,
	free = false
): [Point, Point] {
	const { grid, width, height } = map;
	const onMap = ([x, y]: Point): Point => [
		Math.min(1, Math.max(0, x)),
		Math.min(1, Math.max(0, y))
	];
	if (kind === 'rect') {
		return free ? [onMap(from), onMap(to)] : [snapToGrid(map, from, 2), snapToGrid(map, to, 2)];
	}

	const a = free ? onMap(from) : snapToHalfCell(map, from);
	const dx = (to[0] - a[0]) * width;
	const dy = (to[1] - a[1]) * height;
	const dragged = Math.hypot(dx, dy);
	const length = free ? dragged : Math.max(1, Math.round(dragged / grid.size)) * grid.size;
	const end = (ux: number, uy: number, long: number): Point => [
		a[0] + (ux * long) / width,
		a[1] + (uy * long) / height
	];
	const fits = ([x, y]: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

	if (kind === 'circle') {
		// Any spot on its rim will do to keep: one that is on the map.
		const rim = [end(1, 0, length), end(-1, 0, length), end(0, 1, length), end(0, -1, length)];
		return [a, rim.find(fits) ?? onMap(rim[0])];
	}
	// A cone points where it was dragged, as far as the map goes that way.
	const [ux, uy] = dragged === 0 ? [1, 0] : [dx / dragged, dy / dragged];
	for (let long = length; long > 0 && !free; long -= grid.size) {
		if (fits(end(ux, uy, long))) return [a, end(ux, uy, long)];
	}
	return [a, onMap(end(ux, uy, length))];
}

/** How many feet that many of the map's pixels are, to one decimal place. */
export function pixelsToFeet(map: Pick<Sheet, 'grid'> & Scale, pixels: number): number {
	return Math.round((pixels / map.grid.size) * map.cellFeet * 10) / 10;
}

/**
 * How many miles apart two spots of a world map are, as the crow flies, on
 * a map that is `miles` across and `width` by `height` of anything: only
 * its shape matters.
 */
export function milesBetween(
	sheet: { width: number; height: number },
	miles: number,
	a: Point,
	b: Point
): number {
	const dx = (a[0] - b[0]) * sheet.width;
	const dy = (a[1] - b[1]) * sheet.height;
	return (Math.hypot(dx, dy) / sheet.width) * miles;
}

/** The same along a way with bends in it: every stretch of it, added up. */
export function milesAlong(
	sheet: { width: number; height: number },
	miles: number,
	points: Point[]
): number {
	let far = 0;
	for (let i = 1; i < points.length; i++) far += milesBetween(sheet, miles, points[i - 1], points[i]);
	return far;
}

/** How many hours of a day are spent on the road. */
const TRAVEL_HOURS = 8;

/**
 * How long a way that many miles long takes, at so many miles a day, in
 * words: "under an hour", "about 3 hours", "about a day", "about 3½ days".
 * Short of a day it is told in hours on the road, of which a day has
 * eight. Beyond that in days, to the half, and past ten to the whole.
 */
export function travelTime(miles: number, dayMiles: number): string {
	const days = miles / dayMiles;
	if (!(days > 0) || !Number.isFinite(days)) return '';
	const hours = Math.round(days * TRAVEL_HOURS);
	if (days * TRAVEL_HOURS < 0.75) return 'under an hour';
	if (hours < TRAVEL_HOURS) return `about ${hours === 1 ? 'an hour' : `${hours} hours`}`;
	const halves = days >= 10 ? Math.round(days) * 2 : Math.round(days * 2);
	if (halves <= 2) return 'about a day';
	const whole = Math.floor(halves / 2).toLocaleString('en');
	return `about ${whole}${halves % 2 ? '½' : ''} days`;
}

/** "0.4 mi", "7.5 mi", "120 mi": as fine as a distance that size is worth telling. */
export function milesCount(miles: number): string {
	const shown = miles >= 100 ? Math.round(miles) : Math.round(miles * 10) / 10;
	return `${shown.toLocaleString('en')} mi`;
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
 * How many feet apart two spots are, counting a diagonal step as one cell:
 * the way most tabletop games count movement on squares. To one decimal
 * place.
 */
export function feetBetween(map: Sheet & Scale, a: Point, b: Point): number {
	const dx = Math.abs(a[0] - b[0]) * map.width;
	const dy = Math.abs(a[1] - b[1]) * map.height;
	return Math.round((Math.max(dx, dy) / map.grid.size) * map.cellFeet * 10) / 10;
}

/** The same along a way with bends in it: every stretch of it counted in cells, and added up. */
export function feetAlong(map: Sheet & Scale, points: Point[]): number {
	let far = 0;
	for (let i = 1; i < points.length; i++) far += feetBetween(map, points[i - 1], points[i]);
	return Math.round(far * 10) / 10;
}

/** What that many cells come to in feet on this map. */
export function cellsToFeet(map: Scale, cells: number): number {
	return Math.round(cells * map.cellFeet * 100) / 100;
}

/** "8 ft", "24 ft", "12.5 ft". */
export function feetCount(feet: number): string {
	return `${feet} ft`;
}

/** How many whole cells fit across and down a map. */
export function cellsAcross(map: Sheet, grid: Pick<Grid, 'size'> = map.grid): [number, number] {
	return [Math.floor(map.width / grid.size), Math.floor(map.height / grid.size)];
}

/**
 * The grid that fits a box dragged over the squares of a map's own picture:
 * `box` in map space, covering `across` squares from its left edge to its
 * right. A cell is as wide as the box says, weighed against how tall the
 * box is, and the lines are shifted to run along its edges. `limits` are
 * the smallest and the largest a cell may be.
 */
export function gridFromBox(
	sheet: Pick<MapInfo, 'width' | 'height'>,
	[x0, y0, x1, y1]: [number, number, number, number],
	across: number,
	limits: { min: number; max: number }
): Pick<Grid, 'size' | 'x' | 'y'> {
	const wide = (x1 - x0) * sheet.width;
	const tall = (y1 - y0) * sheet.height;
	let size = wide / Math.max(1, across);
	// The box is about a whole number of squares down as well: both say how big one is.
	const down = Math.max(1, Math.round(tall / size));
	size = (wide + tall) / (Math.max(1, across) + down);
	size = Math.min(limits.max, Math.max(limits.min, Math.round(size * 100) / 100));
	const shift = (edge: number) => Math.round(wrapOffset(edge, size) * 100) / 100;
	return { size, x: shift(x0 * sheet.width), y: shift(y0 * sheet.height) };
}
