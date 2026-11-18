import { expect, test } from 'bun:test';
import { cellBox, cleared, covered, fogPath, isFogged, without } from './fog';
import { DEFAULT_GRID, type Fog, type Rect } from './types';

/** 1000 by 500, in cells of 50 that start 10 in from the left. */
const map = { width: 1000, height: 500, grid: { ...DEFAULT_GRID, x: 10 } };

const area = (rects: Rect[]) =>
	rects.reduce((sum, [x0, y0, x1, y1]) => sum + (x1 - x0) * (y1 - y0), 0);

test('fog that is off covers nothing, and fog that is on covers all but what is cleared', () => {
	expect(isFogged({ on: false, clear: [] }, [0.5, 0.5])).toBe(false);
	expect(isFogged(undefined, [0.5, 0.5])).toBe(false);
	const fog: Fog = { on: true, clear: [[0, 0, 0.5, 1]] };
	expect(isFogged(fog, [0.25, 0.5])).toBe(false);
	expect(isFogged(fog, [0.75, 0.5])).toBe(true);
	// A token standing right on the edge of the clear is in it.
	expect(isFogged(fog, [0.5, 0.5])).toBe(false);
});

test('a hole cut out of a box leaves the pieces around it, and other boxes alone', () => {
	const whole: Rect = [0, 0, 1, 1];
	const apart: Rect = [2, 2, 3, 3];
	const left = without([whole, apart], [0.25, 0.25, 0.75, 0.75]);
	expect(left).toHaveLength(5);
	expect(left).toContainEqual(apart);
	expect(area(left)).toBeCloseTo(1 - 0.25 + 1);
	// A hole over all of it leaves nothing, and one that only touches its edge leaves it whole.
	expect(without([whole], [-1, -1, 2, 2])).toEqual([]);
	expect(without([whole], [1, 0, 2, 1])).toEqual([whole]);
});

test('clearing never leaves two boxes over the same ground', () => {
	let fog: Fog = { on: true, clear: [] };
	fog = cleared(fog, [0, 0, 0.6, 0.6]);
	fog = cleared(fog, [0.4, 0.4, 1, 1]);
	fog = cleared(fog, [0.2, 0.2, 0.8, 0.8]);
	// Were any two to overlap, their areas would add up to more than they cover:
	// two boxes of 0.36 sharing 0.04, and what the third adds between them.
	expect(area(fog.clear)).toBeCloseTo(0.36 + 0.36 - 0.04 + 0.08);
	expect(isFogged(fog, [0.9, 0.1])).toBe(true);
	expect(isFogged(fog, [0.5, 0.5])).toBe(false);
	// Fog that is off has nothing to clear.
	const off: Fog = { on: false, clear: [] };
	expect(cleared(off, [0, 0, 1, 1])).toBe(off);
});

test('covering a part of a map with no fog starts some, and leaves the rest clear', () => {
	const fog = covered({ on: false, clear: [] }, [0.5, 0, 1, 1]);
	expect(fog.on).toBe(true);
	expect(isFogged(fog, [0.75, 0.5])).toBe(true);
	expect(isFogged(fog, [0.25, 0.5])).toBe(false);
	// Covering what was cleared puts it back.
	expect(covered(cleared({ on: true, clear: [] }, [0, 0, 1, 1]), [0, 0, 1, 1]).clear).toEqual([]);
});

test('a dragged box grows to the cells it touches, or with Alt stays as dragged', () => {
	// From inside the second cell across to inside the fourth, and one cell down.
	expect(cellBox(map, [0.07, 0.12], [0.2, 0.18])).toEqual([0.06, 0.1, 0.21, 0.2]);
	// Dragged the other way round, it is the same box.
	expect(cellBox(map, [0.2, 0.18], [0.07, 0.12])).toEqual([0.06, 0.1, 0.21, 0.2]);
	// A click is the one cell under it.
	expect(cellBox(map, [0.07, 0.12], [0.07, 0.12])).toEqual([0.06, 0.1, 0.11, 0.2]);
	expect(cellBox(map, [0.07, 0.12], [0.2, 0.18], true)).toEqual([0.07, 0.12, 0.2, 0.18]);
	expect(cellBox(map, [0.07, 0.12], [0.07, 0.12], true)).toBeNull();
	// It stops at the edge of the map.
	expect(cellBox(map, [-0.5, -0.5], [0.001, 0.05])).toEqual([0, 0, 0.01, 0.1]);
	expect(cellBox(map, [1.2, 0.5], [1.5, 0.6])).toBeNull();
});

test('the fog is drawn as the whole map with a hole for each cleared box', () => {
	expect(fogPath({ on: true, clear: [[0, 0, 0.5, 1]] }, 1000, 500)).toBe(
		'M0 0H1000V500H0ZM0 0H500V500H0Z'
	);
});
