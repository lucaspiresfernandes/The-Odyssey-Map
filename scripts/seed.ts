// Creates a small demo campaign to explore:  bun run seed
//
// It goes through the same modules as the app, so everything it creates is
// ordinary data with ordinary history. Safe to run more than once: it does
// nothing if the demo account already exists.
//
// The demo login is for local development only. Change the password or
// delete the account before putting a server on the internet.

import { eq } from 'drizzle-orm';
import { createGuest, registerUser } from '#lib/server/auth.ts';
import { actorFor, createCampaign, getInviteToken, getMembership, joinCampaign } from '#lib/server/campaigns.ts';
import { openDb } from '#lib/server/db.ts';
import { addToGallery, newImageFile } from '#lib/server/gallery.ts';
import { getMapSnapshot } from '#lib/server/queries.ts';
import { users } from '#lib/server/schema.ts';
import { getStorage } from '#lib/server/storage.ts';
import { uploadKey } from '#lib/server/tiles.ts';
import { perform, type Actor } from '#lib/server/world.ts';
import { TOKEN_COLORS, type MapKind, type Marker, type Point } from '#lib/shared/types.ts';
import { interior, terrain, type Painting } from './demo-art.ts';

export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'odyssey-demo';

const db = openDb();

if (db.select({ id: users.id }).from(users).where(eq(users.username, DEMO_USERNAME)).get()) {
	console.log(`The demo account "${DEMO_USERNAME}" already exists. Nothing to do.`);
	process.exit(0);
}

const owner = await registerUser(db, DEMO_USERNAME, DEMO_PASSWORD);
const campaign = createCampaign(db, owner, 'The Sunless Reach');
const gm = actorFor(owner, getMembership(db, campaign.id, owner.id)!);

const guest = createGuest(db, 'Mira');
joinCampaign(db, campaign.id, guest.id);
const mira = actorFor(guest, getMembership(db, campaign.id, guest.id)!);

/** Puts a painting in the gallery under the name of the map it is for, and lays it under that map. */
async function paint(mapId: string, painting: Painting) {
	const file = newImageFile('png');
	await getStorage().put(uploadKey(file), painting.png);
	const name = getMapSnapshot(db, campaign.id, mapId, 'gm')!.map.name;
	addToGallery(db, gm, { kind: 'map', name, file, width: painting.width, height: painting.height });
	perform(db, gm, { t: 'map.update', id: mapId, image: file });
}

/** Draws a region on `mapId` and returns the id of the map behind it: a world map unless told otherwise. */
function region(mapId: string, name: string, points: Point[], kind: MapKind = 'world'): string {
	perform(db, gm, { t: 'region.create', mapId, name, points, kind });
	const regions = getMapSnapshot(db, campaign.id, mapId, 'gm')!.regions;
	return regions.find((r) => r.name === name)!.targetMapId;
}

function mark(by: Actor, mapId: string, marker: Partial<Marker> & { title: string; x: number; y: number }) {
	perform(db, by, {
		t: 'marker.create',
		mapId,
		kind: by.role === 'gm' ? 'world' : 'player',
		...marker
	});
}

// The world, and a window onto its coast.
const coast = { x0: 0.5, y0: 0.3, x1: 0.78, y1: 0.62 };
const world = campaign.rootMapId;
await paint(world, terrain({ seed: 7, x0: 0, y0: 0, x1: 1, y1: 1 }));

const port = region(world, 'Port Varr', [
	[coast.x0, coast.y0],
	[coast.x1, coast.y0],
	[coast.x1, coast.y1],
	[coast.x0, coast.y1]
]);
// The same land, seen closer: the child map samples the region it sits in.
await paint(port, terrain({ seed: 7, ...coast }));

const wood = region(world, 'The Ashen Wood', [
	[0.14, 0.2],
	[0.3, 0.14],
	[0.42, 0.26],
	[0.38, 0.44],
	[0.2, 0.46]
]);
await paint(wood, terrain({ seed: 7, x0: 0.14, y0: 0.14, x1: 0.42, y1: 0.46 }));

const tavern = region(port, 'The Gilded Eel', [
	[0.42, 0.4],
	[0.56, 0.4],
	[0.56, 0.56],
	[0.42, 0.56]
]);
await paint(tavern, interior({ seed: 3, rooms: 5 }));

// The cellar is where the fight breaks out: a battle map from the start,
// with the pieces already on it.
const cellar = region(
	tavern,
	'The Cellar',
	[
		[0.62, 0.58],
		[0.86, 0.58],
		[0.86, 0.86],
		[0.62, 0.86]
	],
	'battle'
);
await paint(cellar, interior({ seed: 11, rooms: 3, dark: true }));

// The painted rooms start 90 pixels in, and so does the grid.
const CELL = 50;
const EDGE = 90 % CELL;
perform(db, gm, { t: 'map.update', id: cellar, grid: { size: CELL, x: EDGE, y: EDGE } });

/** Puts a token on the cellar's grid, in the cell that many across and down. */
function piece(by: Actor, name: string, column: number, row: number, extra: Record<string, unknown> = {}) {
	perform(db, by, {
		t: 'token.create',
		mapId: cellar,
		name,
		x: (EDGE + (column + 0.5) * CELL) / 1400,
		y: (EDGE + (row + 0.5) * CELL) / 1000,
		...extra
	});
}

piece(mira, 'Mira', 4, 13, { color: TOKEN_COLORS[5] });
piece(gm, 'Smuggler', 9, 6);
piece(gm, 'Smuggler 2', 11, 9, { outline: TOKEN_COLORS[2] });
piece(gm, 'Brute', 17.5, 11.5, { size: 2, color: TOKEN_COLORS[1] });
piece(gm, 'Lookout', 21, 3, { color: TOKEN_COLORS[6], hidden: true });

mark(gm, world, {
	type: 'quest',
	title: 'The Drowned Bell',
	description: 'It still rings at low tide. The fishers say whoever answers it does not come back.',
	x: 0.83,
	y: 0.7
});
mark(gm, world, {
	type: 'note',
	title: 'Wyrm nest',
	description: 'Hidden until the party finds the scorched clearing.',
	x: 0.34,
	y: 0.42,
	hidden: true
});
mark(gm, port, {
	type: 'note',
	title: 'Harbourmaster Ilse',
	description: 'Knows every ship that came in this month, and which ones did not declare their cargo.',
	x: 0.7,
	y: 0.3
});
mark(gm, tavern, {
	type: 'treasure',
	title: 'Loose floorboard',
	description: 'Hidden. A ledger of smuggled cargo is wedged underneath.',
	x: 0.3,
	y: 0.62,
	hidden: true
});
mark(mira, tavern, {
	type: 'note',
	title: 'The suspicious innkeeper',
	description: 'Went pale when we asked about the cellar.',
	x: 0.52,
	y: 0.34
});
mark(mira, port, {
	type: 'note',
	title: 'Meet here at dawn',
	description: 'By the fish market, before the tide turns.',
	x: 0.28,
	y: 0.66
});

console.log(`
Demo campaign created: ${campaign.name}

  Log in as the GM   username "${DEMO_USERNAME}", password "${DEMO_PASSWORD}"
  Invite for players /join/${getInviteToken(db, campaign.id)}
`);
