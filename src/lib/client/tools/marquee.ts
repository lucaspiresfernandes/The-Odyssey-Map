// The box that selects several things at once: what on the map a box that
// was dragged over it catches.

import { within } from '#lib/client/stage.svelte.ts';
import { templateBox, touchesBox } from '#lib/shared/drawing.ts';
import { isTemplate, type Marker, type Point } from '#lib/shared/types.ts';
import type { Board } from './board.ts';

/** How tall a pin stands over its spot, on screen. */
export const PIN_HEIGHT = 44;

/**
 * Everything a box dragged over the map touches, by id: the tokens and
 * drawings of a battle map, and of a world map the markers that are this
 * person's to move. `a` and `b` are two opposite corners of it, in map space.
 */
export function caughtIn(
	board: Board,
	[a, b]: [Point, Point],
	canGrabMarker: (marker: Marker) => boolean
): string[] {
	const { tokens, drawings, markers, battle, W, H, cell, stage } = board;
	const box = {
		x0: Math.min(a[0], b[0]),
		x1: Math.max(a[0], b[0]),
		y0: Math.min(a[1], b[1]),
		y1: Math.max(a[1], b[1])
	};
	const caught: string[] = [];
	for (const token of tokens) {
		// A disc against a box, in the map's pixels: from its middle to the
		// nearest spot of the box is no further than its edge.
		const nx = within(token.x, box.x0, box.x1);
		const ny = within(token.y, box.y0, box.y1);
		const away = Math.hypot((token.x - nx) * W, (token.y - ny) * H);
		if (away <= (token.size * cell) / 2) caught.push(token.id);
	}
	for (const drawing of drawings) {
		if (isTemplate(drawing.kind) && drawing.points.length === 2) {
			// A template is caught by the box around it.
			const [from, to] = drawing.points.map(([x, y]): Point => [x * W, y * H]);
			const around = templateBox(drawing.kind, from, to);
			const apart =
				around.x0 / W > box.x1 ||
				around.x1 / W < box.x0 ||
				around.y0 / H > box.y1 ||
				around.y1 / H < box.y0;
			if (!apart) caught.push(drawing.id);
			continue;
		}
		if (drawing.kind === 'line') {
			if (touchesBox(drawing.points, box)) caught.push(drawing.id);
			continue;
		}
		// How much room a text takes is the browser's to say.
		const letters = stage.world?.querySelector(`[data-drawing-id="${drawing.id}"]`);
		if (!letters) continue;
		const rect = letters.getBoundingClientRect();
		const [x0, y0] = stage.toMap(rect.left, rect.top);
		const [x1, y1] = stage.toMap(rect.right, rect.bottom);
		if (x0 <= box.x1 && x1 >= box.x0 && y0 <= box.y1 && y1 >= box.y0) caught.push(drawing.id);
	}
	if (!battle) {
		// A pin stands on its spot, and is as big on screen at any zoom: it is
		// caught by the box around it.
		const wide = 16 / (stage.view.k * W);
		const tall = PIN_HEIGHT / (stage.view.k * H);
		for (const marker of markers) {
			if (!canGrabMarker(marker)) continue;
			const apart =
				marker.x - wide > box.x1 ||
				marker.x + wide < box.x0 ||
				marker.y - tall > box.y1 ||
				marker.y < box.y0;
			if (!apart) caught.push(marker.id);
		}
	}
	return caught;
}
