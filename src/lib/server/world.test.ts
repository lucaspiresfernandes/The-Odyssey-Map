import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, createSession, getSessionUser, registerUser, verifyLogin } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import {
	addToGallery,
	canLoadImage,
	hideInGallery,
	listGallery,
	nameFromFile,
	newImageFile,
	removeFromGallery,
	renameInGallery,
	sweepGallery
} from './gallery';
import { getMapSnapshot } from './queries';
import { toLiveEvent } from './visibility';
import {
	ActionError,
	deletedMaps,
	eventsAfter,
	perform,
	performReceived,
	undoable,
	type Actor
} from './world';
import {
	type Drawing,
	type GalleryItem,
	type GalleryKind,
	type MapInfo,
	type Marker,
	type Point,
	type Region,
	type StoredEvent,
	type Token
} from '../shared/types';
import type { Command, CommandOf } from '../shared/types';

let db: Db;
let gm: Actor;
let player: Actor;
/** A second player at the same table. */
let other: Actor;
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
	const second = createGuest(db, 'Tovin');
	joinCampaign(db, campaign.id, second.id);
	other = actorFor(second, getMembership(db, campaign.id, second.id)!);
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

function worldMarker(extra: Partial<CommandOf<'marker.create'>> = {}): Marker {
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
/** Puts a picture in the gallery, as the upload endpoint does once the file is saved. */
function picture(kind: GalleryKind = 'map', name = 'A picture', by: Actor = gm): GalleryItem {
	return addToGallery(db, by, { kind, name, file: newImageFile('png'), width: 640, height: 480 });
}

/** A picture in the gallery that the GM has revealed to the players. */
function revealed(kind: GalleryKind = 'map', name = 'A picture'): GalleryItem {
	const item = picture(kind, name);
	hideInGallery(db, gm, item.id, false);
	return { ...item, hidden: false };
}

function sentToPlayer(events: StoredEvent[]): string {
	return JSON.stringify(events.map((e) => toLiveEvent(db, e, 'player')).filter(Boolean));
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

	test('a username can be registered only once, whatever its case', async () => {
		await expect(registerUser(db, 'Keeper', 'another long password')).rejects.toThrow(
			'That username is taken.'
		);
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
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.markers[0].hidden).toBe(true);
		expect(eventsAfter(db, 0)).toHaveLength(4);

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
		expect(toLiveEvent(db, hide, 'player')!.patch).toEqual({ t: 'marker.remove', id: marker.id, mapId });
		expect(toLiveEvent(db, hide, 'gm')!.patch.t).toBe('marker.upsert');
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);

		const [show] = perform(db, gm, { t: 'marker.update', id: marker.id, changes: { hidden: false } });
		const patch = toLiveEvent(db, show, 'player')!.patch;
		expect(patch.t === 'marker.upsert' && patch.marker.title).toBe('The Drowned Bell');
	});

	test('the past of a revealed marker stays with the GM', () => {
		const marker = worldMarker({ hidden: true, title: 'SECRET working title' });
		const [reveal] = perform(db, gm, { t: 'marker.update', id: marker.id, changes: { title: 'The Bell', hidden: false } });
		expect(sentToPlayer([reveal])).not.toContain('SECRET');
		// Undoing the reveal would be a way to reach back into that past.
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: reveal.seq }))).toBe('not_found');
	});
});

describe('player markers', () => {
	test('anyone at the table can add and edit them', () => {
		const marker = note(player);
		perform(db, other, { t: 'marker.update', id: marker.id, changes: { description: 'Meet here at dawn' } });
		perform(db, gm, { t: 'marker.update', id: marker.id, changes: { type: 'note' } });

		const [now] = getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers;
		expect(now.description).toBe('Meet here at dawn');
		expect(now.type).toBe('note');
		// Editing a note does not make it yours.
		expect(now.authorId).toBe(player.userId);
	});

	test('a note is deleted by whoever added it, or by the GM', () => {
		const marker = note(player);
		expect(refusal(() => perform(db, other, { t: 'marker.delete', id: marker.id }))).toBe('forbidden');
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(1);

		perform(db, player, { t: 'marker.delete', id: marker.id });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);

		// The GM can clear anyone's note off the map, and take that back.
		const second = note(other);
		const [cleared] = perform(db, gm, { t: 'marker.delete', id: second.id });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(0);
		perform(db, gm, { t: 'history.revert', seq: cleared.seq });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers[0].id).toBe(second.id);

		// The GM's own notes are not a player's to delete.
		const gmNote = note(gm);
		expect(refusal(() => perform(db, player, { t: 'marker.delete', id: gmNote.id }))).toBe('forbidden');
	});

	test('undo is no way around that', () => {
		const marker = note(player);
		const [created] = eventsAfter(db, 0);
		// Undoing the creation would delete the note.
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: created.seq }))).toBe('forbidden');

		// And once it is deleted, another player can't bring it back either.
		const [deleted] = perform(db, player, { t: 'marker.delete', id: marker.id });
		expect(refusal(() => perform(db, other, { t: 'marker.restore', id: marker.id }))).toBe('forbidden');
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: deleted.seq }))).toBe('forbidden');
		perform(db, player, { t: 'history.revert', seq: deleted.seq });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers).toHaveLength(1);
	});

	test('they can never be hidden', () => {
		const [event] = perform(db, gm, { t: 'marker.create', mapId, kind: 'player', title: 'Note', x: 0, y: 0, hidden: true });
		expect((event.after as Marker).hidden).toBe(false);
		expect(refusal(() => perform(db, gm, { t: 'marker.update', id: event.entityId, changes: { hidden: true } }))).toBe('invalid');
	});
});

describe('undo', () => {
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

	test('redo is undoing the undo', () => {
		const marker = note();
		const [retitle] = perform(db, player, { t: 'marker.update', id: marker.id, changes: { title: 'Wrong name' } });
		const title = () => getMapSnapshot(db, gm.campaignId, mapId, 'player')!.markers[0].title;

		const [undone] = perform(db, player, { t: 'history.revert', seq: retitle.seq });
		expect(title()).toBe('The suspicious innkeeper');
		const [redone] = perform(db, player, { t: 'history.revert', seq: undone.seq });
		expect(title()).toBe('Wrong name');
		perform(db, player, { t: 'history.revert', seq: redone.seq });
		expect(title()).toBe('The suspicious innkeeper');
	});

	test('the log records who changed what, and what it was before', () => {
		const marker = note();
		perform(db, gm, { t: 'marker.update', id: marker.id, changes: { title: 'The honest innkeeper' } });
		const latest = eventsAfter(db, 0).at(-1)!;
		expect(latest.actorName).toBe('keeper');
		expect((latest.before as Marker).title).toBe('The suspicious innkeeper');
		expect((latest.after as Marker).title).toBe('The honest innkeeper');
	});

	test('drawing a region can be undone, creating its map on its own cannot', () => {
		const drawn = perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		expect(drawn.map((e) => `${e.entity}.${e.action}`)).toEqual(['map.create', 'region.create']);
		expect(undoable(drawn)).toEqual([drawn[1].seq]);
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: drawn[0].seq }))).toBe('invalid');

		// The undo deletes the region and its map, and that is the end of it:
		// there is nothing left to redo.
		const undone = perform(db, gm, { t: 'history.revert', seq: drawn[1].seq });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions).toHaveLength(0);
		expect(getMapSnapshot(db, gm.campaignId, drawn[0].entityId, 'gm')).toBeNull();
		expect(undoable(undone)).toEqual([]);
	});

	test('undo leaves a region alone once something is inside it', () => {
		const drawn = perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		const inside = drawn[0].entityId;
		perform(db, player, { t: 'marker.create', mapId: inside, kind: 'player', title: 'Dock 9', x: 0.5, y: 0.5 });

		// Undoing the drawing would delete the note with it, without asking.
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: drawn[1].seq }))).toBe('conflict');
		expect(getMapSnapshot(db, gm.campaignId, inside, 'player')!.markers).toHaveLength(1);
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
		expect(refusal(() => perform(db, player, { t: 'map.update', id: mapId, image: picture().file }))).toBe('forbidden');
	});

	test('deleting a region deletes everything inside it, for good', () => {
		const draw = (on: string, name: string) =>
			perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE })[1].after as Region;
		const city = draw(mapId, 'Port Varr');
		const tavern = draw(city.targetMapId, 'The Gilded Eel');
		const cellar = draw(tavern.targetMapId, 'The Cellar');
		const kept = draw(mapId, 'The Ashen Wood');
		const outside = note();
		const [inside] = perform(db, player, { t: 'marker.create', mapId: cellar.targetMapId, kind: 'player', title: 'Dock 9', x: 0.5, y: 0.5 });
		perform(db, gm, { t: 'map.update', id: tavern.targetMapId, image: picture().file });

		expect(refusal(() => perform(db, player, { t: 'region.delete', id: city.id }))).toBe('forbidden');
		const made = perform(db, gm, { t: 'region.delete', id: city.id });

		// One event says the region went, and one per map that went with it.
		const gone = [city, tavern, cellar].map((r) => r.targetMapId);
		expect(made.map((e) => `${e.entity}.${e.action}`)).toEqual(['region.delete', 'map.delete', 'map.delete', 'map.delete']);
		expect(deletedMaps(made).sort()).toEqual([...gone].sort());
		expect(toLiveEvent(db, made[0], 'player')!.patch).toEqual({
			t: 'region.remove',
			id: city.id,
			mapId,
			targetMapId: city.targetMapId
		});
		expect(made.slice(1).map((e) => toLiveEvent(db, e, 'gm'))).toEqual([null, null, null]);

		// The maps are gone to the GM too, and so is what was on them.
		for (const id of gone) expect(getMapSnapshot(db, gm.campaignId, id, 'gm')).toBeNull();
		expect(refusal(() => perform(db, gm, { t: 'marker.update', id: inside.entityId, changes: { title: 'x' } }))).toBe('not_found');
		expect(refusal(() => perform(db, gm, { t: 'region.update', id: tavern.id, hidden: true }))).toBe('not_found');
		expect(refusal(() => perform(db, gm, { t: 'region.delete', id: city.id }))).toBe('not_found');

		// What was beside it is untouched.
		const root = getMapSnapshot(db, gm.campaignId, mapId, 'gm')!;
		expect(root.regions.map((r) => r.id)).toEqual([kept.id]);
		expect(root.markers.map((m) => m.id)).toEqual([outside.id]);
		expect(getMapSnapshot(db, gm.campaignId, kept.targetMapId, 'gm')).not.toBeNull();

		// Nothing brings it back, and its past went with it.
		expect(undoable(made)).toEqual([]);
		for (const event of made) {
			expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: event.seq }))).toBe('invalid');
		}
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: inside.seq }))).toBe('not_found');
		const log = JSON.stringify(eventsAfter(db, 0).filter((e) => e.seq < made[0].seq));
		expect(log).toContain('The Ashen Wood');
		for (const lost of ['Port Varr', 'The Gilded Eel', 'The Cellar', 'Dock 9']) expect(log).not.toContain(lost);
	});

	test('a region can be reshaped, and the reshape undone', () => {
		perform(db, gm, { t: 'region.create', mapId, name: 'Port Varr', points: SQUARE });
		const [region] = getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions;
		const moved = SQUARE.map(([x, y]): Point => [x + 0.2, y]);

		expect(refusal(() => perform(db, player, { t: 'region.update', id: region.id, points: moved }))).toBe('forbidden');
		const [reshaped] = perform(db, gm, { t: 'region.update', id: region.id, points: moved });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.regions[0].points).toEqual(moved);
		expect(perform(db, gm, { t: 'region.update', id: region.id, points: moved })).toHaveLength(0);

		perform(db, gm, { t: 'history.revert', seq: reshaped.seq });
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'player')!.regions[0].points).toEqual(SQUARE);
	});
});

describe('maps that borrow their picture', () => {
	const draw = (on: string, name: string, extra: Partial<CommandOf<'region.create'>> = {}) =>
		perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra })[1].after as Region;
	const backdrop = (id: string, role: 'gm' | 'player' = 'player') =>
		getMapSnapshot(db, gm.campaignId, id, role)!.backdrop;
	/** Lays a 640 by 480 picture under a map. */
	function paint(id: string): GalleryItem {
		const item = picture();
		perform(db, gm, { t: 'map.update', id, image: item.file });
		return item;
	}

	test('a map with no image shows the part of its parent’s under the region', () => {
		const coast = paint(mapId);
		const city = draw(mapId, 'Port Varr');
		// SQUARE is a tenth in from the left and the top, and three tenths across.
		expect(backdrop(city.targetMapId)).toEqual({ file: coast.file, width: 640, height: 480, x: 64, y: 48, w: 192, h: 144 });
		// The first map has nothing further out to borrow from.
		expect(backdrop(mapId)).toBeNull();
	});

	test('without an image anywhere on the way, a map is plain paper', () => {
		const city = draw(mapId, 'Port Varr');
		const tavern = draw(city.targetMapId, 'The Gilded Eel');
		expect(backdrop(city.targetMapId)).toBeNull();
		expect(backdrop(tavern.targetMapId)).toBeNull();
	});

	test('a map inside a borrowing map shows a part of that part', () => {
		const coast = paint(mapId);
		const city = draw(mapId, 'Port Varr');
		const tavern = draw(city.targetMapId, 'The Gilded Eel');
		expect(backdrop(tavern.targetMapId)).toEqual({ file: coast.file, width: 640, height: 480, x: 83.2, y: 62.4, w: 57.6, h: 43.2 });
	});

	test('the nearest image on the way is the one borrowed from', () => {
		paint(mapId);
		const city = draw(mapId, 'Port Varr');
		const tavern = draw(city.targetMapId, 'The Gilded Eel');
		const streets = paint(city.targetMapId);
		expect(backdrop(tavern.targetMapId)).toMatchObject({ file: streets.file, x: 64, y: 48, w: 192, h: 144 });
		// The city has an image of its own now. What it would borrow is still
		// worked out, for the day that image is taken back off.
		expect(getMapSnapshot(db, gm.campaignId, city.targetMapId, 'gm')!.map.imageFile).toBe(streets.file);
		expect(backdrop(city.targetMapId)).toMatchObject({ x: 64, y: 48 });
	});

	test('it follows the region when the region is reshaped, and undo', () => {
		paint(mapId);
		const city = draw(mapId, 'Port Varr');
		const half: Point[] = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
		const [reshaped] = perform(db, gm, { t: 'region.update', id: city.id, points: half });
		expect(backdrop(city.targetMapId)).toMatchObject({ x: 0, y: 0, w: 320, h: 480 });
		perform(db, gm, { t: 'history.revert', seq: reshaped.seq });
		expect(backdrop(city.targetMapId)).toMatchObject({ x: 64, y: 48, w: 192, h: 144 });
	});

	test('a battle map borrows nothing: it is plain paper until it has an image', () => {
		paint(mapId);
		const arena = draw(mapId, 'The Pit', { kind: 'battle' });
		expect(backdrop(arena.targetMapId, 'gm')).toBeNull();
	});

	test('a region with no room in it borrows nothing', () => {
		paint(mapId);
		const line: Point[] = [[0.1, 0.1], [0.2, 0.1], [0.3, 0.1]];
		const [, drawn] = perform(db, gm, { t: 'region.create', mapId, name: 'A crack', points: line });
		expect(backdrop((drawn.after as Region).targetMapId)).toBeNull();
	});

	test('a player may load the image a map they can open borrows from', () => {
		const coast = paint(mapId);
		const city = draw(mapId, 'Port Varr');
		// The picture was never revealed in the gallery: it is the map that shows it.
		expect(backdrop(city.targetMapId)?.file).toBe(coast.file);
		expect(canLoadImage(db, gm.campaignId, 'player', coast.file)).toBe(true);
		// Behind a hidden region there is no map for a player to ask about.
		perform(db, gm, { t: 'region.update', id: city.id, hidden: true });
		expect(getMapSnapshot(db, gm.campaignId, city.targetMapId, 'player')).toBeNull();
		expect(backdrop(city.targetMapId, 'gm')).not.toBeNull();
	});
});

describe('hidden regions', () => {
	/** Draws a region and returns it, with the events that drawing it made. */
	function draw(name: string, on = mapId, extra: Partial<CommandOf<'region.create'>> = {}) {
		const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
		return { events, region: events[1].after as Region };
	}

	const playerSees = (id: string) => getMapSnapshot(db, gm.campaignId, id, 'player');

	test('hiding looks like a delete to players and revealing like a create', () => {
		const { region } = draw('The Cellar');
		const [hide] = perform(db, gm, { t: 'region.update', id: region.id, hidden: true });
		expect(toLiveEvent(db, hide, 'player')!.patch).toEqual({
			t: 'region.remove',
			id: region.id,
			mapId,
			targetMapId: region.targetMapId
		});
		expect(toLiveEvent(db, hide, 'gm')!.patch.t).toBe('region.upsert');
		expect(playerSees(mapId)!.regions).toHaveLength(0);
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions[0].hidden).toBe(true);

		const [show] = perform(db, gm, { t: 'region.update', id: region.id, hidden: false });
		const patch = toLiveEvent(db, show, 'player')!.patch;
		expect(patch.t === 'region.upsert' && patch.region.name).toBe('The Cellar');
		expect(playerSees(mapId)!.regions).toHaveLength(1);
	});

	test('players are kept out of the map behind it, and of every map inside that', () => {
		const { region: tavern } = draw('The Gilded Eel');
		const { region: cellar } = draw('The Cellar', tavern.targetMapId);
		const { region: vault } = draw('The Vault', cellar.targetMapId);
		const dropped = note(player);
		perform(db, gm, { t: 'marker.update', id: dropped.id, changes: { title: 'Still here' } });
		const [inside] = perform(db, player, { t: 'marker.create', mapId: vault.targetMapId, kind: 'player', title: 'Chest', x: 0.5, y: 0.5 });

		perform(db, gm, { t: 'region.update', id: cellar.id, hidden: true });
		expect(playerSees(tavern.targetMapId)!.regions).toHaveLength(0);
		expect(playerSees(cellar.targetMapId)).toBeNull();
		expect(playerSees(vault.targetMapId)).toBeNull();
		expect(getMapSnapshot(db, gm.campaignId, vault.targetMapId, 'gm')!.markers).toHaveLength(1);

		// Nor can they act on what is in there, even knowing its id.
		expect(refusal(() => perform(db, player, { t: 'marker.create', mapId: vault.targetMapId, kind: 'player', title: 'x', x: 0, y: 0 }))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'marker.update', id: inside.entityId, changes: { title: 'x' } }))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'marker.delete', id: inside.entityId }))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: inside.seq }))).toBe('not_found');

		perform(db, gm, { t: 'region.update', id: cellar.id, hidden: false });
		expect(playerSees(vault.targetMapId)!.markers).toHaveLength(1);
	});

	test('nothing that happens in there reaches a player', () => {
		const { region } = draw('The Cellar');
		perform(db, gm, { t: 'region.update', id: region.id, hidden: true });
		const inside = region.targetMapId;

		const events = [
			...perform(db, gm, { t: 'map.update', id: inside, name: 'SECRET crypt' }),
			...perform(db, gm, { t: 'marker.create', mapId: inside, kind: 'world', title: 'SECRET altar', x: 0.5, y: 0.5 }),
			...perform(db, gm, { t: 'marker.create', mapId: inside, kind: 'player', title: 'SECRET note', x: 0.5, y: 0.5 }),
			...perform(db, gm, { t: 'region.create', mapId: inside, name: 'SECRET vault', points: SQUARE }),
			...perform(db, gm, { t: 'map.update', id: inside, image: picture().file })
		];
		expect(events).toHaveLength(6);
		expect(sentToPlayer(events)).toBe('[]');
		expect(JSON.stringify(playerSees(mapId))).not.toContain('SECRET');

		// Nor does the news of it all being deleted: the region, its map and the vault's.
		const deleted = perform(db, gm, { t: 'region.delete', id: region.id });
		expect(deleted).toHaveLength(3);
		expect(sentToPlayer(deleted)).toBe('[]');
	});

	test('a region can be drawn already hidden', () => {
		const { events, region } = draw('SECRET passage', mapId, { hidden: true });
		expect(region.hidden).toBe(true);
		expect(sentToPlayer(events)).toBe('[]');
		expect(playerSees(mapId)!.regions).toHaveLength(0);
		expect(playerSees(region.targetMapId)).toBeNull();
	});

	test('hiding is undone on its own, leaving a later reshape alone', () => {
		const { region } = draw('The Cellar');
		const moved = SQUARE.map(([x, y]): Point => [x + 0.2, y]);
		const [hide] = perform(db, gm, { t: 'region.update', id: region.id, hidden: true });
		const [reshape] = perform(db, gm, { t: 'region.update', id: region.id, points: moved });

		perform(db, gm, { t: 'history.revert', seq: hide.seq });
		expect(playerSees(mapId)!.regions[0].points).toEqual(moved);

		perform(db, gm, { t: 'history.revert', seq: reshape.seq });
		const [now] = playerSees(mapId)!.regions;
		expect(now.points).toEqual(SQUARE);
		expect(now.hidden).toBe(false);
	});

	test('only the GM hides and reveals', () => {
		const { region } = draw('The Cellar');
		expect(refusal(() => perform(db, player, { t: 'region.update', id: region.id, hidden: true }))).toBe('forbidden');
		expect(refusal(() => performReceived(db, gm, { t: 'region.update', id: region.id, hidden: 'yes' }))).toBe('invalid');
		expect(perform(db, gm, { t: 'region.update', id: region.id, hidden: false })).toHaveLength(0);
	});
});

describe('battle maps', () => {
	/** A battle map behind a region of the first map, and that region. */
	function battlefield(extra: Partial<CommandOf<'region.create'>> = {}) {
		const events = perform(db, gm, { t: 'region.create', mapId, name: 'The Bridge', points: SQUARE, kind: 'battle', ...extra });
		const region = events[1].after as Region;
		return { region, id: region.targetMapId };
	}

	function token(by: Actor, on: string, extra: Partial<CommandOf<'token.create'>> = {}): Token {
		const [event] = perform(db, by, { t: 'token.create', mapId: on, name: 'Goblin', x: 0.5, y: 0.5, ...extra });
		return event.after as Token;
	}

	const sees = (id: string, role: 'gm' | 'player' = 'player') => getMapSnapshot(db, gm.campaignId, id, role)!;

	test('a region can lead to one, and says so', () => {
		const { region, id } = battlefield();
		expect(region.kind).toBe('battle');
		expect(sees(id).map.kind).toBe('battle');
		expect(sees(mapId).regions[0].kind).toBe('battle');
		// A region leads to a world map unless it is asked for otherwise.
		const [, plain] = perform(db, gm, { t: 'region.create', mapId, name: 'The Marsh', points: SQUARE });
		expect((plain.after as Region).kind).toBe('world');
	});

	test('the GM sets up its grid', () => {
		const { id } = battlefield();
		const [made] = perform(db, gm, { t: 'map.update', id, grid: { size: 70, x: 80, y: -10 } });
		expect(sees(id).map).toMatchObject({ kind: 'battle', grid: { size: 70, x: 10, y: 60, shown: true } });
		expect(perform(db, gm, { t: 'map.update', id, grid: { shown: false } })).toHaveLength(1);
		expect(sees(id).map.grid).toEqual({ size: 70, x: 10, y: 60, shown: false });

		expect(refusal(() => perform(db, player, { t: 'map.update', id, grid: { size: 60 } }))).toBe('forbidden');
		for (const grid of [{ size: 2 }, { size: 'big' }, { x: Infinity }, { shown: 1 }, 'square']) {
			expect(refusal(() => performReceived(db, gm, { t: 'map.update', id, grid }))).toBe('invalid');
		}
		expect(refusal(() => perform(db, gm, { t: 'map.update', id }))).toBe('invalid');

		// Undoing the first change puts back the grid the map was made with.
		perform(db, gm, { t: 'history.revert', seq: made.seq });
		expect(sees(id).map).toMatchObject({ kind: 'battle', grid: { size: 50, x: 0, y: 0 } });
	});

	test('a map stays the kind it was made as', () => {
		const { id } = battlefield();
		// Neither way, for the GM or anyone, alone or along with another change.
		expect(refusal(() => performReceived(db, gm, { t: 'map.update', id: mapId, kind: 'battle' }))).toBe('invalid');
		expect(refusal(() => performReceived(db, gm, { t: 'map.update', id, kind: 'world' }))).toBe('invalid');
		expect(refusal(() => performReceived(db, gm, { t: 'map.update', id, kind: 'world', grid: { size: 70 } }))).toBe('invalid');
		expect(refusal(() => performReceived(db, player, { t: 'map.update', id, kind: 'world' }))).toBe('forbidden');
		// Even to say what it already is: the kind isn't something a map is told.
		expect(refusal(() => performReceived(db, gm, { t: 'map.update', id, kind: 'battle' }))).toBe('invalid');
		expect(sees(mapId).map.kind).toBe('world');
		expect(sees(id).map).toMatchObject({ kind: 'battle', grid: { size: 50 } });
	});

	test('a cell stands for eight feet until the GM says otherwise', () => {
		const { id } = battlefield();
		expect(sees(id).map.cellFeet).toBe(8);
		const [scaled] = perform(db, gm, { t: 'map.update', id, cellFeet: 5 });
		expect(sees(id).map.cellFeet).toBe(5);
		expect(sees(id, 'gm').map.cellFeet).toBe(5);
		// The same again changes nothing, and so is no event.
		expect(perform(db, gm, { t: 'map.update', id, cellFeet: 5 })).toHaveLength(0);
		expect(perform(db, gm, { t: 'map.update', id, cellFeet: 2.5 })).toHaveLength(1);

		expect(refusal(() => perform(db, player, { t: 'map.update', id, cellFeet: 10 }))).toBe('forbidden');
		for (const cellFeet of [0, -5, 0.1, 5000, '5', null, Infinity]) {
			expect(refusal(() => performReceived(db, gm, { t: 'map.update', id, cellFeet }))).toBe('invalid');
		}

		// Undoing the first change puts back the scale the map had before it.
		perform(db, gm, { t: 'history.revert', seq: scaled.seq });
		expect(sees(id).map).toMatchObject({ cellFeet: 8 });
	});

	test('it holds no markers, no notes and no regions', () => {
		const { id } = battlefield();
		const marker = { t: 'marker.create', mapId: id, title: 'Trapdoor', x: 0.5, y: 0.5 } as const;
		expect(refusal(() => perform(db, gm, { ...marker, kind: 'world' }))).toBe('invalid');
		expect(refusal(() => perform(db, player, { ...marker, kind: 'player' }))).toBe('invalid');
		// Nothing leads further in from a battle map.
		expect(refusal(() => perform(db, gm, { t: 'region.create', mapId: id, name: 'The Vault', points: SQUARE }))).toBe('invalid');
		expect(sees(id, 'gm')).toMatchObject({ markers: [], regions: [] });
	});

	test('tokens go on battle maps only', () => {
		expect(refusal(() => token(gm, mapId))).toBe('invalid');
		const { id } = battlefield();
		expect(token(gm, id)).toMatchObject({ name: 'Goblin', size: 1, hidden: false });
		expect(sees(id).tokens).toHaveLength(1);
	});

	test('anyone adds a token, and anyone moves any of them', () => {
		const { id } = battlefield();
		const goblin = token(gm, id);
		// Whatever a player asks for, the token they add is in plain sight.
		const mine = token(player, id, { name: 'Mira', hidden: true });
		expect(mine).toMatchObject({ name: 'Mira', hidden: false });
		// The token a player puts down is their own, and the GM's is nobody's.
		// That says whose turn it is, not who may move it.
		expect(mine).toMatchObject({ ownerId: player.userId, ownerName: 'Mira' });
		expect(goblin.ownerId).toBeNull();

		const [move] = perform(db, player, { t: 'token.update', id: mine.id, changes: { x: 0.1, y: 0.2 } });
		expect(move.after).toMatchObject({ x: 0.1, y: 0.2 });
		// The GM's, another player's, a player's for the GM: all the same.
		expect(perform(db, player, { t: 'token.update', id: goblin.id, changes: { x: 0.1 } })[0].after).toMatchObject({ x: 0.1 });
		expect(perform(db, other, { t: 'token.update', id: mine.id, changes: { x: 0.9 } })[0].after).toMatchObject({ x: 0.9 });
		expect(perform(db, gm, { t: 'token.update', id: mine.id, changes: { x: 0.3 } })).toHaveLength(1);
		// Taking one off the map as well.
		expect(perform(db, other, { t: 'token.delete', id: mine.id })[0]).toMatchObject({ action: 'delete', after: null });
		expect(perform(db, player, { t: 'token.delete', id: goblin.id })).toHaveLength(1);
		expect(sees(id, 'gm').tokens).toHaveLength(0);
	});

	test('only the GM hides a token', () => {
		const { id } = battlefield();
		const mine = token(player, id);
		expect(refusal(() => perform(db, player, { t: 'token.update', id: mine.id, changes: { hidden: true } }))).toBe('forbidden');
		// Saying whose token it is, is the GM's as well.
		expect(refusal(() => perform(db, player, { t: 'token.update', id: mine.id, changes: { ownerId: other.userId } }))).toBe('forbidden');
		expect(perform(db, gm, { t: 'token.update', id: mine.id, changes: { ownerId: other.userId } })[0].after).toMatchObject({ ownerId: other.userId, ownerName: 'Tovin' });
		expect(perform(db, gm, { t: 'token.update', id: mine.id, changes: { hidden: true } })[0].after).toMatchObject({ hidden: true });
	});

	test('a hidden token reaches the GM only', () => {
		const { id } = battlefield();
		const ambush = token(gm, id, { name: 'SECRET assassin', hidden: true });
		const events = [
			...eventsAfter(db, 0).filter((e) => e.entity === 'token'),
			...perform(db, gm, { t: 'token.update', id: ambush.id, changes: { x: 0.7 } })
		];
		expect(sentToPlayer(events)).toBe('[]');
		expect(JSON.stringify(sees(id))).not.toContain('SECRET');
		expect(sees(id, 'gm').tokens).toHaveLength(1);
		expect(refusal(() => perform(db, player, { t: 'token.update', id: ambush.id, changes: { x: 0.1 } }))).toBe('not_found');

		// Stepping out of the shadows looks like a token being added, and back like one being taken away.
		const [reveal] = perform(db, gm, { t: 'token.update', id: ambush.id, changes: { hidden: false } });
		expect(toLiveEvent(db, reveal, 'player')!.patch.t).toBe('token.upsert');
		const [hide] = perform(db, gm, { t: 'token.update', id: ambush.id, changes: { hidden: true } });
		expect(toLiveEvent(db, hide, 'player')!.patch).toEqual({ t: 'token.remove', id: ambush.id, mapId: id });
	});

	test('nothing on a battle map behind a hidden region reaches a player', () => {
		const { id } = battlefield({ hidden: true });
		const events = perform(db, gm, { t: 'token.create', mapId: id, name: 'SECRET ogre', x: 0.5, y: 0.5 });
		expect(sentToPlayer(events)).toBe('[]');
		expect(refusal(() => token(player, id))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'token.update', id: events[0].entityId, changes: { x: 0.1 } }))).toBe('not_found');
	});

	test('a move is undone, a delete too, each by whoever made it', () => {
		const { id } = battlefield();
		const mine = token(player, id);
		const [move] = perform(db, player, { t: 'token.update', id: mine.id, changes: { x: 0.1, y: 0.1 } });
		perform(db, player, { t: 'token.update', id: mine.id, changes: { name: 'Mira the Bold' } });

		// Only the move goes back. The rename made since stays.
		perform(db, player, { t: 'history.revert', seq: move.seq });
		expect(sees(id).tokens[0]).toMatchObject({ x: 0.5, y: 0.5, name: 'Mira the Bold' });

		const [gone] = perform(db, gm, { t: 'token.delete', id: mine.id });
		expect(undoable([gone])).toEqual([gone.seq]);
		expect(sees(id).tokens).toHaveLength(0);
		// The delete was the GM's, so it is the GM's to take back.
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: gone.seq }))).toBe('not_found');
		perform(db, gm, { t: 'history.revert', seq: gone.seq });
		expect(sees(id).tokens).toHaveLength(1);

		// A player's undo reaches their own moves, not the GM's, nor another player's.
		const [gmMove] = perform(db, gm, { t: 'token.update', id: mine.id, changes: { x: 0.8 } });
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: gmMove.seq }))).toBe('not_found');
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: move.seq }))).toBe('not_found');
	});

	test('deleting the region takes the battle map and its tokens along', () => {
		const { region, id } = battlefield();
		const goblin = token(gm, id);
		perform(db, gm, { t: 'region.delete', id: region.id });
		expect(getMapSnapshot(db, gm.campaignId, id, 'gm')).toBeNull();
		expect(refusal(() => perform(db, gm, { t: 'token.update', id: goblin.id, changes: { x: 0.1 } }))).toBe('not_found');
	});

	test('malformed tokens are refused', () => {
		const { id } = battlefield();
		const base = { t: 'token.create', mapId: id, name: 'Goblin', x: 0.5, y: 0.5 };
		for (const extra of [{ name: ' ' }, { x: 2 }, { size: 0 }, { size: 0.25 }, { size: 1.2 }, { size: '2' }, { size: 99 }, { color: 'red' }, { outline: 'red' }, { outline: '' }, { hidden: 'no' }, { rotation: 10 }, { rotation: '90' }, { locked: 1 }]) {
			expect(refusal(() => performReceived(db, gm, { ...base, ...extra }))).toBe('invalid');
		}
		expect(sees(id, 'gm').tokens).toHaveLength(0);
	});

	test('a token is turned and resized by anyone, half a cell at a time', () => {
		const { id } = battlefield();
		const goblin = token(gm, id);
		const mine = token(player, id, { name: 'Mira' });
		expect(mine).toMatchObject({ rotation: 0, locked: false });

		const [turned] = perform(db, player, { t: 'token.update', id: mine.id, changes: { rotation: 45, size: 2 } });
		expect(turned.after).toMatchObject({ rotation: 45, size: 2 });
		// Half sizes are kept as they are, down to half a cell and up to the limit.
		perform(db, player, { t: 'token.update', id: goblin.id, changes: { size: 1.5 } });
		expect(sees(id).tokens[0].size).toBe(1.5);
		perform(db, player, { t: 'token.update', id: goblin.id, changes: { size: 0.5 } });
		expect(sees(id).tokens[0].size).toBe(0.5);
		perform(db, player, { t: 'token.update', id: goblin.id, changes: { size: 1 } });
		expect(refusal(() => perform(db, gm, { t: 'token.update', id: goblin.id, changes: { size: 6.5 } }))).toBe('invalid');
		// A full turn and a bit is the bit, and so is turning back past nothing.
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { rotation: 375 } })[0].after).toMatchObject({ rotation: 15 });
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { rotation: -15 } })[0].after).toMatchObject({ rotation: 345 });
		// Nothing to do is nothing done.
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { rotation: 345 } })).toHaveLength(0);

		// Nobody's token is out of anyone's reach.
		for (const changes of [{ rotation: 90 }, { size: 3 }, { color: '#3fae7c' }]) {
			expect(perform(db, player, { t: 'token.update', id: goblin.id, changes })[0].after).toMatchObject(changes);
		}
		expect(perform(db, other, { t: 'token.update', id: mine.id, changes: { color: '#3fae7c' } })).toHaveLength(1);
		// Undo turns it back, and leaves its size alone.
		perform(db, player, { t: 'token.update', id: mine.id, changes: { size: 3 } });
		perform(db, player, { t: 'history.revert', seq: turned.seq });
		expect(sees(id).tokens[1]).toMatchObject({ rotation: 0, size: 1 });
	});

	test('any token can wear an outline, with a picture or without', () => {
		const { id } = battlefield();
		// A token starts out with none, whatever its colour.
		const goblin = token(gm, id, { color: '#3fae7c' });
		expect(goblin).toMatchObject({ color: '#3fae7c', outline: null });
		const marked = token(gm, id, { name: 'Chief', outline: '#e0a526' });
		expect(marked.outline).toBe('#e0a526');

		// Anyone gives it one, changes it, and takes it off again.
		const [ringed] = perform(db, player, { t: 'token.update', id: goblin.id, changes: { outline: '#5b8def' } });
		expect(ringed.after).toMatchObject({ color: '#3fae7c', outline: '#5b8def' });
		expect(sees(id).tokens[0].outline).toBe('#5b8def');
		expect(perform(db, other, { t: 'token.update', id: goblin.id, changes: { outline: null } })[0].after).toMatchObject({ outline: null });
		expect(perform(db, other, { t: 'token.update', id: goblin.id, changes: { outline: null } })).toHaveLength(0);
		expect(refusal(() => perform(db, gm, { t: 'token.update', id: goblin.id, changes: { outline: 'red' } }))).toBe('invalid');

		// Undo puts the ring back, and a lock doesn't hold it.
		perform(db, player, { t: 'history.revert', seq: ringed.seq });
		expect(sees(id).tokens[0].outline).toBeNull();
		perform(db, gm, { t: 'token.update', id: goblin.id, changes: { locked: true } });
		expect(perform(db, player, { t: 'token.update', id: goblin.id, changes: { outline: '#b072e0' } })).toHaveLength(1);
		// A copy wears the same one.
		expect(perform(db, player, { t: 'token.duplicate', id: goblin.id })[0].after).toMatchObject({ outline: '#b072e0' });
	});

	test('anyone labels a token, and locks or unlocks it', () => {
		const { id } = battlefield();
		const goblin = token(gm, id);
		const mine = token(player, id, { name: 'Mira' });

		const [named] = perform(db, player, { t: 'token.update', id: goblin.id, changes: { name: 'Goblin chief' } });
		expect(named.after).toMatchObject({ name: 'Goblin chief' });
		expect(perform(db, other, { t: 'token.update', id: mine.id, changes: { name: 'Mira the Bold', locked: true } })[0].after).toMatchObject({ name: 'Mira the Bold', locked: true });
		expect(refusal(() => perform(db, player, { t: 'token.update', id: goblin.id, changes: { name: '' } }))).toBe('invalid');
		// Their own label is theirs to undo.
		perform(db, player, { t: 'history.revert', seq: named.seq });
		expect(sees(id).tokens[0].name).toBe('Goblin');

		// A locked token stays as it is, for the player who added it and for the GM.
		for (const changes of [{ x: 0.2 }, { size: 2 }, { rotation: 90 }]) {
			expect(refusal(() => perform(db, player, { t: 'token.update', id: mine.id, changes }))).toBe('conflict');
			expect(refusal(() => perform(db, gm, { t: 'token.update', id: mine.id, changes }))).toBe('conflict');
		}
		// Its label and its colour aren't what the lock holds.
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { name: 'Mira', color: '#3fae7c' } })).toHaveLength(1);
		// Unlocking and moving can be one change. Anyone unlocks.
		expect(perform(db, player, { t: 'token.update', id: mine.id, changes: { locked: false, x: 0.2 } })[0].after).toMatchObject({ locked: false, x: 0.2 });
		perform(db, gm, { t: 'token.update', id: goblin.id, changes: { locked: true } });
		expect(perform(db, player, { t: 'token.update', id: goblin.id, changes: { locked: false } })).toHaveLength(1);
		// Unlocked, it is anyone's to move again.
		expect(perform(db, player, { t: 'token.update', id: goblin.id, changes: { x: 0.2 } })).toHaveLength(1);
	});

	test('anyone duplicates a token', () => {
		const { id } = battlefield();
		perform(db, gm, { t: 'map.update', id, grid: { size: 100 } });
		const ogre = token(gm, id, { name: 'Ogre', size: 2, rotation: 90, locked: true, color: '#3fae7c' });

		const [copied] = perform(db, player, { t: 'token.duplicate', id: ogre.id });
		const copy = copied.after as Token;
		// Its own width to the right: two cells of a hundred, on a map 1600 wide.
		// And the next number after its name, to tell it from the first.
		expect(copy).toMatchObject({ name: 'Ogre 2', size: 2, rotation: 90, color: '#3fae7c', locked: false, y: 0.5 });
		expect(copy.x).toBeCloseTo(0.625);
		expect(copy.id).not.toBe(ogre.id);
		// Whoever made the copy can take it back.
		perform(db, player, { t: 'history.revert', seq: copied.seq });
		expect(sees(id).tokens).toHaveLength(1);

		// Where that spot is taken, the next one along.
		const [second] = perform(db, gm, { t: 'token.duplicate', id: ogre.id });
		expect((second.after as Token).x).toBeCloseTo(0.625);
		expect((perform(db, gm, { t: 'token.duplicate', id: ogre.id })[0].after as Token).x).toBeCloseTo(0.75);
		// At the right edge it goes to the left instead.
		perform(db, gm, { t: 'token.update', id: ogre.id, changes: { locked: false, x: 0.95 } });
		expect((perform(db, gm, { t: 'token.duplicate', id: ogre.id })[0].after as Token).x).toBeCloseTo(0.825);

		// A hidden token is nobody's to copy but the GM's.
		const lurker = token(gm, id, { hidden: true });
		expect(refusal(() => perform(db, player, { t: 'token.duplicate', id: lurker.id }))).toBe('not_found');
		expect(perform(db, gm, { t: 'token.duplicate', id: lurker.id })[0].after).toMatchObject({ hidden: true });
	});

	test('anyone takes a token off the map, and whoever did puts it back', () => {
		const { id } = battlefield();
		const mine = token(player, id, { name: 'Mira' });
		const ogre = token(gm, id, { name: 'Ogre', x: 0.7 });

		// A player deletes the GM's token, and everyone is told it is gone.
		const [slain] = perform(db, player, { t: 'token.delete', id: ogre.id });
		expect(slain).toMatchObject({ entity: 'token', action: 'delete', actorId: player.userId });
		expect(toLiveEvent(db, slain, 'gm')!.patch).toEqual({ t: 'token.remove', id: ogre.id, mapId: id });
		expect(sees(id, 'gm').tokens.map((t) => t.name)).toEqual(['Mira']);
		expect(refusal(() => perform(db, player, { t: 'token.delete', id: ogre.id }))).toBe('conflict');
		// Changing their mind is theirs, by undo and no other way. It is nobody else's, but the GM's.
		expect(refusal(() => perform(db, player, { t: 'token.restore', id: ogre.id }))).toBe('forbidden');
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: slain.seq }))).toBe('not_found');
		const [back] = perform(db, player, { t: 'history.revert', seq: slain.seq });
		expect(back).toMatchObject({ action: 'restore' });
		expect(sees(id).tokens).toHaveLength(2);
		// And redo takes it off again.
		perform(db, player, { t: 'history.revert', seq: back.seq });
		expect(sees(id).tokens).toHaveLength(1);
		perform(db, gm, { t: 'token.restore', id: ogre.id });

		// A token the player cannot see is not theirs to delete: to them it is not there.
		perform(db, gm, { t: 'token.update', id: ogre.id, changes: { hidden: true } });
		expect(refusal(() => perform(db, player, { t: 'token.delete', id: ogre.id }))).toBe('not_found');
		expect(sees(id, 'gm').tokens).toHaveLength(2);

		// What the GM deleted is the GM's to bring back.
		const [gone] = perform(db, gm, { t: 'token.delete', id: mine.id });
		expect(refusal(() => perform(db, player, { t: 'token.restore', id: mine.id }))).toBe('forbidden');
		perform(db, gm, { t: 'history.revert', seq: gone.seq });
		perform(db, gm, { t: 'token.delete', id: ogre.id });

		// A player also takes back a token they put down themselves, and puts it back again.
		const [made] = perform(db, player, { t: 'token.create', mapId: id, name: 'Familiar', x: 0.3, y: 0.3 });
		const [unmade] = perform(db, player, { t: 'history.revert', seq: made.seq });
		expect(sees(id).tokens).toHaveLength(1);
		perform(db, player, { t: 'history.revert', seq: unmade.seq });
		expect(sees(id).tokens).toHaveLength(2);
		// Not one that someone else put down.
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: made.seq }))).toBe('not_found');
	});

	test('several changes go as one batch, or not at all', () => {
		const { id } = battlefield();
		const a = token(gm, id);
		const b = token(gm, id, { x: 0.6 });
		const moved = perform(db, gm, {
			t: 'batch',
			cmds: [
				{ t: 'token.update', id: a.id, changes: { x: 0.1 } },
				{ t: 'token.update', id: b.id, changes: { x: 0.2 } }
			]
		});
		expect(moved.map((e) => (e.after as Token).x)).toEqual([0.1, 0.2]);
		// They undo as one too.
		perform(db, gm, { t: 'batch', cmds: moved.map((e) => ({ t: 'history.revert', seq: e.seq })) });
		expect(sees(id).tokens.map((t) => t.x)).toEqual([0.5, 0.6]);

		// One refusal takes the rest back with it.
		const half: Command = { t: 'batch', cmds: [{ t: 'token.update', id: a.id, changes: { x: 0.9 } }, { t: 'token.delete', id: 'nothing' }] };
		expect(refusal(() => perform(db, gm, half))).toBe('not_found');
		expect(sees(id).tokens[0].x).toBe(0.5);
		const mixed: Command = { t: 'batch', cmds: [{ t: 'token.update', id: a.id, changes: { name: 'Gob' } }, { t: 'token.update', id: a.id, changes: { hidden: true } }] };
		expect(refusal(() => perform(db, player, mixed))).toBe('forbidden');
		expect(sees(id).tokens[0].name).toBe('Goblin');

		for (const cmds of [[], 'all', [{ t: 'batch', cmds: [{ t: 'token.delete', id: a.id }] }], Array(201).fill({ t: 'token.duplicate', id: a.id })]) {
			expect(refusal(() => performReceived(db, gm, { t: 'batch', cmds }))).toBe('invalid');
		}
		expect(sees(id).tokens).toHaveLength(2);
	});
});

describe('drawings', () => {
	function battlefield(extra: Partial<CommandOf<'region.create'>> = {}) {
		const events = perform(db, gm, { t: 'region.create', mapId, name: 'The Bridge', points: SQUARE, kind: 'battle', ...extra });
		return (events[1].after as Region).targetMapId;
	}

	const LINE: Point[] = [
		[0.2, 0.2],
		[0.3, 0.25],
		[0.4, 0.2]
	];

	function line(by: Actor, on: string, extra: Partial<CommandOf<'drawing.create'>> = {}): Drawing {
		const [event] = perform(db, by, { t: 'drawing.create', mapId: on, kind: 'line', points: LINE, ...extra });
		return event.after as Drawing;
	}

	function words(by: Actor, on: string, text = 'Here be goblins'): Drawing {
		const [event] = perform(db, by, { t: 'drawing.create', mapId: on, kind: 'text', points: [[0.5, 0.5]], text });
		return event.after as Drawing;
	}

	const sees = (id: string, role: 'gm' | 'player' = 'player') => getMapSnapshot(db, gm.campaignId, id, role)!;

	test('anyone at the table draws and writes on a battle map', () => {
		expect(refusal(() => line(gm, mapId))).toBe('invalid');
		const id = battlefield();
		expect(line(player, id, { color: '#e5544b' })).toMatchObject({ kind: 'line', points: LINE, text: '', color: '#e5544b', size: 0.1, authorId: player.userId, authorName: 'Mira' });
		expect(words(gm, id)).toMatchObject({ kind: 'text', points: [[0.5, 0.5]], text: 'Here be goblins', size: 0.5 });
		expect(sees(id).drawings).toHaveLength(2);
		// Everyone who can open the map is sent it.
		const [event] = perform(db, other, { t: 'drawing.create', mapId: id, kind: 'line', points: LINE });
		expect(toLiveEvent(db, event, 'player')!.patch).toMatchObject({ t: 'drawing.upsert', drawing: { authorName: 'Tovin' } });
	});

	test('it is changed and rubbed out by whoever made it, and the GM', () => {
		const id = battlefield();
		const note = words(player, id);
		expect(refusal(() => perform(db, other, { t: 'drawing.update', id: note.id, changes: { text: 'Mine now' } }))).toBe('forbidden');
		expect(refusal(() => perform(db, other, { t: 'drawing.delete', id: note.id }))).toBe('forbidden');

		const [reworded] = perform(db, player, { t: 'drawing.update', id: note.id, changes: { text: 'Here be dragons', color: '#e0a526' } });
		expect(reworded.after).toMatchObject({ text: 'Here be dragons', color: '#e0a526' });
		expect(perform(db, gm, { t: 'drawing.update', id: note.id, changes: { text: 'Here be dragons' } })).toHaveLength(0);

		const [gone] = perform(db, gm, { t: 'drawing.delete', id: note.id });
		expect(toLiveEvent(db, gone, 'player')!.patch).toEqual({ t: 'drawing.remove', id: note.id, mapId: id });
		expect(sees(id).drawings).toHaveLength(0);
		expect(refusal(() => perform(db, player, { t: 'drawing.update', id: note.id, changes: { text: 'Back?' } }))).toBe('conflict');
		// Rubbed out by the GM, it is the GM's to bring back, or its author's with a restore.
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: gone.seq }))).toBe('not_found');
		perform(db, player, { t: 'drawing.restore', id: note.id });
		expect(sees(id).drawings[0].text).toBe('Here be dragons');
	});

	test('it slides across the map whole, and stops at the edge', () => {
		const id = battlefield();
		const drawn = line(player, id);
		const [moved] = perform(db, player, { t: 'drawing.update', id: drawn.id, changes: { move: [0.1, -0.05] } });
		expect((moved.after as Drawing).points).toEqual([
			[0.3, 0.15],
			[0.4, 0.2],
			[0.5, 0.15]
		]);
		// As far as the map goes, and no further: the shape is kept.
		const [edged] = perform(db, player, { t: 'drawing.update', id: drawn.id, changes: { move: [2, -2] } });
		expect((edged.after as Drawing).points).toEqual([
			[0.8, 0],
			[0.9, 0.05],
			[1, 0]
		]);
		// Undo puts it back where it was before each.
		perform(db, player, { t: 'history.revert', seq: edged.seq });
		perform(db, player, { t: 'history.revert', seq: moved.seq });
		expect(sees(id).drawings[0].points).toEqual(LINE);
		for (const move of [[1], ['a', 0], [Infinity, 0], 'left']) {
			expect(refusal(() => performReceived(db, player, { t: 'drawing.update', id: drawn.id, changes: { move } }))).toBe('invalid');
		}
	});

	test('undo rubs out what was drawn, and draws it again', () => {
		const id = battlefield();
		const [made] = perform(db, player, { t: 'drawing.create', mapId: id, kind: 'line', points: LINE });
		expect(undoable([made])).toEqual([made.seq]);
		const [unmade] = perform(db, player, { t: 'history.revert', seq: made.seq });
		expect(sees(id).drawings).toHaveLength(0);
		perform(db, player, { t: 'history.revert', seq: unmade.seq });
		expect(sees(id).drawings).toHaveLength(1);
		expect(refusal(() => perform(db, other, { t: 'history.revert', seq: made.seq }))).toBe('not_found');
	});

	test('nothing drawn behind a hidden region reaches a player', () => {
		const id = battlefield({ hidden: true });
		const [event] = perform(db, gm, { t: 'drawing.create', mapId: id, kind: 'text', points: [[0.5, 0.5]], text: 'SECRET door' });
		expect(sentToPlayer([event])).toBe('[]');
		expect(refusal(() => line(player, id))).toBe('not_found');
		expect(refusal(() => perform(db, player, { t: 'drawing.delete', id: event.entityId }))).toBe('not_found');
	});

	test('malformed drawings are refused', () => {
		const id = battlefield();
		const base = { t: 'drawing.create', mapId: id, kind: 'line', points: LINE };
		const tooLong = Array.from({ length: 801 }, (_, i) => [i / 801, 0.5]);
		for (const extra of [{ kind: 'circle' }, { points: [[0.5, 0.5]] }, { points: [[0.5, 2], [0.5, 0.5]] }, { points: 'wavy' }, { points: tooLong }, { color: 'red' }, { size: 0 }, { size: 50 }, { size: 'thick' }]) {
			expect(refusal(() => performReceived(db, gm, { ...base, ...extra }))).toBe('invalid');
		}
		const text = { t: 'drawing.create', mapId: id, kind: 'text', points: [[0.5, 0.5]], text: 'Hello' };
		for (const extra of [{ text: ' ' }, { text: undefined }, { text: 'x'.repeat(201) }, { points: LINE }]) {
			expect(refusal(() => performReceived(db, gm, { ...text, ...extra }))).toBe('invalid');
		}
		expect(refusal(() => perform(db, gm, { t: 'drawing.update', id: line(gm, id).id, changes: { text: 'A line has no words' } }))).toBe('invalid');
		expect(sees(id).drawings).toHaveLength(1);
	});

	test('a map with a drawing on it is no longer blank, and goes with its region', () => {
		const [made, door] = perform(db, gm, { t: 'region.create', mapId, name: 'The Bridge', points: SQUARE, kind: 'battle' });
		const id = made.entityId;
		const drawn = line(gm, id);
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: door.seq }))).toBe('conflict');
		perform(db, gm, { t: 'region.delete', id: door.entityId });
		expect(refusal(() => perform(db, gm, { t: 'drawing.delete', id: drawn.id }))).toBe('not_found');
	});
});

describe('the gallery', () => {
	/** A battle map behind a region of the first map, and that region. */
	function battlefield(extra: Partial<CommandOf<'region.create'>> = {}) {
		const events = perform(db, gm, { t: 'region.create', mapId, name: 'The Bridge', points: SQUARE, kind: 'battle', ...extra });
		const region = events[1].after as Region;
		return { region, id: region.targetMapId };
	}

	function token(on: string, extra: Partial<CommandOf<'token.create'>> = {}, by: Actor = gm): Token {
		const [event] = perform(db, by, { t: 'token.create', mapId: on, name: 'Goblin', x: 0.5, y: 0.5, ...extra });
		return event.after as Token;
	}

	const mapNow = (id: string) => getMapSnapshot(db, gm.campaignId, id, 'gm')!.map;
	const names = (who: Actor = gm) => listGallery(db, who).map((item) => item.name);
	const playerLoads = (file: string) => canLoadImage(db, gm.campaignId, 'player', file);

	test('the GM fills it, renames what is in it and tidies it', () => {
		const coast = picture('map', 'the coast');
		picture('token', 'Goblin');
		picture('map', 'Ashen Wood');
		// By name, whatever the case and whatever it is for.
		expect(names()).toEqual(['Ashen Wood', 'Goblin', 'the coast']);

		renameInGallery(db, gm, coast.id, '  The Sunless Coast ');
		expect(names()).toContain('The Sunless Coast');
		expect(refusal(() => renameInGallery(db, gm, coast.id, ' '))).toBe('invalid');
	});

	test('every picture starts hidden, and a player is shown only what the GM reveals', () => {
		const coast = picture('map', 'SECRET coast');
		const goblin = picture('token', 'SECRET goblin');
		const knight = picture('token', 'Knight');
		expect(coast.hidden).toBe(true);
		expect(names(player)).toEqual([]);

		hideInGallery(db, gm, knight.id, false);
		expect(listGallery(db, player)).toEqual([{ ...knight, hidden: false }]);
		expect(JSON.stringify(listGallery(db, player))).not.toContain('SECRET');
		// The GM sees the lot, and which of them are out in the open.
		expect(listGallery(db, gm).map((item) => [item.name, item.hidden])).toEqual([
			['Knight', false],
			['SECRET coast', true],
			['SECRET goblin', true]
		]);

		// Hidden again, it is gone from the player's gallery.
		hideInGallery(db, gm, knight.id, true);
		expect(names(player)).toEqual([]);
		void goblin;
	});

	test('a player changes nothing of the GM’s in it, and reveals nothing', () => {
		const knight = revealed('token', 'Knight');
		const goblin = picture('token', 'Goblin');

		// A token picture of their own is another matter: see player-pictures in party.test.ts.
		expect(refusal(() => picture('map', 'My map', player))).toBe('forbidden');
		expect(refusal(() => renameInGallery(db, player, knight.id, 'x'))).toBe('forbidden');
		expect(refusal(() => removeFromGallery(db, player, knight.id))).toBe('forbidden');
		expect(refusal(() => hideInGallery(db, player, goblin.id, false))).toBe('forbidden');
		expect(refusal(() => hideInGallery(db, player, knight.id, true))).toBe('forbidden');
		expect(refusal(() => hideInGallery(db, gm, goblin.id, 'no'))).toBe('invalid');
		expect(names()).toEqual(['Goblin', 'Knight']);
		expect(names(player)).toEqual(['Knight']);
	});

	test('a picture is named after the file it came in', () => {
		expect(nameFromFile('ancient_red  dragon.final.PNG')).toBe('ancient red dragon.final');
		expect(nameFromFile('.png')).toBe('Untitled');
		expect(nameFromFile(`${'x'.repeat(200)}.webp`)).toHaveLength(80);
	});

	test('a map image is laid under as many maps as the GM likes', () => {
		const coast = picture();
		const { id: second } = battlefield();
		const [laid] = perform(db, gm, { t: 'map.update', id: mapId, image: coast.file });
		perform(db, gm, { t: 'map.update', id: second, image: coast.file });

		// Each map takes the size of the picture.
		expect(laid.after as MapInfo).toMatchObject({ imageFile: coast.file, width: 640, height: 480 });
		expect(mapNow(second)).toMatchObject({ imageFile: coast.file, width: 640, height: 480 });
		// Laying the same one again changes nothing.
		expect(perform(db, gm, { t: 'map.update', id: mapId, image: coast.file })).toEqual([]);
		// Looking through the gallery is not laying an image: that stays the GM's.
		expect(refusal(() => perform(db, player, { t: 'map.update', id: mapId, image: coast.file }))).toBe('forbidden');

		// Undo takes it back off this map, and leaves the other alone.
		perform(db, gm, { t: 'history.revert', seq: laid.seq });
		expect(mapNow(mapId)).toMatchObject({ imageFile: null, width: 1600, height: 1000 });
		expect(mapNow(second).imageFile).toBe(coast.file);
	});

	test('a token wears a token picture', () => {
		const { id } = battlefield();
		const face = picture('token', 'Goblin');
		const goblin = token(id, { image: face.file });
		expect(goblin.image).toBe(face.file);

		// Taking the picture off is undone like any other edit.
		const [bare] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { image: null } });
		expect((bare.after as Token).image).toBeNull();
		const [again] = perform(db, gm, { t: 'history.revert', seq: bare.seq });
		expect((again.after as Token).image).toBe(face.file);
	});

	test('a player dresses a token from what the GM has revealed', () => {
		const { id } = battlefield();
		const hero = revealed('token', 'Hero');
		const knight = revealed('token', 'Knight');
		const foe = token(id);

		const me = token(id, { name: 'Mira', image: hero.file }, player);
		expect(me).toMatchObject({ image: hero.file });

		// They change it, take it off, and undo that.
		const [changed] = perform(db, player, { t: 'token.update', id: me.id, changes: { image: knight.file } });
		expect((changed.after as Token).image).toBe(knight.file);
		const [back] = perform(db, player, { t: 'history.revert', seq: changed.seq });
		expect((back.after as Token).image).toBe(hero.file);
		const [bare] = perform(db, player, { t: 'token.update', id: me.id, changes: { image: null } });
		expect((bare.after as Token).image).toBeNull();

		// Any token is theirs to dress, the one the GM added included.
		expect(perform(db, player, { t: 'token.update', id: foe.id, changes: { image: hero.file } })).toHaveLength(1);
		expect(perform(db, other, { t: 'token.update', id: me.id, changes: { image: hero.file } })).toHaveLength(1);
		expect(perform(db, gm, { t: 'token.update', id: me.id, changes: { image: knight.file } })).toHaveLength(1);
	});

	test('a hidden picture is not a player\'s to pick, even knowing its file', () => {
		const { id } = battlefield();
		const dragon = picture('token', 'SECRET dragon');
		const hero = revealed('token', 'Hero');
		const gone = revealed('token', 'Gone');
		removeFromGallery(db, gm, gone.id);

		// The same answer as for a picture that was never there.
		expect(refusal(() => token(id, { image: dragon.file }, player))).toBe('conflict');
		const me = token(id, { name: 'Mira' }, player);
		expect(refusal(() => perform(db, player, { t: 'token.update', id: me.id, changes: { image: dragon.file } }))).toBe('conflict');
		expect(refusal(() => perform(db, player, { t: 'token.update', id: me.id, changes: { image: 'never-uploaded.png' } }))).toBe('conflict');

		// The GM can put a hidden picture on the player's token, and it stays
		// there while the player does anything else with the token.
		perform(db, gm, { t: 'token.update', id: me.id, changes: { image: dragon.file } });
		expect(perform(db, player, { t: 'token.update', id: me.id, changes: { x: 0.2, name: 'Mira the Bold' } })).toHaveLength(1);

		// Swapping it for a revealed one is undone like anything else: undo
		// hands the token back what it wore. That is no way to pick it afresh.
		const [swapped] = perform(db, player, { t: 'token.update', id: me.id, changes: { image: hero.file } });
		const [back] = perform(db, player, { t: 'history.revert', seq: swapped.seq });
		expect((back.after as Token).image).toBe(dragon.file);
		perform(db, player, { t: 'token.update', id: me.id, changes: { image: null } });
		expect(refusal(() => perform(db, player, { t: 'token.update', id: me.id, changes: { image: dragon.file } }))).toBe('conflict');

		// Once hidden again, a picture stays on the tokens that wear it and is no longer there to pick.
		const mine = token(id, { name: 'Second', image: hero.file }, player);
		hideInGallery(db, gm, hero.id, true);
		expect((getMapSnapshot(db, gm.campaignId, id, 'player')!.tokens.find((t) => t.id === mine.id) as Token).image).toBe(hero.file);
		expect(refusal(() => token(id, { image: hero.file }, other))).toBe('conflict');
		// But for whoever has a token that wears it: their own token's face is theirs to use again.
		expect(refusal(() => token(id, { image: hero.file }, player))).toBe('allowed');
	});

	test('each kind of picture has its use, and no other', () => {
		const { id } = battlefield();
		const face = picture('token');
		const coast = picture('map');
		expect(refusal(() => perform(db, gm, { t: 'map.update', id: mapId, image: face.file }))).toBe('conflict');
		expect(refusal(() => token(id, { image: coast.file }))).toBe('conflict');
		expect(refusal(() => token(id, { image: coast.file }, player))).toBe('conflict');
		expect(refusal(() => token(id, { image: 'never-uploaded.png' }))).toBe('conflict');
		expect(refusal(() => token(id, { image: '../../etc/passwd' }))).toBe('invalid');
		expect(refusal(() => performReceived(db, gm, { t: 'map.update', id: mapId, image: null }))).toBe('invalid');
	});

	test('a picture taken out of the gallery stays where it is shown', () => {
		const { region, id } = battlefield();
		const coast = picture('map', 'Coast');
		const face = picture('token', 'Goblin');
		perform(db, gm, { t: 'map.update', id, image: coast.file });
		const goblin = token(id, { image: face.file });

		// Nothing is removed from disk yet: both are still in front of the table.
		expect(removeFromGallery(db, gm, coast.id)).toEqual([]);
		expect(removeFromGallery(db, gm, face.id)).toEqual([]);
		expect(names()).toEqual([]);
		expect(names(player)).toEqual([]);
		expect(mapNow(id).imageFile).toBe(coast.file);
		expect(canLoadImage(db, gm.campaignId, 'gm', coast.file)).toBe(true);
		expect(refusal(() => removeFromGallery(db, gm, coast.id))).toBe('not_found');

		// A deleted token can come back, so it holds on to its picture too.
		perform(db, gm, { t: 'token.delete', id: goblin.id });
		expect(sweepGallery(db, gm.campaignId)).toEqual([]);

		// Once the map is gone, and its tokens with it, nothing holds either.
		perform(db, gm, { t: 'region.delete', id: region.id });
		expect(sweepGallery(db, gm.campaignId).sort()).toEqual([coast.file, face.file].sort());
		expect(canLoadImage(db, gm.campaignId, 'gm', coast.file)).toBe(false);
	});

	test('one that nothing shows goes at once, and undo does not bring it back', () => {
		const first = picture('map', 'First');
		const second = picture('map', 'Second');
		perform(db, gm, { t: 'map.update', id: mapId, image: first.file });
		const [replaced] = perform(db, gm, { t: 'map.update', id: mapId, image: second.file });

		expect(removeFromGallery(db, gm, first.id)).toEqual([first.file]);
		expect(refusal(() => perform(db, gm, { t: 'history.revert', seq: replaced.seq }))).toBe('conflict');
		expect(mapNow(mapId).imageFile).toBe(second.file);
	});

	test('a player loads what the GM has revealed, used or not', () => {
		const knight = revealed('token');
		expect(playerLoads(knight.file)).toBe(true);
		expect(playerLoads('never-uploaded.png')).toBe(false);

		// Hidden again, or taken out of the gallery, it is no longer on show.
		hideInGallery(db, gm, knight.id, true);
		expect(playerLoads(knight.file)).toBe(false);
		hideInGallery(db, gm, knight.id, false);
		removeFromGallery(db, gm, knight.id);
		expect(playerLoads(knight.file)).toBe(false);
	});

	test('a hidden picture they load only where it is in front of them', () => {
		const coast = picture('map');
		const unused = picture('map');
		const face = picture('token');
		const mask = picture('token');
		const { region, id } = battlefield();
		perform(db, gm, { t: 'map.update', id, image: coast.file });
		token(id, { image: face.file });
		const lurker = token(id, { image: mask.file, hidden: true });

		expect(playerLoads(coast.file)).toBe(true);
		expect(playerLoads(face.file)).toBe(true);
		// Not what is only in the gallery, nor the face of a token they can't see.
		expect(playerLoads(unused.file)).toBe(false);
		expect(playerLoads(mask.file)).toBe(false);
		expect(canLoadImage(db, gm.campaignId, 'gm', mask.file)).toBe(true);

		perform(db, gm, { t: 'token.update', id: lurker.id, changes: { hidden: false } });
		expect(playerLoads(mask.file)).toBe(true);
		perform(db, gm, { t: 'token.delete', id: lurker.id });
		expect(playerLoads(mask.file)).toBe(false);

		// Behind a hidden region, the map keeps its picture and its tokens' to itself.
		perform(db, gm, { t: 'region.update', id: region.id, hidden: true });
		expect(playerLoads(coast.file)).toBe(false);
		expect(playerLoads(face.file)).toBe(false);
		// Unless the same picture is also somewhere they can go.
		perform(db, gm, { t: 'map.update', id: mapId, image: coast.file });
		expect(playerLoads(coast.file)).toBe(true);
	});

	test('one campaign cannot use, see or tidy another\'s pictures', async () => {
		const coast = picture('map');
		const rival = await registerUser(db, 'rival', 'another long password');
		const elsewhere = createCampaign(db, rival, 'Elsewhere');
		const outsider = actorFor(rival, getMembership(db, elsewhere.id, rival.id)!);

		expect(listGallery(db, outsider)).toEqual([]);
		expect(refusal(() => perform(db, outsider, { t: 'map.update', id: elsewhere.rootMapId, image: coast.file }))).toBe('conflict');
		expect(refusal(() => removeFromGallery(db, outsider, coast.id))).toBe('not_found');
		expect(canLoadImage(db, elsewhere.id, 'gm', coast.file)).toBe(false);
		expect(canLoadImage(db, elsewhere.id, 'player', coast.file)).toBe(false);
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
		const [created] = eventsAfter(db, 0);
		expect(refusal(() => perform(db, outsider, { t: 'history.revert', seq: created.seq }))).toBe('not_found');
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
		for (const input of bad) expect(refusal(() => performReceived(db, player, input))).toBe('invalid');
		expect(refusal(() => perform(db, gm, { t: 'region.create', mapId, name: 'Line', points: [[0, 0], [1, 1]] }))).toBe('invalid');
		expect(eventsAfter(db, 0)).toHaveLength(0);
	});

	test('an edit that changes nothing leaves no trace', () => {
		const marker = note();
		expect(perform(db, player, { t: 'marker.update', id: marker.id, changes: { title: marker.title } })).toHaveLength(0);
	});
});
