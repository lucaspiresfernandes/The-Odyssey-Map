import { describe, expect, test } from 'bun:test';
import { KEY, PEN_KEYS, SHEET, ariaKey, chord, keyLabel } from './keys.ts';

describe('chord', () => {
	test('a letter is its capital, whatever Shift and Caps Lock say', () => {
		expect(chord({ key: 'h' })).toBe('H');
		expect(chord({ key: 'H' })).toBe('H');
		expect(chord({ key: 'H', shiftKey: true })).toBe('Shift+H');
		expect(chord({ key: 'h', shiftKey: true })).toBe('Shift+H');
	});

	test('a sign that takes Shift to type is that sign and no more', () => {
		expect(chord({ key: '?', shiftKey: true })).toBe('?');
		expect(chord({ key: '#', shiftKey: true })).toBe('#');
		expect(chord({ key: '+', shiftKey: true })).toBe('+');
		expect(chord({ key: '+' })).toBe('+');
	});

	test('Ctrl and the Command key are one', () => {
		expect(chord({ key: 'z', ctrlKey: true })).toBe('Ctrl+Z');
		expect(chord({ key: 'z', metaKey: true })).toBe('Ctrl+Z');
		expect(chord({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z');
	});

	test('named keys keep their modifiers', () => {
		expect(chord({ key: 'ArrowUp', altKey: true })).toBe('Alt+ArrowUp');
		expect(chord({ key: 'Enter', shiftKey: true })).toBe('Shift+Enter');
		expect(chord({ key: 'Escape' })).toBe('Escape');
	});

	test('a sign typed with AltGr is not a Ctrl+Alt chord', () => {
		const altGr = { ctrlKey: true, altKey: true, getModifierState: (k: string) => k === 'AltGraph' };
		expect(chord({ key: '/', ...altGr })).toBe('/');
		expect(chord({ key: '?', ...altGr })).toBe('?');
	});

	test('another alphabet has its letters where they were', () => {
		expect(chord({ key: 'р', code: 'KeyH' })).toBe('H');
		expect(chord({ key: 'ç', code: 'Semicolon' })).toBe('ç');
	});
});

describe('how a key is shown', () => {
	test('to people', () => {
		expect(keyLabel('Alt+ArrowUp')).toBe('Alt+↑');
		expect(keyLabel('Escape')).toBe('Esc');
		expect(keyLabel('Shift+H')).toBe('Shift+H');
		expect(keyLabel('q')).toBe('Q');
		expect(keyLabel('+')).toBe('+');
	});

	test('to screen readers', () => {
		expect(ariaKey('Ctrl+Shift+Z')).toBe('Control+Shift+Z');
		expect(ariaKey('+')).toBe('Plus');
		expect(ariaKey('N')).toBe('N');
	});
});

describe('the table of keys', () => {
	test('every key is on the sheet', () => {
		const shown = new Set(SHEET.flatMap((section) => section.rows.flatMap((row) => row.keys)));
		for (const [name, key] of Object.entries(KEY)) {
			expect(shown.has(key), `${name} (${key}) is missing from the sheet`).toBe(true);
		}
	});

	// Keys that mean one thing on a world map and another on a battle map, or
	// one thing with a tool in hand and another with something selected.
	const SHARED: Record<string, string[]> = {
		N: ['nextTurn', 'note'],
		R: ['pen', 'region'],
		M: ['marks', 'marker'],
		G: ['mine', 'move'],
		C: ['ink', 'count'],
		// The fog's brush for the GM with the fog in hand, the letters of a text otherwise.
		'[': ['brushSmaller', 'textSmaller'],
		']': ['brushBigger', 'textBigger']
	};

	test('no key does two things in one place', () => {
		const owners = new Map<string, string[]>();
		for (const [name, key] of Object.entries(KEY)) {
			owners.set(key, [...(owners.get(key) ?? []), name]);
		}
		for (const [key, names] of owners) {
			if (names.length > 1) expect(names.sort()).toEqual(SHARED[key]?.sort());
		}
		for (const key of PEN_KEYS) expect(owners.has(key)).toBe(false);
	});
});
