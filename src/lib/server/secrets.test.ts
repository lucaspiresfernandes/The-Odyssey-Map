// What is kept from some players and not from others: regions that are
// closed, things hidden from the table and shown to a few, a picture held
// up for a few, and the fog of a world map, which the party lifts.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, registerUser } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { addToGallery, canLoadImage, newImageFile, showToTable, shownTo } from './gallery';
import { audienceOf, findable, getMapSnapshot, playersOf } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, perform, undoable, viewerOf, type Actor } from './world';
import { isFogged } from '../shared/fog';
import type { Marker, Patch, Point, Region, StoredEvent, Token, Viewer } from '../shared/types';

let db: Db;
let gm: Actor;
let mira: Actor;
let odo: Actor;
let mapId: string;

const SQUARE: Point[] = [
	[0.1, 0.1],
	[0.4, 0.1],
	[0.4, 0.4],
	[0.1, 0.4]
];
/** A region well away from that one. */
const FAR: Point[] = [
	[0.7, 0.7],
	[0.9, 0.7],
	[0.9, 0.9],
	[0.7, 0.9]
];

beforeEach(async () => {
	db = openDb(':memory:');
	const owner = await registerUser(db, 'keeper', 'correct horse battery');
	const campaign = createCampaign(db, owner, 'The Sunless Reach');
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	const join = (name: string) => {
		const guest = createGuest(db, name);
		joinCampaign(db, campaign.id, guest.id);
		return actorFor(guest, getMembership(db, campaign.id, guest.id)!);
	};
	mira = join('Mira');
	odo = join('Odo');
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

function draw(name: string, on = mapId, extra: Record<string, unknown> = {}): Region {
	const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
	return events[1].after as Region;
}

/** A map as someone is sent it: the GM, the table as a whole, or one player. */
const sees = (id: string, who: Actor | 'player' = 'player') =>
	getMapSnapshot(db, gm.campaignId, id, who === 'player' ? 'player' : viewerOf(who));

/** What someone's browser is sent for an event. */
const sent = (event: StoredEvent, who: Actor | 'player'): Patch | null =>
	toLiveEvent(db, event, who === 'player' ? 'player' : viewerOf(who))?.patch ?? null;

describe('a closed region', () => {
	test('players see it on the map, and can not step inside', () => {
		const tomb = draw('The Tomb', mapId, { closed: true });
		expect(tomb.closed).toBe(true);
		expect(sees(mapId)!.regions.map((r) => [r.name, r.closed])).toEqual([['The Tomb', true]]);
		expect(sees(tomb.targetMapId)).toBeNull();
		expect(sees(tomb.targetMapId, gm)!.map.name).toBe('The Tomb');
		// Nor is anything in there theirs to touch, or to find.
		expect(
			refusal(() =>
				perform(db, mira, { t: 'marker.create', mapId: tomb.targetMapId, kind: 'player', title: 'Hi', x: 0.5, y: 0.5 })
			)
		).toBe('not_found');
		expect(findable(db, gm.campaignId, viewerOf(mira)).map((e) => e.name)).toEqual(['The Sunless Reach']);
		expect(findable(db, gm.campaignId, 'gm').find((e) => e.name === 'The Tomb')?.hidden).toBe(true);
	});

	test('the GM opens it and closes it, and the table is told each time', () => {
		const tomb = draw('The Tomb', mapId, { closed: true });
		const [opened] = perform(db, gm, { t: 'region.update', id: tomb.id, closed: false });
		expect(sent(opened, 'player')).toMatchObject({ t: 'region.upsert', region: { closed: false } });
		expect(sees(tomb.targetMapId)!.map.name).toBe('The Tomb');

		const [closed] = perform(db, gm, { t: 'region.update', id: tomb.id, closed: true });
		// It stays on the map: that is what tells a player inside to step back out.
		expect(sent(closed, 'player')).toMatchObject({ t: 'region.upsert', region: { closed: true } });
		expect(sees(tomb.targetMapId)).toBeNull();
		expect(refusal(() => perform(db, mira, { t: 'region.update', id: tomb.id, closed: false }))).toBe('forbidden');

		perform(db, gm, { t: 'history.revert', seq: closed.seq });
		expect(sees(tomb.targetMapId)).not.toBeNull();
	});

	test('what happens inside stays inside, but for its name', () => {
		const tomb = draw('The Tomb', mapId, { closed: true });
		const [noted] = perform(db, gm, {
			t: 'marker.create',
			mapId: tomb.targetMapId,
			kind: 'world',
			title: 'The sarcophagus',
			x: 0.5,
			y: 0.5
		});
		expect(sent(noted, 'player')).toBeNull();
		// Its name is lettered on the region outside, which players do see.
		const [renamed] = perform(db, gm, { t: 'map.update', id: tomb.targetMapId, name: 'The Old Tomb' });
		expect(sent(renamed, 'player')).toMatchObject({ t: 'region.upsert', region: { name: 'The Old Tomb' } });
		expect(sent(renamed, gm)).toMatchObject({ t: 'map.upsert' });
	});

	test('the party is never in one', () => {
		const tomb = draw('The Tomb', mapId, { closed: true });
		expect(refusal(() => perform(db, gm, { t: 'party.move', mapId: tomb.targetMapId, x: 0.5, y: 0.5 }))).toBe('conflict');
		perform(db, gm, { t: 'region.update', id: tomb.id, closed: false });
		perform(db, gm, { t: 'party.move', mapId: tomb.targetMapId, x: 0.5, y: 0.5 });
		expect(refusal(() => perform(db, gm, { t: 'region.update', id: tomb.id, closed: true }))).toBe('conflict');
	});
});

describe('a secret with some of the players', () => {
	const marker = (extra: Record<string, unknown> = {}) =>
		perform(db, gm, { t: 'marker.create', mapId, kind: 'world', title: 'The cache', x: 0.5, y: 0.5, ...extra })[0];

	test('the players of a campaign are the ones who joined, not the GM', () => {
		expect(playersOf(db, gm.campaignId).map((p) => p.name)).toEqual(['Mira', 'Odo']);
	});

	test('a hidden marker is shown to the players it is shared with, and nobody else', () => {
		const made = marker({ hidden: true, seenBy: [mira.userId] });
		const id = made.entityId;
		expect((made.after as Marker).seenBy).toEqual([mira.userId]);
		expect(sent(made, 'player')).toBeNull();
		expect(sent(made, odo)).toBeNull();
		// She is told it is a secret, and not who else is in on it.
		expect(sent(made, mira)).toMatchObject({ t: 'marker.upsert', marker: { hidden: true, seenBy: [] } });
		expect(sent(made, gm)).toMatchObject({ marker: { seenBy: [mira.userId] } });

		expect(sees(mapId, mira)!.markers).toHaveLength(1);
		expect(sees(mapId, odo)!.markers).toHaveLength(0);
		// A table display is nobody in particular.
		expect(sees(mapId)!.markers).toHaveLength(0);
		expect(findable(db, gm.campaignId, viewerOf(mira)).some((e) => e.id === id)).toBe(true);
		expect(findable(db, gm.campaignId, viewerOf(odo)).some((e) => e.id === id)).toBe(false);
		// It is still the GM's to change, and to a player who can't see it, not there.
		expect(refusal(() => perform(db, mira, { t: 'marker.update', id, changes: { title: 'Mine' } }))).toBe('forbidden');
		expect(refusal(() => perform(db, odo, { t: 'marker.delete', id }))).toBe('not_found');
	});

	test('sharing it later looks like it appearing, and taking that back like it going', () => {
		const made = marker({ hidden: true });
		const id = made.entityId;
		const [shared] = perform(db, gm, { t: 'marker.update', id, changes: { seenBy: [odo.userId] } });
		expect(sent(shared, odo)).toMatchObject({ t: 'marker.upsert' });
		expect(sent(shared, mira)).toBeNull();
		const [passed] = perform(db, gm, { t: 'marker.update', id, changes: { seenBy: [mira.userId] } });
		expect(sent(passed, odo)).toEqual({ t: 'marker.remove', id, mapId });
		expect(sent(passed, mira)).toMatchObject({ t: 'marker.upsert' });

		// Revealed to everyone, it is a secret with nobody: hiding it again hides it from all.
		const [revealed] = perform(db, gm, { t: 'marker.update', id, changes: { hidden: false } });
		expect((revealed.after as Marker).seenBy).toEqual([]);
		// And undo puts the secret back as it was.
		perform(db, gm, { t: 'history.revert', seq: revealed.seq });
		expect(sees(mapId, gm)!.markers[0]).toMatchObject({ hidden: true, seenBy: [mira.userId] });
	});

	test('only players of the campaign can be let in, and only the GM lets them', () => {
		const made = marker({ hidden: true });
		const share = (seenBy: unknown) =>
			perform(db, gm, { t: 'marker.update', id: made.entityId, changes: { seenBy } as never });
		expect(refusal(() => share([gm.userId]))).toBe('not_found');
		expect(refusal(() => share(['nobody']))).toBe('not_found');
		expect(refusal(() => share('Mira'))).toBe('invalid');
		// The same player twice is that player once.
		expect((share([odo.userId, odo.userId])[0].after as Marker).seenBy).toEqual([odo.userId]);
	});

	test('a hidden region opens its map, and what is in it, to the players it is shared with', () => {
		const vault = draw('The Vault', mapId, { hidden: true });
		const inner = draw('The Strongroom', vault.targetMapId);
		perform(db, gm, { t: 'region.update', id: vault.id, seenBy: [mira.userId] });

		expect(sees(mapId, mira)!.regions.map((r) => r.name)).toEqual(['The Vault']);
		expect(sees(mapId, odo)!.regions).toHaveLength(0);
		expect(sees(inner.targetMapId, mira)!.map.name).toBe('The Strongroom');
		expect(sees(inner.targetMapId, odo)).toBeNull();
		expect(sees(inner.targetMapId)).toBeNull();

		// What happens in there is news for her alone.
		const [noted] = perform(db, mira, {
			t: 'marker.create',
			mapId: vault.targetMapId,
			kind: 'player',
			title: 'Gold!',
			x: 0.5,
			y: 0.5
		});
		expect(sent(noted, mira)).toMatchObject({ t: 'marker.upsert' });
		expect(sent(noted, odo)).toBeNull();
		expect(sent(noted, 'player')).toBeNull();

		// The GM can bring her along there, and not the table.
		expect(audienceOf(db, gm.campaignId, inner.targetMapId)).toEqual({ table: false, only: [mira.userId] });
		// But the party stands where everyone can.
		expect(refusal(() => perform(db, gm, { t: 'party.move', mapId: vault.targetMapId, x: 0.5, y: 0.5 }))).toBe('conflict');
	});

	test('a hidden token is seen, and moved, by the players it is shared with', () => {
		const field = draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;
		const [made] = perform(db, gm, { t: 'token.create', mapId: field, name: 'Familiar', x: 0.5, y: 0.5, hidden: true });
		const id = made.entityId;
		const [shared] = perform(db, gm, { t: 'token.update', id, changes: { seenBy: [mira.userId] } });
		expect(sent(shared, mira)).toMatchObject({ t: 'token.upsert', token: { hidden: true, seenBy: [] } });
		expect(sent(shared, odo)).toBeNull();
		expect(sees(field, mira)!.tokens).toHaveLength(1);
		expect(sees(field, odo)!.tokens).toHaveLength(0);

		expect(perform(db, mira, { t: 'token.update', id, changes: { x: 0.6 } })).toHaveLength(1);
		expect(refusal(() => perform(db, odo, { t: 'token.update', id, changes: { x: 0.2 } }))).toBe('not_found');
		// Who is in on it stays the GM's to say.
		expect(refusal(() => perform(db, mira, { t: 'token.update', id, changes: { seenBy: [] } }))).toBe('forbidden');

		// In the turn order it is theirs to see, and nobody else's.
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [id], current: id } });
		expect(sees(field, mira)!.map.turns).toMatchObject({ order: [id], current: id });
		expect(sees(field, odo)!.map.turns).toMatchObject({ order: [], current: null });
	});
});

describe('a picture held up for some of the players', () => {
	test('they are shown it, and may load it: the others are not', () => {
		const letter = addToGallery(db, gm, {
			kind: 'map',
			name: 'The Letter',
			file: newImageFile('png'),
			width: 640,
			height: 480
		});
		expect(showToTable(db, gm, letter.id, [odo.userId])).toMatchObject({ to: [odo.userId] });
		expect(shownTo(db, gm.campaignId)).toMatchObject({ file: letter.file, to: [odo.userId] });
		expect(shownTo(db, gm.campaignId, viewerOf(odo))).toEqual({
			file: letter.file,
			name: 'The Letter',
			width: 640,
			height: 480
		});
		expect(shownTo(db, gm.campaignId, viewerOf(mira))).toBeNull();
		expect(shownTo(db, gm.campaignId, 'player')).toBeNull();
		expect(canLoadImage(db, gm.campaignId, viewerOf(odo), letter.file)).toBe(true);
		expect(canLoadImage(db, gm.campaignId, viewerOf(mira), letter.file)).toBe(false);

		// Held up again for everyone, it is everyone's.
		showToTable(db, gm, letter.id);
		expect(shownTo(db, gm.campaignId, viewerOf(mira))?.file).toBe(letter.file);
		expect(refusal(() => showToTable(db, gm, letter.id, ['nobody']))).toBe('not_found');
	});
});

describe('the fog of a world map', () => {
	const fog = (id = mapId) => sees(id, gm)!.map.fog;
	const cover = (id = mapId) => perform(db, gm, { t: 'map.update', id, fog: { on: true, clear: [], spots: [] } });

	test('each map has its own, and it hides what the party has not been near', () => {
		const port = draw('Port Varr');
		draw('The Far Keep', mapId, { points: FAR });
		perform(db, gm, { t: 'marker.create', mapId, kind: 'world', title: 'Near', x: 0.3, y: 0.3 });
		perform(db, gm, { t: 'marker.create', mapId, kind: 'world', title: 'Far', x: 0.8, y: 0.2 });
		perform(db, mira, { t: 'marker.create', mapId, kind: 'player', title: 'Our note', x: 0.8, y: 0.25 });
		perform(db, gm, { t: 'party.move', mapId, x: 0.28, y: 0.28 });

		const [covered] = cover();
		// The party sees around itself from the moment the fog comes down.
		expect(fog().spots).toHaveLength(1);
		expect(isFogged(fog(), [0.28, 0.28])).toBe(false);
		expect(isFogged(fog(), [0.8, 0.8])).toBe(true);

		const seen = sees(mapId)!;
		expect(seen.regions.map((r) => r.name)).toEqual(['Port Varr']);
		// The table's own notes are never lost to it.
		expect(seen.markers.map((m) => m.title).sort()).toEqual(['Near', 'Our note']);
		expect(sees(mapId, gm)!.markers).toHaveLength(3);
		// The players are sent what they may see now, in place of what they had.
		const patch = sent(covered, 'player')!;
		expect(patch.t === 'map.upsert' && patch.regions?.map((r) => r.name)).toEqual(['Port Varr']);
		expect(patch.t === 'map.upsert' && patch.markers).toHaveLength(2);

		// A region still under the fog keeps its map shut, and out of the finder.
		expect(findable(db, gm.campaignId, viewerOf(mira)).map((e) => e.name).sort()).toEqual([
			'Near',
			'Our note',
			'Port Varr',
			'The Sunless Reach'
		]);
		// The map inside Port Varr has no fog of its own.
		expect(fog(port.targetMapId).on).toBe(false);
	});

	test('it lifts where the party goes, and undoing the move brings it back', () => {
		const keep = draw('The Far Keep', mapId, { points: FAR });
		perform(db, gm, { t: 'party.move', mapId, x: 0.2, y: 0.2 });
		cover();
		expect(sees(keep.targetMapId)).toBeNull();

		const moved = perform(db, gm, { t: 'party.move', mapId, x: 0.8, y: 0.8 });
		expect(moved.map((e) => e.entity)).toEqual(['party', 'map']);
		expect(fog().spots).toHaveLength(2);
		expect(sees(mapId)!.regions.map((r) => r.name)).toEqual(['The Far Keep']);
		expect(sees(keep.targetMapId)).not.toBeNull();
		// Standing where it stood before clears nothing new.
		expect(perform(db, gm, { t: 'party.move', mapId, x: 0.8, y: 0.801 }).map((e) => e.entity)).toEqual(['party']);

		// One step back: the newest change first, as the browser asks for them.
		for (const seq of undoable(moved).reverse()) perform(db, gm, { t: 'history.revert', seq });
		expect(fog().spots).toHaveLength(1);
		expect(sees(mapId)!.regions).toHaveLength(0);
	});

	test('dragged across the map, the party uncovers the way it went: planted, only where it lands', () => {
		perform(db, gm, { t: 'party.move', mapId, x: 0.1, y: 0.5 });
		cover();
		perform(db, gm, { t: 'party.move', mapId, x: 0.9, y: 0.5, along: true });
		expect(isFogged(fog(), [0.5, 0.5])).toBe(false);
		expect(isFogged(fog(), [0.5, 0.9])).toBe(true);
		// Put down somewhere else with the tool, it has not been in between.
		perform(db, gm, { t: 'party.move', mapId, x: 0.9, y: 0.05 });
		perform(db, gm, { t: 'party.move', mapId, x: 0.1, y: 0.05 });
		expect(isFogged(fog(), [0.5, 0.05])).toBe(true);
		expect(isFogged(fog(), [0.1, 0.05])).toBe(false);
	});

	test('the party is let through it: going into a region clears the way there', () => {
		const keep = draw('The Far Keep', mapId, { points: FAR });
		cover();
		expect(fog().spots).toBeUndefined();
		expect(sees(keep.targetMapId)).toBeNull();
		perform(db, gm, { t: 'party.move', mapId: keep.targetMapId, x: 0.5, y: 0.5 });
		// On the map outside, the fog lifts around the region the party is in.
		expect(isFogged(fog(), [0.8, 0.8])).toBe(false);
		expect(sees(keep.targetMapId)!.party?.mapId).toBe(keep.targetMapId);
	});

	test('lifting it is one change, and takes back with undo', () => {
		perform(db, gm, { t: 'party.move', mapId, x: 0.2, y: 0.2 });
		cover();
		const [lifted] = perform(db, gm, { t: 'map.update', id: mapId, fog: { on: false, clear: [], spots: [] } });
		expect(fog()).toEqual({ on: false, clear: [] });
		perform(db, gm, { t: 'history.revert', seq: lifted.seq });
		expect(fog().on).toBe(true);
		expect(fog().spots).toHaveLength(1);
		expect(refusal(() => perform(db, mira, { t: 'map.update', id: mapId, fog: { on: false } }))).toBe('forbidden');
	});
});

describe('what each person is told', () => {
	test('the same event is one thing to the table and another to a player who is let in', () => {
		const vault = draw('The Vault', mapId, { hidden: true });
		const [shared] = perform(db, gm, { t: 'region.update', id: vault.id, seenBy: [mira.userId] });
		const viewers: (Viewer | 'player')[] = ['player', viewerOf(mira), viewerOf(odo)];
		const told = viewers.map((who) => toLiveEvent(db, shared, who)?.patch.t ?? null);
		expect(told).toEqual([null, 'region.upsert', null]);
	});

	test('a token carries nothing of who else is in on it', () => {
		const field = draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;
		const [made] = perform(db, gm, {
			t: 'token.create',
			mapId: field,
			name: 'Spy',
			x: 0.5,
			y: 0.5,
			hidden: true,
			seenBy: [mira.userId, odo.userId]
		});
		expect((made.after as Token).seenBy).toEqual([mira.userId, odo.userId]);
		expect(JSON.stringify(sent(made, mira))).not.toContain(odo.userId);
	});
});
