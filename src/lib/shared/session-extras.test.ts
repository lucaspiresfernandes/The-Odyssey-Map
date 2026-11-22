// The arithmetic behind a few things a session is run with: how long the
// way takes, a ruler with bends in it, fog covered by hand on a world map,
// whose turn is whose to end, and the address an invite is made out to.

import { describe, expect, test } from 'bun:test';
import { inviteAddress, type Invite } from '../client/invite';
import { boxed, isFogged } from './fog';
import { feetAlong, milesAlong, milesBetween, travelTime } from './grid';
import { canEndTurn } from './rules';
import { DEFAULT_GRID, type Point } from './types';

describe('a ruler along a road', () => {
	const sheet = { width: 2000, height: 1000 };

	test('every stretch of it is added up', () => {
		const road: Point[] = [
			[0, 0],
			[0.5, 0],
			[0.5, 0.5]
		];
		// A map 200 miles across and half as tall: half way across, then a quarter of that width down.
		expect(milesAlong(sheet, 200, road)).toBeCloseTo(100 + 50);
		expect(milesAlong(sheet, 200, road.slice(0, 2))).toBeCloseTo(milesBetween(sheet, 200, road[0], road[1]));
		expect(milesAlong(sheet, 200, [road[0]])).toBe(0);
	});

	test('on a battle map each stretch is counted in cells', () => {
		const map = { width: 1000, height: 1000, grid: { ...DEFAULT_GRID, size: 50 }, cellFeet: 5 };
		// Four cells along, then three down: a diagonal would have been four.
		expect(feetAlong(map, [[0, 0], [0.2, 0], [0.2, 0.15]])).toBe(35);
	});
});

describe('how long the way takes', () => {
	test('short of a day it is told in hours on the road', () => {
		expect(travelTime(1, 24)).toBe('under an hour');
		expect(travelTime(3, 24)).toBe('about an hour');
		expect(travelTime(12, 24)).toBe('about 4 hours');
	});

	test('beyond that in days, to the half, and past ten to the whole', () => {
		expect(travelTime(23, 24)).toBe('about a day');
		expect(travelTime(24, 24)).toBe('about a day');
		expect(travelTime(36, 24)).toBe('about 1½ days');
		expect(travelTime(84, 24)).toBe('about 3½ days');
		expect(travelTime(72, 24)).toBe('about 3 days');
		expect(travelTime(300, 24)).toBe('about 13 days');
		// A slower pace makes a longer way of the same miles.
		expect(travelTime(84, 12)).toBe('about 7 days');
	});

	test('no way at all takes no time to tell', () => {
		expect(travelTime(0, 24)).toBe('');
	});
});

describe('fog covered by hand', () => {
	test('covering a part of what was cleared leaves the rest of it in the clear', () => {
		const fog = boxed({ on: true, clear: [[0, 0, 1, 1]] }, [0, 0, 0.5, 1], true);
		expect(isFogged(fog, [0.25, 0.5])).toBe(true);
		expect(isFogged(fog, [0.75, 0.5])).toBe(false);
	});
});

describe('whose turn it is to end', () => {
	test('the GM ends any, a player their own and what is nobody\'s', () => {
		expect(canEndTurn('gm', 'gm', { ownerId: 'mira' })).toBe(true);
		expect(canEndTurn('player', 'mira', { ownerId: 'mira' })).toBe(true);
		expect(canEndTurn('player', 'tovin', { ownerId: 'mira' })).toBe(false);
		expect(canEndTurn('player', 'tovin', { ownerId: null })).toBe(true);
		// A token from before any could be someone's.
		expect(canEndTurn('player', 'tovin', {})).toBe(true);
	});
});

describe('the address of an invite', () => {
	const invite: Invite = { path: '/join/abc', origins: [], hosts: ['192.168.1.20', '172.20.0.1'] };
	const local = { origin: 'http://localhost:3000', hostname: 'localhost', protocol: 'http:', port: '3000' };

	test('a browser on the machine itself makes it out to the machine\'s address on the network', () => {
		expect(inviteAddress(invite, local)).toMatchObject({
			url: 'http://192.168.1.20:3000/join/abc',
			host: '192.168.1.20',
			local: false
		});
		// The one the GM picked, as long as the machine still has it.
		expect(inviteAddress(invite, local, '172.20.0.1').url).toBe('http://172.20.0.1:3000/join/abc');
		expect(inviteAddress(invite, local, '10.9.9.9').host).toBe('192.168.1.20');
	});

	test('a browser already on an address others can reach uses that', () => {
		const lan = { origin: 'http://192.168.1.20:3000', hostname: '192.168.1.20', protocol: 'http:', port: '3000' };
		expect(inviteAddress(invite, lan)).toMatchObject({ url: 'http://192.168.1.20:3000/join/abc', hosts: [] });
	});

	test('a public address comes first, and with no way in the link is said to be local', () => {
		const hosted = { ...invite, origins: ['https://maps.example.com'] };
		expect(inviteAddress(hosted, local).url).toBe('https://maps.example.com/join/abc');
		expect(inviteAddress({ ...invite, hosts: [] }, local)).toMatchObject({
			url: 'http://localhost:3000/join/abc',
			local: true
		});
	});
});
