import { describe, expect, test } from 'bun:test';
import { boxOf, capped, linePath, thinOut, touchesBox } from './drawing';
import type { Point } from './types';

describe('a line drawn freehand', () => {
	test('is thinned to the points that give it its shape', () => {
		// Along the bottom, then up the side, with a wobble well under the tolerance.
		const line: Point[] = [];
		for (let x = 0; x <= 100; x += 2) line.push([x, x % 4 === 0 ? 0 : 0.2]);
		for (let y = 2; y <= 100; y += 2) line.push([100, y]);
		expect(thinOut(line, 0.5)).toEqual([
			[0, 0],
			[100, 0],
			[100, 100]
		]);
		// A tighter tolerance keeps the wobble.
		expect(thinOut(line, 0.05).length).toBeGreaterThan(40);
	});

	test('keeps its ends, however short it is', () => {
		expect(thinOut([[1, 1]], 5)).toEqual([[1, 1]]);
		expect(
			thinOut(
				[
					[1, 1],
					[2, 2]
				],
				5
			)
		).toHaveLength(2);
		// A loop back to where it started is not flattened to nothing.
		const loop: Point[] = [
			[0, 0],
			[10, 0],
			[10, 10],
			[0, 10],
			[0, 0]
		];
		expect(thinOut(loop, 1)).toEqual(loop);
	});

	test('is capped by spreading what is kept along it', () => {
		const line: Point[] = Array.from({ length: 1000 }, (_, i) => [i, 0]);
		const kept = capped(line, 10);
		expect(kept).toHaveLength(10);
		expect(kept[0]).toEqual([0, 0]);
		expect(kept[9]).toEqual([999, 0]);
		expect(capped(line.slice(0, 5), 10)).toHaveLength(5);
	});

	test('is drawn as a path, a single point as a dot', () => {
		expect(linePath([])).toBe('');
		expect(linePath([[5, 5]])).toBe('M5 5L5 5');
		expect(
			linePath([
				[0, 0],
				[10, 0],
				[10, 10]
			])
		).toBe('M0 0Q10 0 10 5L10 10');
	});

	test('is caught by a box it passes through', () => {
		const box = { x0: 4, x1: 6, y0: 4, y1: 6 };
		const across: Point[] = [
			[0, 5],
			[10, 5]
		];
		// Neither end is inside, but the line is.
		expect(touchesBox(across, box)).toBe(true);
		expect(
			touchesBox(
				[
					[0, 0],
					[10, 10]
				],
				box
			)
		).toBe(true);
		expect(
			touchesBox(
				[
					[0, 7],
					[10, 7]
				],
				box
			)
		).toBe(false);
		expect(
			touchesBox(
				[
					[0, 0],
					[3, 3]
				],
				box
			)
		).toBe(false);
		expect(touchesBox([[5, 5]], box)).toBe(true);
		expect(touchesBox([[1, 5]], box)).toBe(false);
	});

	test('has a box around it', () => {
		expect(
			boxOf([
				[0.2, 0.9],
				[0.5, 0.1]
			])
		).toEqual({ x0: 0.2, x1: 0.5, y0: 0.1, y1: 0.9 });
	});
});
