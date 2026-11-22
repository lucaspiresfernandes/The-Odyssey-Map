// The fog of war of the battle maps.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, registerUser } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { getMapSnapshot } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, perform, performReceived, type Actor } from './world';
import type { Fog, FogMark, Point, Rect, Region, StoredEvent, Token } from '../shared/types';
import type { CommandOf } from '../shared/types';

let db: Db;
let gm: Actor;
let player: Actor;
let mapId: string;

const SQUARE: Point[] = [
	[0.1, 0.1],
	[0.4, 0.1],
	[0.4, 0.4],
	[0.1, 0.4]
];

beforeEach(async () => {
	db = openDb(':memory:');
	const owner = await registerUser(db, 'keeper', 'correct horse battery');
	const campaign = createCampaign(db, owner, 'The Sunless Reach');
	const guest = createGuest(db, 'Mira');
	joinCampaign(db, campaign.id, guest.id);
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	player = actorFor(guest, getMembership(db, campaign.id, guest.id)!);
	mapId = campaign.rootMapId;
});

function refusal(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		if (err instanceof ActionError) return err.code;
		throw err;
	}
	return 'allowed';
}

/** Draws a region on a map and returns it. */
function draw(name: string, on = mapId, extra: Partial<CommandOf<'region.create'>> = {}): Region {
	const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
	return events[1].after as Region;
}

const sees = (id: string, role: 'gm' | 'player' = 'player') =>
	getMapSnapshot(db, gm.campaignId, id, role)!;

/** Everything a player's browser would be sent for these events. */
const sentToPlayer = (events: StoredEvent[]) =>
	JSON.stringify(events.map((e) => toLiveEvent(db, e, 'player')).filter(Boolean));

describe('fog of war', () => {
	/** A battle map behind a region of the first map. */
	const battlefield = () => draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;

	function token(by: Actor, on: string, x: number, y: number, name = 'Goblin'): Token {
		return perform(db, by, { t: 'token.create', mapId: on, name, x, y })[0].after as Token;
	}

	const fogOver = (id: string, fog: Partial<Fog>) => perform(db, gm, { t: 'map.update', id, fog });
	/** The same, with fog that is no fog at all: what a browser gone wrong might send. */
	const fogSent = (id: string, fog: unknown) => performReceived(db, gm, { t: 'map.update', id, fog });
	const names = (tokens: Token[]) => tokens.map((t) => t.name).sort();
	/** The left half of a map, and the right. */
	const LEFT: Rect = [0, 0, 0.5, 1];
	const RIGHT: Rect = [0.5, 0, 1, 1];

	test('a map has none until the GM covers it', () => {
		const id = battlefield();
		expect(sees(id).map.fog).toEqual({ on: false, clear: [] });
		token(gm, id, 0.25, 0.5);
		expect(sees(id).tokens).toHaveLength(1);

		fogOver(id, { on: true });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [] });
		expect(sees(id).tokens).toHaveLength(0);
		// The same again changes nothing, and so is no event.
		expect(fogOver(id, { on: true })).toHaveLength(0);
	});

	test('what stands under it reaches the GM only', () => {
		const id = battlefield();
		const near = token(gm, id, 0.25, 0.5, 'Near');
		const far = token(gm, id, 0.75, 0.5, 'SECRET far');
		fogOver(id, { on: true, clear: [LEFT] });

		expect(names(sees(id).tokens)).toEqual(['Near']);
		expect(names(sees(id, 'gm').tokens)).toEqual(['Near', 'SECRET far']);
		expect(JSON.stringify(sees(id))).not.toContain('SECRET');

		// Nothing done to it under there reaches a player, and to a player it isn't there to act on.
		const events = perform(db, gm, { t: 'token.update', id: far.id, changes: { name: 'SECRET ogre', y: 0.6 } });
		expect(sentToPlayer(events)).toBe('[]');
		expect(refusal(() => perform(db, player, { t: 'token.update', id: far.id, changes: { x: 0.2 } }))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'token.duplicate', id: far.id }))).toBe('not_found');
		// One in the clear is theirs to move as ever.
		expect(perform(db, player, { t: 'token.update', id: near.id, changes: { y: 0.3 } })).toHaveLength(1);
	});

	test('a token coming out of it looks like one being added, and going under like one taken away', () => {
		const id = battlefield();
		const scout = token(gm, id, 0.75, 0.5, 'Scout');
		fogOver(id, { on: true, clear: [LEFT] });

		const [out] = perform(db, gm, { t: 'token.update', id: scout.id, changes: { x: 0.25 } });
		const shown = toLiveEvent(db, out, 'player')!.patch;
		expect(shown.t === 'token.upsert' && shown.token.x).toBe(0.25);
		const [back] = perform(db, gm, { t: 'token.update', id: scout.id, changes: { x: 0.75 } });
		expect(toLiveEvent(db, back, 'player')!.patch).toEqual({ t: 'token.remove', id: scout.id, mapId: id });
		// The GM is sent it as it is, both times.
		expect(toLiveEvent(db, back, 'gm')!.patch.t).toBe('token.upsert');
	});

	test('fog that moves tells the players which tokens they see now', () => {
		const id = battlefield();
		token(gm, id, 0.25, 0.5, 'Near');
		token(gm, id, 0.75, 0.5, 'Far');
		const lurker = token(gm, id, 0.75, 0.9, 'Lurker');
		perform(db, gm, { t: 'token.update', id: lurker.id, changes: { hidden: true } });

		const [covered] = fogOver(id, { on: true, clear: [LEFT] });
		const first = toLiveEvent(db, covered, 'player')!.patch;
		expect(first.t === 'map.upsert' && names(first.tokens!)).toEqual(['Near']);
		// The GM sees through it, and is sent the map alone.
		expect(toLiveEvent(db, covered, 'gm')!.patch).not.toHaveProperty('tokens');

		// Clearing the rest shows what was under it, but never what is hidden besides.
		const [lifted] = fogOver(id, { clear: [LEFT, RIGHT] });
		const second = toLiveEvent(db, lifted, 'player')!.patch;
		expect(second.t === 'map.upsert' && names(second.tokens!)).toEqual(['Far', 'Near']);
		// A change to anything else about the map brings no tokens along.
		const [renamed] = perform(db, gm, { t: 'map.update', id, name: 'The Long Bridge' });
		expect(toLiveEvent(db, renamed, 'player')!.patch).not.toHaveProperty('tokens');
	});

	test('a player puts a token only where they can see', () => {
		const id = battlefield();
		const mine = token(player, id, 0.25, 0.5, 'Mira');
		fogOver(id, { on: true, clear: [LEFT] });

		expect(refusal(() => perform(db, player, { t: 'token.update', id: mine.id, changes: { x: 0.75 } }))).toBe('conflict');
		expect(refusal(() => token(player, id, 0.75, 0.5))).toBe('conflict');
		expect(token(player, id, 0.3, 0.3)).toMatchObject({ x: 0.3 });
		// Turning it where it stands is not a move.
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { rotation: 90 } })).toHaveLength(1);
		// The GM puts them anywhere: that is how one goes into hiding.
		expect(perform(db, gm, { t: 'token.update', id: mine.id, changes: { x: 0.75 } })).toHaveLength(1);
		expect(names(sees(id).tokens)).toEqual(['Goblin']);
	});

	test('it is for the GM, and malformed fog is refused', () => {
		const id = battlefield();
		expect(refusal(() => perform(db, player, { t: 'map.update', id, fog: { on: true } }))).toBe('forbidden');
		const malformed = [
			{ on: 'yes' },
			{ clear: 'all' },
			{ clear: [[0, 0, 1]] },
			{ clear: [[0.5, 0, 0.2, 1]] },
			{ clear: [[0, 0, 2, 1]] },
			'thick'
		];
		for (const fog of malformed) expect(refusal(() => fogSent(id, fog))).toBe('invalid');
		const pieces = Array.from({ length: 401 }, (_, i): Rect => [i / 500, 0, (i + 1) / 500, 1]);
		expect(refusal(() => fogOver(id, { clear: pieces }))).toBe('conflict');
		expect(sees(id).map.fog).toEqual({ on: false, clear: [] });
	});

	test('a change to the fog is undone on its own, leaving a later rename alone', () => {
		const id = battlefield();
		token(gm, id, 0.75, 0.75);
		const [covered] = fogOver(id, { on: true, clear: [LEFT] });
		const [renamed] = perform(db, gm, { t: 'map.update', id, name: 'The Long Bridge' });
		const [cleared] = fogOver(id, { clear: [LEFT, RIGHT] });
		expect(sees(id).tokens).toHaveLength(1);

		// Undoing the rename, which came between, doesn't drag the fog back with it.
		perform(db, gm, { t: 'history.revert', seq: renamed.seq });
		expect(sees(id).map).toMatchObject({ name: 'The Bridge', fog: { on: true, clear: [LEFT, RIGHT] } });

		const [undone] = perform(db, gm, { t: 'history.revert', seq: cleared.seq });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [LEFT] });
		// The players are told what that covers again.
		const patch = toLiveEvent(db, undone, 'player')!.patch;
		expect(patch.t === 'map.upsert' && patch.tokens).toEqual([]);

		perform(db, gm, { t: 'history.revert', seq: covered.seq });
		expect(sees(id).map.fog).toEqual({ on: false, clear: [] });
		expect(sees(id).tokens).toHaveLength(1);
	});

	test('a round brush clears where it was swept, and covers again where it was swept back', () => {
		const id = battlefield();
		token(gm, id, 0.3, 0.5, 'On the way');
		token(gm, id, 0.3, 0.8, 'Beside it');
		fogOver(id, { on: true, clear: [] });
		expect(sees(id).tokens).toHaveLength(0);

		// From left to right through the middle of the map, a tenth of it each way.
		const sweep: FogMark = { cover: false, path: [[0.2, 0.5], [0.6, 0.5]], r: [0.1, 0.1] };
		const [swept] = fogOver(id, { marks: [sweep] });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [], marks: [sweep] });
		expect(names(sees(id).tokens)).toEqual(['On the way']);
		const patch = toLiveEvent(db, swept, 'player')!.patch;
		expect(patch.t === 'map.upsert' && names(patch.tokens!)).toEqual(['On the way']);

		// A dab of fog over the token puts it back under: the last mark over a spot is the one that counts.
		const dab: FogMark = { cover: true, path: [[0.3, 0.5]], r: [0.05, 0.05] };
		const [dabbed] = fogOver(id, { marks: [sweep, dab] });
		expect(sees(id).tokens).toHaveLength(0);
		perform(db, gm, { t: 'history.revert', seq: dabbed.seq });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [], marks: [sweep] });
		expect(names(sees(id).tokens)).toEqual(['On the way']);

		// Anything else said about the fog leaves the marks as they are, and covering the whole map says there are none.
		fogOver(id, { clear: [LEFT] });
		expect(sees(id).map.fog.marks).toEqual([sweep]);
		fogOver(id, { on: true, clear: [], marks: [] });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [] });
	});

	test('a square brush clears to its corners, where a round one of the same size does not', () => {
		const id = battlefield();
		token(gm, id, 0.38, 0.58, 'In the corner');
		token(gm, id, 0.3, 0.8, 'Beside it');
		fogOver(id, { on: true, clear: [] });

		// A dab of the round brush leaves the corner of the box around it in the fog.
		const round: FogMark = { cover: false, path: [[0.3, 0.5]], r: [0.1, 0.1] };
		fogOver(id, { marks: [round] });
		expect(sees(id).tokens).toHaveLength(0);

		const square: FogMark = { ...round, square: true };
		fogOver(id, { marks: [square] });
		expect(sees(id).map.fog).toEqual({ on: true, clear: [], marks: [square] });
		expect(names(sees(id).tokens)).toEqual(['In the corner']);
	});

	test('a malformed mark is refused, and so are more of them than a map keeps', () => {
		const id = battlefield();
		const malformed = [
			'a circle',
			[{ box: [0, 0, 1, 1] }],
			[{ cover: false, box: [0.5, 0, 0.2, 1] }],
			[{ cover: false }],
			[{ cover: false, path: [], r: [0.1, 0.1] }],
			[{ cover: false, path: [[0.5]], r: [0.1, 0.1] }],
			[{ cover: false, path: [[0.5, 1.5]], r: [0.1, 0.1] }],
			[{ cover: false, path: [[0.5, 0.5]], r: [0.1] }],
			[{ cover: false, path: [[0.5, 0.5]], r: [0, 0.1] }],
			[{ cover: false, path: [[0.5, 0.5]], r: [0.1, 9] }],
			[{ cover: false, path: [[0.5, 0.5]], r: [0.1, 0.1], square: 'yes' }],
			[{ cover: false, path: Array.from({ length: 49 }, () => [0.5, 0.5]), r: [0.1, 0.1] }]
		];
		for (const marks of malformed) expect(refusal(() => fogSent(id, { on: true, marks }))).toBe('invalid');
		const many = Array.from({ length: 401 }, (): FogMark => ({ cover: false, box: [0, 0, 0.5, 0.5] }));
		expect(refusal(() => fogOver(id, { on: true, marks: many }))).toBe('conflict');
		expect(sees(id).map.fog).toEqual({ on: false, clear: [] });
	});
});
