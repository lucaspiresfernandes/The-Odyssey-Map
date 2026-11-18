import { describe, expect, test } from 'bun:test';
import { tileLevelFor, tileLevels, tilesIn } from './tiles';

describe('tile levels', () => {
	test('an image the preview can show whole has none', () => {
		expect(tileLevels(1600, 1000)).toBe(0);
		expect(tileLevels(2048, 2048)).toBe(0);
	});

	test('a big one has a level for each halving down to the preview', () => {
		expect(tileLevels(2049, 100)).toBe(1);
		// 13810, 6905 and 3453 across. The next, 1727, is the preview's job.
		expect(tileLevels(13810, 12802)).toBe(3);
	});

	test('the zoom picks the smallest level that is still sharp', () => {
		expect(tileLevelFor(2)).toBe(0);
		expect(tileLevelFor(1)).toBe(0);
		expect(tileLevelFor(0.5)).toBe(1);
		expect(tileLevelFor(0.3)).toBe(1);
		expect(tileLevelFor(0.25)).toBe(2);
	});
});

describe('tiles in view', () => {
	const everything = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

	test('a level is covered edge to edge, with the last tiles cut short', () => {
		const tiles = tilesIn(2400, 1500, 0, everything);
		expect(tiles).toHaveLength(5 * 3);
		const last = tiles.at(-1)!;
		expect(last).toMatchObject({ x: 4, y: 2, left: 2048, top: 1024, width: 352, height: 476 });
	});

	test('a smaller level puts fewer, larger tiles over the same map', () => {
		const tiles = tilesIn(13810, 12802, 2, everything);
		expect(tiles).toHaveLength(7 * 7);
		expect(tiles[1]).toMatchObject({ x: 1, y: 0, left: 2048, width: 2048, height: 2048 });
	});

	test('only the tiles that touch the box are returned', () => {
		const tiles = tilesIn(13810, 12802, 0, { x0: 600, y0: 100, x1: 1100, y1: 400 });
		expect(tiles.map((t) => `${t.x},${t.y}`)).toEqual(['1,0', '2,0']);
	});
});
