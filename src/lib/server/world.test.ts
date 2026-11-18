import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, createSession, getSessionUser, registerUser, verifyLogin } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { getMapSnapshot, listHistory } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, eventsAfter, perform, setMapImage, type Actor } from './world';
import type { Marker, Point, StoredEvent } from '../shared/types';

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

function worldMarker(extra: Record<string, unknown> = {}): Marker {
	const [event] = perform(db, gm, {
		t: 'marker.create',
		mapId,
		kind: 'world',
		type: 'quest',
		title: 'The Drowned Bell',
		description: 'It still rings at low tide.',
		x: 0.5,
		y: 0.5,
		...extra
	});
	return event.after as Marker;
}

function note(by: Actor = player): Marker {
	const [event] = perform(db, by, {
		t: 'marker.create',
		mapId,
		kind: 'player',
		title: 'The suspicious innkeeper',
		x: 0.2,
		y: 0.3
	});
	return event.after as Marker;
}

/** Everything a player's browser would be sent for these events. */
function sentToPlayer(events: StoredEvent[]): string {
	return JSON.stringify(events.map((e) => toLiveEvent(e, 'player')).filter(Boolean));
}

describe('accounts', () => {
	test('login needs the right password, sessions resolve to their user', async () => {
		const user = await verifyLogin(db, 'Keeper', 'correct horse battery');
		expect(user.id).toBe(gm.userId);
		await expect(verifyLogin(db, 'keeper', 'wrong')).rejects.toThrow('Wrong username or password.');

		const token = createSession(db, user.id);
		expect(getSessionUser(db, token)?.name).toBe('keeper');
		expect(getSessionUser(db, token + 'x')).toBeNull();
	});

	test('joining by invite never changes an existing role', () => {
		joinCampaign(db, gm.campaignId, gm.userId);
		expect(getMembership(db, gm.campaignId, gm.userId)?.role).toBe('gm');
	});
});

describe('world markers', () => {
	test('players can read them but not change them', () => {
		const marker = worldMarker();
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(1);

		expect(refusal(() => perform(db, player, { t: 'marker.create', mapId, kind: 'world', title: 'x', x: 0, y: 0 }))).toBe('forbidden');
		expect(refusal(() => perform(db, player, { t: 'marker.update', id: marker.id, changes: { title: 'Mine now' } }))).toBe('forbidden');
		expect(refusal(() => perform(db, player, { t: 'marker.delete', id: marker.id }))).toBe('forbidden');
	});

	test('a hidden marker reaches the GM only', () => {
		const events = perform(db, gm, {
			t: 'marker.create',
			mapId,
			kind: 'world',
			title: 'SECRET-LICH',
			description: 'SECRET-LICH phylactery',
			x: 0.5,
			y: 0.5,
			hidden: true
		});
		const id = events[0].entityId;
		events.push(...perform(db, gm, { t: 'marker.update', id, changes: { title: 'SECRET-LICH lair' } }));
		events.push(...perform(db, gm, { t: 'marker.delete', id }));
		events.push(...perform(db, gm, { t: 'marker.restore', id }));

		expect(sentToPlayer(events)).toBe('[]');
		expect(JSON.stringify(getMapSnapshot(db, gm.campaignId, mapId, 'player'))).not.toContain('SECRET');
		expect(JSON.stringify(listHistory(db, gm.campaignId, 'player'))).not.toContain('SECRET');
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.markers[0].hidden).toBe(true);
		expect(listHistory(db, gm.campaignId, 'gm')).toHaveLength(4);

		// To a player the marker does not exist, whatever they try on it.
		expect(refusal(() => perform(db, player, { t: 'marker.update', id, changes: { title: 'x' } }))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'marker.delete', id }))).toBe('not_found');
		for (const event of events) {
			expect(refusal(() => perform(db, player, { t: 'history.revert', seq: event.seq }))).toBe('not_found');
		}
	});

	test('hiding looks like a delete to players and revealing like a create', () => {
		const marker = worldMarker();
		const [hide] = perform(db, gm, { t: 'marker.update', id: marker.id, changes: { hidden: true } });
		expect(toLiveEvent(hide, 'player')!.patch).toEqual({ t: 'marker.remove', id: marker.id, mapId });
		expect(toLiveEvent(hide, 'gm')!.patch.t).toBe('marker.upsert');
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);

		const [show] = perform(db, gm, { t: 'marker.update', id: marker.id, changes: { hidden: false } });
		const patch = toLiveEvent(show, 'player')!.patch;
		expect(patch.t === 'marker.upsert' && patch.marker.title).toBe('The Drowned Bell');
	});

	test('the past of a revealed marker stays with the GM', () => {
		const marker = worldMarker({ hidden: true, title: 'SECRET working title' });
		perform(db, gm, { t: 'marker.update', id: marker.id, changes: { title: 'The Bell', hidden: false } });
		expect(JSON.stringify(listHistory(db, gm.campaignId, 'player'))).not.toContain('SECRET');
	});
});

describe('player markers', () => {
	test('anyone at the table can add, edit and delete them', () => {
		const marker = note(player);
		const other = actorFor(createGuest(db, 'Tovin'), getMembership(db, gm.campaignId, player.userId)!);
		joinCampaign(db, gm.campaignId, other.userId);

		perform(db, other, { t: 'marker.update', id: marker.id, changes: { description: 'Meet here at dawn' } });
		perform(db, gm, { t: 'marker.update', id: marker.id, changes: { type: 'danger' } });
		perform(db, other, { t: 'marker.delete', id: marker.id });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);
	});

	test('they can never be hidden', () => {
		const [event] = perform(db, gm, { t: 'marker.create', mapId, kind: 'player', title: 'Note', x: 0, y: 0, hidden: true });
		expect((event.after as Marker).hidden).toBe(false);
		expect(refusal(() => perform(db, gm, { t: 'marker.update', id: event.entityId, changes: { hidden: true } }))).toBe('invalid');
	});
});

describe('history', () => {
	test('a deleted marker can be restored by undoing the delete', () => {
		const marker = note();
		const [deleted] = perform(db, player, { t: 'marker.delete', id: marker.id });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);

		const [restored] = perform(db, player, { t: 'history.revert', seq: deleted.seq });
		expect(restored.action).toBe('restore');
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers[0].id).toBe(marker.id);
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: deleted.seq }))).toBe('conflict');
	});

	test('undoing an edit puts back only what that edit changed', () => {
		const marker = note();
		const [retitle] = perform(db, player, { t: 'marker.update', id: marker.id, changes: { title: 'Wrong name' } });
		perform(db, player, { t: 'marker.update', id: marker.id, changes: { x: 0.9 } });
		perform(db, player, { t: 'history.revert', seq: retitle.seq });

		const now = getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers[0];
		expect(now.title).toBe('The suspicious innkeeper');
		expect(now.x).toBe(0.9);
	});

	test('records who changed what, and what it was before', () => {
		const marker = note();
		perform(db, gm, { t: 'marker.update', id: marker.id, changes: { title: 'The honest innkeeper' } });
		const [latest] = listHistory(db, gm.campaignId, 'player');
		expect(latest.actorName).toBe('keeper');
		expect((latest.before as Marker).title).toBe('The suspicious innkeeper');
		expect((latest.after as Marker).title).toBe('The honest innkeeper');
	});

	test('players cannot undo the GM\'s work', () => {
		const marker = worldMarker();
		const [edit] = perform(db, gm, { t: 'marker.update', id: marker.id, changes: { title: 'Renamed' } });
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: edit.seq }))).toBe('not_found');
		perform(db, gm, { t: 'history.revert', seq: edit.seq });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.markers[0].title).toBe('The Drowned Bell');
	});
});

describe('nested maps', () => {
	test('a region opens onto a map of its own, with a trail back', () => {
		const events = perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		expect(events.map((e) => `${e.entity}.${e.action}`)).toEqual(['map.create', 'region.create']);

		const [region] = getMapSnapshot(db, gm.campaignId, mapId, 'player')!.regions;
		expect(region.name).toBe('Port Varr');

		perform(db, gm, { t: 'region.create', mapId: region.targetMapId, name: 'The Gilded Eel', points: SQUARE });
		const city = getMapSnapshot(db, gm.campaignId, region.targetMapId, 'player')!;
		const tavern = getMapSnapshot(db, gm.campaignId, city.regions[0].targetMapId, 'player')!;
		expect(tavern.trail.map((c) => c.name)).toEqual(['The Sunless Reach', 'Port Varr', 'The Gilded Eel']);
	});

	test('only the GM shapes maps and regions', () => {
		expect(refusal(() => perform(db, player, { t: 'region.create', mapId, name: 'x', points: SQUARE }))).toBe('forbidden');
		expect(refusal(() => perform(db, player, { t: 'map.update', id: mapId, name: 'x' }))).toBe('forbidden');
		expect(refusal(() => setMapImage(db, player, mapId, { file: `${mapId}-abc.png`, width: 10, height: 10 }))).toBe('forbidden');
	});

	test('deleting a region keeps what is inside it for a restore', () => {
		perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		const [region] = getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions;
		perform(db, player, { t: 'marker.create', mapId: region.targetMapId, kind: 'player', title: 'Dock 9', x: 0.5, y: 0.5 });

		const [deleted] = perform(db, gm, { t: 'region.delete', id: region.id });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions).toHaveLength(0);
		perform(db, gm, { t: 'history.revert', seq: deleted.seq });

		const [back] = getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions;
		expect(back.targetMapId).toBe(region.targetMapId);
		expect(getMapSnapshot(db, gm.campaignId, back.targetMapId, 'player')!.markers).toHaveLength(1);
	});
});

describe('boundaries', () => {
	test('one campaign cannot touch another', async () => {
		const marker = note();
		const rival = await registerUser(db, 'rival', 'another long password');
		const other = createCampaign(db, rival, 'Elsewhere');
		const outsider = actorFor(rival, getMembership(db, other.id, rival.id)!);

		expect(refusal(() => perform(db, outsider, { t: 'marker.update', id: marker.id, changes: { title: 'x' } }))).toBe('not_found');
		expect(refusal(() => perform(db, outsider, { t: 'marker.create', mapId, kind: 'world', title: 'x', x: 0, y: 0 }))).toBe('not_found');
		expect(getMapSnapshot(db, other.id, mapId, 'gm')).toBeNull();
		expect(listHistory(db, other.id, 'gm')).toHaveLength(0);
	});

	test('malformed input is refused, not stored', () => {
		const bad: unknown[] = [
			null,
			'marker.create',
			{ t: 'nope' },
			{ t: 'marker.create', mapId, kind: 'player', title: '   ', x: 0.5, y: 0.5 },
			{ t: 'marker.create', mapId, kind: 'player', title: 'ok', x: 1.5, y: 0.5 },
			{ t: 'marker.create', mapId, kind: 'player', title: 'ok', x: 'left', y: 0.5 },
			{ t: 'marker.create', mapId, kind: 'player', title: 'x'.repeat(500), x: 0.5, y: 0.5 },
			{ t: 'marker.create', mapId, kind: 'player', title: 'ok', type: 'dragon', x: 0.5, y: 0.5 },
			{ t: 'marker.create', mapId, kind: 'npc', title: 'ok', x: 0.5, y: 0.5 }
		];
		for (const input of bad) expect(refusal(() => perform(db, player, input))).toBe('invalid');
		expect(refusal(() => perform(db, gm, { t: 'region.create', mapId, name: 'Line', points: [[0, 0], [1, 1]] }))).toBe('invalid');
		expect(eventsAfter(db, 0)).toHaveLength(0);
	});

	test('an edit that changes nothing leaves no trace', () => {
		const marker = note();
		expect(perform(db, player, { t: 'marker.update', id: marker.id, changes: { title: marker.title } })).toHaveLength(0);
	});
});
