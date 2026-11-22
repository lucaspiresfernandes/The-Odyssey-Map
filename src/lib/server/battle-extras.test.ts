// What a fight is kept track of with: the number a token carries, what each
// rolled for its place in the turn order, and ending a turn. And a whole
// campaign going out to one file and coming back as a new campaign.

import { beforeEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { exportCampaign, importCampaign, ImportError } from './archive';
import { createGuest, registerUser, type User } from './auth';
import {
	actorFor,
	createCampaign,
	dateOf,
	getMembership,
	joinCampaign,
	listCampaigns,
	setDate
} from './campaigns';
import { openDb, type Db } from './db';
import { addToGallery, listGallery, newImageFile } from './gallery';
import { getMapSnapshot } from './queries';
import { memoryStorage, setStorage, type Storage } from './storage';
import { tarEntries, tarStream } from './tar';
import { uploadKey } from './tiles';
import { toLiveEvent } from './visibility';
import { ActionError, perform, undoable, viewerOf, type Actor } from './world';
import { gridFromBox } from '../shared/grid';
import { countFrom, sortedByRolls } from '../shared/turns';
import type { MapInfo, Point, Region, Token } from '../shared/types';
import type { CommandOf } from '../shared/types';

let db: Db;
let owner: User;
let gm: Actor;
let player: Actor;
let mapId: string;
let field: string;

const SQUARE: Point[] = [
	[0.1, 0.1],
	[0.4, 0.1],
	[0.4, 0.4],
	[0.1, 0.4]
];

beforeEach(async () => {
	db = openDb(':memory:');
	owner = await registerUser(db, 'keeper', 'correct horse battery');
	const campaign = createCampaign(db, owner, 'The Sunless Reach');
	const guest = createGuest(db, 'Mira');
	joinCampaign(db, campaign.id, guest.id);
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	player = actorFor(guest, getMembership(db, campaign.id, guest.id)!);
	mapId = campaign.rootMapId;
	field = draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;
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

function draw(name: string, on = mapId, extra: Partial<CommandOf<'region.create'>> = {}): Region {
	const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
	return events[1].after as Region;
}

function token(name: string, extra: Partial<CommandOf<'token.create'>> = {}): Token {
	const [made] = perform(db, gm, { t: 'token.create', mapId: field, name, x: 0.5, y: 0.5, ...extra });
	return made.after as Token;
}

const turns = (who: Actor = gm) =>
	getMapSnapshot(db, gm.campaignId, field, viewerOf(who))!.map.turns;

describe('the number on a token', () => {
	test('anyone sets it, changes it and takes it off, and undo puts it back', () => {
		const ogre = token('Ogre');
		expect(ogre.count).toBeNull();
		const [set] = perform(db, player, { t: 'token.update', id: ogre.id, changes: { count: 59 } });
		expect((set.after as Token).count).toBe(59);
		expect(perform(db, player, { t: 'token.update', id: ogre.id, changes: { count: 59 } })).toHaveLength(0);
		perform(db, gm, { t: 'token.update', id: ogre.id, changes: { count: null } });
		perform(db, player, { t: 'history.revert', seq: set.seq });
		const now = getMapSnapshot(db, gm.campaignId, field, 'gm')!.tokens[0];
		expect(now.count).toBeNull();

		for (const count of [1.5, 100000, -1000, '7', NaN]) {
			expect(refusal(() => perform(db, gm, { t: 'token.update', id: ogre.id, changes: { count } as never }))).toBe('invalid');
		}
	});

	test('a copy carries the same number', () => {
		const ogre = token('Ogre', { count: 12 });
		const [copied] = perform(db, gm, { t: 'token.duplicate', id: ogre.id });
		expect((copied.after as Token).count).toBe(12);
	});

	test('what is typed for it: a number, or how much more or less', () => {
		const limits = { min: -999, max: 9999 };
		expect(countFrom('24', 10, limits)).toBe(24);
		expect(countFrom('+3', 10, limits)).toBe(13);
		expect(countFrom(' - 5 ', 10, limits)).toBe(5);
		expect(countFrom('-5', null, limits)).toBe(-5);
		expect(countFrom('=-5', 10, limits)).toBe(-5);
		expect(countFrom('', 10, limits)).toBeNull();
		expect(countFrom('+99999', 10, limits)).toBe(9999);
		expect(countFrom('ten', 10, limits)).toBeUndefined();
	});
});

describe('what each token rolled', () => {
	test('the order sorts by it, highest first, and the rest keep their places after', () => {
		expect(sortedByRolls(['a', 'b', 'c', 'd'], { b: 17, d: 17, c: 20 })).toEqual(['c', 'b', 'd', 'a']);
		expect(sortedByRolls(['a', 'b'], {})).toEqual(['a', 'b']);
	});

	test('the GM keeps the rolls with the order, and players are not sent them', () => {
		const [a, b] = [token('Ana'), token('Brute')];
		const [kept] = perform(db, gm, {
			t: 'map.update',
			id: field,
			turns: { order: [b.id, a.id], rolls: { [a.id]: 12, [b.id]: 19, stranger: 4 } }
		});
		// Only for the tokens that take turns, and in the order they take them.
		expect((kept.after as MapInfo).turns.rolls).toEqual({ [b.id]: 19, [a.id]: 12 });
		expect(turns().rolls).toEqual({ [b.id]: 19, [a.id]: 12 });
		expect(turns(player).rolls).toBeUndefined();

		// A token that leaves the order leaves its roll behind.
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [a.id] } });
		expect(turns().rolls).toEqual({ [a.id]: 12 });
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [], current: null, round: 1 } });
		expect(turns()).toEqual({ order: [], current: null, round: 1 });
		expect(refusal(() => perform(db, gm, { t: 'map.update', id: field, turns: { order: [a.id], rolls: { [a.id]: 1.5 } } }))).toBe('invalid');
	});
});

describe('ending a turn', () => {
	test('anyone ends the turn of a token they can see, and it moves on once', () => {
		const [a, b] = [token('Ana'), token('Brute')];
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [a.id, b.id] } });
		// Starting the fight is the GM's.
		expect(refusal(() => perform(db, player, { t: 'turn.next', mapId: field, from: null }))).toBe('forbidden');
		perform(db, gm, { t: 'turn.next', mapId: field, from: null });
		expect(turns().current).toBe(a.id);

		const passed = perform(db, player, { t: 'turn.next', mapId: field, from: a.id });
		expect(turns()).toMatchObject({ current: b.id, round: 1 });
		expect(toLiveEvent(db, passed[0], 'player')!.patch).toMatchObject({ t: 'map.upsert' });
		// Two people pressing at once: the second finds that turn already over.
		expect(perform(db, gm, { t: 'turn.next', mapId: field, from: a.id })).toHaveLength(0);
		expect(turns().current).toBe(b.id);

		// Round the top of the order is the next round.
		perform(db, player, { t: 'turn.next', mapId: field, from: b.id });
		expect(turns()).toMatchObject({ current: a.id, round: 2 });
		// The map is the GM's to undo, so a player's undo has nothing of this to take back.
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: passed[0].seq }))).toBe('not_found');
		expect(undoable(passed)).toEqual([passed[0].seq]);
	});

	test('a turn that is nobody a player can see is the GM to move on from', () => {
		const [a, lurker] = [token('Ana'), token('Lurker', { hidden: true })];
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [a.id, lurker.id], current: lurker.id } });
		expect(turns(player).current).toBeNull();
		expect(refusal(() => perform(db, player, { t: 'turn.next', mapId: field, from: lurker.id }))).toBe('forbidden');
		// Naming a turn that isn't the one it is ends nothing, whoever asks.
		expect(perform(db, player, { t: 'turn.next', mapId: field, from: null })).toHaveLength(0);
		expect(turns().current).toBe(lurker.id);
		expect(perform(db, gm, { t: 'turn.next', mapId: field, from: lurker.id })).toHaveLength(1);
		expect(refusal(() => perform(db, gm, { t: 'turn.next', mapId, from: null }))).toBe('invalid');
	});

	test('the GM goes back a turn, once for each press, as far as before the fight', () => {
		const [a, b] = [token('Ana'), token('Brute')];
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [a.id, b.id], current: a.id, round: 2 } });
		// It is not the table's: a player ends turns, and never takes one back.
		expect(refusal(() => perform(db, player, { t: 'turn.back', mapId: field, from: a.id }))).toBe('forbidden');

		// Back over the top of the order is the round before.
		const back = perform(db, gm, { t: 'turn.back', mapId: field, from: a.id });
		expect(turns()).toMatchObject({ current: b.id, round: 1 });
		expect(toLiveEvent(db, back[0], 'player')!.patch).toMatchObject({ t: 'map.upsert' });
		// A second press that named the same turn goes back no further.
		expect(perform(db, gm, { t: 'turn.back', mapId: field, from: a.id })).toHaveLength(0);
		expect(turns().current).toBe(b.id);

		perform(db, gm, { t: 'turn.back', mapId: field, from: b.id });
		expect(turns()).toMatchObject({ current: a.id, round: 1 });
		// Back from the first turn of all, the fight has not started.
		perform(db, gm, { t: 'turn.back', mapId: field, from: a.id });
		expect(turns()).toMatchObject({ order: [a.id, b.id], current: null, round: 1 });
		// With no turn on, there is none to go back from.
		expect(perform(db, gm, { t: 'turn.back', mapId: field, from: a.id })).toHaveLength(0);
		expect(refusal(() => perform(db, gm, { t: 'turn.back', mapId, from: a.id }))).toBe('invalid');
	});
});

describe('lining the grid up by a box', () => {
	const sheet = { width: 2000, height: 1000 };
	const limits = { min: 8, max: 2000 };

	test('one square dragged is one cell, and the lines run along its edges', () => {
		expect(gridFromBox(sheet, [0.1, 0.2, 0.135, 0.27], 1, limits)).toEqual({ size: 70, x: 60, y: 60 });
	});

	test('several squares say it better, and a box not quite square is weighed both ways', () => {
		// Five squares across and two down, of 64 pixels: dragged a little wide.
		const grid = gridFromBox(sheet, [0.016, 0.064, 0.1765, 0.192], 5, limits);
		expect(grid.size).toBeCloseTo(64, 0);
		expect(grid.x).toBeCloseTo(32, 0);
	});

	test('a cell is never smaller or bigger than a grid allows', () => {
		expect(gridFromBox(sheet, [0, 0, 0.001, 0.002], 1, limits).size).toBe(8);
	});
});

describe('a campaign in one file', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = memoryStorage();
		setStorage(storage);
	});

	/** A small picture that really is one. */
	async function picture(kind: 'map' | 'token', name: string) {
		const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#445566' } })
			.png()
			.toBuffer();
		const file = newImageFile('png');
		await storage.put(uploadKey(file), new Uint8Array(bytes));
		return addToGallery(db, gm, { kind, name, file, width: 40, height: 30 });
	}

	const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
		new Uint8Array(await new Response(stream).arrayBuffer());
	const streamOf = (bytes: Uint8Array) =>
		new Blob([new Uint8Array(bytes)]).stream() as ReadableStream<Uint8Array>;

	test('an archive written is an archive read, by this and by any other tool', async () => {
		const text = (words: string) => new TextEncoder().encode(words);
		async function* files() {
			yield { name: 'a.txt', size: 5, bytes: [text('hel'), text('lo')] };
			yield { name: 'dir/empty', size: 0, bytes: [] };
			yield { name: 'b.bin', size: 600, bytes: [new Uint8Array(600).fill(7)] };
		}
		const archive = await bytesOf(tarStream(files()));
		expect(archive.length % 512).toBe(0);
		const read = [];
		for await (const entry of tarEntries(streamOf(archive), () => 1000)) read.push(entry);
		expect(read.map((e) => [e.name, e.bytes.length])).toEqual([['a.txt', 5], ['dir/empty', 0], ['b.bin', 600]]);
		expect(new TextDecoder().decode(read[0].bytes)).toBe('hello');
		// Bun's own reader of the format agrees.
		const theirs = await new Bun.Archive(archive).files();
		expect(await theirs.get('a.txt')!.text()).toBe('hello');
		expect(theirs.get('b.bin')!.size).toBe(600);
	});

	test('everything about the world comes back, under ids of its own', async () => {
		const chart = await picture('map', 'The Chart');
		const face = await picture('token', 'Ogre');
		perform(db, gm, { t: 'map.update', id: mapId, image: chart.file, miles: 600 });
		const crypt = draw('The Crypt', mapId, { hidden: true });
		const tomb = draw('The Tomb', mapId, { closed: true });
		perform(db, gm, { t: 'region.update', id: crypt.id, seenBy: [player.userId] });
		perform(db, gm, { t: 'marker.create', mapId, kind: 'world', title: 'The cache', x: 0.5, y: 0.5, hidden: true });
		perform(db, player, { t: 'marker.create', mapId, kind: 'player', title: 'Our camp', x: 0.6, y: 0.6 });
		const ogre = token('Ogre', { image: face.file, count: 59, marks: ['red'] });
		perform(db, gm, { t: 'map.update', id: field, turns: { order: [ogre.id], current: ogre.id, rolls: { [ogre.id]: 14 } } });
		perform(db, player, { t: 'drawing.create', mapId: field, kind: 'text', points: [[0.3, 0.3]], text: 'Trap!' });
		const gone = token('Goblin');
		perform(db, gm, { t: 'token.delete', id: gone.id });
		setDate(db, gm, '3rd of Eleasis, 1492 DR');

		const out = exportCampaign(db, gm.campaignId);
		expect(out.name).toBe('The Sunless Reach');
		const file = await bytesOf(out.stream);
		// Whoever imports it need not be whoever made it.
		const other = await registerUser(db, 'another', 'correct horse battery');
		const copy = await importCampaign(db, other, streamOf(file));

		expect(copy.id).not.toBe(gm.campaignId);
		expect(listCampaigns(db, other.id).map((c) => [c.name, c.role])).toEqual([['The Sunless Reach', 'gm']]);
		// The story is where it had got to.
		expect(copy.date).toBe('3rd of Eleasis, 1492 DR');
		expect(dateOf(db, copy.id)).toBe('3rd of Eleasis, 1492 DR');
		const root = getMapSnapshot(db, copy.id, copy.rootMapId, 'gm')!;
		expect(root.map).toMatchObject({ name: 'The Sunless Reach', miles: 600, width: 40, height: 30 });
		expect(root.map.imageFile).not.toBe(chart.file);
		expect(await storage.has(uploadKey(root.map.imageFile!))).toBe(true);
		// Secrets with players stay behind: they were that table's.
		expect(root.regions.map((r) => [r.name, r.hidden, r.closed, r.seenBy, r.kind])).toEqual([
			['The Bridge', false, false, [], 'battle'],
			['The Crypt', true, false, [], 'world'],
			['The Tomb', false, true, [], 'world']
		]);
		expect(root.markers.map((m) => [m.title, m.kind, m.hidden, m.authorName])).toEqual([
			['The cache', 'world', true, 'keeper'],
			['Our camp', 'player', false, 'Mira']
		]);

		const bridge = root.regions[0].targetMapId;
		const fight = getMapSnapshot(db, copy.id, bridge, 'gm')!;
		// What was taken off the map before stays off it.
		expect(fight.tokens).toHaveLength(1);
		const [again] = fight.tokens;
		expect(again).toMatchObject({ name: 'Ogre', count: 59, marks: ['red'] });
		expect(again.id).not.toBe(ogre.id);
		expect(fight.map.turns).toEqual({ order: [again.id], current: again.id, round: 1, rolls: { [again.id]: 14 } });
		expect(fight.drawings.map((d) => d.text)).toEqual(['Trap!']);
		const shelf = listGallery(db, { ...gm, campaignId: copy.id, userId: other.id });
		expect(shelf.map((p) => p.name).sort()).toEqual(['Ogre', 'The Chart']);
		expect(shelf.every((p) => ![chart.file, face.file].includes(p.file))).toBe(true);
		expect(again.image).toBe(shelf.find((p) => p.name === 'Ogre')!.file);

		// The new campaign is one like any other, and the old one is as it was.
		const them = actorFor(other, getMembership(db, copy.id, other.id)!);
		const find = { t: 'marker.create', mapId: copy.rootMapId, kind: 'world', title: 'A new find', x: 0.4, y: 0.4 } as const;
		expect(perform(db, them, find)).toHaveLength(1);
		expect(getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.markers).toHaveLength(2);
		// And the same file is good for another.
		const second = await importCampaign(db, other, streamOf(file));
		expect(second.id).not.toBe(copy.id);
	});

	test('a file that is not one is refused, and leaves nothing behind', async () => {
		const junk = (bytes: Uint8Array) =>
			importCampaign(db, owner, streamOf(bytes)).then(
				() => 'imported',
				(err) => (err instanceof ImportError ? 'refused' : Promise.reject(err))
			);
		expect(await junk(new Uint8Array(2048).fill(65))).toBe('refused');
		expect(await junk(new Uint8Array(0))).toBe('refused');

		const chart = await picture('map', 'The Chart');
		perform(db, gm, { t: 'map.update', id: mapId, image: chart.file });
		const good = await bytesOf(exportCampaign(db, gm.campaignId).stream);
		// Cut short in the middle of the picture.
		expect(await junk(good.subarray(0, good.length - 1536))).toBe('refused');

		// A list that says something no command would be let say.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const tampered = async (change: (manifest: any) => void) => {
			const entries: { name: string; bytes: Uint8Array }[] = [];
			for await (const entry of tarEntries(streamOf(good), () => 1e9)) entries.push(entry);
			const manifest = JSON.parse(new TextDecoder().decode(entries[0].bytes));
			change(manifest);
			entries[0].bytes = new TextEncoder().encode(JSON.stringify(manifest));
			async function* files() {
				for (const { name, bytes } of entries) yield { name, size: bytes.length, bytes: [bytes] };
			}
			return junk(await bytesOf(tarStream(files())));
		};
		expect(await tampered(() => {})).toBe('imported');
		expect(await tampered((m) => m.regions.pop())).toBe('refused');
		expect(await tampered((m) => (m.maps[1].parentId = 'nowhere'))).toBe('refused');
		expect(await tampered((m) => (m.maps[0].grid = { size: -4 }))).toBe('refused');
		expect(await tampered((m) => (m.odyssey = 99))).toBe('refused');

		// Only the one good import left pictures of its own.
		const before = listCampaigns(db, owner.id).length;
		expect(before).toBe(2);
		expect(refusal(() => perform(db, player, { t: 'map.update', id: mapId, name: 'Mine' }))).toBe('forbidden');
		const guest = createGuest(db, 'Odo');
		expect(await importCampaign(db, guest, streamOf(good)).catch((err) => err instanceof ImportError)).toBe(true);
	});
});
