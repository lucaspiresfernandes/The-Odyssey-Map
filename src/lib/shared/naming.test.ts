import { describe, expect, test } from 'bun:test';
import { copyName, numberedNames } from './naming';
import { LIMITS } from './types';

describe('numbered names', () => {
	test('a name nobody has is kept', () => {
		expect(numberedNames(['Goblin'], [])).toEqual(['Goblin']);
		expect(numberedNames(['Goblin', 'Ogre'], ['Wolf'])).toEqual(['Goblin', 'Ogre']);
	});

	test('several of one name put down together count from one', () => {
		expect(numberedNames(['Goblin', 'Goblin', 'Ogre', 'Goblin'], [])).toEqual([
			'Goblin 1',
			'Goblin 2',
			'Ogre',
			'Goblin 3'
		]);
	});

	test('they go on from the highest number on the map', () => {
		expect(numberedNames(['Goblin', 'Goblin'], ['Goblin 1', 'Goblin 2', 'Goblin 3'])).toEqual([
			'Goblin 4',
			'Goblin 5'
		]);
		// One with no number is the first of them.
		expect(numberedNames(['Goblin', 'Goblin'], ['goblin'])).toEqual(['Goblin 2', 'Goblin 3']);
	});

	test('a single one whose name is taken gets the next number', () => {
		expect(numberedNames(['Goblin'], ['Goblin'])).toEqual(['Goblin 2']);
		expect(numberedNames(['Goblin'], ['Goblin', 'Goblin 7'])).toEqual(['Goblin 8']);
		// Its own number is no part of its name.
		expect(numberedNames(['Goblin 2'], ['Goblin 2'])).toEqual(['Goblin 3']);
	});

	test('a copy is always numbered, after everything of its name', () => {
		expect(copyName('Goblin', [])).toBe('Goblin 2');
		expect(copyName('Goblin', ['Goblin', 'Goblin 2'])).toBe('Goblin 3');
		expect(copyName('Goblin 2', ['Goblin', 'Goblin 2', 'Goblin 5'])).toBe('Goblin 6');
		expect(copyName('Room 12 guard', [])).toBe('Room 12 guard 2');
	});

	test('a long name is cut short to make room for its number', () => {
		const long = 'x'.repeat(LIMITS.tokenName);
		const copy = copyName(long, []);
		expect(copy.length).toBe(LIMITS.tokenName);
		expect(copy.endsWith(' 2')).toBe(true);
	});
});
