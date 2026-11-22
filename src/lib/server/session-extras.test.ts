// What makes a real session go smoothly: a seat a player can get back
// into, tokens that are someone's, a picture on the card of a marker, how
// long the way takes, and the fog of a world map cleared by hand.

import { beforeEach, describe, expect, test } from 'bun:test';
import {
	createGuest,
	getSessionUser,
	createSession,
	registerUser,
} from './auth';
import {
	actorFor,
	createCampaign,
	getMembership,
	joinCampaign,
} from './campaigns';
import { openDb, type Db } from './db';
import {
	addToGallery,
	canLoadImage,
	galleryIdOf,
	newImageFile,
	removeFromGallery,
	sweepGallery,
} from './gallery';
import { getMapSnapshot } from './queries';
import { seatClaims } from './schema';
import {
	KNOCK_LASTS,
	answerKnock,
	forgetKnock,
	knock,
	knockAsNew,
	knocksOf,
	seatAnswer,
	seatsOf,
} from './seats';
import { toLiveEvent } from './visibility';
import { ActionError, perform, type Actor } from './world';
import { boxed } from '../shared/fog';
import {
	DEFAULT_DAY_MILES,
	LIMITS,
	type GalleryKind,
	type MapInfo,
	type Marker,
	type Point,
	type Region,
	type Token,
} from '../shared/types';
import type { CommandOf } from '../shared/types';

let db: Db;
let gm: Actor;
let player: Actor;
/** A second player at the same table. */
let other: Actor;
let campaignId: string;
let mapId: string;

const SQUARE: Point[] = [
	[0.1, 0.1],
	[0.4, 0.1],
	[0.4, 0.4],
	[0.1, 0.4],
];

beforeEach(async () => {
	db = openDb(':memory:');
	const owner = await registerUser(db, 'keeper', 'correct horse battery');
	const campaign = createCampaign(db, owner, 'The Sunless Reach');
	const guest = createGuest(db, 'Mira');
	joinCampaign(db, campaign.id, guest.id);
	const second = createGuest(db, 'Tovin');
	joinCampaign(db, campaign.id, second.id);
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	player = actorFor(guest, getMembership(db, campaign.id, guest.id)!);
	other = actorFor(second, getMembership(db, campaign.id, second.id)!);
	campaignId = campaign.id;
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

function draw(
	name: string,
	on = mapId,
	extra: Partial<CommandOf<'region.create'>> = {},
): Region {
	const events = perform(db, gm, {
		t: 'region.create',
		mapId: on,
		name,
		points: SQUARE,
		...extra,
	});
	return events[1].after as Region;
}

const battlefield = () =>
	draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;

function token(
	by: Actor,
	on: string,
	extra: Partial<CommandOf<'token.create'>> = {},
): Token {
	const [event] = perform(db, by, {
		t: 'token.create',
		mapId: on,
		name: 'Goblin',
		x: 0.5,
		y: 0.5,
		...extra,
	});
	return event.after as Token;
}

function marker(extra: Partial<CommandOf<'marker.create'>> = {}): Marker {
	const [event] = perform(db, gm, {
		t: 'marker.create',
		mapId,
		kind: 'world',
		type: 'note',
		title: 'The ferryman',
		x: 0.5,
		y: 0.5,
		...extra,
	});
	return event.after as Marker;
}

function picture(kind: GalleryKind = 'token', name = 'A face') {
	return addToGallery(db, gm, {
		kind,
		name,
		file: newImageFile('png'),
		width: 640,
		height: 480,
	});
}

const asPlayer = (who: Actor) => ({
	role: 'player' as const,
	userId: who.userId,
});
const mapNow = (id = mapId) => getMapSnapshot(db, campaignId, id, 'gm')!.map;

describe('a seat at the table', () => {
	test('the seats to ask for are the players who joined by link', () => {
		expect(seatsOf(db, campaignId).map((seat) => seat.name)).toEqual([
			'Mira',
			'Tovin',
		]);
	});

	test('someone asks for a seat, the GM lets them in, and that browser is the player again', () => {
		const held = knock(db, campaignId, player.userId);
		expect(knocksOf(db, campaignId)).toMatchObject([
			{ userId: player.userId, name: 'Mira' },
		]);
		expect(seatAnswer(db, campaignId, held).status).toBe('waiting');

		const [asked] = knocksOf(db, campaignId);
		// Only the GM answers.
		expect(refusal(() => answerKnock(db, other, asked.id, true))).toBe(
			'forbidden',
		);
		answerKnock(db, gm, asked.id, true);
		expect(knocksOf(db, campaignId)).toHaveLength(0);

		// Looking leaves the answer to be read. Reading it uses it up.
		expect(seatAnswer(db, campaignId, held, true).status).toBe('granted');
		const answer = seatAnswer(db, campaignId, held);
		expect(answer).toMatchObject({
			status: 'granted',
			user: { id: player.userId, name: 'Mira' },
		});
		expect(seatAnswer(db, campaignId, held).status).toBe('gone');

		// A login made for that user is the same player, secrets and all.
		const session = createSession(db, answer.user!.id);
		expect(getSessionUser(db, session)?.id).toBe(player.userId);
	});

	test('a no is told once, and what the browser holds is no use to anyone else', () => {
		const held = knock(db, campaignId, player.userId);
		answerKnock(db, gm, knocksOf(db, campaignId)[0].id, false);
		expect(seatAnswer(db, campaignId, held + 'x').status).toBe('gone');
		expect(seatAnswer(db, campaignId, held)).toMatchObject({
			status: 'refused',
		});
		expect(seatAnswer(db, campaignId, held).status).toBe('gone');
		// Answered already: there is nothing left to answer.
		expect(refusal(() => answerKnock(db, gm, 'nobody', true))).toBe(
			'not_found',
		);
	});

	test("only a seat of this table can be asked for, and not the GM's", () => {
		expect(refusal(() => knock(db, campaignId, gm.userId))).toBe('not_found');
		expect(refusal(() => knock(db, campaignId, 'nobody'))).toBe('not_found');
		expect(refusal(() => knock(db, campaignId, null))).toBe('not_found');
	});

	test('asking again takes the place of the earlier asking, and giving up takes it away', () => {
		const first = knock(db, campaignId, player.userId);
		const second = knock(db, campaignId, player.userId);
		expect(knocksOf(db, campaignId)).toHaveLength(1);
		expect(seatAnswer(db, campaignId, first).status).toBe('gone');
		forgetKnock(db, second);
		expect(knocksOf(db, campaignId)).toHaveLength(0);
	});

	test('an asking nobody answered lapses', () => {
		const held = knock(db, campaignId, player.userId);
		db.update(seatClaims)
			.set({ createdAt: Date.now() - KNOCK_LASTS - 1000 })
			.run();
		expect(knocksOf(db, campaignId)).toHaveLength(0);
		expect(seatAnswer(db, campaignId, held).status).toBe('gone');
	});

	test('only so many wait at once', () => {
		for (let i = 0; i < LIMITS.knocks; i++) {
			const guest = createGuest(db, `Guest ${i}`);
			joinCampaign(db, campaignId, guest.id);
			knock(db, campaignId, guest.id);
		}
		expect(refusal(() => knock(db, campaignId, player.userId))).toBe(
			'conflict',
		);
		expect(refusal(() => knockAsNew(db, campaignId, { name: 'Odo' }))).toBe(
			'conflict',
		);
	});
});

describe('a new seat at the table', () => {
	test('someone new is nobody at the table until the GM says yes and they hear of it', () => {
		const held = knockAsNew(db, campaignId, { name: '  Odo   the  Bold ' });
		expect(knocksOf(db, campaignId)).toMatchObject([
			{ userId: null, name: 'Odo the Bold', newcomer: true },
		]);
		// Asking seats nobody.
		expect(seatsOf(db, campaignId).map((seat) => seat.name)).toEqual([
			'Mira',
			'Tovin',
		]);
		expect(seatAnswer(db, campaignId, held)).toMatchObject({
			status: 'waiting',
			newcomer: true,
		});

		const [asked] = knocksOf(db, campaignId);
		expect(refusal(() => answerKnock(db, player, asked.id, true))).toBe(
			'forbidden',
		);
		answerKnock(db, gm, asked.id, true);
		// Nor does the yes, until the browser that asked comes to hear it.
		expect(seatAnswer(db, campaignId, held, true)).toMatchObject({
			status: 'granted',
			name: 'Odo the Bold',
		});
		expect(seatsOf(db, campaignId)).toHaveLength(2);

		const answer = seatAnswer(db, campaignId, held);
		expect(answer).toMatchObject({
			status: 'granted',
			user: { name: 'Odo the Bold', isGuest: true },
		});
		expect(getMembership(db, campaignId, answer.user!.id)?.role).toBe('player');
		expect(seatsOf(db, campaignId).map((seat) => seat.name)).toEqual([
			'Mira',
			'Tovin',
			'Odo the Bold',
		]);
		// Once.
		expect(seatAnswer(db, campaignId, held).status).toBe('gone');
		expect(seatsOf(db, campaignId)).toHaveLength(3);
	});

	test('a no seats nobody', () => {
		const held = knockAsNew(db, campaignId, { name: 'Odo' });
		answerKnock(db, gm, knocksOf(db, campaignId)[0].id, false);
		expect(seatAnswer(db, campaignId, held)).toMatchObject({
			status: 'refused',
			newcomer: true,
		});
		expect(seatAnswer(db, campaignId, held).status).toBe('gone');
		expect(seatsOf(db, campaignId)).toHaveLength(2);
	});

	test("a name that won't do is turned down at the door", () => {
		expect(refusal(() => knockAsNew(db, campaignId, { name: '   ' }))).toBe(
			'invalid',
		);
		expect(
			refusal(() => knockAsNew(db, campaignId, { name: 'x'.repeat(41) })),
		).toBe('invalid');
		expect(refusal(() => knockAsNew(db, campaignId, { name: null }))).toBe(
			'invalid',
		);
		expect(knocksOf(db, campaignId)).toHaveLength(0);
	});

	test('someone with an account asks as themselves, and joins as themselves', async () => {
		const account = await registerUser(db, 'wren', 'correct horse battery');
		const first = knockAsNew(db, campaignId, { user: account });
		// Asking again takes the place of the earlier asking.
		const held = knockAsNew(db, campaignId, { user: account });
		expect(knocksOf(db, campaignId)).toMatchObject([
			{ userId: account.id, name: 'wren', newcomer: true },
		]);
		expect(seatAnswer(db, campaignId, first).status).toBe('gone');
		expect(getMembership(db, campaignId, account.id)).toBeNull();

		answerKnock(db, gm, knocksOf(db, campaignId)[0].id, true);
		expect(seatAnswer(db, campaignId, held)).toMatchObject({
			status: 'granted',
			user: { id: account.id, isGuest: false },
		});
		expect(getMembership(db, campaignId, account.id)?.role).toBe('player');
		// They log in with their account: theirs is no seat to ask for by name.
		expect(seatsOf(db, campaignId)).toHaveLength(2);
	});

	test('whoever sits at the table already has no new seat to ask for', () => {
		expect(
			refusal(() =>
				knockAsNew(db, campaignId, { user: { id: player.userId } }),
			),
		).toBe('conflict');
		expect(
			refusal(() => knockAsNew(db, campaignId, { user: { id: gm.userId } })),
		).toBe('conflict');
	});

	test('a seat asked back is told apart from a new one', () => {
		knock(db, campaignId, player.userId);
		knockAsNew(db, campaignId, { name: 'Odo' });
		expect(
			knocksOf(db, campaignId).map((each) => [each.name, each.newcomer]),
		).toEqual([
			['Mira', false],
			['Odo', true],
		]);
	});
});

describe('whose token it is', () => {
	test("a player's token is theirs, the GM's is nobody's until it is handed to someone", () => {
		const id = battlefield();
		expect(token(player, id, { name: 'Mira' })).toMatchObject({
			ownerId: player.userId,
			ownerName: 'Mira',
		});
		const wolf = token(gm, id, { name: 'Wolf' });
		expect(wolf).toMatchObject({ ownerId: null, ownerName: null });
		expect(token(gm, id, { ownerId: other.userId })).toMatchObject({
			ownerName: 'Tovin',
		});

		const [handed] = perform(db, gm, {
			t: 'token.update',
			id: wolf.id,
			changes: { ownerId: player.userId },
		});
		expect(handed.after).toMatchObject({
			ownerId: player.userId,
			ownerName: 'Mira',
		});
		// Everyone is told whose it is: it is no secret.
		expect(toLiveEvent(db, handed, asPlayer(other))?.patch).toMatchObject({
			token: { ownerId: player.userId },
		});
		// Undo hands it back to nobody.
		const [back] = perform(db, gm, { t: 'history.revert', seq: handed.seq });
		expect(back.after).toMatchObject({ ownerId: null, ownerName: null });
	});

	test('only the GM says whose it is, and only a player of the campaign can have one', () => {
		const id = battlefield();
		const wolf = token(gm, id);
		expect(
			refusal(() =>
				perform(db, player, {
					t: 'token.update',
					id: wolf.id,
					changes: { ownerId: player.userId },
				}),
			),
		).toBe('forbidden');
		expect(
			refusal(() =>
				perform(db, gm, {
					t: 'token.update',
					id: wolf.id,
					changes: { ownerId: gm.userId },
				}),
			),
		).toBe('not_found');
		// Whatever a player asks for, the token they put down is their own.
		expect(token(player, id, { ownerId: other.userId }).ownerId).toBe(
			player.userId,
		);
		// Saying what is already so changes nothing, whoever says it.
		const mine = token(player, id);
		expect(
			perform(db, player, {
				t: 'token.update',
				id: mine.id,
				changes: { ownerId: player.userId },
			}),
		).toHaveLength(0);
	});

	test("anyone still moves it, and a copy of it is the same player's", () => {
		const id = battlefield();
		const mine = token(player, id, { name: 'Mira' });
		expect(
			perform(db, other, {
				t: 'token.update',
				id: mine.id,
				changes: { x: 0.2 },
			}),
		).toHaveLength(1);
		const [copy] = perform(db, other, { t: 'token.duplicate', id: mine.id });
		expect(copy.after).toMatchObject({
			ownerId: player.userId,
			ownerName: 'Mira',
		});
	});

	test("the turn of a token that is someone's is theirs to end, and the GM's", () => {
		const id = battlefield();
		const mine = token(player, id, { name: 'Mira', x: 0.2 });
		const theirs = token(other, id, { name: 'Tovin', x: 0.4 });
		const goblin = token(gm, id, { x: 0.6 });
		const order = [mine.id, theirs.id, goblin.id];
		perform(db, gm, {
			t: 'map.update',
			id,
			turns: { order, current: mine.id },
		});
		const turn = () => mapNow(id).turns.current;

		expect(
			refusal(() =>
				perform(db, other, { t: 'turn.next', mapId: id, from: mine.id }),
			),
		).toBe('forbidden');
		expect(turn()).toBe(mine.id);
		perform(db, player, { t: 'turn.next', mapId: id, from: mine.id });
		expect(turn()).toBe(theirs.id);
		// The GM moves any turn on.
		perform(db, gm, { t: 'turn.next', mapId: id, from: theirs.id });
		expect(turn()).toBe(goblin.id);
		// One that is nobody's is the table's, as it always was.
		perform(db, player, { t: 'turn.next', mapId: id, from: goblin.id });
		expect(turn()).toBe(mine.id);
	});
});

describe('a picture on a marker', () => {
	test('the GM gives a world marker a picture off either shelf, and takes it back', () => {
		const face = picture('token');
		const view = picture('map', 'The crossing');
		const ferryman = marker({ image: face.file });
		expect(ferryman.image).toBe(face.file);

		const [changed] = perform(db, gm, {
			t: 'marker.update',
			id: ferryman.id,
			changes: { image: view.file },
		});
		expect(changed.after).toMatchObject({ image: view.file });
		const [undone] = perform(db, gm, { t: 'history.revert', seq: changed.seq });
		expect(undone.after).toMatchObject({ image: face.file });
		const [bare] = perform(db, gm, {
			t: 'marker.update',
			id: ferryman.id,
			changes: { image: null },
		});
		expect(bare.after).toMatchObject({ image: null });
	});

	test('it has to be a picture of the campaign, and a table note carries none', () => {
		expect(refusal(() => marker({ image: newImageFile('png') }))).toBe(
			'conflict',
		);
		expect(refusal(() => marker({ image: 'not a file' }))).toBe('invalid');
		const face = picture();
		const note = {
			t: 'marker.create',
			mapId,
			kind: 'player',
			title: 'A note',
			x: 0.2,
			y: 0.2,
		} as const;
		expect(
			refusal(() => perform(db, player, { ...note, image: face.file })),
		).toBe('invalid');
		const [made] = perform(db, player, note);
		expect(
			refusal(() =>
				perform(db, player, {
					t: 'marker.update',
					id: made.entityId,
					changes: { image: face.file },
				}),
			),
		).toBe('invalid');
	});

	test('whoever can see the marker can load its picture, hidden in the gallery or not', () => {
		const face = picture();
		const ferryman = marker({ image: face.file, hidden: true });
		expect(canLoadImage(db, campaignId, asPlayer(player), face.file)).toBe(
			false,
		);
		// A secret with one player is that player's to see, picture and all.
		perform(db, gm, {
			t: 'marker.update',
			id: ferryman.id,
			changes: { seenBy: [player.userId] },
		});
		expect(canLoadImage(db, campaignId, asPlayer(player), face.file)).toBe(
			true,
		);
		expect(canLoadImage(db, campaignId, asPlayer(other), face.file)).toBe(
			false,
		);
		expect(canLoadImage(db, campaignId, 'player', face.file)).toBe(false);
		perform(db, gm, {
			t: 'marker.update',
			id: ferryman.id,
			changes: { hidden: false },
		});
		expect(canLoadImage(db, campaignId, asPlayer(other), face.file)).toBe(true);

		// Under the fog it is still to be found. Cleared by hand, it is there.
		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: { on: true, clear: [] },
		});
		expect(canLoadImage(db, campaignId, asPlayer(other), face.file)).toBe(
			false,
		);
		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: boxed(mapNow().fog, [0.4, 0.4, 0.6, 0.6]),
		});
		expect(canLoadImage(db, campaignId, asPlayer(other), face.file)).toBe(true);
	});

	test('a picture taken out of the gallery is kept for the marker that shows it', () => {
		const face = picture();
		const ferryman = marker({ image: face.file });
		expect(galleryIdOf(db, campaignId, face.file)).toBe(face.id);
		expect(removeFromGallery(db, gm, face.id)).toEqual([]);
		expect(galleryIdOf(db, campaignId, face.file)).toBeNull();
		expect(canLoadImage(db, campaignId, asPlayer(player), face.file)).toBe(
			true,
		);
		// Once the marker lets go of it, nothing holds it any more.
		perform(db, gm, {
			t: 'marker.update',
			id: ferryman.id,
			changes: { image: null },
		});
		expect(sweepGallery(db, campaignId)).toEqual([face.file]);
	});
});

describe("how far a day's travel goes", () => {
	test('a day on foot until the GM says otherwise, and the maps inside go by the one outside', () => {
		const snapshot = (id: string) =>
			getMapSnapshot(db, campaignId, id, asPlayer(player))!;
		expect(snapshot(mapId).dayMiles).toBe(DEFAULT_DAY_MILES);

		const inner = draw('The marsh').targetMapId;
		const [paced] = perform(db, gm, {
			t: 'map.update',
			id: mapId,
			dayMiles: 30,
		});
		expect((paced.after as MapInfo).dayMiles).toBe(30);
		expect(snapshot(inner).dayMiles).toBe(30);
		// Slow going in the marsh is the marsh's own.
		perform(db, gm, { t: 'map.update', id: inner, dayMiles: 8 });
		expect(snapshot(inner).dayMiles).toBe(8);
		expect(snapshot(mapId).dayMiles).toBe(30);

		// Undo takes back the pace, and leaves a scale given since alone.
		perform(db, gm, { t: 'map.update', id: mapId, miles: 600 });
		perform(db, gm, { t: 'history.revert', seq: paced.seq });
		expect(mapNow()).toMatchObject({ dayMiles: null, miles: 600 });
		perform(db, gm, { t: 'map.update', id: inner, dayMiles: null });
		expect(snapshot(inner).dayMiles).toBe(DEFAULT_DAY_MILES);
	});

	test("it is the GM's to say, within reason, and of world maps", () => {
		expect(
			refusal(() =>
				perform(db, player, { t: 'map.update', id: mapId, dayMiles: 30 }),
			),
		).toBe('forbidden');
		expect(
			refusal(() =>
				perform(db, gm, { t: 'map.update', id: mapId, dayMiles: 0 }),
			),
		).toBe('invalid');
		expect(
			refusal(() =>
				perform(db, gm, { t: 'map.update', id: battlefield(), dayMiles: 30 }),
			),
		).toBe('invalid');
	});
});

describe('the fog of a world map, by hand', () => {
	const seen = (who: Actor) =>
		getMapSnapshot(db, campaignId, mapId, asPlayer(who))!.markers.map(
			(each) => each.title,
		);

	test('the GM clears a part of it, and what is there shows to the players', () => {
		marker({ title: 'The shrine', x: 0.8, y: 0.8 });
		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: { on: true, clear: [] },
		});
		expect(seen(player)).toEqual([]);

		const [lifted] = perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: boxed(mapNow().fog, [0.7, 0.7, 0.9, 0.9]),
		});
		expect(seen(player)).toEqual(['The shrine']);
		// Fog that moved comes with what the players can see now.
		expect(toLiveEvent(db, lifted, asPlayer(player))?.patch).toMatchObject({
			t: 'map.upsert',
			markers: [{ title: 'The shrine' }],
		});
		perform(db, gm, { t: 'history.revert', seq: lifted.seq });
		expect(seen(player)).toEqual([]);
	});

	test('covering a part takes back what was cleared there', () => {
		marker({ title: 'The camp', x: 0.5, y: 0.5 });
		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: { on: true, clear: [[0.4, 0.4, 0.6, 0.6]] },
		});
		expect(seen(player)).toEqual(['The camp']);

		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: boxed(mapNow().fog, [0.3, 0.3, 0.7, 0.7], true),
		});
		// What was cleared to begin with is still on record, under the box that covers it now.
		expect(mapNow().fog).toEqual({
			on: true,
			clear: [[0.4, 0.4, 0.6, 0.6]],
			marks: [{ cover: true, box: [0.3, 0.3, 0.7, 0.7] }],
		});
		expect(seen(player)).toEqual([]);
	});

	test('covering a part of a map with no fog starts some there, and leaves the rest in the clear', () => {
		marker({ title: 'The shrine', x: 0.8, y: 0.8 });
		marker({ title: 'The camp', x: 0.2, y: 0.2 });
		perform(db, gm, {
			t: 'map.update',
			id: mapId,
			fog: boxed(mapNow().fog, [0.7, 0.7, 0.9, 0.9], true),
		});
		expect(seen(player)).toEqual(['The camp']);
	});
});
