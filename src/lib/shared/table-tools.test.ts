// The arithmetic behind the turn order, the spell templates, the ruler of
// a world map and the road the party has taken.

import { describe, expect, test } from 'bun:test';
import { templateBox, templatePath, templateSpan } from './drawing';
import { milesBetween, milesCount, pixelsToFeet, snapToHalfCell, templatePoints } from './grid';
import { joinedTurns, nextTurn, previousTurn, reorderedTurns } from './turns';
import { MARK_LOOKS, TOKEN_MARK_IDS, turnsAmong, type Point, type Turns } from './types';

/** A map of twenty cells by ten, fifty pixels to the cell. */
const SHEET = { width: 1000, height: 500, grid: { size: 50, x: 0, y: 0, shown: true } };
const px = ([x, y]: Point): Point => [x * SHEET.width, y * SHEET.height];

describe('taking turns', () => {
	const turns = (current: string | null, round = 1): Turns => ({ order: ['a', 'b', 'c'], current, round });

	test('the first turn is the first token\'s, and the order comes round to a new round', () => {
		expect(nextTurn(turns(null), ['a', 'b', 'c'])).toEqual({ current: 'a', round: 1 });
		expect(nextTurn(turns('a'), ['a', 'b', 'c'])).toEqual({ current: 'b', round: 1 });
		expect(nextTurn(turns('c'), ['a', 'b', 'c'])).toEqual({ current: 'a', round: 2 });
	});

	test('a token that is off the map is passed over, and keeps its place', () => {
		expect(nextTurn(turns('a'), ['a', 'c'])).toEqual({ current: 'c', round: 1 });
		expect(nextTurn(turns('b'), ['a', 'b'])).toEqual({ current: 'a', round: 2 });
		// The one whose turn it was has gone: the fight goes on from where it stood.
		expect(nextTurn(turns('b'), ['a', 'c'])).toEqual({ current: 'c', round: 1 });
		expect(nextTurn(turns('a', 3), ['a'])).toEqual({ current: 'a', round: 4 });
		expect(nextTurn(turns('a'), [])).toBeNull();
		expect(nextTurn({ order: [], current: null, round: 1 }, ['a'])).toBeNull();
	});

	test('going back a turn is the way it came, to before the fight started', () => {
		expect(previousTurn(turns('b'), ['a', 'b', 'c'])).toEqual({ current: 'a', round: 1 });
		// Back over the top of the order is the round before.
		expect(previousTurn(turns('a', 2), ['a', 'b', 'c'])).toEqual({ current: 'c', round: 1 });
		expect(previousTurn(turns('a'), ['a', 'b', 'c'])).toEqual({ current: null, round: 1 });
		expect(previousTurn(turns(null), ['a', 'b', 'c'])).toBeNull();
		// A token that is off the map is passed over this way too.
		expect(previousTurn(turns('c'), ['a', 'c'])).toEqual({ current: 'a', round: 1 });
		expect(previousTurn(turns('b'), ['b', 'c'])).toEqual({ current: null, round: 1 });
		expect(previousTurn(turns('b', 3), ['b', 'c'])).toEqual({ current: 'c', round: 2 });
		expect(previousTurn(turns('a', 4), ['a'])).toEqual({ current: 'a', round: 3 });
		expect(previousTurn(turns('a'), [])).toBeNull();
		// It takes back what moving on did, wherever the fight stands.
		for (const from of [turns(null), turns('a'), turns('c'), turns('c', 5)]) {
			const { current, round } = from;
			const on = { ...from, ...nextTurn(from, ['a', 'b', 'c'])! };
			expect(previousTurn(on, ['a', 'b', 'c'])).toEqual({ current, round });
		}
	});

	test('the tokens that show are sorted by hand, and the rest keep their places', () => {
		expect(reorderedTurns(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
		expect(reorderedTurns(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
		// `b` is off the map: it is not there to be sorted, and stays second.
		expect(reorderedTurns(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'b', 'a']);
		expect(reorderedTurns(['a', 'b', 'c', 'd'], ['d', 'a'])).toEqual(['d', 'b', 'c', 'a']);
		// A token that isn't in the order is no part of it, however it was sorted.
		expect(reorderedTurns(['a', 'b'], ['x', 'b', 'a'])).toEqual(['b', 'a']);
	});

	test('tokens join at the end, once each', () => {
		expect(joinedTurns(['a', 'b'], ['b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
	});

	test('someone who sees only some tokens is shown only those', () => {
		expect(turnsAmong(turns('b', 2), ['a', 'c'])).toEqual({ order: ['a', 'c'], current: null, round: 2 });
		expect(turnsAmong(turns('b', 2), ['a', 'b'])).toEqual({ order: ['a', 'b'], current: 'b', round: 2 });
	});
});

describe('marks', () => {
	test('there is one to cross a token out, six plain colours, and the rest are icons', () => {
		expect(TOKEN_MARK_IDS[0]).toBe('down');
		expect(new Set(TOKEN_MARK_IDS).size).toBe(TOKEN_MARK_IDS.length);
		const plain = MARK_LOOKS.filter((look) => !look.icon && look.id !== 'down');
		const icons = MARK_LOOKS.filter((look) => look.icon);
		expect(plain).toHaveLength(6);
		expect(icons.length).toBeGreaterThanOrEqual(12);
		// Every icon is a path that starts somewhere, in a colour of its own to draw it in.
		for (const look of icons) {
			expect(look.icon).toMatch(/^M[\d.]/);
			expect(look.color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

describe('shapes', () => {
	test('one starts on the grid and is a whole number of cells long', () => {
		// The corner of a cell, its middle, or the middle of one of its sides.
		expect(snapToHalfCell(SHEET, [0.262, 0.31])).toEqual([0.25, 0.3]);
		expect(snapToHalfCell(SHEET, [0.268, 0.33])).toEqual([0.275, 0.35]);

		const [a, b] = templatePoints(SHEET, 'circle', [0.262, 0.31], [0.36, 0.3]);
		expect(a).toEqual([0.25, 0.3]);
		// Dragged 110 pixels from where it starts: that is two cells.
		expect(templateSpan('circle', px(a), px(b))[0]).toBeCloseTo(100);

		// A press that goes nowhere is still a cell big, so it can be seen.
		const [c, d] = templatePoints(SHEET, 'circle', [0.5, 0.5], [0.5, 0.5]);
		expect(templateSpan('circle', px(c), px(d))[0]).toBeCloseTo(50);
	});

	test('with Alt held it is exactly as dragged', () => {
		expect(templatePoints(SHEET, 'cone', [0.262, 0.31], [0.4, 0.5], true)).toEqual([[0.262, 0.31], [0.4, 0.5]]);
		expect(templatePoints(SHEET, 'rect', [0.262, 0.31], [1.4, -0.2], true)).toEqual([[0.262, 0.31], [1, 0]]);
	});

	test('a box runs from the corner of one cell to the corner of another', () => {
		expect(templatePoints(SHEET, 'rect', [0.262, 0.31], [0.41, 0.52])).toEqual([[0.25, 0.3], [0.4, 0.5]]);
	});

	test('both its points stay on the map', () => {
		// A circle near the right edge keeps a spot of its rim that is on the map.
		const [a, b] = templatePoints(SHEET, 'circle', [0.95, 0.5], [1.3, 0.5]);
		expect(b[0]).toBeGreaterThanOrEqual(0);
		expect(b[0]).toBeLessThanOrEqual(1);
		expect(templateSpan('circle', px(a), px(b))[0]).toBeCloseTo(350);

		// A cone pointing off the map is as long as the map lets it be.
		const [tip, end] = templatePoints(SHEET, 'cone', [0.9, 0.5], [1.5, 0.5]);
		expect(tip).toEqual([0.9, 0.5]);
		expect(end).toEqual([1, 0.5]);
	});

	test('a cone is as wide at its far end as it is long', () => {
		const box = templateBox('cone', [100, 100], [200, 100]);
		expect(box).toEqual({ x0: 100, x1: 200, y0: 50, y1: 150 });
		expect(templatePath('cone', [100, 100], [200, 100])).toBe('M100 100L200 150L200 50Z');
	});

	test('a circle and a box are drawn around what they cover', () => {
		expect(templateBox('circle', [100, 100], [100, 140])).toEqual({ x0: 60, x1: 140, y0: 60, y1: 140 });
		expect(templatePath('circle', [100, 100], [100, 140])).toBe('M60 100a40 40 0 1 0 80 0a40 40 0 1 0 -80 0Z');
		expect(templateBox('rect', [200, 50], [100, 150])).toEqual({ x0: 100, x1: 200, y0: 50, y1: 150 });
		expect(templatePath('rect', [100, 50], [200, 150])).toBe('M100 50H200V150H100Z');
		expect(templateSpan('rect', [100, 50], [200, 200])).toEqual([100, 150]);
	});

	test('its size is told in feet at the scale of the map', () => {
		expect(pixelsToFeet({ grid: SHEET.grid, cellFeet: 5 }, 200)).toBe(20);
		expect(pixelsToFeet({ grid: SHEET.grid, cellFeet: 8 }, 75)).toBe(12);
	});
});

describe('the ruler of a world map', () => {
	test('it measures as the crow flies, whatever the shape of the map', () => {
		// A thousand miles across, and half as tall as it is wide.
		expect(milesBetween(SHEET, 1000, [0, 0.5], [1, 0.5])).toBeCloseTo(1000);
		expect(milesBetween(SHEET, 1000, [0.5, 0], [0.5, 1])).toBeCloseTo(500);
		expect(milesBetween(SHEET, 1000, [0, 0], [0.3, 0.8])).toBeCloseTo(500);
	});

	test('a distance is told as finely as it is worth telling', () => {
		expect(milesCount(0.44)).toBe('0.4 mi');
		expect(milesCount(7.46)).toBe('7.5 mi');
		expect(milesCount(120.4)).toBe('120 mi');
		expect(milesCount(12345.6)).toBe('12,346 mi');
	});
});