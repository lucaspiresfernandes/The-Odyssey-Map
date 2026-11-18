// The arithmetic of the fog of war. Fog covers a whole battle map but for a
// list of boxes that have been cleared. The boxes never overlap: clearing
// one cuts it out of the others first. That keeps the fog one shape with
// holes in it, which draws without seams.

import type { Fog, MapInfo, Point, Rect } from './types';

type Sheet = Pick<MapInfo, 'width' | 'height' | 'grid'>;

/** True when a spot is under the fog: it is on, and none of the cleared boxes holds the spot. */
export function isFogged(fog: Fog | undefined, [x, y]: Point): boolean {
	if (!fog?.on) return false;
	return !fog.clear.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

/** `rects` with `hole` cut out of them: what is left of each one it touches, in up to four pieces. */
export function without(rects: Rect[], [hx0, hy0, hx1, hy1]: Rect): Rect[] {
	const left: Rect[] = [];
	for (const rect of rects) {
		const [x0, y0, x1, y1] = rect;
		if (hx0 >= x1 || hx1 <= x0 || hy0 >= y1 || hy1 <= y0) {
			left.push(rect);
			continue;
		}
		// A strip above the hole and one below, each the whole width, and
		// between them what is left on either side.
		if (hy0 > y0) left.push([x0, y0, x1, hy0]);
		if (hy1 < y1) left.push([x0, hy1, x1, y1]);
		const top = Math.max(y0, hy0);
		const bottom = Math.min(y1, hy1);
		if (hx0 > x0) left.push([x0, top, hx0, bottom]);
		if (hx1 < x1) left.push([hx1, top, x1, bottom]);
	}
	return left;
}

/** The fog with `rect` cleared of it. Fog that is off has nothing to clear. */
export function cleared(fog: Fog, rect: Rect): Fog {
	if (!fog.on) return fog;
	return { on: true, clear: [...without(fog.clear, rect), rect] };
}

/**
 * The fog with `rect` covered again. On a map with no fog yet, that is
 * where it starts: the rest of the map stays in the clear.
 */
export function covered(fog: Fog, rect: Rect): Fog {
	return { on: true, clear: without(fog.on ? fog.clear : [[0, 0, 1, 1]], rect) };
}

/** Six decimal places put an edge within a thirtieth of a pixel on the biggest map there is. */
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The box dragged from `a` to `b`, grown to take in every grid cell it
 * touches, so fog comes and goes a cell at a time. With `free` it is the
 * box exactly as dragged. Null when there is nothing of it on the map.
 */
export function cellBox(map: Sheet, a: Point, b: Point, free = false): Rect | null {
	const { size } = map.grid;
	const span = (from: number, to: number, offset: number, across: number): [number, number] => {
		let low = Math.min(from, to);
		let high = Math.max(from, to);
		if (!free) {
			low = (Math.floor((low * across - offset) / size) * size + offset) / across;
			high = (Math.ceil((high * across - offset) / size) * size + offset) / across;
		}
		return [rounded(Math.max(0, low)), rounded(Math.min(1, high))];
	};
	const [x0, x1] = span(a[0], b[0], map.grid.x, map.width);
	const [y0, y1] = span(a[1], b[1], map.grid.y, map.height);
	return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

/** The fog as one path in the map's pixels: the whole map, with a hole for each cleared box. */
export function fogPath(fog: Fog, width: number, height: number): string {
	let d = `M0 0H${width}V${height}H0Z`;
	for (const [x0, y0, x1, y1] of fog.clear) {
		d += `M${x0 * width} ${y0 * height}H${x1 * width}V${y1 * height}H${x0 * width}Z`;
	}
	return d;
}
