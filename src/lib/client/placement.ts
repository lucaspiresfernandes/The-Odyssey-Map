// Where the things that float over a map go on the screen: the card of a
// marker, the buttons under a selection, the name of a region. All of it is
// arithmetic from the view, and none of it knows what a marker is.

import { boxOf, templateBox } from '#lib/shared/drawing.ts';
import { isTemplate, type Drawing, type Point, type Token } from '#lib/shared/types.ts';
import type { View } from './mapview.ts';
import { within } from './stage.svelte.ts';

/** The map as it lies on the screen: its view, its size in its own pixels, and the size of the screen. */
export interface Frame {
	view: View;
	W: number;
	H: number;
	cw: number;
	ch: number;
}

/** A box on the map, in map space. */
export interface Extent {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

/** Where buttons that float by a selection go, and whether that is under it. */
export interface BarSpot {
	left: number;
	top: number;
	under: boolean;
}

/** Where a spot of the map is on the screen. */
const onScreen = ({ view, W, H }: Frame, [x, y]: Point): Point => [
	x * W * view.k + view.x,
	y * H * view.k + view.y
];

/**
 * Where a card goes for something at this spot of the map: `above` it by
 * that many screen pixels when there is room, `below` it when there is not.
 * Null while the spot is off the screen.
 */
export function cardSpot(
	frame: Frame,
	spot: Point,
	above: number,
	below: number,
	w: number,
	h: number
): { left: number; top: number } | null {
	const { cw, ch } = frame;
	const [sx, sy] = onScreen(frame, spot);
	if (sx < -30 || sx > cw + 30 || sy < -30 || sy > ch + above + 30) return null;
	const fits = sy - above - h >= 6;
	return {
		left: Math.min(Math.max(sx - w / 2, 8), Math.max(8, cw - w - 8)),
		top: fits ? sy - above - h : Math.min(sy + below, Math.max(6, ch - h - 6))
	};
}

/**
 * Where the buttons for a selection float: just under it, in the middle, or
 * over the top of it when it is too low on the screen for that. `raise` is
 * how far above its box the selection stands on screen, as pins do. `drop`
 * is the gap left under it, and `lift` the gap left over it. Null while the
 * selection is off the screen.
 */
export function barSpot(
	frame: Frame,
	box: Extent,
	bar: { w: number; h: number },
	gaps: { raise?: number; drop: number; lift: number }
): BarSpot | null {
	const { cw, ch } = frame;
	const [sx, top] = onScreen(frame, [(box.x0 + box.x1) / 2, box.y0]);
	const [, bottom] = onScreen(frame, [0, box.y1]);
	const head = top - (gaps.raise ?? 0);
	if (sx < -30 || sx > cw + 30 || bottom < -30 || head > ch + 30) return null;
	const under = bottom + gaps.drop;
	const fits = under + bar.h <= ch - 6;
	return {
		left: Math.min(Math.max(sx - bar.w / 2, 8), Math.max(8, cw - bar.w - 8)),
		top: fits ? under : Math.max(6, head - gaps.lift - bar.h),
		under: fits
	};
}

/** How tokens and drawings are drawn on a battle map right now, for working out what they cover. */
export interface Drawn {
	W: number;
	H: number;
	/** The side of one grid cell, in map pixels. */
	cell: number;
	spotOf(token: Token): Point;
	sizeOf(token: Token): number;
	/** How far from where it is kept a drawing is drawn, while it is in hand. */
	shiftOf(drawing: Drawing): Point;
}

/** The box around some tokens and drawings of a battle map, as they are drawn. */
export function extentOf(tokens: Token[], drawings: Drawing[], drawn: Drawn): Extent {
	const { W, H, cell } = drawn;
	const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
	const take = (x: number, y: number, rx: number, ry: number) => {
		box.x0 = Math.min(box.x0, x - rx);
		box.x1 = Math.max(box.x1, x + rx);
		box.y0 = Math.min(box.y0, y - ry);
		box.y1 = Math.max(box.y1, y + ry);
	};
	for (const token of tokens) {
		const half = (drawn.sizeOf(token) * cell) / 2;
		take(...drawn.spotOf(token), half / W, half / H);
	}
	for (const drawing of drawings) {
		const [sx, sy] = drawn.shiftOf(drawing);
		const half = (drawing.size * cell) / 2;
		if (isTemplate(drawing.kind) && drawing.points.length === 2) {
			const [a, b] = drawing.points.map(([x, y]): Point => [x * W, y * H]);
			const around = templateBox(drawing.kind, a, b, cell);
			take(around.x0 / W + sx, around.y0 / H + sy, 0, 0);
			take(around.x1 / W + sx, around.y1 / H + sy, 0, 0);
		} else if (drawing.kind === 'line') {
			const b = boxOf(drawing.points);
			take(b.x0 + sx, b.y0 + sy, half / W, half / H);
			take(b.x1 + sx, b.y1 + sy, half / W, half / H);
		} else {
			// A text starts at its point and runs to the right: about this far.
			const [x, y] = drawing.points[0];
			const long = (drawing.text.length * drawing.size * cell * 0.55) / W;
			take(x + sx, y + sy, 0, half / H);
			take(x + sx + long, y + sy, 0, half / H);
		}
	}
	return box;
}

/**
 * Where a region's name goes: the middle of its outline. When that is off
 * screen the name slides to the nearest spot that is still on screen and
 * still over the region, so a region you have zoomed into keeps its name.
 */
export function nameSpot({ view, W, H, cw, ch }: Frame, points: Point[]): Point {
	const b = boxOf(points);
	const sx = view.k * W;
	const sy = view.k * H;
	// Room for the name itself, and for the toolbars that float over the
	// top and bottom of the map.
	const mx = Math.min(170, cw / 2);
	const my = Math.min(80, ch / 2);
	return [
		within(within((b.x0 + b.x1) / 2, (mx - view.x) / sx, (cw - mx - view.x) / sx), b.x0, b.x1),
		within(within((b.y0 + b.y1) / 2, (my - view.y) / sy, (ch - my - view.y) / sy), b.y0, b.y1)
	];
}

/**
 * Where the buttons for a selected region float: right over its name,
 * however big the region is. With no room up there they go under the name,
 * clear of the line that says how to get in. A name that is off screen
 * leaves them at the edge it went out by, for as long as some of the region
 * is in sight. `nameTall` is how tall the name stands on screen. Null while
 * the region is off the screen.
 */
export function regionBarSpot(
	frame: Frame,
	points: Point[],
	nameTall: number,
	bar: { w: number; h: number }
): { left: number; top: number; tip: 'top' | 'bottom' } | null {
	const { cw, ch } = frame;
	const box = boxOf(points);
	const [left, top] = onScreen(frame, [box.x0, box.y0]);
	const [right, bottom] = onScreen(frame, [box.x1, box.y1]);
	if (right < 0 || left > cw || bottom < 0 || top > ch) return null;
	const [sx, sy] = onScreen(frame, nameSpot(frame, points));
	// The name is lettered around its spot: half of it is above, half below.
	const half = nameTall / 2;
	const over = sy - half - 6 - bar.h;
	const above = over >= 6;
	const at = Math.min(Math.max(above ? over : sy + half + 24, 6), Math.max(6, ch - bar.h - 6));
	// The tooltips come out away from the name, where the screen has room for them.
	const tip = above ? at >= 64 : at + bar.h + 64 > ch;
	return {
		left: Math.min(Math.max(sx - bar.w / 2, 8), Math.max(8, cw - bar.w - 8)),
		top: at,
		tip: tip ? 'top' : 'bottom'
	};
}
