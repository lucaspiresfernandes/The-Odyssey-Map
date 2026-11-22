import { expect, test } from 'bun:test';
import {
	boxed,
	brushMarks,
	brushReach,
	brushSize,
	fogOf,
	isFogged,
	marked,
	stampPath,
	sweepPath
} from './fog';
import { FOG_BRUSH, LIMITS, type Fog, type FogMark, type Point } from './types';

/** Twice as wide as it is tall: a brush that is round on it is twice as tall as wide in map space. */
const map = { width: 1000, height: 500 };

const fogged: Fog = { on: true, clear: [] };

test('fog that is off covers nothing, and fog that is on covers all but what is cleared', () => {
	expect(isFogged({ on: false, clear: [] }, [0.5, 0.5])).toBe(false);
	expect(isFogged(undefined, [0.5, 0.5])).toBe(false);
	const fog: Fog = { on: true, clear: [[0, 0, 0.5, 1]] };
	expect(isFogged(fog, [0.25, 0.5])).toBe(false);
	expect(isFogged(fog, [0.75, 0.5])).toBe(true);
	// A token standing right on the edge of the clear is in it.
	expect(isFogged(fog, [0.5, 0.5])).toBe(false);
});

test('a spot is under the fog or not by the last mark made over it', () => {
	let fog = boxed(fogged, [0, 0, 0.6, 0.6]);
	expect(isFogged(fog, [0.5, 0.5])).toBe(false);
	fog = boxed(fog, [0.4, 0.4, 1, 1], true);
	expect(isFogged(fog, [0.5, 0.5])).toBe(true);
	expect(isFogged(fog, [0.2, 0.2])).toBe(false);
	fog = boxed(fog, [0.45, 0.45, 0.55, 0.55]);
	expect(isFogged(fog, [0.5, 0.5])).toBe(false);
	expect(isFogged(fog, [0.9, 0.9])).toBe(true);
	// Fog that is off has nothing to clear.
	const off: Fog = { on: false, clear: [] };
	expect(boxed(off, [0, 0, 1, 1])).toBe(off);
	expect(marked(off, brushMarks(false, [[0.5, 0.5]], map, 0.1))).toBe(off);
});

test('covering a part of a map with no fog starts some, and leaves the rest clear', () => {
	const fog = boxed({ on: false, clear: [] }, [0.5, 0, 1, 1], true);
	expect(fog.on).toBe(true);
	expect(isFogged(fog, [0.75, 0.5])).toBe(true);
	expect(isFogged(fog, [0.25, 0.5])).toBe(false);
	// The brush starts it the same way.
	const painted = marked({ on: false, clear: [] }, brushMarks(true, [[0.5, 0.5]], map, 0.1));
	expect(isFogged(painted, [0.5, 0.5])).toBe(true);
	expect(isFogged(painted, [0.1, 0.1])).toBe(false);
});

test('a box forgets the marks made inside it, and no others', () => {
	let fog = boxed(fogged, [0.4, 0.4, 0.6, 0.6]);
	fog = marked(fog, brushMarks(false, [[0.5, 0.5]], map, 0.02));
	fog = boxed(fog, [0.1, 0.1, 0.2, 0.2]);
	// A sweep that goes on past the edge of the box to come.
	const [across] = brushMarks(false, [[0.5, 0.5], [0.9, 0.5]], map, 0.02);
	fog = marked(fog, [across]);
	expect(fog.marks).toHaveLength(4);

	fog = boxed(fog, [0.3, 0.3, 0.7, 0.7], true);
	expect(fog.marks).toEqual([
		{ cover: false, box: [0.1, 0.1, 0.2, 0.2] },
		across,
		{ cover: true, box: [0.3, 0.3, 0.7, 0.7] }
	]);
	expect(isFogged(fog, [0.5, 0.5])).toBe(true);
	expect(isFogged(fog, [0.8, 0.5])).toBe(false);
});

test('the brush is round on the picture of the map, whatever shape the map is', () => {
	expect(brushReach(map, 0.1)).toEqual([0.1, 0.2]);
	expect(brushReach({ width: 500, height: 1000 }, 0.1)).toEqual([0.2, 0.1]);
	expect(brushSize(5)).toBe(FOG_BRUSH.max);
	expect(brushSize(0)).toBe(FOG_BRUSH.min);

	// A dab of it: 100 pixels each way, a tenth of the width and a fifth of the height.
	const fog = marked(fogged, brushMarks(false, [[0.5, 0.5]], map, 0.1));
	expect(isFogged(fog, [0.59, 0.5])).toBe(false);
	expect(isFogged(fog, [0.61, 0.5])).toBe(true);
	expect(isFogged(fog, [0.5, 0.69])).toBe(false);
	expect(isFogged(fog, [0.5, 0.71])).toBe(true);
	// The corner of the box around it is outside it.
	expect(isFogged(fog, [0.58, 0.66])).toBe(true);
});

test('a sweep clears all along the way it went, with round ends, and nothing beside it', () => {
	const marks = brushMarks(
		false,
		[
			[0.2, 0.5],
			[0.5, 0.5],
			[0.8, 0.5]
		],
		map,
		0.05
	);
	// The spot in the middle of a straight sweep says nothing the ends don't.
	expect(marks).toEqual([
		{
			cover: false,
			path: [
				[0.2, 0.5],
				[0.8, 0.5]
			],
			r: [0.05, 0.1]
		}
	]);
	const fog = marked(fogged, marks);
	expect(isFogged(fog, [0.5, 0.59])).toBe(false);
	expect(isFogged(fog, [0.5, 0.61])).toBe(true);
	expect(isFogged(fog, [0.84, 0.5])).toBe(false);
	expect(isFogged(fog, [0.86, 0.5])).toBe(true);

	// Swept across it the other way with the fog, it is cut in two.
	const cut = marked(fog, brushMarks(true, [[0.5, 0.2], [0.5, 0.8]], map, 0.05));
	expect(isFogged(cut, [0.5, 0.5])).toBe(true);
	expect(isFogged(cut, [0.3, 0.5])).toBe(false);
	expect(isFogged(cut, [0.7, 0.5])).toBe(false);
});

test('a long sweep is kept as several marks that join up, and all of it on the map', () => {
	const spots = LIMITS.fogPath * 2;
	const zigzag = Array.from({ length: spots }, (_, i): Point => [0.1 + (0.8 * i) / spots, i % 2 ? 0.3 : 0.7]);
	const marks = brushMarks(false, zigzag, map, 0.01) as Extract<FogMark, { path: Point[] }>[];
	expect(marks).toHaveLength(3);
	expect(marks.every((mark) => mark.path.length <= LIMITS.fogPath)).toBe(true);
	expect(marks[1].path[0]).toEqual(marks[0].path.at(-1)!);
	expect(marks[2].path[0]).toEqual(marks[1].path.at(-1)!);
	expect(marks[2].path.at(-1)![1]).toBe(0.3);

	expect(brushMarks(true, [[-0.5, 2]], map, 0.05)[0]).toMatchObject({ path: [[0, 1]] });
	expect(brushMarks(false, [], map, 0.05)).toEqual([]);
});

test('a square brush is square on the picture of the map, corners and all', () => {
	// A dab of it: 100 pixels each way, like the round one.
	const marks = brushMarks(false, [[0.5, 0.5]], map, 0.1, true);
	expect(marks).toEqual([{ cover: false, path: [[0.5, 0.5]], r: [0.1, 0.2], square: true }]);
	const fog = marked(fogged, marks);
	expect(isFogged(fog, [0.59, 0.5])).toBe(false);
	expect(isFogged(fog, [0.61, 0.5])).toBe(true);
	expect(isFogged(fog, [0.5, 0.69])).toBe(false);
	expect(isFogged(fog, [0.5, 0.71])).toBe(true);
	// The corner the round brush leaves in the fog.
	expect(isFogged(fog, [0.58, 0.66])).toBe(false);
	expect(isFogged(fog, [0.61, 0.71])).toBe(true);
	// A round brush says nothing of being one.
	expect('square' in brushMarks(false, [[0.5, 0.5]], map, 0.1)[0]).toBe(false);
});

test('a square brush clears what it went over on a slant, with its sides kept level', () => {
	// On a square map, from the upper left to the lower right, 0.1 each way from its middle.
	const square = { width: 1000, height: 1000 };
	const marks = brushMarks(false, [[0.3, 0.3], [0.7, 0.7]], square, 0.1, true);
	const fog = marked(fogged, marks);
	// The square at either end, to its corners.
	expect(isFogged(fog, [0.21, 0.21])).toBe(false);
	expect(isFogged(fog, [0.19, 0.3])).toBe(true);
	expect(isFogged(fog, [0.79, 0.79])).toBe(false);
	expect(isFogged(fog, [0.79, 0.61])).toBe(false);
	expect(isFogged(fog, [0.81, 0.7])).toBe(true);
	// Half way along: 0.2 to either side of the way, across or down, and no further.
	expect(isFogged(fog, [0.69, 0.5])).toBe(false);
	expect(isFogged(fog, [0.71, 0.5])).toBe(true);
	expect(isFogged(fog, [0.5, 0.31])).toBe(false);
	expect(isFogged(fog, [0.5, 0.29])).toBe(true);
	// Beside the way, off the corners it did not drag along.
	expect(isFogged(fog, [0.75, 0.25])).toBe(true);
	expect(isFogged(fog, [0.25, 0.75])).toBe(true);

	// Swept back the other way with the fog, it covers the same again.
	const back = marked(fog, brushMarks(true, [[0.7, 0.7], [0.3, 0.3]], square, 0.1, true));
	for (const spot of [[0.21, 0.21], [0.79, 0.61], [0.69, 0.5], [0.5, 0.31]] as Point[]) {
		expect(isFogged(back, spot)).toBe(true);
	}
});

test('fog is kept with its marks only where it has some', () => {
	expect('marks' in fogOf({ on: true, clear: [], marks: [] })).toBe(false);
	const mark: FogMark = { cover: false, box: [0, 0, 0.5, 0.5] };
	expect(fogOf({ on: true, clear: [], marks: [mark] })).toEqual({ on: true, clear: [], marks: [mark] });
});

test('a sweep is drawn as a line measured in brushes, and a dab as a dot', () => {
	const sweep = {
		cover: false,
		path: [
			[0.2, 0.5],
			[0.8, 0.5]
		] as Point[],
		r: [0.05, 0.1] as [number, number]
	};
	expect(sweepPath(sweep)).toBe('M4 5L16 5');
	expect(sweepPath({ cover: false, path: [[0.5, 0.5]], r: [0.1, 0.2] })).toBe('M5 2.5h0');
});

test('what a square brush went over is drawn as shapes that all go round the same way', () => {
	const r: [number, number] = [0.1, 0.1];
	// A dab is the square itself.
	expect(stampPath({ cover: false, path: [[0.5, 0.5]], r, square: true })).toBe(
		'M4 4L6 4L6 4L6 6L4 6L4 6Z'
	);
	// Down to the right, then down to the left: a shape for each stretch.
	const path: Point[] = [
		[0.2, 0.2],
		[0.5, 0.4],
		[0.3, 0.8]
	];
	const shapes = stampPath({ cover: false, path, r, square: true }).split('Z').filter(Boolean);
	expect(shapes[0]).toBe('M1 1L3 1L6 3L6 5L4 5L1 3');
	expect(shapes).toHaveLength(2);
	// Twice the area inside each, by its corners in turn: the same sign for both.
	const turns = shapes.map((shape) => {
		const corners = shape
			.slice(1)
			.split('L')
			.map((each) => each.split(' ').map(Number));
		return corners.reduce((sum, [x, y], i) => {
			const [nx, ny] = corners[(i + 1) % corners.length];
			return sum + x * ny - nx * y;
		}, 0);
	});
	expect(turns[0]).toBeGreaterThan(0);
	expect(turns[1]).toBeGreaterThan(0);
});
