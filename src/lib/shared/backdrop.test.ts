import { describe, expect, test } from 'bun:test';
import { boxAround, boxWithin, frameOf, partOf } from './backdrop';
import type { Point } from './types';

const image = { file: 'a-b.png', width: 4000, height: 3000 };

describe('the part of an image under a region', () => {
	test('is the box around its corners', () => {
		const triangle: Point[] = [
			[0.5, 0.2],
			[0.7, 0.6],
			[0.3, 0.4]
		];
		expect(boxAround(triangle)).toEqual([0.3, 0.2, 0.7, 0.6]);
		expect(partOf(image, boxAround(triangle))).toEqual({ ...image, x: 1200, y: 600, w: 1600, h: 1200 });
	});

	test('a region inside a region is a part of that part', () => {
		// The right half of the lower half.
		const box = boxWithin([0, 0.5, 1, 1], [0.5, 0, 1, 1]);
		expect(box).toEqual([0.5, 0.5, 1, 1]);
		expect(partOf(image, box)).toMatchObject({ x: 2000, y: 1500, w: 2000, h: 1500 });
	});

	test('less than a pixel of picture is no picture', () => {
		expect(partOf(image, [0.2, 0.2, 0.2001, 0.6])).toBeNull();
		expect(partOf(image, [0.2, 0.2, 0.6, 0.2])).toBeNull();
		expect(partOf(image, [0.2, 0.2, 0.201, 0.201])).not.toBeNull();
	});
});

describe('the size of a map with a borrowed picture', () => {
	test('a big part is shown at its own size', () => {
		expect(frameOf({ w: 2400, h: 1800.5 })).toEqual({ width: 2400, height: 1800, scale: 1 });
		expect(frameOf({ w: 900, h: 1600 })).toEqual({ width: 900, height: 1600, scale: 1 });
	});

	test('a small one is blown up to the width of a map', () => {
		expect(frameOf({ w: 400, h: 100 })).toEqual({ width: 1600, height: 400, scale: 4 });
		expect(frameOf({ w: 100, h: 200 })).toEqual({ width: 800, height: 1600, scale: 8 });
	});

	test('a sliver still has a size', () => {
		expect(frameOf({ w: 1600, h: 0.2 })).toMatchObject({ width: 1600, height: 1 });
	});
});
