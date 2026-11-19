// A world map with no image of its own borrows one. It shows the part of
// its parent's image that lies under the region leading to it, so stepping
// into a region is a closer look at what was already drawn there. One big
// image can carry several maps that way, each a part of the one before.
//
// The part is the box around the region's corners. When the parent has no
// image either, it is a part of the parent's own borrowed one, and so on
// up to the first map that has an image.

import { DEFAULT_MAP_SIZE, type Backdrop, type Point, type Rect } from './types';

/** The box around a region's corners, in the space of the map it is drawn on. */
export function boxAround(points: Point[]): Rect {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** `inner` is a box in fractions of `outer`. Returns it in the space `outer` is given in. */
export function boxWithin(outer: Rect, inner: Rect): Rect {
	const w = outer[2] - outer[0];
	const h = outer[3] - outer[1];
	return [
		outer[0] + inner[0] * w,
		outer[1] + inner[1] * h,
		outer[0] + inner[2] * w,
		outer[1] + inner[3] * h
	];
}

/**
 * The part of an image that a box covers, as a backdrop, or null when there
 * is less than a pixel of picture under it. `box` is in fractions of the image.
 */
export function partOf(image: { file: string; width: number; height: number }, box: Rect): Backdrop | null {
	// Two decimal places are a hundredth of a pixel.
	const px = (fraction: number, side: number) => Math.round(fraction * side * 100) / 100;
	const part = {
		file: image.file,
		width: image.width,
		height: image.height,
		x: px(box[0], image.width),
		y: px(box[1], image.height),
		w: px(box[2] - box[0], image.width),
		h: px(box[3] - box[1], image.height)
	};
	return part.w >= 1 && part.h >= 1 ? part : null;
}

/**
 * How big a map with a borrowed picture is, in its own pixels, and how many
 * of them one pixel of the picture covers.
 *
 * A part as wide as a map usually is, or wider, is shown at its own size.
 * A smaller one is blown up to that width: a map a hundred pixels across
 * would have everything drawn on it at the wrong size.
 */
export function frameOf(part: Pick<Backdrop, 'w' | 'h'>): {
	width: number;
	height: number;
	scale: number;
} {
	const scale = Math.max(1, DEFAULT_MAP_SIZE.width / Math.max(part.w, part.h));
	return {
		// Rounded down, so the picture reaches the edge of the map.
		width: Math.max(1, Math.floor(part.w * scale)),
		height: Math.max(1, Math.floor(part.h * scale)),
		scale
	};
}
