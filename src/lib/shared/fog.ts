// The arithmetic of the fog of war. Fog covers a whole map but for what has
// been cleared from it: by a brush swept across the map, round or square.
// Each sweep is a mark, and the marks are kept in the order they were
// made: a spot is under the fog or not by the last mark that holds it.

import { thinOut } from './drawing';
import { FOG_BRUSH, LIMITS, type Fog, type FogMark, type MapInfo, type Point, type Rect } from './types';

type Sized = Pick<MapInfo, 'width' | 'height'>;

const inBox = ([x0, y0, x1, y1]: Rect, [x, y]: Point) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** True when a round brush of one, swept from `a` to `b`, went over a spot: it is within one of the way. */
function roundOver([ax, ay]: Point, [bx, by]: Point, [px, py]: Point): boolean {
	const dx = bx - ax;
	const dy = by - ay;
	const length = dx * dx + dy * dy;
	// How far along the way the spot is nearest to it, kept between its ends.
	const along =
		length === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
	return (px - ax - along * dx) ** 2 + (py - ay - along * dy) ** 2 <= 1;
}

/**
 * True when a square brush, one from its middle to its sides, swept from
 * `a` to `b`, went over a spot: somewhere on the way it was within one of
 * the spot both across and down.
 */
function squareOver(a: Point, b: Point, spot: Point): boolean {
	// The part of the way, from 0 at `a` to 1 at `b`, that is near enough both ways.
	let from = 0;
	let to = 1;
	for (const axis of [0, 1]) {
		const step = b[axis] - a[axis];
		const gap = spot[axis] - a[axis];
		if (step === 0) {
			if (Math.abs(gap) > 1) return false;
			continue;
		}
		const one = (gap - 1) / step;
		const other = (gap + 1) / step;
		from = Math.max(from, Math.min(one, other));
		to = Math.min(to, Math.max(one, other));
		if (from > to) return false;
	}
	return true;
}

/** True when a mark holds a spot: the spot is in its box, or the brush went over it as it swept. */
function holds(mark: FogMark, [x, y]: Point): boolean {
	if ('box' in mark) return inBox(mark.box, [x, y]);
	// Measured in brushes: the brush is round on the map's picture, which
	// makes it an oval in map space, and a circle of one across in these.
	const [rx, ry] = mark.r;
	const inBrushes = ([sx, sy]: Point): Point => [sx / rx, sy / ry];
	const over = mark.square ? squareOver : roundOver;
	const spot = inBrushes([x, y]);
	// A brush put down and lifted again went from where it was to the same place.
	let a = inBrushes(mark.path[0]);
	for (let i = 0; i < mark.path.length; i++) {
		const b = inBrushes(mark.path[i]);
		if (over(a, b, spot)) return true;
		a = b;
	}
	return false;
}

/**
 * True when a spot is under the fog: it is on, and the last mark made over
 * the spot covered it, or none was and nothing cleared there to begin with.
 */
export function isFogged(fog: Fog | undefined, at: Point): boolean {
	if (!fog?.on) return false;
	const marks = fog.marks ?? [];
	for (let i = marks.length - 1; i >= 0; i--) {
		if (holds(marks[i], at)) return marks[i].cover;
	}
	return !fog.clear.some((box) => inBox(box, at));
}

/** The middle of the box around some corners: where a region is taken to be, for the fog. */
export function middleOf(points: Point[]): Point {
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Six decimal places put an edge within a thirtieth of a pixel on the biggest map there is. */
function rounded(n: number) {
	return Math.round(n * 1e6) / 1e6;
}

const onMap = (n: number) => Math.min(1, Math.max(0, n));

/** A brush size the fog can be painted with: the nearest one to what was asked for. */
export function brushSize(size: number): number {
	return Math.min(FOG_BRUSH.max, Math.max(FOG_BRUSH.min, size));
}

/**
 * How far a brush of some size reaches across a map and down it, in map
 * space. Its size is its radius as a part of the map's longer side, so on
 * the map's picture it is round, or for a square brush, square.
 */
export function brushReach(map: Sized, size: number): [number, number] {
	const reach = brushSize(size) * Math.max(map.width, map.height);
	// A map many times longer than it is tall would otherwise have a brush
	// many maps tall.
	return [rounded(Math.min(4, reach / map.width)), rounded(Math.min(4, reach / map.height))];
}

/**
 * The marks a brush leaves that was swept through these spots, to clear
 * the fog there or with `cover` to put it back: a round brush, or with
 * `square` a square one. The spots it passed through are thinned to the
 * ones that give the sweep its shape. A long one is kept as several marks,
 * each starting where the last one ended.
 */
export function brushMarks(
	cover: boolean,
	swept: Point[],
	map: Sized,
	size: number,
	square = false
): FogMark[] {
	if (swept.length === 0) return [];
	const r = brushReach(map, size);
	// Thinned in brushes: what is dropped lay within a twentieth of the
	// brush's reach of the line through what stays.
	const path = thinOut(
		swept.map(([x, y]): Point => [x / r[0], y / r[1]]),
		0.05
	).map(([x, y]): Point => [rounded(onMap(x * r[0])), rounded(onMap(y * r[1]))]);
	const marks: FogMark[] = [];
	for (let i = 0; i === 0 || i < path.length - 1; i += LIMITS.fogPath - 1) {
		const mark = { cover, path: path.slice(i, i + LIMITS.fogPath), r };
		marks.push(square ? { ...mark, square } : mark);
	}
	return marks;
}

/** The box around everything a mark holds. */
function boundsOf(mark: FogMark): Rect {
	if ('box' in mark) return mark.box;
	const xs = mark.path.map((point) => point[0]);
	const ys = mark.path.map((point) => point[1]);
	const [rx, ry] = mark.r;
	return [Math.min(...xs) - rx, Math.min(...ys) - ry, Math.max(...xs) + rx, Math.max(...ys) + ry];
}

/**
 * The fog with these marks made on it, one after the other. Fog that is off
 * has nothing to clear, and comes back as it was. Covering a part of a map
 * with no fog starts some there: the rest of the map stays in the clear.
 */
export function marked(fog: Fog, marks: FogMark[]): Fog {
	let next = fog;
	for (const mark of marks) {
		if (!next.on) {
			if (mark.cover) next = { on: true, clear: [[0, 0, 1, 1]], marks: [mark] };
			continue;
		}
		// A box says all there is to say about what is inside it: the marks
		// made there before are forgotten, so the list doesn't grow for ever.
		const before = next.marks ?? [];
		const box = 'box' in mark ? mark.box : null;
		const kept = box
			? before.filter((each) => {
					const [x0, y0, x1, y1] = boundsOf(each);
					return x0 < box[0] || y0 < box[1] || x1 > box[2] || y1 > box[3];
				})
			: before;
		next = { ...next, marks: [...kept, mark] };
	}
	return next;
}

/** The fog with a box of it cleared, or with `cover` put back. */
export function boxed(fog: Fog, box: Rect, cover = false): Fog {
	return marked(fog, [{ cover, box }]);
}

/** Fog as it is kept: with its marks only where it has some. */
export function fogOf(fog: Fog): Fog {
	return fog.marks?.length
		? { on: fog.on, clear: fog.clear, marks: fog.marks }
		: { on: fog.on, clear: fog.clear };
}

/**
 * Where a round brush swept, as the path a line of its width is drawn
 * along. It is in brushes: drawn two wide with round ends, and scaled by
 * the reach of the brush, it covers what the mark holds.
 */
export function sweepPath(mark: Extract<FogMark, { path: Point[] }>): string {
	const [rx, ry] = mark.r;
	const d = mark.path.map(([x, y], i) => `${i ? 'L' : 'M'}${fine(x / rx)} ${fine(y / ry)}`).join('');
	// A brush that was put down and lifted again leaves a dot.
	return mark.path.length === 1 ? `${d}h0` : d;
}

/** Four decimal places of a brush are finer than a pixel of the biggest brush there is. */
const fine = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Where a square brush swept, as the outline of what it went over, to be
 * filled. It is in brushes, like `sweepPath`. A line can't be drawn that
 * wide with its ends kept level, so each stretch of the way is a shape of
 * its own: the square at one end, the square at the other, and what lies
 * between them. They all go round the same way, so that where two of them
 * overlap, both still count.
 */
export function stampPath(mark: Extract<FogMark, { path: Point[] }>): string {
	const [rx, ry] = mark.r;
	const spots = mark.path.map(([x, y]): Point => [x / rx, y / ry]);
	const shapes: string[] = [];
	for (let i = 0; i === 0 || i < spots.length - 1; i++) {
		const [ax, ay] = spots[i];
		const [bx, by] = spots[i + 1] ?? spots[i];
		// The way the brush went, across and down.
		const sx = bx < ax ? -1 : 1;
		const sy = by < ay ? -1 : 1;
		// From the corner behind the brush where it started, round by the
		// corner ahead of it where it stopped.
		const corners: Point[] = [
			[ax - sx, ay - sy],
			[ax + sx, ay - sy],
			[bx + sx, by - sy],
			[bx + sx, by + sy],
			[bx - sx, by + sy],
			[ax - sx, ay + sy]
		];
		if (sx !== sy) corners.reverse();
		shapes.push(`M${corners.map(([x, y]) => `${fine(x)} ${fine(y)}`).join('L')}Z`);
	}
	return shapes.join('');
}
