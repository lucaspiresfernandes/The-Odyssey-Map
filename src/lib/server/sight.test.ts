// Fog that follows the tokens, drawings the GM keeps out of sight, and what
// distances are told in and how a diagonal is counted.

import { beforeEach, describe, expect, test } from 'bun:test';
import { createGuest, registerUser } from './auth';
import { actorFor, createCampaign, getMembership, joinCampaign } from './campaigns';
import { openDb, type Db } from './db';
import { findable, getMapSnapshot } from './queries';
import { toLiveEvent } from './visibility';
import { ActionError, perform, viewerOf, type Actor } from './world';
import {
	cellsApart,
	feetAlong,
	feetBetween,
	feetCount,
	longFrom,
	milesCount,
	shortFrom,
	shortIn
} from '../shared/grid';
import {
	DEFAULT_GRID,
	type CommandOf,
	type Drawing,
	type LiveEvent,
	type Point,
	type Region,
	type StoredEvent,
	type Token
} from '../shared/types';

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
	odo = seat('Odo');
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

function draw(name: string, on = mapId, extra: Partial<CommandOf<'region.create'>> = {}): Region {
	const events = perform(db, gm, { t: 'region.create', mapId: on, name, points: SQUARE, ...extra });
	return events[1].after as Region;
}

/** A battle map behind a region of the first map. */
const battlefield = () => draw('The Bridge', mapId, { kind: 'battle' }).targetMapId;

const sees = (id: string, who: 'gm' | 'player' | Actor = 'player') =>
	getMapSnapshot(db, gm.campaignId, id, typeof who === 'string' ? who : viewerOf(who))!;

function token(by: Actor, on: string, x: number, y: number, name: string): Token {
	return perform(db, by, { t: 'token.create', mapId: on, name, x, y })[0].after as Token;
}

const names = (tokens: Token[]) => tokens.map((t) => t.name).sort();

/** What the table's browsers would be sent for these events. */
const sent = (events: StoredEvent[], who: 'gm' | 'player' | Actor = 'player'): LiveEvent[] =>
	events
		.map((e) => toLiveEvent(db, e, typeof who === 'string' ? who : viewerOf(who)))
		.filter((e) => e !== null);

describe('fog that follows the tokens', () => {
	// A new battle map is 1600 by 1000 with cells of 50 pixels and 8 feet. So
	// 16 feet is two cells: 100 pixels, which is 0.0625 of the way across.
	const SIGHT = 16;
	const see = (id: string, sight: number | null = SIGHT) =>
		perform(db, gm, { t: 'map.update', id, sight });

	/** Mira's hero in the middle, a goblin a cell away and an ogre across the map. */
	function fight() {
		const id = battlefield();
		const hero = token(mira, id, 0.5, 0.5, 'Hero');
		const goblin = token(gm, id, 0.53, 0.5, 'Goblin');
		const ogre = token(gm, id, 0.9, 0.5, 'SECRET ogre');
		return { id, hero, goblin, ogre };
	}

	test('a map has none of it until the GM says how far the tokens see', () => {
		const { id } = fight();
		expect(sees(id).map.sight).toBeNull();
		expect(sees(id).tokens).toHaveLength(3);

		see(id);
		expect(sees(id).map.sight).toBe(SIGHT);
		expect(names(sees(id).tokens)).toEqual(['Goblin', 'Hero']);
		expect(JSON.stringify(sees(id))).not.toContain('SECRET');
		// The GM sees through it, and so it is with every player: the party shares its sight.
		expect(sees(id, 'gm').tokens).toHaveLength(3);
		expect(names(sees(id, odo).tokens)).toEqual(['Goblin', 'Hero']);
	});

	test('it is the GM’s to set, on battle maps, within reason', () => {
		const { id } = fight();
		expect(refusal(() => perform(db, mira, { t: 'map.update', id, sight: 30 }))).toBe('forbidden');
		expect(refusal(() => see(mapId))).toBe('invalid');
		expect(refusal(() => see(id, 0))).toBe('invalid');
		expect(refusal(() => see(id, 1e9))).toBe('invalid');
	});

	test('turning it on or off sends the players what they see now', () => {
		const { id } = fight();
		const [on] = sent(see(id));
		expect(on.patch.t).toBe('map.upsert');
		expect(names((on.patch as { tokens: Token[] }).tokens)).toEqual(['Goblin', 'Hero']);
		// The GM is sent the map, and has every token already.
		expect((sent(see(id, 20), 'gm')[0].patch as { tokens?: Token[] }).tokens).toBeUndefined();

		const [off] = sent(see(id, null));
		expect((off.patch as { tokens: Token[] }).tokens).toHaveLength(3);
	});

	test('where a token walks to comes into sight, and where it left goes out of it', () => {
		const { id, hero } = fight();
		see(id);
		const walked = perform(db, mira, { t: 'token.update', id: hero.id, changes: { x: 0.88 } });
		const [news] = sent(walked);
		expect(news.patch.t).toBe('token.upsert');
		// The lot, in place of what they had: the ogre is there now, the goblin is not.
		expect(names((news.patch as { tokens: Token[] }).tokens)).toEqual(['Hero', 'SECRET ogre']);
		expect(names(sees(id).tokens)).toEqual(['Hero', 'SECRET ogre']);
		// The GM is sent the one token that moved.
		expect((sent(walked, 'gm')[0].patch as { tokens?: Token[] }).tokens).toBeUndefined();
	});

	test('a token that is nobody’s gives no sight, and is news only while it is in it', () => {
		const { id, goblin, ogre } = fight();
		see(id);
		// Out of sight, nothing done to it reaches a player, and it isn't there to act on.
		const far = perform(db, gm, { t: 'token.update', id: ogre.id, changes: { y: 0.6 } });
		expect(sent(far)).toHaveLength(0);
		expect(refusal(() => perform(db, mira, { t: 'token.update', id: ogre.id, changes: { x: 0.5 } }))).toBe(
			'not_found'
		);

		// Walking out of sight looks like being taken away, and back in like being added.
		const out = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { x: 0.1 } });
		expect(sent(out)[0].patch).toEqual({ t: 'token.remove', id: goblin.id, mapId: id });
		const back = perform(db, gm, { t: 'token.update', id: goblin.id, changes: { x: 0.47 } });
		expect(sent(back)[0].patch.t).toBe('token.upsert');
		expect((sent(back)[0].patch as { tokens?: Token[] }).tokens).toBeUndefined();
	});

	test('with no token of a player on the map, the players see none', () => {
		const { id, hero } = fight();
		see(id);
		const gone = perform(db, mira, { t: 'token.delete', id: hero.id });
		const [news] = sent(gone);
		expect(news.patch.t).toBe('token.remove');
		expect((news.patch as { tokens: Token[] }).tokens).toEqual([]);
		expect(sees(id).tokens).toEqual([]);

		// Whoever took it off the map can still change their mind.
		const undone = perform(db, mira, { t: 'history.revert', seq: gone[0].seq });
		expect(names((sent(undone)[0].patch as { tokens: Token[] }).tokens)).toEqual(['Goblin', 'Hero']);
	});

	test('a token handed to a player sees, and a hidden one does not', () => {
		const { id, hero, ogre } = fight();
		see(id);
		const handed = perform(db, gm, {
			t: 'token.update',
			id: ogre.id,
			changes: { ownerId: odo.userId }
		});
		expect(names((sent(handed)[0].patch as { tokens: Token[] }).tokens)).toEqual([
			'Goblin',
			'Hero',
			'SECRET ogre'
		]);

		// Hidden from the table, the hero is nobody's eyes: only the handed token sees now.
		const hid = perform(db, gm, { t: 'token.update', id: hero.id, changes: { hidden: true } });
		const [news] = sent(hid);
		expect(news.patch.t).toBe('token.remove');
		expect(names((news.patch as { tokens: Token[] }).tokens)).toEqual(['SECRET ogre']);
	});

	test('a player puts a token of their own anywhere, and it sees where it lands', () => {
		const { id } = fight();
		see(id);
		const made = perform(db, odo, { t: 'token.create', mapId: id, name: 'Scout', x: 0.9, y: 0.52 });
		expect(names((sent(made)[0].patch as { tokens: Token[] }).tokens)).toEqual([
			'Goblin',
			'Hero',
			'SECRET ogre',
			'Scout'
		]);
	});

	test('the fog laid by hand still covers what the tokens stand next to', () => {
		const { id } = fight();
		see(id);
		// Everything right of the hero is covered: the goblin a cell away is under it.
		perform(db, gm, { t: 'map.update', id, fog: { on: true, clear: [[0, 0, 0.51, 1]] } });
		expect(names(sees(id).tokens)).toEqual(['Hero']);
	});

	test('the turn order a player is shown follows what the tokens see', () => {
		const { id, hero, goblin, ogre } = fight();
		perform(db, gm, { t: 'map.update', id, turns: { order: [hero.id, goblin.id, ogre.id] } });
		see(id);
		expect(sees(id).map.turns.order).toEqual([hero.id, goblin.id]);
		const walked = perform(db, mira, { t: 'token.update', id: hero.id, changes: { x: 0.88 } });
		expect((sent(walked)[0].patch as { turns: { order: string[] } }).turns.order).toEqual([
			hero.id,
			ogre.id
		]);
	});

	test('it goes back with undo', () => {
		const { id } = fight();
		const [set] = see(id);
		perform(db, gm, { t: 'history.revert', seq: set.seq });
		expect(sees(id, 'gm').map.sight).toBeNull();
	});
});

describe('drawings the GM keeps out of sight', () => {
	const LINE: Point[] = [
		[0.2, 0.2],
		[0.3, 0.3]
	];
	const sketch = (by: Actor, on: string, hidden = false) =>
		perform(db, by, { t: 'drawing.create', mapId: on, kind: 'line', points: LINE, hidden });
	const hide = (id: string, changes: { hidden?: boolean; seenBy?: string[] }) =>
		perform(db, gm, { t: 'drawing.update', id, changes });

	test('a hidden one reaches the GM only', () => {
		const id = battlefield();
		const made = sketch(gm, id, true);
		const trap = made[0].after as Drawing;
		expect(trap.hidden).toBe(true);
		expect(sent(made)).toHaveLength(0);
		expect(sent(made, 'gm')).toHaveLength(1);
		expect(sees(id).drawings).toHaveLength(0);
		expect(sees(id, 'gm').drawings).toHaveLength(1);

		// Nothing done to it reaches a player, not even its going.
		expect(sent(hide(trap.id, {}))).toHaveLength(0);
		expect(sent(perform(db, gm, { t: 'drawing.update', id: trap.id, changes: { move: [0.1, 0] } }))).toHaveLength(0);
		expect(sent(perform(db, gm, { t: 'drawing.delete', id: trap.id }))).toHaveLength(0);
	});

	test('revealing it looks like it being drawn, and hiding it like it being rubbed out', () => {
		const id = battlefield();
		const trap = sketch(gm, id, true)[0].after as Drawing;
		const shown = hide(trap.id, { hidden: false });
		expect(sent(shown)[0].patch.t).toBe('drawing.upsert');
		expect(sees(id).drawings).toHaveLength(1);

		const hid = hide(trap.id, { hidden: true });
		expect(sent(hid)[0].patch).toEqual({ t: 'drawing.remove', id: trap.id, mapId: id });
		// Undo reveals it again.
		const undone = perform(db, gm, { t: 'history.revert', seq: hid[0].seq });
		expect(sent(undone)[0].patch.t).toBe('drawing.upsert');
	});

	test('it can be a secret with some players', () => {
		const id = battlefield();
		const trap = sketch(gm, id, true)[0].after as Drawing;
		const shared = hide(trap.id, { seenBy: [mira.userId] });
		expect(sent(shared, mira)[0].patch.t).toBe('drawing.upsert');
		expect(sent(shared, odo)).toHaveLength(0);
		expect(sent(shared)).toHaveLength(0);

		// Whoever is let in is told it is hidden, and not who else knows.
		const [seen] = sees(id, mira).drawings;
		expect(seen).toMatchObject({ hidden: true, seenBy: [] });
		expect(sees(id, odo).drawings).toHaveLength(0);
		expect(sees(id, 'gm').drawings[0].seenBy).toEqual([mira.userId]);

		// Revealed to everyone, it is a secret with nobody.
		const revealed = hide(trap.id, { hidden: false })[0].after as Drawing;
		expect(revealed.seenBy).toEqual([]);
	});

	test('hiding is the GM’s, and a player can’t act on what they can’t see', () => {
		const id = battlefield();
		const mine = sketch(mira, id, true)[0].after as Drawing;
		// A player has nothing to hide: theirs goes down in plain sight.
		expect(mine.hidden).toBe(false);
		expect(refusal(() => perform(db, mira, { t: 'drawing.update', id: mine.id, changes: { hidden: true } }))).toBe(
			'forbidden'
		);
		const trap = sketch(gm, id, true)[0].after as Drawing;
		expect(refusal(() => perform(db, mira, { t: 'drawing.delete', id: trap.id }))).toBe('not_found');
	});
});

describe('what distances are told in', () => {
	const set = (id: string, changes: Partial<CommandOf<'map.update'>>) =>
		perform(db, gm, { t: 'map.update', id, ...changes });

	test('a map goes by the maps further out, until it says otherwise', () => {
		const kingdom = draw('The Kingdom').targetMapId;
		const bridge = draw('The Bridge', kingdom, { kind: 'battle' }).targetMapId;
		/** What a map goes by: its own word, or what the maps further out say. */
		const told = (id: string) => {
			const seen = sees(id);
			return {
				units: seen.map.units ?? seen.units,
				diagonal: seen.map.diagonal ?? seen.diagonal
			};
		};
		expect(told(bridge)).toEqual({ units: 'imperial', diagonal: 'one' });

		// Said once, on the first map of the campaign.
		set(mapId, { units: 'metric', diagonal: 'alternate' });
		expect(told(mapId)).toEqual({ units: 'metric', diagonal: 'alternate' });
		expect(told(kingdom)).toEqual({ units: 'metric', diagonal: 'alternate' });
		expect(told(bridge)).toEqual({ units: 'metric', diagonal: 'alternate' });

		// And again only where it is different.
		const [own] = set(bridge, { diagonal: 'true' });
		expect(told(bridge)).toEqual({ units: 'metric', diagonal: 'true' });
		// A map is sent what the maps outside it say, whatever it says itself.
		expect(sees(bridge).diagonal).toBe('alternate');
		expect(told(kingdom).diagonal).toBe('alternate');
		set(bridge, { diagonal: null });
		expect(told(bridge).diagonal).toBe('alternate');
		// Undo of a change to one leaves the others alone.
		set(bridge, { units: 'imperial' });
		perform(db, gm, { t: 'history.revert', seq: own.seq });
		expect(sees(bridge, 'gm').map).toMatchObject({ units: 'imperial', diagonal: null });
	});

	test('they are the GM’s to say, and one of the ways there are', () => {
		expect(refusal(() => perform(db, mira, { t: 'map.update', id: mapId, units: 'metric' }))).toBe(
			'forbidden'
		);
		expect(refusal(() => set(mapId, { units: 'cubits' as never }))).toBe('invalid');
		expect(refusal(() => set(mapId, { diagonal: 'never' as never }))).toBe('invalid');
	});

	test('metres and kilometres are worked out from the feet and miles that are kept', () => {
		expect(feetCount(5, 'metric')).toBe('1.5 m');
		expect(feetCount(8, 'metric')).toBe('2.4 m');
		expect(feetCount(30, 'metric')).toBe('9 m');
		expect(feetCount(30)).toBe('30 ft');
		expect(milesCount(24, 'metric')).toBe('36 km');
		expect(milesCount(24)).toBe('24 mi');
		// What is typed in metres is kept as the feet it came from.
		expect(shortFrom(1.5, 'metric')).toBe(5);
		expect(shortIn(shortFrom(2, 'metric'), 'metric')).toBe(2);
		expect(longFrom(900, 'metric')).toBe(600);
		expect(shortFrom(5, 'imperial')).toBe(5);
	});

	test('a diagonal step is counted the way the map says', () => {
		// Three cells across and four down.
		expect(cellsApart(3, 4)).toBe(4);
		expect(cellsApart(3, 4, 'alternate')).toBe(5);
		expect(cellsApart(3, 4, 'true')).toBe(5);
		// Every second diagonal step counts as two: 1, 3, 4, 6.
		expect([1, 2, 3, 4].map((n) => cellsApart(n, n, 'alternate'))).toEqual([1, 3, 4, 6]);
		expect(cellsApart(5, 0, 'alternate')).toBe(5);

		// A sheet of 1000 by 1000 with cells of 50 pixels and 5 feet.
		const sheet = { width: 1000, height: 1000, grid: { ...DEFAULT_GRID, size: 50 }, cellFeet: 5 };
		const a: Point = [0.1, 0.1];
		const b: Point = [0.3, 0.3];
		expect(feetBetween(sheet, a, b)).toBe(20);
		expect(feetBetween(sheet, a, b, 'alternate')).toBe(30);
		expect(feetBetween(sheet, a, b, 'true')).toBe(28.3);
		// Along a way with a bend in it, each stretch is counted on its own.
		expect(feetAlong(sheet, [a, b, [0.5, 0.3]], 'alternate')).toBe(50);
	});

	test('the finder searches what a marker says, as well as what it is called', () => {
		perform(db, gm, {
			t: 'marker.create',
			mapId,
			kind: 'world',
			type: 'merchant',
			title: 'The Gilded Eel',
			description: 'Run by Marta, who buys anything that washes ashore.',
			x: 0.5,
			y: 0.5
		});
		perform(db, gm, { t: 'marker.create', mapId, kind: 'world', type: 'note', title: 'Well', x: 0.2, y: 0.2 });
		const found = findable(db, gm.campaignId, 'player');
		expect(found.find((e) => e.name === 'The Gilded Eel')?.text).toContain('washes ashore');
		// One that says nothing has no words to search.
		expect(found.find((e) => e.name === 'Well')).not.toHaveProperty('text');
	});
});
