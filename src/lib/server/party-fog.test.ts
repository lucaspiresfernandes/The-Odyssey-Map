// The party marker of the world maps, and the fog of war of the battle maps.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, registerUser } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { audienceOf, getMapSnapshot } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, perform, undoable, type Actor } from './world';
import type { Point, Rect, Region, StoredEvent, Token } from '../shared/types';

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
function draw(name: string, on = mapId, extra: Record<string, unknown> = {}): Region {
	const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
	return events[1].after as Region;
}

const sees = (id: string, role: 'gm' | 'player' = 'player') =>
	getMapSnapshot(db, gm.campaignId, id, role)!;

/** Everything a player's browser would be sent for these events. */
const sentToPlayer = (events: StoredEvent[]) =>
	JSON.stringify(events.map((e) => toLiveEvent(db, e, 'player')).filter(Boolean));

describe('the party', () => {
	const party = (role: 'gm' | 'player' = 'player', on = mapId) => sees(on, role).party;

	test('the GM puts it on a world map, and the whole table is shown where', () => {
		expect(party()).toBeNull();
		const [placed] = perform(db, gm, { t: 'party.move', mapId, x: 0.3, y: 0.6 });
		expect(placed).toMatchObject({ entity: 'party', action: 'create', before: null });
		expect(party()).toEqual({ id: gm.campaignId, mapId, x: 0.3, y: 0.6, trail: [mapId] });
		expect(toLiveEvent(db, placed, 'player')!.patch).toEqual({ t: 'party.set', party: party('gm') });

		// Moving it is one more change, and the same spot again is none.
		expect(perform(db, gm, { t: 'party.move', mapId, x: 0.5, y: 0.5 })[0].action).toBe('update');
		expect(perform(db, gm, { t: 'party.move', mapId, x: 0.5, y: 0.5 })).toHaveLength(0);
		expect(refusal(() => perform(db, player, { t: 'party.move', mapId, x: 0.1, y: 0.1 }))).toBe('forbidden');
		expect(refusal(() => perform(db, gm, { t: 'party.move', mapId, x: 2, y: 0.1 }))).toBe('invalid');
	});

	test('it is one party: moved to a map further in, every map on the way knows', () => {
		const port = draw('Port Varr');
		const tavern = draw('The Gilded Eel', port.targetMapId);
		perform(db, gm, { t: 'party.move', mapId, x: 0.3, y: 0.6 });
		perform(db, gm, { t: 'party.move', mapId: tavern.targetMapId, x: 0.5, y: 0.5 });

		// Looked at from the first map, it is somewhere inside Port Varr.
		const now = party()!;
		expect(now.mapId).toBe(tavern.targetMapId);
		expect(now.trail).toEqual([mapId, port.targetMapId, tavern.targetMapId]);
		expect(party('player', tavern.targetMapId)).toEqual(now);
	});

	test('it stands where the players are: never on a battle map, never behind a hidden region', () => {
		const bridge = draw('The Bridge', mapId, { kind: 'battle' });
		expect(refusal(() => perform(db, gm, { t: 'party.move', mapId: bridge.targetMapId, x: 0.5, y: 0.5 }))).toBe('invalid');

		const crypt = draw('The Crypt', mapId, { hidden: true });
		expect(refusal(() => perform(db, gm, { t: 'party.move', mapId: crypt.targetMapId, x: 0.5, y: 0.5 }))).toBe('conflict');

		// Nor is a region hidden over its head, from however far up.
		const port = draw('Port Varr');
		const tavern = draw('The Gilded Eel', port.targetMapId);
		perform(db, gm, { t: 'party.move', mapId: tavern.targetMapId, x: 0.5, y: 0.5 });
		expect(refusal(() => perform(db, gm, { t: 'region.update', id: tavern.id, hidden: true }))).toBe('conflict');
		expect(refusal(() => perform(db, gm, { t: 'region.update', id: port.id, hidden: true }))).toBe('conflict');
		// Reshaping one is no trouble, and once the party has left, neither is hiding it.
		const moved = SQUARE.map(([x, y]): Point => [x + 0.1, y]);
		expect(perform(db, gm, { t: 'region.update', id: port.id, points: moved })).toHaveLength(1);
		perform(db, gm, { t: 'party.move', mapId, x: 0.5, y: 0.5 });
		expect(perform(db, gm, { t: 'region.update', id: port.id, hidden: true })).toHaveLength(1);
		expect(party()!.mapId).toBe(mapId);
	});

	test('a move is undone, and so is putting it on the map at all', () => {
		const [placed] = perform(db, gm, { t: 'party.move', mapId, x: 0.3, y: 0.6 });
		const [moved] = perform(db, gm, { t: 'party.move', mapId, x: 0.8, y: 0.2 });
		expect(undoable([placed, moved])).toEqual([placed.seq, moved.seq]);

		perform(db, gm, { t: 'history.revert', seq: moved.seq });
		expect(party('gm')).toMatchObject({ x: 0.3, y: 0.6 });
		const [gone] = perform(db, gm, { t: 'history.revert', seq: placed.seq });
		expect(party('gm')).toBeNull();
		expect(toLiveEvent(db, gone, 'player')!.patch).toEqual({ t: 'party.set', party: null });
		// Redo is undoing the undo: it is back where it was taken from.
		perform(db, gm, { t: 'history.revert', seq: gone.seq });
		expect(party('gm')).toMatchObject({ x: 0.3, y: 0.6 });
		// None of it is a player's to undo.
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: moved.seq }))).toBe('not_found');
	});

	test('the GM takes it off the maps, and undo plants it back', () => {
		const port = draw('Port Varr');
		perform(db, gm, { t: 'party.move', mapId: port.targetMapId, x: 0.3, y: 0.6 });
		expect(refusal(() => perform(db, player, { t: 'party.remove' }))).toBe('forbidden');

		const [gone] = perform(db, gm, { t: 'party.remove' });
		expect(gone).toMatchObject({ entity: 'party', action: 'delete', mapId: port.targetMapId, after: null });
		expect(toLiveEvent(db, gone, 'player')!.patch).toEqual({ t: 'party.set', party: null });
		expect(party('gm')).toBeNull();
		expect(party('gm', port.targetMapId)).toBeNull();
		// With no party there is nothing to take off, and nothing is recorded.
		expect(perform(db, gm, { t: 'party.remove' })).toHaveLength(0);

		// Unlike one lost with its map, this one has somewhere to come back to.
		expect(undoable([gone])).toEqual([gone.seq]);
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: gone.seq }))).toBe('not_found');
		const [back] = perform(db, gm, { t: 'history.revert', seq: gone.seq });
		expect(party()).toMatchObject({ mapId: port.targetMapId, x: 0.3, y: 0.6, trail: [mapId, port.targetMapId] });
		// Redo takes it off again.
		perform(db, gm, { t: 'history.revert', seq: back.seq });
		expect(party('gm')).toBeNull();
		// And with it gone, the region it stood in can be hidden.
		expect(perform(db, gm, { t: 'region.update', id: port.id, hidden: true })).toHaveLength(1);
	});

	test('it goes with the map it stands on when the region there is deleted', () => {
		const port = draw('Port Varr');
		const tavern = draw('The Gilded Eel', port.targetMapId);
		perform(db, gm, { t: 'party.move', mapId: tavern.targetMapId, x: 0.5, y: 0.5 });

		const deleted = perform(db, gm, { t: 'region.delete', id: port.id });
		const lost = deleted.find((e) => e.entity === 'party')!;
		expect(lost.action).toBe('delete');
		expect(toLiveEvent(db, lost, 'player')!.patch).toEqual({ t: 'party.set', party: null });
		expect(party('gm')).toBeNull();
		// There is no map left for it to come back to.
		expect(undoable(deleted)).toEqual([]);
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: lost.seq }))).toBe('not_found');
	});

	test('a map with the party on it is no longer blank', () => {
		const made = perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		const port = made[1].after as Region;
		perform(db, gm, { t: 'party.move', mapId: port.targetMapId, x: 0.5, y: 0.5 });
		// So undo won't delete the region out from under it.
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: made[1].seq }))).toBe('conflict');
	});
});

describe('fog of war', () => {
	/** A battle map behind a region of the first map. */
	const battlefield = () => draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;

	function token(by: Actor, on: string, x: number, y: number, name = 'Goblin'): Token {
		return perform(db, by, { t: 'token.create', mapId: on, name, x, y })[0].after as Token;
	}

	const fogOver = (id: string, fog: unknown) => perform(db, gm, { t: 'map.update', id, fog });
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

	test('it is for the GM, on battle maps, and malformed fog is refused', () => {
		const id = battlefield();
		expect(refusal(() => perform(db, player, { t: 'map.update', id, fog: { on: true } }))).toBe('forbidden');
		expect(refusal(() => fogOver(mapId, { on: true }))).toBe('invalid');
		const malformed = [
			{ on: 'yes' },
			{ clear: 'all' },
			{ clear: [[0, 0, 1]] },
			{ clear: [[0.5, 0, 0.2, 1]] },
			{ clear: [[0, 0, 2, 1]] },
			'thick'
		];
		for (const fog of malformed) expect(refusal(() => fogOver(id, fog))).toBe('invalid');
		const pieces = Array.from({ length: 401 }, (_, i) => [i / 500, 0, (i + 1) / 500, 1]);
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
});

describe('bringing everyone along', () => {
	test('the whole table can follow to an open map, and only the GM behind a hidden region', () => {
		const port = draw('Port Varr');
		const crypt = draw('The Crypt', port.targetMapId, { hidden: true });
		const vault = draw('The Vault', crypt.targetMapId);
		expect(audienceOf(db, gm.campaignId, mapId)).toBe('table');
		expect(audienceOf(db, gm.campaignId, port.targetMapId)).toBe('table');
		expect(audienceOf(db, gm.campaignId, crypt.targetMapId)).toBe('gm');
		expect(audienceOf(db, gm.campaignId, vault.targetMapId)).toBe('gm');
		expect(audienceOf(db, gm.campaignId, 'nosuchmap')).toBeNull();
		expect(audienceOf(db, 'anothercampaign', mapId)).toBeNull();
	});
});
