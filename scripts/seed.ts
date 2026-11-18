// Creates a small demo campaign to explore:  bun run seed
//
// It goes through the same modules as the app, so everything it creates is
// ordinary data with ordinary history. Safe to run more than once: it does
// nothing if the demo account already exists.
//
// The demo login is for local development only. Change the password or
// delete the account before putting a server on the internet.

import { eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGuest, registerUser } from '#lib/server/auth.ts';
import { actorFor, createCampaign, getInviteToken, getMembership, joinCampaign } from '#lib/server/campaigns.ts';
import { openDb, uploadsDir } from '#lib/server/db.ts';
import { newId } from '#lib/server/ids.ts';
import { getMapSnapshot } from '#lib/server/queries.ts';
import { users } from '#lib/server/schema.ts';
import { perform, setMapImage, type Actor } from '#lib/server/world.ts';
import type { Marker, Point } from '#lib/shared/types.ts';
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

mkdirSync(uploadsDir(), { recursive: true });

async function paint(mapId: string, painting: Painting) {
	const file = `${mapId}-${newId(12)}.png`;
	await Bun.write(join(uploadsDir(), file), painting.png);
	setMapImage(db, gm, mapId, { file, width: painting.width, height: painting.height });
}

/** Draws a region on `mapId` and returns the id of the map behind it. */
function region(mapId: string, name: string, points: Point[]): string {
	perform(db, gm, { t: 'region.create', mapId, name, points });
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

const cellar = region(tavern, 'The Cellar', [
	[0.62, 0.58],
	[0.86, 0.58],
	[0.86, 0.86],
	[0.62, 0.86]
]);
await paint(cellar, interior({ seed: 11, rooms: 3, dark: true }));

mark(gm, world, {
	type: 'quest',
	title: 'The Drowned Bell',
	description: 'It still rings at low tide. The fishers say whoever answers it does not come back.',
	x: 0.83,
	y: 0.7
});
mark(gm, world, {
	type: 'danger',
	title: 'Wyrm nest',
	description: 'Hidden until the party finds the scorched clearing.',
	x: 0.34,
	y: 0.42,
	hidden: true
});
mark(gm, port, {
	type: 'npc',
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
	type: 'npc',
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
