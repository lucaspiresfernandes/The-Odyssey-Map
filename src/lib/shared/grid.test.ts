import { describe, expect, test } from 'bun:test';
import {
	arrangeInCells,
	cellsAcross,
	cellsToFeet,
	feetBetween,
	feetCount,
	freeCell,
	snapToGrid,
	wrapOffset
} from './grid';

// A thousand pixels each way with cells of a hundred: ten by ten.
const map = { width: 1000, height: 1000, grid: { size: 100, x: 0, y: 0, shown: true }, cellFeet: 8 };
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

	test('a half size is centred on a cell too', () => {
		expect(snapToGrid(map, [0.52, 0.58], 0.5)).toEqual([0.55, 0.55]);
		expect(snapToGrid(map, [0.52, 0.58], 1.5)).toEqual([0.55, 0.55]);
		expect(snapToGrid(map, [0.52, 0.58], 2.5)).toEqual([0.55, 0.55]);
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
	test('straight lines count cells, eight feet each', () => {
		expect(feetBetween(map, [0.05, 0.05], [0.65, 0.05])).toBe(48);
	});

	test('a diagonal step counts as one cell', () => {
		expect(feetBetween(map, [0.05, 0.05], [0.35, 0.25])).toBe(24);
	});

	test('a map that is not square measures in its own pixels', () => {
		const wide = { ...map, width: 2000 };
		expect(feetBetween(wide, [0, 0.5], [0.5, 0.5])).toBe(80);
	});

	test('a cell is as many feet as its map says', () => {
		const dungeon = { ...map, cellFeet: 5 };
		expect(feetBetween(dungeon, [0.05, 0.05], [0.65, 0.05])).toBe(30);
		expect(feetBetween({ ...map, cellFeet: 2.5 }, [0.05, 0.05], [0.35, 0.05])).toBe(7.5);
	});

	test('off the grid it is told to a tenth of a foot', () => {
		expect(feetBetween(map, [0, 0], [0.233, 0])).toBe(18.6);
	});

	test('a size in cells comes to feet too', () => {
		expect(cellsToFeet(map, 1.5)).toBe(12);
		expect(cellsToFeet({ cellFeet: 2.5 }, 1.5)).toBe(3.75);
	});

	test('distances read naturally', () => {
		expect(feetCount(8)).toBe('8 ft');
		expect(feetCount(7.5)).toBe('7.5 ft');
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

describe('tokens put down together', () => {
	test('stand side by side in rows, around the middle of them all', () => {
		expect(arrangeInCells([])).toEqual([]);
		expect(arrangeInCells([1])).toEqual([[0, 0]]);
		expect(arrangeInCells([1, 1])).toEqual([[-0.5, 0], [0.5, 0]]);
		expect(arrangeInCells([1, 1, 1, 1])).toEqual([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]);
		// Five make a row of three and a row of two.
		expect(arrangeInCells([1, 1, 1, 1, 1])).toEqual([[-1, -0.5], [0, -0.5], [1, -0.5], [-1, 0.5], [0, 0.5]]);
	});

	test('a big one takes the cells it covers, and the next row starts under it', () => {
		expect(arrangeInCells([2, 1, 1])).toEqual([[-0.5, -0.5], [1, -1], [-1, 1]]);
		// A half size gets whole cells to stand in the middle of.
		expect(arrangeInCells([1.5, 0.5])).toEqual([[-0.5, 0], [1.5, -1]]);
	});

	test('once one of them sits squarely on a grid, they all do', () => {
		const sizes = [1, 2, 0.5, 3, 1.5, 4, 2.5, 1, 6, 1];
		const spots = arrangeInCells(sizes);
		// A hundred cells each way, so there is room for them all. Put the first
		// where a token of its size rests, and see where the rest come to.
		const wide = { ...shifted, width: 10000, height: 10000 };
		const [x0, y0] = snapToGrid(wide, [0.5, 0.5], sizes[0]);
		spots.forEach(([dx, dy], i) => {
			const at: [number, number] = [x0 + (dx - spots[0][0]) * 0.01, y0 + (dy - spots[0][1]) * 0.01];
			const [sx, sy] = snapToGrid(wide, at, sizes[i]);
			expect(sx).toBeCloseTo(at[0], 6);
			expect(sy).toBeCloseTo(at[1], 6);
		});
		// And no two of them share a cell.
		const half = (size: number) => Math.max(size, 1) / 2;
		for (let a = 0; a < sizes.length; a++) {
			for (let b = a + 1; b < sizes.length; b++) {
				const apart = Math.max(Math.abs(spots[a][0] - spots[b][0]), Math.abs(spots[a][1] - spots[b][1]));
				expect(apart).toBeGreaterThanOrEqual(half(sizes[a]) + half(sizes[b]));
			}
		}
	});
});
