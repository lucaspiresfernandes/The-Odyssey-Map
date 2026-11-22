import { describe, expect, test } from 'bun:test';
import { DICE, isDie, rollDie } from './dice';

describe('dice', () => {
	test('a die is one of the seven the table has', () => {
		for (const sides of DICE) expect(isDie(sides)).toBe(true);
		for (const not of [0, 1, 7, 6.5, -6, '6', null, undefined, NaN, Infinity]) {
			expect(isDie(not)).toBe(false);
		}
	});

	test('a roll lands on a face of the die, and on every face in time', () => {
		for (const sides of DICE) {
			const seen = new Set<number>();
			for (let i = 0; i < sides * 60; i++) {
				const result = rollDie(sides);
				expect(Number.isInteger(result)).toBe(true);
				expect(result).toBeGreaterThanOrEqual(1);
				expect(result).toBeLessThanOrEqual(sides);
				seen.add(result);
			}
			expect(seen.size).toBe(sides);
		}
	});

	test('the lowest and the highest number drawn are the first and the last face', () => {
		expect(rollDie(20, () => 0)).toBe(1);
		// The last number of the stretch that divides evenly among twenty faces.
		const fair = Math.floor(2 ** 32 / 20) * 20;
		expect(rollDie(20, () => fair - 1)).toBe(20);
	});

	test('a number that would favour the low faces is drawn again', () => {
		// 2^32 is not a multiple of 6: its last four numbers would make 1 to 4 likelier.
		const drawn = [2 ** 32 - 1, 2 ** 32 - 4, 5];
		expect(rollDie(6, () => drawn.shift()!)).toBe(6);
		expect(drawn).toEqual([]);
	});
});
