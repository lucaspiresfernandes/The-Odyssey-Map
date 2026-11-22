// What came with the party: characters kept on tokens, numbered copies,
// shapes that are turned and resized, token pictures a player adds, and a
// finder that knows the tokens and the texts of a battle map.

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
	removeFromGallery,
	renameInGallery
} from './gallery';
import { partyOf } from './party';
import { findable, getMapSnapshot } from './queries';
import { createSeat, removeSeat } from './seats';
import { ActionError, perform, performReceived, type Actor } from './world';
import {
	LIMITS,
	type Drawing,
	type GalleryItem,
	type Point,
	type Region,
	type Token
} from '../shared/types';
import type { CommandOf } from '../shared/types';

let db: Db;
let gm: Actor;
let mira: Actor;
let tovin: Actor;
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
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	const seat = (name: string) => {
		const guest = createGuest(db, name);
		joinCampaign(db, campaign.id, guest.id);
		return actorFor(guest, getMembership(db, campaign.id, guest.id)!);
	};
	mira = seat('Mira');
	tovin = seat('Tovin');
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

/** A battle map behind a region of the first map, by its id. */
function battlefield(name = 'The Bridge', points: Point[] = SQUARE): string {
	const events = perform(db, gm, { t: 'region.create', mapId, name, points, kind: 'battle' });
	return (events[1].after as Region).targetMapId;
}

function token(by: Actor, on: string, extra: Partial<CommandOf<'token.create'>> = {}): Token {
	const [event] = perform(db, by, { t: 'token.create', mapId: on, name: 'Goblin', x: 0.5, y: 0.5, ...extra });
	return event.after as Token;
}

const change = (by: Actor, id: string, changes: CommandOf<'token.update'>['changes']) =>
	perform(db, by, { t: 'token.update', id, changes })[0]?.after as Token;

const tokensOf = (on: string, who: Actor = gm) =>
	getMapSnapshot(db, gm.campaignId, on, { role: who.role, userId: who.userId })!.tokens;

function picture(by: Actor = gm, name = 'A picture'): GalleryItem {
	return addToGallery(db, by, { kind: 'token', name, file: newImageFile('webp'), width: 512, height: 512 });
}

describe('numbered copies', () => {
	test('a copy takes the next number after its name', () => {
		const field = battlefield();
		const goblin = token(gm, field);
		const second = perform(db, gm, { t: 'token.duplicate', id: goblin.id })[0].after as Token;
		expect(second.name).toBe('Goblin 2');
		// A copy of the copy goes on from the highest, and so does one more of the first.
		expect((perform(db, gm, { t: 'token.duplicate', id: second.id })[0].after as Token).name).toBe('Goblin 3');
		expect((perform(db, gm, { t: 'token.duplicate', id: goblin.id })[0].after as Token).name).toBe('Goblin 4');
		// The first keeps the name it had.
		expect(tokensOf(field).map((each) => each.name)).toEqual(['Goblin', 'Goblin 2', 'Goblin 3', 'Goblin 4']);
	});

	test('a player’s copy is numbered by the tokens they can see', () => {
		const field = battlefield();
		const goblin = token(gm, field);
		token(gm, field, { name: 'Goblin 7', hidden: true, x: 0.2 });
		// The hidden one would have made it "Goblin 8", and told of itself.
		expect((perform(db, mira, { t: 'token.duplicate', id: goblin.id })[0].after as Token).name).toBe('Goblin 2');
		expect((perform(db, gm, { t: 'token.duplicate', id: goblin.id })[0].after as Token).name).toBe('Goblin 8');
	});
});

describe('the party', () => {
	const party = (who: Actor = gm) => partyOf(db, who).map((each) => [each.player, each.name]);

	test('a player’s character is the first token they were given, until one is said to be', () => {
		const field = battlefield();
		expect(party()).toEqual([]);

		const ranger = token(gm, field, { name: 'Sable', ownerId: mira.userId, size: 2, outline: '#3fae7c' });
		// The wolf is hers too, copied from the ranger afterwards: it is not her character.
		perform(db, gm, { t: 'token.duplicate', id: ranger.id });
		token(tovin, field, { name: 'Tovin the Grey', x: 0.3 });
		expect(party()).toEqual([
			['Mira', 'Sable'],
			['Tovin', 'Tovin the Grey']
		]);
		expect(partyOf(db, gm)[0]).toEqual({
			userId: mira.userId,
			player: 'Mira',
			name: 'Sable',
			color: ranger.color,
			outline: '#3fae7c',
			image: null,
			size: 2
		});
		// A player is told their own, and nobody else's.
		expect(party(mira)).toEqual([['Mira', 'Sable']]);
		expect(party(tovin)).toEqual([['Tovin', 'Tovin the Grey']]);
	});

	test('it is whichever token was said to be their character last, as it looks now', () => {
		const field = battlefield();
		const ranger = token(gm, field, { name: 'Sable', ownerId: mira.userId });
		const wolf = token(gm, field, { name: 'Ash', ownerId: mira.userId, x: 0.3 });
		expect(ranger.characterAt).toBeNull();

		expect(change(gm, wolf.id, { character: true }).characterAt).not.toBeNull();
		expect(party()).toEqual([['Mira', 'Ash']]);
		// What is changed about that token is what the party is told.
		change(mira, wolf.id, { name: 'Ash the Swift', size: 1.5 });
		expect(partyOf(db, gm)[0]).toMatchObject({ name: 'Ash the Swift', size: 1.5 });

		// Unsaid, it falls back on the first she was given.
		change(mira, wolf.id, { character: false });
		expect(party()).toEqual([['Mira', 'Sable']]);
	});

	test('a token put down as a character is one, and stays one when it is taken off the map', () => {
		const first = battlefield();
		const second = battlefield('The Vault', [
			[0.6, 0.6],
			[0.9, 0.6],
			[0.9, 0.9],
			[0.6, 0.9]
		]);
		token(gm, first, { name: 'Sable', ownerId: mira.userId });
		// The party goes down on the next map: each token handed out, and a character.
		const [made] = perform(db, gm, {
			t: 'batch',
			cmds: [
				{ t: 'token.create', mapId: second, name: 'Sable', x: 0.5, y: 0.5, ownerId: mira.userId, character: true }
			]
		});
		const here = made.after as Token;
		expect(here).toMatchObject({ ownerId: mira.userId, ownerName: 'Mira', hidden: false });
		expect(here.characterAt).not.toBeNull();

		// What she changes about it here is what goes down the next time, even
		// once this map is tidied and the token is gone from it.
		change(mira, here.id, { name: 'Sable of the Reach' });
		perform(db, gm, { t: 'token.delete', id: here.id });
		expect(party()).toEqual([['Mira', 'Sable of the Reach']]);
	});

	test('a character is a player’s: the GM says so of any, a player of their own', () => {
		const field = battlefield();
		const goblin = token(gm, field);
		const hers = token(mira, field, { name: 'Sable', x: 0.3 });

		// One that is nobody's is nobody's character, put down or said after.
		expect(token(gm, field, { character: true, x: 0.2 }).characterAt).toBeNull();
		expect(refusal(() => change(gm, goblin.id, { character: true }))).toBe('invalid');
		expect(refusal(() => change(tovin, hers.id, { character: true }))).toBe('forbidden');
		expect(refusal(() => change(mira, goblin.id, { character: true }))).toBe('invalid');
		expect(change(mira, hers.id, { character: true }).characterAt).not.toBeNull();
		// What a player puts down as their character is one from the first.
		expect(token(tovin, field, { character: true, x: 0.7 }).characterAt).not.toBeNull();

		// Handed to someone else, it is not the next one's character unless that is said too.
		expect(change(gm, hers.id, { ownerId: tovin.userId }).characterAt).toBeNull();
		const both = change(gm, hers.id, { ownerId: mira.userId, character: true });
		expect(both).toMatchObject({ ownerId: mira.userId });
		expect(both.characterAt).not.toBeNull();
		// A copy is its owner's, and not their character.
		const copy = perform(db, mira, { t: 'token.duplicate', id: hers.id })[0].after as Token;
		expect(copy).toMatchObject({ ownerId: mira.userId, characterAt: null });
	});

	test('undo takes back what was said of a character', () => {
		const field = battlefield();
		const hers = token(mira, field, { name: 'Sable' });
		const [said] = perform(db, mira, { t: 'token.update', id: hers.id, changes: { character: true } });
		const [unsaid] = perform(db, mira, { t: 'history.revert', seq: said.seq });
		expect((unsaid.after as Token).characterAt).toBeNull();
		const [again] = perform(db, mira, { t: 'history.revert', seq: unsaid.seq });
		expect((again.after as Token).characterAt).not.toBeNull();
		// Nothing of it is kept on the token but when it was said.
		expect(again.after).not.toHaveProperty('character');
	});

	test('a seat taken away has no character left behind', async () => {
		const field = battlefield();
		const odo = createSeat(db, gm, 'Odo');
		token(gm, field, { name: 'Odo the Bold', ownerId: odo.id, character: true });
		expect(party()).toEqual([['Odo', 'Odo the Bold']]);
		removeSeat(db, gm, odo.id);
		expect(party()).toEqual([]);
		expect(tokensOf(field)[0]).toMatchObject({ ownerId: null, characterAt: null });
	});

	test('a player uses the picture of their own token again, hidden in the gallery or not', () => {
		const first = battlefield();
		const face = picture(gm, 'Sable');
		// The GM gave her character a picture the table can't pick.
		const hers = token(gm, first, { name: 'Sable', ownerId: mira.userId, image: face.file });
		const who = (actor: Actor) => ({ role: actor.role, userId: actor.userId });
		expect(canLoadImage(db, gm.campaignId, who(mira), face.file)).toBe(true);
		expect(refusal(() => token(mira, first, { image: face.file, character: true, x: 0.3 }))).toBe('allowed');
		expect(refusal(() => token(tovin, first, { image: face.file, x: 0.7 }))).toBe('conflict');
		// Even with that token off the map: it is still hers.
		perform(db, gm, { t: 'token.delete', id: hers.id });
		expect(canLoadImage(db, gm.campaignId, who(mira), face.file)).toBe(true);
	});
});

describe('token pictures a player adds', () => {
	const names = (who: Actor) => listGallery(db, who).map((item) => item.name);

	test('they are the player’s own: there for them and the GM, hidden from the rest', () => {
		const field = battlefield();
		const mine = picture(mira, 'Sable');
		expect(mine).toMatchObject({ hidden: true, ownerId: mira.userId, kind: 'token' });
		expect(picture(gm, 'Ogre').ownerId).toBeNull();
		expect(names(mira)).toEqual(['Sable']);
		expect(names(tovin)).toEqual([]);
		expect(names(gm)).toEqual(['Ogre', 'Sable']);

		// She puts it on her token. The other player can't pick it, and sees it there.
		const hers = token(mira, field, { name: 'Sable', image: mine.file });
		expect(hers.image).toBe(mine.file);
		expect(refusal(() => token(tovin, field, { image: mine.file, x: 0.3 }))).toBe('conflict');
		const who = (actor: Actor) => ({ role: actor.role, userId: actor.userId });
		expect(canLoadImage(db, gm.campaignId, who(tovin), mine.file)).toBe(true);
		perform(db, mira, { t: 'token.delete', id: hers.id });
		expect(canLoadImage(db, gm.campaignId, who(tovin), mine.file)).toBe(false);
		expect(canLoadImage(db, gm.campaignId, who(mira), mine.file)).toBe(true);
		// Revealed by the GM, it is the whole table's to pick.
		hideInGallery(db, gm, mine.id, false);
		expect(names(tovin)).toEqual(['Sable']);
	});

	test('a player adds no map image, and keeps only so many pictures', () => {
		const map = { kind: 'map' as const, name: 'A map', file: newImageFile('png'), width: 640, height: 480 };
		expect(refusal(() => addToGallery(db, mira, map))).toBe('forbidden');
		for (let i = 0; i < LIMITS.playerPictures; i++) picture(mira, `Face ${i}`);
		expect(refusal(() => picture(mira, 'One too many'))).toBe('conflict');
		// Each player has room of their own, and the GM's is not counted.
		expect(refusal(() => picture(tovin))).toBe('allowed');
		expect(refusal(() => picture(gm))).toBe('allowed');
		// Taking one out makes room for another.
		removeFromGallery(db, mira, listGallery(db, mira)[0].id);
		expect(refusal(() => picture(mira, 'In its place'))).toBe('allowed');
	});

	test('a player takes out what they added, and nothing else', () => {
		const mine = picture(mira, 'Sable');
		const theirs = picture(tovin, 'Tovin');
		const ogre = picture(gm, 'Ogre');
		hideInGallery(db, gm, ogre.id, false);

		// Another player's, which they were never shown, is not there to them.
		expect(refusal(() => removeFromGallery(db, mira, theirs.id))).toBe('not_found');
		expect(refusal(() => removeFromGallery(db, mira, ogre.id))).toBe('forbidden');
		expect(refusal(() => renameInGallery(db, mira, mine.id, 'x'))).toBe('forbidden');
		expect(refusal(() => hideInGallery(db, mira, mine.id, false))).toBe('forbidden');
		removeFromGallery(db, mira, mine.id);
		expect(listGallery(db, mira).map((item) => item.name)).toEqual(['Ogre']);
		// The GM tidies any of them.
		expect(refusal(() => removeFromGallery(db, gm, theirs.id))).toBe('allowed');
	});

	test('a seat taken away leaves its pictures to the GM', () => {
		const odo = createSeat(db, gm, 'Odo');
		const actor: Actor = { userId: odo.id, name: odo.name, campaignId: gm.campaignId, role: 'player' };
		const face = picture(actor, 'Odo');
		removeSeat(db, gm, odo.id);
		expect(listGallery(db, gm).find((item) => item.id === face.id)).toMatchObject({ ownerId: null, hidden: true });
	});
});

describe('shapes that are turned and resized', () => {
	const CONE: Point[] = [
		[0.5, 0.5],
		[0.6, 0.5]
	];

	function shape(by: Actor, on: string, kind: Drawing['kind'] = 'cone', points = CONE): Drawing {
		return perform(db, by, { t: 'drawing.create', mapId: on, kind, points })[0].after as Drawing;
	}

	test('its two points are put elsewhere, by whoever drew it and the GM', () => {
		const field = battlefield();
		const cone = shape(mira, field);
		const aimed: Point[] = [
			[0.5, 0.5],
			[0.5, 0.2]
		];
		const [turned] = perform(db, mira, { t: 'drawing.update', id: cone.id, changes: { points: aimed } });
		expect((turned.after as Drawing).points).toEqual(aimed);
		expect(refusal(() => perform(db, tovin, { t: 'drawing.update', id: cone.id, changes: { points: CONE } }))).toBe('forbidden');
		expect(perform(db, gm, { t: 'drawing.update', id: cone.id, changes: { points: CONE } })).toHaveLength(1);
		// Put where it is already, nothing has changed.
		expect(perform(db, gm, { t: 'drawing.update', id: cone.id, changes: { points: CONE } })).toHaveLength(0);

		// Undo puts it back as it was.
		const [again] = perform(db, mira, { t: 'drawing.update', id: cone.id, changes: { points: aimed } });
		const [back] = perform(db, mira, { t: 'history.revert', seq: again.seq });
		expect((back.after as Drawing).points).toEqual(CONE);
	});

	test('it stays a shape: two points, on the map, with some size', () => {
		const field = battlefield();
		const cone = shape(gm, field);
		const to = (points: unknown) => () =>
			performReceived(db, gm, { t: 'drawing.update', id: cone.id, changes: { points } });
		expect(refusal(to([[0.5, 0.5]]))).toBe('invalid');
		expect(refusal(to([[0.5, 0.5], [0.5, 0.5]]))).toBe('invalid');
		expect(refusal(to([[0.5, 0.5], [1.5, 0.5]]))).toBe('invalid');
		expect(refusal(to([[0.5, 0.5], [0.6, 0.5], [0.7, 0.5]]))).toBe('invalid');
		// A line drawn freehand and a text have no points to put elsewhere.
		const line = shape(gm, field, 'line', [[0.2, 0.2], [0.3, 0.3], [0.4, 0.2]]);
		expect(refusal(() => perform(db, gm, { t: 'drawing.update', id: line.id, changes: { points: CONE } }))).toBe('invalid');
	});

	test('a ray is a shape like the rest', () => {
		const field = battlefield();
		const ray = shape(mira, field, 'ray');
		expect(ray).toMatchObject({ kind: 'ray', points: CONE });
		const [moved] = perform(db, mira, {
			t: 'drawing.update',
			id: ray.id,
			changes: { points: [[0.5, 0.5], [0.7, 0.7]], move: [0.1, 0] }
		});
		// Turned first, then slid: both in one change.
		expect((moved.after as Drawing).points).toEqual([[0.6, 0.5], [0.8, 0.7]]);
		expect(refusal(() => shape(gm, field, 'ray', [[0.5, 0.5]]))).toBe('invalid');
	});
});

describe('the finder on battle maps', () => {
	const found = (who: Actor) =>
		findable(db, gm.campaignId, { role: who.role, userId: who.userId })
			.filter((entry) => entry.kind === 'token' || entry.kind === 'text')
			.map((entry) => entry.name)
			.sort();

	test('it knows the tokens and what is written there, and the way to each', () => {
		const field = battlefield();
		const ogre = token(gm, field, { name: 'Ogre' });
		const [wrote] = perform(db, mira, { t: 'drawing.create', mapId: field, kind: 'text', points: [[0.3, 0.3]], text: 'Trapdoor' });
		// A line and a shape have no name to be found by.
		perform(db, mira, { t: 'drawing.create', mapId: field, kind: 'circle', points: [[0.3, 0.3], [0.4, 0.3]] });

		const all = findable(db, gm.campaignId, { role: 'player', userId: mira.userId });
		expect(all.find((entry) => entry.id === ogre.id)).toEqual({
			kind: 'token',
			id: ogre.id,
			mapId: field,
			name: 'Ogre',
			path: ['The Sunless Reach', 'The Bridge'],
			type: 'token',
			hidden: false
		});
		expect(all.find((entry) => entry.id === (wrote.after as Drawing).id)).toMatchObject({
			kind: 'text',
			mapId: field,
			name: 'Trapdoor',
			type: 'text'
		});
		expect(found(mira)).toEqual(['Ogre', 'Trapdoor']);
	});

	test('a player is told of none they could not see on the map', () => {
		const field = battlefield();
		token(gm, field, { name: 'Knight' });
		token(gm, field, { name: 'Assassin', hidden: true, x: 0.3 });
		token(gm, field, { name: 'Familiar', hidden: true, seenBy: [mira.userId], x: 0.7 });
		perform(db, gm, { t: 'drawing.create', mapId: field, kind: 'text', points: [[0.3, 0.3]], text: 'Pit trap', hidden: true });
		// The fog covers the map but for its left half: the lurker stands under it.
		token(gm, field, { name: 'Lurker', x: 0.9 });
		perform(db, gm, { t: 'map.update', id: field, fog: { on: true, clear: [[0, 0, 0.8, 1]], marks: [] } });

		expect(found(mira)).toEqual(['Familiar', 'Knight']);
		expect(found(tovin)).toEqual(['Knight']);
		expect(found(gm)).toEqual(['Assassin', 'Familiar', 'Knight', 'Lurker', 'Pit trap']);
		// The GM is told which of them the table can't see.
		const hidden = findable(db, gm.campaignId, 'gm')
			.filter((entry) => entry.hidden)
			.map((entry) => entry.name)
			.sort();
		expect(hidden).toEqual(['Assassin', 'Familiar', 'Pit trap']);
	});

	test('nor of anything on a battle map they are kept out of', () => {
		const field = battlefield();
		token(gm, field, { name: 'Knight' });
		const door = getMapSnapshot(db, gm.campaignId, mapId, 'gm')!.regions[0];
		perform(db, gm, { t: 'region.update', id: door.id, closed: true });
		expect(found(mira)).toEqual([]);
		expect(found(gm)).toEqual(['Knight']);
	});
});
