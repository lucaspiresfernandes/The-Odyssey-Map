// What the GM keeps up a sleeve for a fight: a number on a token that the
// table is not sent, and encounters: tokens made ahead of time, to put down in one go.

import { beforeEach, describe, expect, test } from 'bun:test';
import { exportCampaign, importCampaign } from './archive';
import { createGuest, registerUser, type User } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { addToGallery, newImageFile, removeFromGallery } from './gallery';
import {
	changeEncounter,
	createEncounter,
	encounterFromMap,
	listEncounters,
	removeEncounter
} from './encounters';
import { getMapSnapshot } from './queries';
import { memoryStorage, setStorage } from './storage';
import { toLiveEvent } from './visibility';
import { ActionError, perform, viewerOf, type Actor } from './world';
import { LIMITS, type Point, type Region, type Token } from '../shared/types';
import type { CommandOf } from '../shared/types';

let db: Db;
let owner: User;
let gm: Actor;
let player: Actor;
let mapId: string;
/** A battle map, with cells of 100 pixels. */
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
	field = battlefield('The Bridge');
});

function battlefield(name: string, points = SQUARE): string {
	const events = perform(db, gm, { t: 'region.create', mapId, name, points, kind: 'battle' });
	const id = (events[1].after as Region).targetMapId;
	perform(db, gm, { t: 'map.update', id, grid: { size: 100, x: 0, y: 0 } });
	return id;
}

function refusal(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		if (err instanceof ActionError) return err.code;
		throw err;
	}
	return 'allowed';
}

function token(by: Actor, extra: Partial<CommandOf<'token.create'>> = {}, on = field): Token {
	const [event] = perform(db, by, { t: 'token.create', mapId: on, name: 'Goblin', x: 0.5, y: 0.5, ...extra });
	return event.after as Token;
}

/** A spot this many cells right of the middle of the battle map, and this many down. */
function cells(right: number, down: number): { x: number; y: number } {
	const { map } = getMapSnapshot(db, gm.campaignId, field, 'gm')!;
	return { x: 0.5 + (right * map.grid.size) / map.width, y: 0.5 + (down * map.grid.size) / map.height };
}

const seenBy = (who: Actor, on = field) =>
	getMapSnapshot(db, gm.campaignId, on, viewerOf(who))!.tokens;
const one = (who: Actor, id: string) => seenBy(who).find((each) => each.id === id)!;

describe('a number the GM keeps', () => {
	test('the GM sees it, and a player is sent the token without it', () => {
		const goblin = token(gm, { count: 7, countHidden: true });
		expect(goblin).toMatchObject({ count: 7, countHidden: true });
		expect(one(gm, goblin.id)).toMatchObject({ count: 7, countHidden: true });
		// Not the number, and not the word that there is one.
		expect(one(player, goblin.id)).toMatchObject({ count: null, countHidden: false });
		// A number that is not kept is the whole table's, as before.
		const open = token(gm, { name: 'Torch', count: 3 });
		expect(one(player, open.id)).toMatchObject({ count: 3, countHidden: false });
	});

	test('changing it is no news to a player, and neither is what else they are told', () => {
		const goblin = token(gm, { count: 7, countHidden: true });
		const [hurt] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { count: 2 } });
		expect(toLiveEvent(db, hurt, 'gm')!.patch).toMatchObject({ token: { count: 2, countHidden: true } });
		expect(toLiveEvent(db, hurt, viewerOf(player))).toBeNull();
		expect(toLiveEvent(db, hurt, 'player')).toBeNull();

		// Anything else that changes is told, without the number.
		const [moved] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { x: 0.6, count: 1 } });
		const told = toLiveEvent(db, moved, viewerOf(player))!.patch;
		expect(told).toMatchObject({ t: 'token.upsert', token: { x: 0.6, count: null, countHidden: false } });
		expect(JSON.stringify(told)).not.toContain('"count":1');
	});

	test('keeping a number takes it off the players\' screens, and showing it puts it back', () => {
		const goblin = token(gm, { count: 7 });
		expect(one(player, goblin.id).count).toBe(7);
		const [kept] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { countHidden: true } });
		expect(toLiveEvent(db, kept, viewerOf(player))!.patch).toMatchObject({ token: { count: null } });
		const [shown] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { countHidden: false } });
		expect(toLiveEvent(db, shown, viewerOf(player))!.patch).toMatchObject({ token: { count: 7 } });
	});

	test('only the GM keeps a number, and a kept one is only the GM\'s to change', () => {
		const goblin = token(gm, { count: 7, countHidden: true });
		const change = (changes: Record<string, unknown>) =>
			refusal(() => perform(db, player, { t: 'token.update', id: goblin.id, changes }));
		expect(change({ count: 99 })).toBe('forbidden');
		expect(change({ count: null })).toBe('forbidden');
		// The right number is refused like a wrong one: guessing tells nothing.
		expect(change({ count: 7 })).toBe('forbidden');
		expect(change({ countHidden: false })).toBe('forbidden');
		expect(one(gm, goblin.id)).toMatchObject({ count: 7, countHidden: true });
		// The rest of the token is still the whole table's.
		expect(change({ x: 0.4, name: 'Goblin chief' })).toBe('allowed');
		expect(one(gm, goblin.id)).toMatchObject({ x: 0.4, name: 'Goblin chief', count: 7 });

		// A player's own token has nothing to keep.
		const mine = token(player, { name: 'Mira', count: 20, countHidden: true });
		expect(mine).toMatchObject({ count: 20, countHidden: false });
		expect(refusal(() => perform(db, player, { t: 'token.update', id: mine.id, changes: { countHidden: true } }))).toBe('forbidden');
	});

	test('a copy keeps the number, and keeps it kept', () => {
		const goblin = token(gm, { count: 7, countHidden: true });
		const [copied] = perform(db, player, { t: 'token.duplicate', id: goblin.id });
		expect(copied.after).toMatchObject({ count: 7, countHidden: true });
		expect(toLiveEvent(db, copied, viewerOf(player))!.patch).toMatchObject({
			token: { count: null, countHidden: false }
		});
	});

	test('a player cannot undo their way to a number that has since been kept', () => {
		const goblin = token(gm, { count: 7 });
		const [set] = perform(db, player, { t: 'token.update', id: goblin.id, changes: { count: 5 } });
		perform(db, gm, { t: 'token.update', id: goblin.id, changes: { countHidden: true, count: 3 } });
		expect(refusal(() => perform(db, player, { t: 'history.revert', seq: set.seq }))).toBe('forbidden');
		expect(one(gm, goblin.id).count).toBe(3);
		// The GM's own undo puts both back.
		const [kept] = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { count: 1 } });
		perform(db, gm, { t: 'history.revert', seq: kept.seq });
		expect(one(gm, goblin.id)).toMatchObject({ count: 3, countHidden: true });
	});
});

describe('an encounter saved from the tokens on a map', () => {
	const names = () => listEncounters(db, gm).map((encounter) => encounter.name);

	test('it keeps what each token is, and where it stands from the middle, in cells', () => {
		const chief = token(gm, { name: 'Chief', ...cells(0, -1), size: 2, count: 30, countHidden: true, marks: ['target'] });
		const left = token(gm, { name: 'Left', ...cells(-2, 0), rotation: 90, outline: '#5b8def' });
		const right = token(gm, { name: 'Right', ...cells(2, 0), hidden: true, locked: true });
		const ambush = encounterFromMap(db, gm, '  Goblin ambush ', [chief.id, left.id, right.id]);
		expect(ambush.name).toBe('Goblin ambush');
		expect(ambush.tokens).toEqual([
			expect.objectContaining({ name: 'Chief', size: 2, count: 30, countHidden: true, marks: ['target'], dx: 0, dy: -0.5 }),
			expect.objectContaining({ name: 'Left', rotation: 90, outline: '#5b8def', dx: -2, dy: 0.5 }),
			expect.objectContaining({ name: 'Right', dx: 2, dy: 0.5 })
		]);
		// What belongs to the map it came from is left behind.
		for (const saved of ambush.tokens) {
			expect(Object.keys(saved)).not.toContain('hidden');
			expect(Object.keys(saved)).not.toContain('locked');
			expect(Object.keys(saved)).not.toContain('ownerId');
		}
		expect(listEncounters(db, gm)).toEqual([ambush]);
		// The tokens stay where they were.
		expect(seenBy(gm)).toHaveLength(3);
	});

	test('it is the GM\'s: a player neither saves one, sees one nor throws one away', () => {
		const goblin = token(gm);
		const ambush = encounterFromMap(db, gm, 'Ambush', [goblin.id]);
		expect(refusal(() => encounterFromMap(db, player, 'Mine', [goblin.id]))).toBe('forbidden');
		expect(refusal(() => listEncounters(db, player))).toBe('forbidden');
		expect(refusal(() => removeEncounter(db, player, ambush.id))).toBe('forbidden');
		expect(names()).toEqual(['Ambush']);
	});

	test('only tokens that stand on one battle map of this campaign are saved', () => {
		const goblin = token(gm);
		const elsewhere = token(gm, {}, battlefield('The Cellar', [[0.5, 0.5], [0.8, 0.5], [0.8, 0.8], [0.5, 0.8]]));
		expect(refusal(() => encounterFromMap(db, gm, 'Both', [goblin.id, elsewhere.id]))).toBe('invalid');
		expect(refusal(() => encounterFromMap(db, gm, 'None', []))).toBe('invalid');
		expect(refusal(() => encounterFromMap(db, gm, 'None', 'goblin'))).toBe('invalid');
		expect(refusal(() => encounterFromMap(db, gm, '  ', [goblin.id]))).toBe('invalid');
		expect(refusal(() => encounterFromMap(db, gm, 'Ghost', [goblin.id, 'nobody']))).toBe('not_found');
		perform(db, gm, { t: 'token.delete', id: goblin.id });
		expect(refusal(() => encounterFromMap(db, gm, 'Gone', [goblin.id]))).toBe('not_found');
		expect(names()).toEqual([]);
	});

	test('thrown away, it is gone, and the tokens put down from it stay', () => {
		const goblin = token(gm);
		const ambush = encounterFromMap(db, gm, 'Ambush', [goblin.id]);
		encounterFromMap(db, gm, 'ambush at dawn', [goblin.id]);
		expect(names()).toEqual(['Ambush', 'ambush at dawn']);
		removeEncounter(db, gm, ambush.id);
		expect(names()).toEqual(['ambush at dawn']);
		expect(refusal(() => removeEncounter(db, gm, ambush.id))).toBe('not_found');
		expect(seenBy(gm)).toHaveLength(1);
	});

	test('a campaign keeps only so many, of only so many tokens', () => {
		const goblin = token(gm);
		for (let i = 0; i < LIMITS.encounters; i++) encounterFromMap(db, gm, `Encounter ${i}`, [goblin.id]);
		expect(refusal(() => encounterFromMap(db, gm, 'One more', [goblin.id]))).toBe('conflict');
		const many = Array.from({ length: LIMITS.encounterTokens + 1 }, (_, i) => `id-${i}`);
		expect(refusal(() => encounterFromMap(db, gm, 'A horde', many))).toBe('invalid');
	});

	test('a picture taken out of the gallery is kept for as long as an encounter wears it', () => {
		const face = addToGallery(db, gm, { kind: 'token', name: 'Goblin', file: newImageFile('png'), width: 64, height: 64 });
		const goblin = token(gm, { image: face.file });
		const ambush = encounterFromMap(db, gm, 'Ambush', [goblin.id]);
		perform(db, gm, { t: 'token.delete', id: goblin.id });
		// The deleted token may come back, so the picture is kept for it too:
		// what is tested here is the encounter, on a map with no trace of the token.
		db.run(`delete from tokens`);
		expect(removeFromGallery(db, gm, face.id)).toEqual([]);
		// Put down from the encounter, a token still wears it.
		const [again] = perform(db, gm, { t: 'token.create', mapId: field, x: 0.5, y: 0.5, ...ambush.tokens[0], hidden: true });
		expect(again.after).toMatchObject({ image: face.file, hidden: true });
		db.run(`delete from tokens`);
		expect(removeEncounter(db, gm, ambush.id)).toEqual([face.file]);
	});

	test('a campaign in one file takes its encounters and its kept numbers along', async () => {
		setStorage(memoryStorage());
		const goblin = token(gm, { count: 7, countHidden: true });
		const wolf = token(gm, { name: 'Wolf', ...cells(1, 0) });
		encounterFromMap(db, gm, 'Ambush', [goblin.id, wolf.id]);
		const file = new Uint8Array(await new Response(exportCampaign(db, gm.campaignId).stream).arrayBuffer());
		const copy = await importCampaign(db, owner, new Blob([file]).stream() as ReadableStream<Uint8Array>);
		const there = actorFor(owner, getMembership(db, copy.id, owner.id)!);
		expect(listEncounters(db, there)).toEqual([
			{
				id: expect.any(String),
				name: 'Ambush',
				tokens: [
					expect.objectContaining({ name: 'Goblin', count: 7, countHidden: true, dx: -0.5, dy: 0 }),
					expect.objectContaining({ name: 'Wolf', count: null, countHidden: false, dx: 0.5, dy: 0 })
				]
			}
		]);
		expect(listEncounters(db, there)[0].id).not.toBe(listEncounters(db, gm)[0].id);
		const kept = db.all<{ n: number }>(`select count(*) as n from tokens where count_hidden = 1 and count = 7`);
		expect(kept[0].n).toBe(2);
	});
});

describe('an encounter put together in the gallery', () => {
	const face = (name: string) =>
		addToGallery(db, gm, { kind: 'token', name, file: newImageFile('png'), width: 64, height: 64 });
	const names = () => listEncounters(db, gm).map((encounter) => encounter.name);

	test('it starts out empty, and is filled with tokens that stand side by side', () => {
		const ambush = createEncounter(db, gm, '  Goblin ambush ');
		expect(ambush).toEqual({ id: expect.any(String), name: 'Goblin ambush', tokens: [] });
		const goblin = face('Goblin');
		changeEncounter(db, gm, ambush.id, {
			tokens: [
				{ name: 'Goblin', image: goblin.file },
				{ name: 'Goblin', image: goblin.file, outline: '#5b8def', count: 7, countHidden: true },
				{ name: 'Chief', size: 2, color: '#3fae7c' }
			]
		});
		expect(listEncounters(db, gm)).toEqual([
			{
				id: ambush.id,
				name: 'Goblin ambush',
				tokens: [
					expect.objectContaining({ name: 'Goblin', image: goblin.file, size: 1, outline: null, count: null, dx: -0.5, dy: -1 }),
					expect.objectContaining({ name: 'Goblin', outline: '#5b8def', count: 7, countHidden: true, dx: 0.5, dy: -1 }),
					expect.objectContaining({ name: 'Chief', image: null, size: 2, color: '#3fae7c', rotation: 0, marks: [], dx: 0, dy: 0.5 })
				]
			}
		]);
	});

	test('renaming it leaves its tokens where they stood, and the other way round', () => {
		const goblin = token(gm, { ...cells(-3, 0) });
		const wolf = token(gm, { name: 'Wolf', ...cells(3, 0) });
		const ambush = encounterFromMap(db, gm, 'Ambush', [goblin.id, wolf.id]);
		changeEncounter(db, gm, ambush.id, { name: 'Ambush at dawn' });
		expect(listEncounters(db, gm)).toEqual([{ ...ambush, name: 'Ambush at dawn' }]);
		// Once its tokens are said again, they stand side by side.
		changeEncounter(db, gm, ambush.id, { tokens: ambush.tokens });
		const [again] = listEncounters(db, gm);
		expect(again.name).toBe('Ambush at dawn');
		expect(again.tokens.map(({ dx, dy }) => [dx, dy])).toEqual([[-0.5, 0], [0.5, 0]]);
	});

	test('put down, its tokens are tokens like any other', () => {
		const goblin = face('Goblin');
		const ambush = createEncounter(db, gm, 'Ambush', [{ name: 'Goblin', image: goblin.file, size: 1.5 }]);
		const [{ dx, dy, ...piece }] = ambush.tokens;
		const [made] = perform(db, gm, { t: 'token.create', mapId: field, x: 0.5, y: 0.5, ...piece, hidden: true });
		expect(made.after).toMatchObject({ name: 'Goblin', image: goblin.file, size: 1.5, hidden: true });
		expect([dx, dy]).toEqual([0, 0]);
	});

	test("it is the GM's to make and to change", () => {
		const ambush = createEncounter(db, gm, 'Ambush');
		expect(refusal(() => createEncounter(db, player, 'Mine'))).toBe('forbidden');
		expect(refusal(() => changeEncounter(db, player, ambush.id, { name: 'Mine' }))).toBe('forbidden');
		expect(refusal(() => changeEncounter(db, player, ambush.id, { tokens: [] }))).toBe('forbidden');
		expect(names()).toEqual(['Ambush']);
	});

	test('what it is made of is checked like a token on its way to a map', () => {
		const ambush = createEncounter(db, gm, 'Ambush');
		const change = (changes: { name?: unknown; tokens?: unknown }) =>
			refusal(() => changeEncounter(db, gm, ambush.id, changes));
		expect(change({})).toBe('invalid');
		expect(change({ name: '  ' })).toBe('invalid');
		expect(change({ tokens: 'goblins' })).toBe('invalid');
		expect(change({ tokens: ['goblin'] })).toBe('invalid');
		expect(change({ tokens: [{ image: null }] })).toBe('invalid');
		expect(change({ tokens: [{ name: 'Goblin', size: 99 }] })).toBe('invalid');
		expect(change({ tokens: [{ name: 'Goblin', color: 'red' }] })).toBe('invalid');
		const many = Array.from({ length: LIMITS.encounterTokens + 1 }, () => ({ name: 'Goblin' }));
		expect(change({ tokens: many })).toBe('invalid');
		// A picture is one of this campaign's token pictures.
		const coast = addToGallery(db, gm, { kind: 'map', name: 'Coast', file: newImageFile('png'), width: 640, height: 480 });
		expect(change({ tokens: [{ name: 'Goblin', image: coast.file }] })).toBe('conflict');
		expect(change({ tokens: [{ name: 'Goblin', image: newImageFile('png') }] })).toBe('conflict');
		expect(refusal(() => changeEncounter(db, gm, 'nothing', { name: 'Ghost' }))).toBe('not_found');
		expect(refusal(() => createEncounter(db, gm, ''))).toBe('invalid');
		expect(listEncounters(db, gm)).toEqual([ambush]);
	});

	test('a picture taken out of the gallery goes once the encounter lets go of it', () => {
		const goblin = face('Goblin');
		const ambush = createEncounter(db, gm, 'Ambush', [{ name: 'Goblin', image: goblin.file }]);
		expect(removeFromGallery(db, gm, goblin.id)).toEqual([]);
		// Still there to be worn while the encounter keeps it.
		expect(changeEncounter(db, gm, ambush.id, { tokens: ambush.tokens })).toEqual([]);
		expect(changeEncounter(db, gm, ambush.id, { tokens: [] })).toEqual([goblin.file]);
	});

	test('a campaign keeps only so many', () => {
		for (let i = 0; i < LIMITS.encounters; i++) createEncounter(db, gm, `Encounter ${i}`);
		expect(refusal(() => createEncounter(db, gm, 'One more'))).toBe('conflict');
	});

	test('an empty one goes out to a file and comes back', async () => {
		setStorage(memoryStorage());
		createEncounter(db, gm, 'Yet to be filled');
		const file = new Uint8Array(await new Response(exportCampaign(db, gm.campaignId).stream).arrayBuffer());
		const copy = await importCampaign(db, owner, new Blob([file]).stream() as ReadableStream<Uint8Array>);
		const there = actorFor(owner, getMembership(db, copy.id, owner.id)!);
		expect(listEncounters(db, there)).toEqual([{ id: expect.any(String), name: 'Yet to be filled', tokens: [] }]);
	});
});
