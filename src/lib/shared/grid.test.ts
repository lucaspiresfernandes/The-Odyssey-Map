import { describe, expect, test } from 'bun:test';
import { cellCount, cellsAcross, cellsBetween, freeCell, snapToGrid, wrapOffset } from './grid';

// A thousand pixels each way with cells of a hundred: ten by ten.
const map = { width: 1000, height: 1000, grid: { size: 100, x: 0, y: 0, shown: true } };
const shifted = { ...map, grid: { ...map.grid, x: 30, y: 60 } };

describe('snapping', () => {
	test('a token one cell across rests in the middle of a cell', () => {
		expect(snapToGrid(map, [0.52, 0.58])).toEqual([0.55, 0.55]);
		expect(snapToGrid(map, [0.0, 0.99])).toEqual([0.05, 0.95]);
	});

	test('one two cells across rests where four cells meet', () => {
		expect(snapToGrid(map, [0.52, 0.58], 2)).toEqual([0.5, 0.6]);
	});

	test('one three cells across is centred on a cell again', () => {
		expect(snapToGrid(map, [0.52, 0.58], 3)).toEqual([0.55, 0.55]);
	});

	test('the grid can start anywhere', () => {
		const [x, y] = snapToGrid(shifted, [0.5, 0.5]);
		expect(x).toBeCloseTo(0.48);
		expect(y).toBeCloseTo(0.51);
	});

	test('nothing is snapped off the map', () => {
		const [x, y] = snapToGrid(shifted, [1, 1], 2);
		expect(x).toBeLessThanOrEqual(1);
		expect(y).toBeLessThanOrEqual(1);
	});
});

describe('measuring', () => {
	test('straight lines count cells', () => {
		expect(cellsBetween(map, [0.05, 0.05], [0.65, 0.05])).toBe(6);
	});

	test('a diagonal step counts as one', () => {
		expect(cellsBetween(map, [0.05, 0.05], [0.35, 0.25])).toBe(3);
	});

	test('a map that is not square measures in its own pixels', () => {
		const wide = { ...map, width: 2000 };
		expect(cellsBetween(wide, [0, 0.5], [0.5, 0.5])).toBe(10);
	});

	test('distances read naturally', () => {
		expect(cellCount(1)).toBe('1 cell');
		expect(cellCount(2.5)).toBe('2.5 cells');
	});
});

test('an offset of a whole cell or more is the same grid', () => {
	expect(wrapOffset(130, 100)).toBe(30);
	expect(wrapOffset(-20, 100)).toBe(80);
});

test('a map knows how many cells it holds', () => {
	expect(cellsAcross({ ...map, width: 1650 })).toEqual([16, 10]);
});

describe('a free cell', () => {
	test('is the one asked for while it is empty', () => {
		expect(freeCell(map, [0.52, 0.58], [])).toEqual([0.55, 0.55]);
	});

	test('is the nearest empty one once that is taken', () => {
		const first = freeCell(map, [0.55, 0.55], [[0.55, 0.55]]);
		expect(first).not.toEqual([0.55, 0.55]);
		expect(Math.hypot(first[0] - 0.55, first[1] - 0.55)).toBeCloseTo(0.1);
		// And it never leaves the map.
		const corner = freeCell(map, [0.05, 0.05], [[0.05, 0.05]]);
		expect(corner[0]).toBeGreaterThanOrEqual(0);
		expect(corner[1]).toBeGreaterThanOrEqual(0);
	});
});
