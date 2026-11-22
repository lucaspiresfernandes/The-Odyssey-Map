// The seats at a table, as the GM looks after them: making one ahead of
// the session, renaming the player in one, and taking one away.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, createSession, getSessionUser, registerUser, type User } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { getMapSnapshot, playersOf } from './queries';
import {
	answerKnock,
	createSeat,
	knock,
	knocksOf,
	removeSeat,
	renameSeat,
	rosterOf,
	seatAnswer,
	seatsOf
} from './seats';
import { toLiveEvent } from './visibility';
import { ActionError, perform, type Actor } from './world';
import type { Drawing, Marker, Point, Region, Token } from '../shared/types';

let db: Db;
let gm: Actor;
let mira: Actor;
let miraUser: User;
let campaignId: string;
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
	campaignId = campaign.id;
	mapId = campaign.rootMapId;
	gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);
	miraUser = createGuest(db, 'Mira');
	joinCampaign(db, campaign.id, miraUser.id);
	mira = actorFor(miraUser, getMembership(db, campaign.id, miraUser.id)!);
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

const names = () => rosterOf(db, campaignId).map((seat) => seat.name);

/** A battle map behind a region of the first map. */
function battlefield(): string {
	const events = perform(db, gm, {
		t: 'region.create',
		mapId,
		name: 'The Bridge',
		points: SQUARE,
		kind: 'battle'
	});
	return (events[1].after as Region).targetMapId;
}

describe('making a seat', () => {
	test('the GM makes one ahead of time, with nobody in it', () => {
		const seat = createSeat(db, gm, '  Odo   the Bold ');
		expect(seat).toMatchObject({ name: 'Odo the Bold', guest: true, taken: false });
		expect(names()).toEqual(['Mira', 'Odo the Bold']);
		// It is a player like any other: there to be handed a token, or let in on a secret.
		expect(playersOf(db, campaignId).map((p) => p.name)).toEqual(['Mira', 'Odo the Bold']);
		// And the invite link offers it, to whoever is to sit in it.
		expect(seatsOf(db, campaignId).some((each) => each.id === seat.id)).toBe(true);
	});

	test('whoever asks for it on the invite link sits down in it, once the GM lets them', () => {
		const seat = createSeat(db, gm, 'Odo');
		const held = knock(db, campaignId, seat.id);
		expect(seatAnswer(db, campaignId, held, true).status).toBe('waiting');
		const [asking] = knocksOf(db, campaignId);
		// They ask for a seat nobody has sat in yet.
		expect(asking).toMatchObject({ userId: seat.id, name: 'Odo', taken: false });
		answerKnock(db, gm, asking.id, true);
		const answer = seatAnswer(db, campaignId, held);
		expect(answer.status).toBe('granted');
		// The browser is logged in as the player the GM made, not as a new one.
		expect(answer.user?.id).toBe(seat.id);
		expect(names()).toEqual(['Mira', 'Odo']);

		createSession(db, seat.id);
		expect(rosterOf(db, campaignId).find((each) => each.id === seat.id)?.taken).toBe(true);
	});

	test('it is the GM’s to make, under a name no other seat has', () => {
		expect(refusal(() => createSeat(db, mira, 'Odo'))).toBe('forbidden');
		expect(refusal(() => createSeat(db, gm, '   '))).toBe('invalid');
		expect(refusal(() => createSeat(db, gm, 'x'.repeat(41)))).toBe('invalid');
		// Two seats by one name could not be told apart on the invite link.
		expect(refusal(() => createSeat(db, gm, 'mira'))).toBe('conflict');
		expect(names()).toEqual(['Mira']);
	});
});

describe('renaming the player in a seat', () => {
	test('their name follows them onto what is theirs', () => {
		const field = battlefield();
		const token = perform(db, mira, { t: 'token.create', mapId: field, name: 'Hero', x: 0.5, y: 0.5 })[0]
			.after as Token;
		const note = perform(db, mira, {
			t: 'marker.create',
			mapId,
			kind: 'player',
			type: 'note',
			title: 'Camp',
			x: 0.5,
			y: 0.5
		})[0].after as Marker;
		expect(token.ownerName).toBe('Mira');

		expect(renameSeat(db, gm, mira.userId, 'Mirabel').name).toBe('Mirabel');
		expect(names()).toEqual(['Mirabel']);
		const seen = getMapSnapshot(db, campaignId, field, 'gm')!;
		expect(seen.tokens[0].ownerName).toBe('Mirabel');
		expect(getMapSnapshot(db, campaignId, mapId, 'gm')!.markers.find((m) => m.id === note.id)?.authorName).toBe(
			'Mirabel'
		);
	});

	test('it is the GM’s, for a seat with no account behind it', async () => {
		expect(refusal(() => renameSeat(db, mira, mira.userId, 'Queen Mira'))).toBe('forbidden');
		expect(refusal(() => renameSeat(db, gm, gm.userId, 'Nobody'))).toBe('not_found');
		expect(refusal(() => renameSeat(db, gm, 'no-such-seat', 'Nobody'))).toBe('not_found');
		createSeat(db, gm, 'Odo');
		expect(refusal(() => renameSeat(db, gm, mira.userId, 'ODO'))).toBe('conflict');
		// The same name in other letters is still their own.
		expect(renameSeat(db, gm, mira.userId, 'MIRA').name).toBe('MIRA');

		// A player with an account of their own is called what they chose.
		const account = await registerUser(db, 'tamsin', 'correct horse battery');
		joinCampaign(db, campaignId, account.id);
		expect(rosterOf(db, campaignId).find((seat) => seat.id === account.id)?.guest).toBe(false);
		expect(refusal(() => renameSeat(db, gm, account.id, 'Tam'))).toBe('conflict');
	});
});

describe('taking a seat away', () => {
	test('the player is gone, and what they made stays', () => {
		const session = createSession(db, mira.userId);
		const note = perform(db, mira, {
			t: 'marker.create',
			mapId,
			kind: 'player',
			type: 'note',
			title: 'Camp',
			x: 0.5,
			y: 0.5
		})[0].after as Marker;

		removeSeat(db, gm, mira.userId);
		expect(names()).toEqual([]);
		expect(getMembership(db, campaignId, mira.userId)).toBeNull();
		// A seat with no account behind it is gone for good, with every browser's login to it.
		expect(getSessionUser(db, session)).toBeNull();
		// Whatever they try next is refused: they are nobody at this table.
		expect(getMapSnapshot(db, campaignId, mapId, 'gm')!.markers.find((m) => m.id === note.id)).toMatchObject({
			title: 'Camp',
			authorName: 'Mira'
		});
	});

	test('their tokens are nobody’s from then on, which the table hears of', () => {
		const field = battlefield();
		const hero = perform(db, mira, { t: 'token.create', mapId: field, name: 'Hero', x: 0.5, y: 0.5 })[0]
			.after as Token;
		perform(db, gm, { t: 'token.create', mapId: field, name: 'Goblin', x: 0.52, y: 0.5 });
		// Where the fog follows the tokens, the table saw by that token.
		perform(db, gm, { t: 'map.update', id: field, sight: 16 });
		expect(getMapSnapshot(db, campaignId, field, 'player')!.tokens).toHaveLength(2);

		const events = removeSeat(db, gm, mira.userId);
		expect(events).toHaveLength(1);
		expect(events[0].after).toMatchObject({ id: hero.id, ownerId: null, ownerName: null });
		// The players are sent what they see now, which is nothing: no token is anyone's.
		const patch = toLiveEvent(db, events[0], 'player')!.patch as { tokens?: Token[] };
		expect(patch.tokens).toEqual([]);
		expect(getMapSnapshot(db, campaignId, field, 'player')!.tokens).toHaveLength(0);
	});

	test('they are in on no secret any more', () => {
		const odo = createSeat(db, gm, 'Odo');
		const field = battlefield();
		const hidden = { hidden: true, seenBy: [mira.userId, odo.id] };
		const cache = perform(db, gm, {
			t: 'marker.create',
			mapId,
			kind: 'world',
			type: 'cache',
			title: 'The Cache',
			x: 0.5,
			y: 0.5,
			...hidden
		})[0].after as Marker;
		const familiar = perform(db, gm, { t: 'token.create', mapId: field, name: 'Familiar', x: 0.5, y: 0.5, ...hidden })[0]
			.after as Token;
		const trap = perform(db, gm, {
			t: 'drawing.create',
			mapId: field,
			kind: 'line',
			points: [
				[0.2, 0.2],
				[0.3, 0.3]
			],
			hidden: true
		})[0].after as Drawing;
		perform(db, gm, { t: 'drawing.update', id: trap.id, changes: { seenBy: [mira.userId] } });
		const door = (
			perform(db, gm, { t: 'region.create', mapId, name: 'The Vault', points: SQUARE, hidden: true })[1]
				.after as Region
		).id;
		perform(db, gm, { t: 'region.update', id: door, seenBy: [mira.userId] });

		removeSeat(db, gm, mira.userId);
		const world = getMapSnapshot(db, campaignId, mapId, 'gm')!;
		const table = getMapSnapshot(db, campaignId, field, 'gm')!;
		// The other player keeps what they were let in on.
		expect(world.markers.find((m) => m.id === cache.id)?.seenBy).toEqual([odo.id]);
		expect(table.tokens.find((t) => t.id === familiar.id)?.seenBy).toEqual([odo.id]);
		expect(table.drawings.find((d) => d.id === trap.id)).toMatchObject({ hidden: true, seenBy: [] });
		expect(world.regions.find((r) => r.id === door)).toMatchObject({ hidden: true, seenBy: [] });
	});

	test('it is the GM’s, and the GM’s own seat is not one of them', () => {
		expect(refusal(() => removeSeat(db, mira, mira.userId))).toBe('forbidden');
		expect(refusal(() => removeSeat(db, gm, gm.userId))).toBe('not_found');
		expect(refusal(() => removeSeat(db, gm, 'no-such-seat'))).toBe('not_found');
		expect(names()).toEqual(['Mira']);
	});

	test('a player with an account of their own keeps the account', async () => {
		const account = await registerUser(db, 'tamsin', 'correct horse battery');
		joinCampaign(db, campaignId, account.id);
		const session = createSession(db, account.id);
		removeSeat(db, gm, account.id);
		expect(getMembership(db, campaignId, account.id)).toBeNull();
		expect(getSessionUser(db, session)?.id).toBe(account.id);
	});
});
