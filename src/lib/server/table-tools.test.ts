// What a session is run with: marks on tokens, the turn order, spell
// templates, the scale of a world map, the road the party has taken, the
// finder, a picture held up for the table, and what a token picture starts
// its tokens out as.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, registerUser } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import {
	addToGallery,
	canLoadImage,
	hideInGallery,
	listGallery,
	newImageFile,
	presetInGallery,
	removeFromGallery,
	showToTable,
	shownTo
} from './gallery';
import { findable, getMapSnapshot } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, perform, undoable, type Actor } from './world';
import type {
	Drawing,
	MapInfo,
	Marker,
	Patch,
	Point,
	Region,
	StoredEvent,
	Token
} from '../shared/types';

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

const battlefield = () => draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;

function token(by: Actor, on: string, extra: Record<string, unknown> = {}): Token {
	const [made] = perform(db, by, { t: 'token.create', mapId: on, name: 'Goblin', x: 0.5, y: 0.5, ...extra });
	return made.after as Token;
}

const sees = (id: string, role: 'gm' | 'player' = 'player') =>
	getMapSnapshot(db, gm.campaignId, id, role)!;

/** What a player's browser is told to do about these events. */
const toldPlayer = (events: StoredEvent[]): Patch[] =>
	events.flatMap((e) => toLiveEvent(db, e, 'player')?.patch ?? []);

const undo = (by: Actor, events: StoredEvent[]) =>
	perform(db, by, { t: 'history.revert', seq: undoable(events)[0] });

describe('marks on tokens', () => {
	test('anyone marks a token, each mark once and in a fixed order', () => {
		const bridge = battlefield();
		const goblin = token(gm, bridge);
		expect(goblin.marks).toEqual([]);

		const [marked] = perform(db, player, {
			t: 'token.update',
			id: goblin.id,
			changes: { marks: ['blue', 'down', 'blue', 'red'] }
		});
		expect((marked.after as Token).marks).toEqual(['down', 'red', 'blue']);
		expect(sees(bridge).tokens[0].marks).toEqual(['down', 'red', 'blue']);

		// The same marks again are no change at all.
		expect(
			perform(db, player, { t: 'token.update', id: goblin.id, changes: { marks: ['red', 'down', 'blue'] } })
		).toHaveLength(0);
		expect(
			refusal(() => perform(db, player, { t: 'token.update', id: goblin.id, changes: { marks: ['on fire'] } }))
		).toBe('invalid');
		expect(
			refusal(() => perform(db, player, { t: 'token.update', id: goblin.id, changes: { marks: 'red' } }))
		).toBe('invalid');
	});

	test('undo takes a mark back off, and leaves a move made since alone', () => {
		const bridge = battlefield();
		const goblin = token(gm, bridge);
		const marked = perform(db, player, { t: 'token.update', id: goblin.id, changes: { marks: ['red'] } });
		perform(db, player, { t: 'token.update', id: goblin.id, changes: { x: 0.6 } });

		undo(player, marked);
		expect(sees(bridge).tokens[0]).toMatchObject({ marks: [], x: 0.6 });
	});

	test('a copy of a token wears the same marks', () => {
		const bridge = battlefield();
		const goblin = token(gm, bridge, { marks: ['green'] });
		const [copied] = perform(db, player, { t: 'token.duplicate', id: goblin.id });
		expect((copied.after as Token).marks).toEqual(['green']);
	});
});

describe('the turn order', () => {
	const turns = (id: string, role: 'gm' | 'player' = 'player') => sees(id, role).map.turns;

	test('the GM says who takes turns and whose turn it is, on a battle map', () => {
		const bridge = battlefield();
		const [a, b] = [token(gm, bridge), token(gm, bridge, { x: 0.6 })];
		expect(turns(bridge)).toEqual({ order: [], current: null, round: 1 });

		perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [b.id, a.id, b.id] } });
		expect(turns(bridge)).toEqual({ order: [b.id, a.id], current: null, round: 1 });
		perform(db, gm, { t: 'map.update', id: bridge, turns: { current: a.id, round: 2 } });
		expect(turns(bridge)).toEqual({ order: [b.id, a.id], current: a.id, round: 2 });

		// A token that leaves the order takes its turn with it.
		perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [b.id] } });
		expect(turns(bridge)).toEqual({ order: [b.id], current: null, round: 2 });

		const set = (changes: unknown, by = gm, on = bridge) =>
			refusal(() => perform(db, by, { t: 'map.update', id: on, turns: changes }));
		expect(set({ order: [a.id] }, player)).toBe('forbidden');
		expect(set({ order: ['nobody'] })).toBe('not_found');
		expect(set({ order: [a.id] }, gm, mapId)).toBe('invalid');
		expect(set({ round: 0 })).toBe('invalid');
		expect(set({ order: 'all of them' })).toBe('invalid');
	});

	test('a token of another map is not one to take turns here', () => {
		const bridge = battlefield();
		const elsewhere = draw('The Pit', mapId, { kind: 'battle' }).targetMapId;
		const stranger = token(gm, elsewhere);
		expect(
			refusal(() => perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [stranger.id] } }))
		).toBe('not_found');
	});

	test('a player is told only of the tokens in it that they can see', () => {
		const bridge = battlefield();
		const seen = token(gm, bridge);
		const ambush = token(gm, bridge, { x: 0.7, hidden: true });
		const set = perform(db, gm, {
			t: 'map.update',
			id: bridge,
			turns: { order: [ambush.id, seen.id], current: ambush.id }
		});

		expect(turns(bridge, 'gm')).toEqual({ order: [ambush.id, seen.id], current: ambush.id, round: 1 });
		// To a player the hidden token's turn is nobody's, and it is not in the order.
		expect(turns(bridge)).toEqual({ order: [seen.id], current: null, round: 1 });
		const [told] = toldPlayer(set);
		expect((told as Extract<Patch, { t: 'map.upsert' }>).map.turns).toEqual(turns(bridge));
		expect(JSON.stringify(toldPlayer(set))).not.toContain(ambush.id);
	});

	test('a token coming into sight brings its place in the order with it, and takes it along when it goes', () => {
		const bridge = battlefield();
		const seen = token(gm, bridge);
		const ambush = token(gm, bridge, { x: 0.7, hidden: true });
		perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [ambush.id, seen.id], current: ambush.id } });

		const revealed = perform(db, gm, { t: 'token.update', id: ambush.id, changes: { hidden: false } });
		expect(toldPlayer(revealed)[0]).toMatchObject({
			t: 'token.upsert',
			turns: { order: [ambush.id, seen.id], current: ambush.id, round: 1 }
		});
		// A change that leaves it in sight says nothing of the order.
		const moved = perform(db, gm, { t: 'token.update', id: ambush.id, changes: { x: 0.8 } });
		expect(toldPlayer(moved)[0]).not.toHaveProperty('turns');

		const hidden = perform(db, gm, { t: 'token.update', id: ambush.id, changes: { hidden: true } });
		expect(toldPlayer(hidden)[0]).toMatchObject({
			t: 'token.remove',
			turns: { order: [seen.id], current: null, round: 1 }
		});

		// Fog does the same as hiding: under it, a token is out of the order they see.
		perform(db, gm, { t: 'token.update', id: ambush.id, changes: { hidden: false } });
		const fogged = perform(db, gm, { t: 'map.update', id: bridge, fog: { on: true, clear: [] } });
		expect((toldPlayer(fogged)[0] as Extract<Patch, { t: 'map.upsert' }>).map.turns.order).toEqual([]);
	});

	test('a token taken off the map keeps its place for when it comes back', () => {
		const bridge = battlefield();
		const [a, b] = [token(gm, bridge), token(gm, bridge, { x: 0.6 })];
		perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [a.id, b.id], current: a.id } });

		const gone = perform(db, gm, { t: 'token.delete', id: a.id });
		expect(turns(bridge, 'gm').order).toEqual([a.id, b.id]);
		expect(toldPlayer(gone)[0]).toMatchObject({ t: 'token.remove', turns: { order: [b.id], current: null } });
		undo(gm, gone);
		expect(turns(bridge)).toEqual({ order: [a.id, b.id], current: a.id, round: 1 });
	});

	test('undo takes a turn back, and leaves fog cleared since as it is', () => {
		const bridge = battlefield();
		const [a, b] = [token(gm, bridge), token(gm, bridge, { x: 0.6 })];
		perform(db, gm, { t: 'map.update', id: bridge, turns: { order: [a.id, b.id], current: a.id } });
		const next = perform(db, gm, { t: 'map.update', id: bridge, turns: { current: b.id } });
		perform(db, gm, { t: 'map.update', id: bridge, fog: { on: true, clear: [[0, 0, 1, 1]] } });

		undo(gm, next);
		const map = sees(bridge, 'gm').map;
		expect(map.turns.current).toBe(a.id);
		expect(map.fog.on).toBe(true);
	});
});

describe('spell templates', () => {
	const template = (on: string, kind: string, points: unknown, by: Actor = player) =>
		perform(db, by, { t: 'drawing.create', mapId: on, kind, points, color: '#e5544b' });

	test('anyone lays one down: a circle, a cone or a box, kept as two points', () => {
		const bridge = battlefield();
		for (const kind of ['circle', 'cone', 'rect']) {
			const [made] = template(bridge, kind, [[0.5, 0.5], [0.6, 0.5]]);
			expect(made.after).toMatchObject({ kind, points: [[0.5, 0.5], [0.6, 0.5]], text: '', authorId: player.userId });
		}
		expect(sees(bridge).drawings.map((d) => d.kind)).toEqual(['circle', 'cone', 'rect']);
	});

	test('one needs two points, apart, on the map', () => {
		const bridge = battlefield();
		const lay = (points: unknown, kind = 'circle') => refusal(() => template(bridge, kind, points));
		expect(lay([[0.5, 0.5]])).toBe('invalid');
		expect(lay([[0.5, 0.5], [0.6, 0.5], [0.7, 0.5]])).toBe('invalid');
		expect(lay([[0.5, 0.5], [0.5, 0.5]])).toBe('invalid');
		expect(lay([[0.5, 0.5], [1.2, 0.5]])).toBe('invalid');
		expect(lay([[0.5, 0.5], [0.6, 0.5]], 'hexagon')).toBe('invalid');
		expect(refusal(() => template(mapId, 'circle', [[0.5, 0.5], [0.6, 0.5]]))).toBe('invalid');
	});

	test('it is moved and rubbed out like any drawing: by whoever laid it, and the GM', () => {
		const bridge = battlefield();
		const made = template(bridge, 'cone', [[0.5, 0.5], [0.6, 0.5]], gm);
		const cone = made[0].after as Drawing;
		expect(
			refusal(() => perform(db, player, { t: 'drawing.update', id: cone.id, changes: { move: [0.1, 0] } }))
		).toBe('forbidden');

		const [moved] = perform(db, gm, { t: 'drawing.update', id: cone.id, changes: { move: [0.1, 0.2] } });
		expect((moved.after as Drawing).points).toEqual([[0.6, 0.7], [0.7, 0.7]]);
		undo(gm, [moved]);
		expect(sees(bridge).drawings[0].points).toEqual([[0.5, 0.5], [0.6, 0.5]]);
		undo(gm, made);
		expect(sees(bridge).drawings).toHaveLength(0);
	});
});

describe('the scale of a world map', () => {
	const miles = (id: string) => sees(id).miles;

	test('the GM says how many miles across a world map is', () => {
		expect(miles(mapId)).toBeNull();
		const set = perform(db, gm, { t: 'map.update', id: mapId, miles: 600 });
		expect(miles(mapId)).toBe(600);
		expect((set[0].after as MapInfo).miles).toBe(600);

		const scale = (value: unknown, by = gm, on = mapId) =>
			refusal(() => perform(db, by, { t: 'map.update', id: on, miles: value }));
		expect(scale(300, player)).toBe('forbidden');
		expect(scale(0)).toBe('invalid');
		expect(scale('far')).toBe('invalid');
		expect(scale(300, gm, battlefield())).toBe('invalid');

		undo(gm, set);
		expect(miles(mapId)).toBeNull();
	});

	test('a map further in works its own out from the way there', () => {
		perform(db, gm, { t: 'map.update', id: mapId, miles: 1000 });
		// The region is three tenths of the map across, and so is the map behind it.
		const kingdom = draw('The Kingdom').targetMapId;
		expect(miles(kingdom)).toBeCloseTo(300);
		const duchy = draw('The Duchy', kingdom).targetMapId;
		expect(miles(duchy)).toBeCloseTo(90);

		// A scale of its own wins, and the maps inside go by that one.
		perform(db, gm, { t: 'map.update', id: kingdom, miles: 50 });
		expect(miles(kingdom)).toBe(50);
		expect(miles(duchy)).toBeCloseTo(15);
		perform(db, gm, { t: 'map.update', id: kingdom, miles: null });
		expect(miles(duchy)).toBeCloseTo(90);

		// A battle map is measured in feet.
		expect(miles(battlefield())).toBeNull();
	});
});

describe('the road the party has taken', () => {
	const journey = (id = mapId) => sees(id).journey;
	const move = (x: number, y: number, on = mapId) => perform(db, gm, { t: 'party.move', mapId: on, x, y });

	test('every move on a map adds a stop to it', () => {
		expect(journey()).toEqual([]);
		move(0.1, 0.1);
		move(0.2, 0.3);
		move(0.5, 0.3);
		expect(journey()).toEqual([[[0.1, 0.1], [0.2, 0.3], [0.5, 0.3]]]);
	});

	test('undoing a move takes the stop back off the road', () => {
		move(0.1, 0.1);
		move(0.2, 0.3);
		const strayed = move(0.9, 0.9);
		undo(gm, strayed);
		expect(journey()).toEqual([[[0.1, 0.1], [0.2, 0.3]]]);
	});

	test('leaving the map ends a stretch, and coming back starts another', () => {
		const inside = draw('The Kingdom').targetMapId;
		move(0.1, 0.1);
		move(0.2, 0.2);
		move(0.5, 0.5, inside);
		move(0.6, 0.6, inside);
		expect(journey()).toEqual([[[0.1, 0.1], [0.2, 0.2]]]);
		expect(journey(inside)).toEqual([[[0.5, 0.5], [0.6, 0.6]]]);

		move(0.8, 0.8);
		move(0.9, 0.8);
		expect(journey()).toEqual([
			[[0.1, 0.1], [0.2, 0.2]],
			[[0.8, 0.8], [0.9, 0.8]]
		]);
		// Taken off the maps and planted again: a stretch of its own too.
		perform(db, gm, { t: 'party.remove' });
		move(0.3, 0.3);
		expect(journey()).toHaveLength(3);
	});
});

describe('the finder', () => {
	/** By name, in the order of the alphabet: markers made in the same instant come in any order. */
	const names = (role: 'gm' | 'player') =>
		findable(db, gm.campaignId, role)
			.map((e) => e.name)
			.sort();

	test('it knows every map and marker, and the way to each', () => {
		const kingdom = draw('The Kingdom').targetMapId;
		const [made] = perform(db, gm, {
			t: 'marker.create',
			mapId: kingdom,
			kind: 'world',
			type: 'city',
			title: 'Saltmere',
			x: 0.5,
			y: 0.5
		});
		const found = findable(db, gm.campaignId, 'player');
		expect(found.find((e) => e.name === 'The Kingdom')).toMatchObject({
			kind: 'map',
			mapId: kingdom,
			path: ['The Sunless Reach'],
			type: 'world',
			hidden: false
		});
		expect(found.find((e) => e.name === 'Saltmere')).toMatchObject({
			kind: 'marker',
			id: (made.after as Marker).id,
			mapId: kingdom,
			path: ['The Sunless Reach', 'The Kingdom'],
			type: 'city'
		});
	});

	test('a player is told of nothing hidden, nor of anything behind a hidden region', () => {
		const vault = draw('The Vault', mapId, { hidden: true }).targetMapId;
		draw('The Inner Vault', vault);
		const pin = { t: 'marker.create', kind: 'world', type: 'treasure', x: 0.5, y: 0.5 };
		perform(db, gm, { ...pin, mapId: vault, title: 'The Crown' });
		perform(db, gm, { ...pin, mapId, title: 'The Trapdoor', hidden: true });
		perform(db, gm, { ...pin, mapId, title: 'The Inn' });

		expect(names('player')).toEqual(['The Inn', 'The Sunless Reach']);
		expect(names('gm')).toEqual([
			'The Crown',
			'The Inn',
			'The Inner Vault',
			'The Sunless Reach',
			'The Trapdoor',
			'The Vault'
		]);
		const hidden = findable(db, gm.campaignId, 'gm').filter((e) => e.hidden);
		expect(hidden.map((e) => e.name).sort()).toEqual([
			'The Crown',
			'The Inner Vault',
			'The Trapdoor',
			'The Vault'
		]);
	});
});

describe('a picture held up for the table', () => {
	const picture = (kind: 'map' | 'token' = 'map', name = 'The Lich') =>
		addToGallery(db, gm, { kind, name, file: newImageFile('png'), width: 640, height: 480 });
	const loads = (file: string) => canLoadImage(db, gm.campaignId, 'player', file);

	test('the GM holds one up, and players may load it for as long as it is', () => {
		const lich = picture();
		expect(shownTo(db, gm.campaignId)).toBeNull();
		expect(loads(lich.file)).toBe(false);

		expect(showToTable(db, gm, lich.id)).toEqual({ file: lich.file, name: 'The Lich', width: 640, height: 480 });
		expect(shownTo(db, gm.campaignId)?.file).toBe(lich.file);
		expect(loads(lich.file)).toBe(true);
		// Holding it up does not put it on the shelf players pick from.
		expect(listGallery(db, player)).toHaveLength(0);

		expect(showToTable(db, gm, null)).toBeNull();
		expect(shownTo(db, gm.campaignId)).toBeNull();
		expect(loads(lich.file)).toBe(false);
	});

	test('only the GM does, and only with a picture of this campaign', () => {
		const lich = picture();
		expect(refusal(() => showToTable(db, player, lich.id))).toBe('forbidden');
		expect(refusal(() => showToTable(db, gm, 'nothing'))).toBe('not_found');
		expect(shownTo(db, gm.campaignId)).toBeNull();
	});

	test('one taken out of the gallery comes down with it', () => {
		const lich = picture();
		showToTable(db, gm, lich.id);
		removeFromGallery(db, gm, lich.id);
		expect(shownTo(db, gm.campaignId)).toBeNull();
		expect(loads(lich.file)).toBe(false);
	});
});

describe('what a token picture starts its tokens out as', () => {
	test('the GM gives a token picture a size and an outline, and the dock is told', () => {
		const ogre = addToGallery(db, gm, { kind: 'token', name: 'Ogre', file: newImageFile('webp'), width: 512, height: 512 });
		expect(ogre).toMatchObject({ tokenSize: null, tokenOutline: null });

		presetInGallery(db, gm, ogre.id, { size: 2, outline: '#e5544b' });
		expect(listGallery(db, gm)[0]).toMatchObject({ tokenSize: 2, tokenOutline: '#e5544b' });
		hideInGallery(db, gm, ogre.id, false);
		expect(listGallery(db, player)[0]).toMatchObject({ tokenSize: 2, tokenOutline: '#e5544b' });

		// With neither given it goes back to the usual.
		presetInGallery(db, gm, ogre.id, {});
		expect(listGallery(db, gm)[0]).toMatchObject({ tokenSize: null, tokenOutline: null });
	});

	test('it is held to what a token can be, and is the GM\'s to say', () => {
		const ogre = addToGallery(db, gm, { kind: 'token', name: 'Ogre', file: newImageFile('webp'), width: 512, height: 512 });
		const scene = addToGallery(db, gm, { kind: 'map', name: 'Cave', file: newImageFile('png'), width: 640, height: 480 });
		expect(refusal(() => presetInGallery(db, gm, ogre.id, { size: 2.3 }))).toBe('invalid');
		expect(refusal(() => presetInGallery(db, gm, ogre.id, { size: 40 }))).toBe('invalid');
		expect(refusal(() => presetInGallery(db, gm, ogre.id, { outline: 'red' }))).toBe('invalid');
		expect(refusal(() => presetInGallery(db, player, ogre.id, { size: 2 }))).toBe('forbidden');
		expect(refusal(() => presetInGallery(db, gm, scene.id, { size: 2 }))).toBe('invalid');
	});
});
