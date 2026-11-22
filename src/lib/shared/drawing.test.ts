import { describe, expect, test } from 'bun:test';
import {
	boxOf,
	capped,
	linePath,
	templateBox,
	templateHolds,
	templatePath,
	templateSpan,
	thinOut,
	touchesBox
} from './drawing';
import { TEXT_SIZES, textSizeStep, type Point } from './types';

describe('the sizes a text can be', () => {
	test('a step goes to the next size, and stops at either end', () => {
		expect(textSizeStep(0.5, 1)).toBe(1);
		expect(textSizeStep(0.5, -1)).toBe(0.3);
		expect(textSizeStep(TEXT_SIZES[0], -1)).toBe(TEXT_SIZES[0]);
		expect(textSizeStep(TEXT_SIZES.at(-1)!, 1)).toBe(TEXT_SIZES.at(-1)!);
	});

	test('a size that is none of them steps from the nearest that is', () => {
		expect(textSizeStep(0.55, 1)).toBe(1);
		expect(textSizeStep(1.2, -1)).toBe(0.5);
		expect(textSizeStep(3, -1)).toBe(1);
	});
});

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

describe('a shape that picks its targets', () => {
	test('a circle holds what is no further from its middle than its rim', () => {
		const a: Point = [100, 100];
		const b: Point = [130, 140];
		expect(templateHolds('circle', a, b, [100, 100])).toBe(true);
		expect(templateHolds('circle', a, b, [100, 150])).toBe(true);
		expect(templateHolds('circle', a, b, [100, 151])).toBe(false);
		expect(templateHolds('circle', a, b, [140, 140])).toBe(false);
		// A hair of slack takes in what sits right on the line.
		expect(templateHolds('circle', a, b, [100, 151], 1)).toBe(true);
	});

	test('a box holds what lies between its corners, whichever two were given', () => {
		const a: Point = [200, 50];
		const b: Point = [100, 150];
		expect(templateHolds('rect', a, b, [150, 100])).toBe(true);
		expect(templateHolds('rect', a, b, [100, 50])).toBe(true);
		expect(templateHolds('rect', a, b, [99, 100])).toBe(false);
		expect(templateHolds('rect', a, b, [150, 151])).toBe(false);
		expect(templateHolds('rect', a, b, [150, 151], 2)).toBe(true);
	});

	test('a cone holds what lies between its tip and its far end, whichever way it points', () => {
		// To the right: its far end runs from (100, -50) to (100, 50).
		const tip: Point = [0, 0];
		const end: Point = [100, 0];
		expect(templateHolds('cone', tip, end, [50, 0])).toBe(true);
		expect(templateHolds('cone', tip, end, [50, 24])).toBe(true);
		expect(templateHolds('cone', tip, end, [50, 26])).toBe(false);
		expect(templateHolds('cone', tip, end, [101, 0])).toBe(false);
		expect(templateHolds('cone', tip, end, [-1, 0])).toBe(false);
		expect(templateHolds('cone', tip, end, [100, 50])).toBe(true);
		// Upwards, the same cone turned.
		expect(templateHolds('cone', tip, [0, -100], [20, -50])).toBe(true);
		expect(templateHolds('cone', tip, [0, -100], [30, -50])).toBe(false);
		expect(templateHolds('cone', tip, [0, -100], [0, 10])).toBe(false);
		// One with no length is a single spot.
		expect(templateHolds('cone', tip, tip, [0, 0])).toBe(true);
		expect(templateHolds('cone', tip, tip, [1, 0])).toBe(false);
	});

	test('a ray holds what is along it, half a cell to either side', () => {
		const from: Point = [100, 100];
		const to: Point = [300, 100];
		const CELL = 50;
		const holds = (at: Point, slack = 0) => templateHolds('ray', from, to, at, slack, CELL);
		expect(holds([200, 100])).toBe(true);
		expect(holds([200, 125])).toBe(true);
		expect(holds([200, 126])).toBe(false);
		expect(holds([99, 100])).toBe(false);
		expect(holds([301, 100])).toBe(false);
		expect(holds([301, 126], 1)).toBe(true);
		// It points any way: along a slant, the same holds.
		const slant: Point = [300, 300];
		expect(templateHolds('ray', from, slant, [200, 200], 0, CELL)).toBe(true);
		expect(templateHolds('ray', from, slant, [220, 180], 0, CELL)).toBe(false);
		expect(templateHolds('ray', from, slant, [210, 190], 0, CELL)).toBe(true);
		// The outline goes round its four corners, and the box around it takes them in.
		expect(templatePath('ray', from, to, CELL)).toBe('M100 125L300 125L300 75L100 75Z');
		expect(templateBox('ray', from, to, CELL)).toEqual({ x0: 100, x1: 300, y0: 75, y1: 125 });
		expect(templateSpan('ray', from, to)).toEqual([200]);
	});
});
