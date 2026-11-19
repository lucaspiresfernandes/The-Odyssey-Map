// The geometry of a line drawn freehand on a battle map. A pointer reports
// far more spots than a line needs, so it is thinned out before it is sent,
// and drawn back as a curve through what is left.
//
// Everything here works in whatever units the points are in. The browser
// thins a line in the map's pixels, where a distance means the same thing
// across and down.

import type { Point, TemplateKind } from './types';

// ---------------------------------------------------------------- templates

// A template marks out the area of a spell: a circle, a cone or a box. It
// is kept as two points, and everything else about it follows from them.
// What follows is worked out in the map's pixels, like the lines.

/**
 * The outline of a template as an SVG path. A circle is drawn around `a`
 * through `b`. A cone has its tip at `a` and the middle of its far end at
 * `b`, and is as wide there as it is long. A box has `a` and `b` for
 * opposite corners.
 */
export function templatePath(kind: TemplateKind, a: Point, b: Point): string {
	const n = (value: number) => Math.round(value * 100) / 100;
	if (kind === 'rect') return `M${n(a[0])} ${n(a[1])}H${n(b[0])}V${n(b[1])}H${n(a[0])}Z`;
	if (kind === 'circle') {
		const r = n(Math.hypot(b[0] - a[0], b[1] - a[1]));
		return `M${n(a[0] - r)} ${n(a[1])}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
	}
	const [left, right] = coneEnds(a, b);
	return `M${n(a[0])} ${n(a[1])}L${n(left[0])} ${n(left[1])}L${n(right[0])} ${n(right[1])}Z`;
}

/** The two corners at the far end of a cone. */
function coneEnds(a: Point, b: Point): [Point, Point] {
	// Half of how long it is, to either side of the middle of its far end.
	const sx = -(b[1] - a[1]) / 2;
	const sy = (b[0] - a[0]) / 2;
	return [
		[b[0] + sx, b[1] + sy],
		[b[0] - sx, b[1] - sy]
	];
}

/** The box around a template. */
export function templateBox(kind: TemplateKind, a: Point, b: Point): Box {
	if (kind === 'rect') return boxOf([a, b]);
	if (kind === 'cone') return boxOf([a, ...coneEnds(a, b)]);
	const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
	return { x0: a[0] - r, x1: a[0] + r, y0: a[1] - r, y1: a[1] + r };
}

/**
 * How big a template is: how far a circle reaches from its middle, how long
 * a cone is, how wide and how tall a box is.
 */
export function templateSpan(kind: TemplateKind, a: Point, b: Point): number[] {
	if (kind === 'rect') return [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
	return [Math.hypot(b[0] - a[0], b[1] - a[1])];
}

// -------------------------------------------------------------------- lines

/**
 * The same line with fewer points: every point dropped lay within
 * `tolerance` of the line through the ones that stay. Both ends are kept.
 * (Ramer-Douglas-Peucker, without the recursion.)
 */
export function thinOut(points: Point[], tolerance: number): Point[] {
	if (points.length <= 2) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const spans: [number, number][] = [[0, points.length - 1]];
	while (spans.length) {
		const [a, b] = spans.pop()!;
		const [ax, ay] = points[a];
		const dx = points[b][0] - ax;
		const dy = points[b][1] - ay;
		const length = Math.hypot(dx, dy);
		let far = -1;
		let most = tolerance;
		for (let i = a + 1; i < b; i++) {
			const px = points[i][0] - ax;
			const py = points[i][1] - ay;
			// A line that ends where it started has no direction to measure from.
			const off = length === 0 ? Math.hypot(px, py) : Math.abs(dy * px - dx * py) / length;
			if (off > most) {
				most = off;
				far = i;
			}
		}
		if (far !== -1) {
			keep[far] = 1;
			spans.push([a, far], [far, b]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/** At most `most` of the points, evenly spread along the line, both ends kept. */
export function capped(points: Point[], most: number): Point[] {
	if (points.length <= most) return points;
	const step = (points.length - 1) / (most - 1);
	return Array.from({ length: most }, (_, i) => points[Math.round(i * step)]);
}

const short = (n: number) => Math.round(n * 100) / 100;

/**
 * An SVG path through the points: straight to the middle of each stretch,
 * curving past each point in between, so the corners of a thinned line
 * come out round.
 */
export function linePath(points: Point[]): string {
	if (points.length === 0) return '';
	const at = ([x, y]: Point) => `${short(x)} ${short(y)}`;
	let d = `M${at(points[0])}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [x, y] = points[i];
		const [nx, ny] = points[i + 1];
		d += `Q${at(points[i])} ${at([(x + nx) / 2, (y + ny) / 2])}`;
	}
	// A single point still gets a segment: with round ends, that draws a dot.
	return `${d}L${at(points[points.length - 1])}`;
}

export interface Box {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/**
 * True when the line through these points comes inside the box anywhere
 * along the way, not only at one of its points: a long straight stretch
 * has none in the middle.
 */
export function touchesBox(points: Point[], box: Box): boolean {
	const crosses = ([ax, ay]: Point, [bx, by]: Point) => {
		// Liang-Barsky: the part of the stretch a..b that lies inside the box, if any.
		let from = 0;
		let to = 1;
		const dx = bx - ax;
		const dy = by - ay;
		const sides = [
			[-dx, ax - box.x0],
			[dx, box.x1 - ax],
			[-dy, ay - box.y0],
			[dy, box.y1 - ay]
		];
		for (const [p, q] of sides) {
			if (p === 0) {
				if (q < 0) return false;
			} else if (p < 0) {
				from = Math.max(from, q / p);
			} else {
				to = Math.min(to, q / p);
			}
			if (from > to) return false;
		}
		return true;
	};
	if (points.length === 1) return crosses(points[0], points[0]);
	return points.some((point, i) => i > 0 && crosses(points[i - 1], point));
}

/** The box around some points. */
export function boxOf(points: Point[]): Box {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
