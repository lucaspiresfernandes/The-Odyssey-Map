// Big map images are shown in pieces. A small preview of the whole picture
// sits underneath, and over it go square tiles cut from the image at several
// sizes: only the ones on screen, at the size the zoom calls for.
//
// Level 0 is the image at full size. Each level after it is half the one
// before, and the levels stop where the preview is already as sharp.

/** The side of a tile, in the pixels of its level. */
export const TILE_SIZE = 512;

/** The longest side of the preview. An image no bigger than this is shown whole, without tiles. */
export const PREVIEW_SIZE = 2048;

/** How many tile levels an image has. 0 for one small enough to be shown whole. */
export function tileLevels(width: number, height: number): number {
	let levels = 0;
	for (let side = Math.max(width, height); side > PREVIEW_SIZE; side = Math.ceil(side / 2)) {
		levels++;
	}
	return levels;
}

/**
 * The level to show when one pixel of the image covers `scale` pixels of
 * the screen: the smallest tiles that are still sharp there. Equal to
 * `tileLevels` or more means the preview is enough.
 */
export function tileLevelFor(scale: number): number {
	// The quarter step lets tiles be stretched by a fifth before the next
	// level takes over, which can't be seen and loads far fewer of them.
	return Math.max(0, Math.floor(Math.log2(1 / scale) + 0.25));
}

export interface Tile {
	level: number;
	/** Column and row within the level. */
	x: number;
	y: number;
	/** Where the tile goes on the map, in pixels of the full image. */
	left: number;
	top: number;
	width: number;
	height: number;
}

/** The tiles of one level that touch a rectangle of the map, given in pixels of the full image. */
export function tilesIn(
	width: number,
	height: number,
	level: number,
	box: { x0: number; y0: number; x1: number; y1: number }
): Tile[] {
	const shrink = 2 ** level;
	const levelWidth = Math.ceil(width / shrink);
	const levelHeight = Math.ceil(height / shrink);
	const span = TILE_SIZE * shrink;

	const first = (at: number) => Math.max(0, Math.floor(at / span));
	const last = (at: number, side: number) =>
		Math.min(Math.ceil(side / TILE_SIZE) - 1, Math.floor(at / span));

	const tiles: Tile[] = [];
	for (let y = first(box.y0); y <= last(box.y1, levelHeight); y++) {
		for (let x = first(box.x0); x <= last(box.x1, levelWidth); x++) {
			tiles.push({
				level,
				x,
				y,
				left: x * span,
				top: y * span,
				// The last column and row are cut short by the edge of the image.
				width: Math.min(TILE_SIZE, levelWidth - x * TILE_SIZE) * shrink,
				height: Math.min(TILE_SIZE, levelHeight - y * TILE_SIZE) * shrink
			});
		}
	}
	return tiles;
}
