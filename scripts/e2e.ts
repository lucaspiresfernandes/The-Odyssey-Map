// End-to-end check of the real thing:  bun run test:e2e
//
// Starts the production build and the WebSocket server on spare ports with
// a throwaway database, then acts as a GM and a player over HTTP and
// WebSockets. The unit tests cover the rules; this covers the wiring
// between the two servers, above all that nothing hidden reaches a player.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const APP_PORT = 4173;
const WS_PORT = 3101;
const app = `http://127.0.0.1:${APP_PORT}`;
const live = `ws://127.0.0.1:${WS_PORT}`;

if (!existsSync('build/index.js')) {
	console.error('No production build found. Run `bun run build` first, or use `bun run test:e2e`.');
	process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'odyssey-e2e-'));
const env = {
	...process.env,
	DATA_DIR: dataDir,
	HOST: '127.0.0.1',
	PORT: String(APP_PORT),
	WS_HOST: '127.0.0.1',
	WS_PORT: String(WS_PORT),
	APP_URL: app,
	BRIDGE_SECRET: crypto.randomUUID(),
	ORIGIN: undefined
};
const servers = [
	Bun.spawn([process.execPath, './build'], { env, stdio: ['ignore', 'ignore', 'inherit'] }),
	Bun.spawn([process.execPath, 'ws/server.ts'], { env, stdio: ['ignore', 'ignore', 'inherit'] })
];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url: string) {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// not up yet
		}
		await pause(100);
	}
	throw new Error(`${url} did not come up`);
}

// ----------------------------------------------------------------- clients

/** A browser, reduced to what matters here: it keeps the session cookie and names its origin. */
class Visitor {
	cookie = '';

	async request(path: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		if (this.cookie) headers.set('cookie', this.cookie);
		if (!headers.has('origin')) headers.set('origin', app);
		const response = await fetch(app + path, { ...init, headers, redirect: 'manual' });
		for (const cookie of response.headers.getSetCookie()) {
			const pair = cookie.split(';')[0];
			if (pair.startsWith('odyssey_session=')) this.cookie = pair;
		}
		return response;
	}

	/** Submits a form the way a browser does without JavaScript. */
	form(path: string, fields: Record<string, string>, origin = app) {
		return this.request(path, {
			method: 'POST',
			headers: { accept: 'text/html', origin },
			body: new URLSearchParams(fields)
		});
	}

	async command(campaign: string, command: unknown) {
		const response = await this.request(`/c/${campaign}/command`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(command)
		});
		return { status: response.status, body: await response.json() };
	}

	connect(campaign: string, origin = app) {
		const messages: any[] = [];
		const ws = new WebSocket(`${live}/?campaign=${campaign}`, {
			headers: { cookie: this.cookie, origin }
		} as any);
		ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
		const opened = new Promise<boolean>((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onerror = () => resolve(false);
			ws.onclose = () => resolve(false);
		});
		/** The close code, once the server has hung up. */
		const closed = new Promise<number>((resolve) => {
			ws.addEventListener('close', (event) => resolve(event.code));
		});
		return { ws, messages, opened, closed };
	}
}

// ------------------------------------------------------------------ checks

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
	results.push({ name, ok, detail });
}

async function run() {
	const secret = crypto.randomUUID();
	const gm = new Visitor();
	const player = new Visitor();

	check('home page loads', (await gm.request('/')).status === 200);

	const account = { username: `gm_${secret.slice(0, 8)}`, password: secret };
	const forged = await new Visitor().form('/?/register', account, 'http://elsewhere.example');
	check('a form posted from another site is refused', forged.status === 403, `status ${forged.status}`);

	const registered = await gm.form('/?/register', account);
	check('registering logs in, over plain http', registered.status === 303 && gm.cookie !== '');

	const created = await gm.form('/?/create', { name: 'End To End' });
	const campaign = (created.headers.get('location') ?? '').split('/')[2];
	check('a campaign can be created', created.status === 303 && !!campaign);

	const mapPath = (await gm.request(`/c/${campaign}`)).headers.get('location') ?? '';
	const mapId = mapPath.split('/')[4];
	const gmPage = await (await gm.request(mapPath)).text();
	const invite = gmPage.match(/\/join\/[A-Za-z0-9]+/)?.[0] ?? '';
	check('the GM sees the map and an invite link', gmPage.includes('End To End') && invite !== '');

	check('a stranger is sent to log in', (await player.request(mapPath)).status === 303);
	const joined = await player.form(invite, { name: 'Tester' });
	check('a player joins with the link and a name', joined.status === 303 && player.cookie !== '');
	const playerPage = await (await player.request(mapPath)).text();
	check('the player is not shown the invite link', !playerPage.includes('/join/'));

	// The WebSocket server asks the app who each session belongs to.
	const gmSocket = gm.connect(campaign);
	const playerSocket = player.connect(campaign);
	check('the GM connects with the app session', await gmSocket.opened);
	check('the player connects with the app session', await playerSocket.opened);
	check('no session, no connection', !(await new Visitor().connect(campaign).opened));
	check('a page on another site cannot connect', !(await gm.connect(campaign, 'http://elsewhere.example').opened));
	await pause(300);
	check(
		'each connection is told its role',
		gmSocket.messages[0]?.role === 'gm' && playerSocket.messages[0]?.role === 'player'
	);

	// Written by the app over HTTP, then handed to the WebSocket server to deliver.
	const hidden = await gm.command(campaign, {
		t: 'marker.create',
		mapId,
		kind: 'world',
		title: `HIDDEN ${secret}`,
		description: `notes ${secret}`,
		x: 0.5,
		y: 0.5,
		hidden: true
	});
	const markerId: string = hidden.body.events?.[0]?.patch.marker.id;
	await gm.command(campaign, { t: 'marker.update', id: markerId, changes: { description: `more ${secret}` } });
	await pause(700);
	check('a hidden marker reaches the GM live', JSON.stringify(gmSocket.messages).includes(secret));
	check('a hidden marker never reaches the player', !JSON.stringify(playerSocket.messages).includes(secret));
	check('the player cannot load it either', !(await (await player.request(mapPath)).text()).includes(secret));
	const poke = await player.command(campaign, { t: 'marker.delete', id: markerId });
	check('to the player it does not exist', poke.status === 404, `status ${poke.status}`);

	// Commands over the socket itself.
	gmSocket.ws.send(
		JSON.stringify({
			t: 'cmd',
			id: 1,
			cmd: { t: 'marker.update', id: markerId, changes: { title: 'Revealed', description: '', hidden: false } }
		})
	);
	await pause(500);
	const reveal = playerSocket.messages.find((m) => m.t === 'event' && m.event.patch.t === 'marker.upsert');
	check('revealing it delivers it to the player', reveal?.event.patch.marker.title === 'Revealed');
	const seen = gmSocket.messages.findIndex((m) => m.t === 'event' && m.event.patch.marker?.title === 'Revealed');
	const acked = gmSocket.messages.findIndex((m) => m.t === 'ack' && m.id === 1);
	check('the sender is shown its change before the acknowledgement', seen !== -1 && seen < acked);

	// Undo is asking for the opposite of a change by its number, and redo is
	// undoing the undo. The acknowledgement says which numbers those are.
	const revealSeq: number = gmSocket.messages[acked]?.undo?.[0];
	check('the acknowledgement names the change, so it can be undone', Number.isInteger(revealSeq));
	gmSocket.ws.send(JSON.stringify({ t: 'cmd', id: 2, cmd: { t: 'history.revert', seq: revealSeq } }));
	await pause(500);
	const undone = gmSocket.messages.find((m) => m.t === 'ack' && m.id === 2);
	check(
		'undoing the reveal takes the marker away from the player again',
		undone?.ok === true &&
			playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'marker.remove' && m.event.patch.id === markerId)
	);
	gmSocket.ws.send(JSON.stringify({ t: 'cmd', id: 3, cmd: { t: 'history.revert', seq: undone?.undo?.[0] } }));
	await pause(500);
	const reveals = playerSocket.messages.filter((m) => m.t === 'event' && m.event.patch.marker?.title === 'Revealed');
	check('redoing it gives the marker back', reveals.length === 2, `${reveals.length} reveals`);

	playerSocket.ws.send(JSON.stringify({ t: 'cmd', id: 7, cmd: { t: 'marker.delete', id: markerId } }));
	playerSocket.ws.send(
		JSON.stringify({
			t: 'cmd',
			id: 8,
			cmd: { t: 'marker.create', mapId, kind: 'player', title: 'Meet here at dawn', x: 0.2, y: 0.2 }
		})
	);
	await pause(500);
	const ack = (id: number) => playerSocket.messages.find((m) => m.t === 'ack' && m.id === id);
	check('the player cannot delete a world marker', ack(7)?.ok === false);
	check('the player can add a note', ack(8)?.ok === true);
	check(
		'the note reaches the GM live',
		gmSocket.messages.some((m) => m.t === 'event' && m.event.patch.marker?.title === 'Meet here at dawn')
	);
	check('the player still never received the hidden text', !JSON.stringify(playerSocket.messages).includes(secret));

	// A table note is deleted by whoever added it or by the GM, and by no other player.
	const noteId: string = gmSocket.messages.find((m) => m.t === 'event' && m.event.patch.marker?.title === 'Meet here at dawn')
		?.event.patch.marker.id;
	const retitled = await gm.command(campaign, { t: 'marker.update', id: noteId, changes: { title: 'Meet here at dusk' } });
	check('the GM can edit a player\'s note', retitled.status === 200, `status ${retitled.status}`);
	const gmNote = await gm.command(campaign, { t: 'marker.create', mapId, kind: 'player', title: 'The GM was here', x: 0.6, y: 0.6 });
	const gmNoteId: string = gmNote.body.events?.[0]?.patch.marker.id;
	playerSocket.ws.send(JSON.stringify({ t: 'cmd', id: 12, cmd: { t: 'marker.delete', id: gmNoteId } }));
	playerSocket.ws.send(JSON.stringify({ t: 'cmd', id: 10, cmd: { t: 'marker.delete', id: noteId } }));
	await pause(500);
	check('a player cannot delete a note someone else added', !!gmNoteId && ack(12)?.ok === false);
	check('the player who added a note can delete it', ack(10)?.ok === true);
	playerSocket.ws.send(JSON.stringify({ t: 'cmd', id: 11, cmd: { t: 'history.revert', seq: ack(10)?.undo?.[0] } }));
	await pause(500);
	check(
		'and can undo that',
		ack(11)?.ok === true && (await (await gm.request(mapPath)).text()).includes('Meet here at dusk')
	);
	const taken = await gm.command(campaign, { t: 'marker.delete', id: noteId });
	check(
		'the GM can delete a player\'s note too',
		taken.status === 200 && !(await (await gm.request(mapPath)).text()).includes('Meet here at dusk'),
		`status ${taken.status}`
	);
	const givenBack = await gm.command(campaign, { t: 'history.revert', seq: taken.body.undo?.[0] });
	check(
		'and undo that',
		givenBack.status === 200 && (await (await player.request(mapPath)).text()).includes('Meet here at dusk'),
		`status ${givenBack.status}`
	);

	// Pointers go from browser to browser through the WebSocket server alone.
	const cursorsSeen = (socket: { messages: any[] }) => socket.messages.filter((m) => m.t === 'cursor');
	playerSocket.ws.send(JSON.stringify({ t: 'cursor', at: { mapId, x: 0.25, y: 0.75 } }));
	await pause(300);
	const pointer = cursorsSeen(gmSocket)[0]?.cursor;
	check(
		'the GM sees where the player is pointing',
		pointer?.name === 'Tester' && pointer.role === 'player' && pointer.mapId === mapId && pointer.x === 0.25 && pointer.y === 0.75
	);
	check('the player is not sent their own pointer', cursorsSeen(playerSocket).length === 0);
	const latecomer = gm.connect(campaign);
	await latecomer.opened;
	await pause(300);
	check(
		'someone who connects later is told where everyone already is',
		latecomer.messages[0]?.cursors?.some((c: any) => c.id === pointer?.id && c.x === 0.25)
	);
	latecomer.ws.close();
	for (const at of [{ mapId, x: 'left', y: 0.5 }, { mapId: '../x', x: 0.5, y: 0.5 }, { mapId, x: 1e9, y: 0.5 }, 'here']) {
		playerSocket.ws.send(JSON.stringify({ t: 'cursor', at }));
		await pause(40);
	}
	await pause(200);
	check('a malformed pointer goes nowhere', cursorsSeen(gmSocket).length === 1, `${cursorsSeen(gmSocket).length} delivered`);

	// Only the app may tell the WebSocket server what to deliver.
	const forgedEvent = {
		seq: 999999,
		at: Date.now(),
		actor: { id: 'x', name: 'x' },
		patch: { t: 'marker.remove', id: markerId, mapId }
	};
	const planted = await fetch(`http://127.0.0.1:${WS_PORT}/publish`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: 'Bearer guess' },
		body: JSON.stringify({
			campaignId: campaign,
			events: [{ seq: 999999, to: { gm: forgedEvent, player: forgedEvent } }]
		})
	});
	await pause(200);
	check(
		'nobody but the app can have events delivered',
		planted.status === 403 && !JSON.stringify(playerSocket.messages).includes('999999')
	);

	// Noise, so the file is far larger than the adapter's default 512 KB
	// request limit, and wide enough to be cut into tiles.
	const pixels = await sharp({
		create: {
			width: 2400,
			height: 1500,
			channels: 3,
			background: 'black',
			noise: { type: 'gaussian', mean: 128, sigma: 40 }
		}
	})
		.png()
		.toBuffer();
	const upload = new FormData();
	upload.set('file', new File([pixels], 'map.png', { type: 'image/png' }));
	const imagePath = `/c/${campaign}/m/${mapId}/image`;
	const uploaded = await gm.request(imagePath, { method: 'POST', body: upload });
	const uploadedMap = (await uploaded.json().catch(() => null))?.events?.[0]?.patch.map;
	const file = uploadedMap?.imageFile;
	check('the GM can upload a large map image', uploaded.status === 200 && !!file, `status ${uploaded.status}`);
	check('the server measures it', uploadedMap?.width === 2400 && uploadedMap?.height === 1500);
	const notAnImage = new FormData();
	notAnImage.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], 'map.png'));
	check('a file that only claims to be an image is refused', (await gm.request(imagePath, { method: 'POST', body: notAnImage })).status === 415);
	check('the player cannot upload one', (await player.request(imagePath, { method: 'POST', body: upload })).status === 403);
	await pause(500);
	check(
		'the new image reaches the player live',
		playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'map.upsert')
	);
	const fetched = await player.request(`${imagePath}?v=${file}`);
	check('the player can load the image', fetched.status === 200 && (await fetched.arrayBuffer()).byteLength === pixels.length);
	check('a stranger cannot', (await new Visitor().request(imagePath)).status === 401);
	const preview = await player.request(`${imagePath}?v=${file}&part=preview`);
	check('a big image has a preview', preview.status === 200 && preview.headers.get('content-type') === 'image/webp');
	// 2400 x 1500 in 512 pixel tiles: five across, three down.
	check('and tiles', (await player.request(`${imagePath}?v=${file}&part=0/4/2`)).status === 200);
	check('but none past its edge', (await player.request(`${imagePath}?v=${file}&part=0/5/0`)).status === 404);

	// A hidden region takes its whole map away from players: the outline, the
	// page behind it, and the news of anything that happens in there.
	const veiled = crypto.randomUUID();
	const drawn = await gm.command(campaign, {
		t: 'region.create',
		mapId,
		name: `Cellar ${veiled}`,
		points: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
		hidden: true
	});
	const cellar = drawn.body.events?.find((e: any) => e.patch.t === 'region.upsert')?.patch.region;
	const cellarPath = `/c/${campaign}/m/${cellar?.targetMapId}`;
	await gm.command(campaign, { t: 'marker.create', mapId: cellar?.targetMapId, kind: 'world', title: `Vault ${veiled}`, x: 0.5, y: 0.5 });
	await pause(500);
	check('a hidden region reaches the GM live', gmSocket.messages.some((m) => m.t === 'event' && m.event.patch.region?.id === cellar?.id));
	check('neither it nor what is inside reaches the player', !JSON.stringify(playerSocket.messages).includes(veiled));
	check('the player is not shown it on the map', !(await (await player.request(mapPath)).text()).includes(veiled));
	check(
		'nor let into the map behind it',
		(await player.request(cellarPath)).status === 404 && (await gm.request(cellarPath)).status === 200
	);
	const trespass = await player.command(campaign, { t: 'marker.create', mapId: cellar?.targetMapId, kind: 'player', title: 'Sneaking in', x: 0.5, y: 0.5 });
	check('nor can they leave a note in there', trespass.status === 404, `status ${trespass.status}`);

	gmSocket.ws.send(JSON.stringify({ t: 'cmd', id: 20, cmd: { t: 'region.update', id: cellar?.id, hidden: false } }));
	await pause(500);
	check(
		'revealing the region delivers it to the player',
		playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'region.upsert' && m.event.patch.region.id === cellar?.id)
	);
	check('and lets them in', (await (await player.request(cellarPath)).text()).includes(`Vault ${veiled}`));
	gmSocket.ws.send(JSON.stringify({ t: 'cmd', id: 21, cmd: { t: 'region.update', id: cellar?.id, hidden: true } }));
	await pause(500);
	check(
		'hiding it again tells the player which map has shut',
		playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'region.remove' && m.event.patch.targetMapId === cellar?.targetMapId)
	);
	check('and shuts it', (await player.request(cellarPath)).status === 404);

	// Deleting a region is for good. The map behind it goes, and the files
	// of that map's image with it.
	const furnished = await gm.request(`${cellarPath}/image`, { method: 'POST', body: upload });
	const cellarFile: string = (await furnished.json().catch(() => null))?.events?.[0]?.patch.map.imageFile ?? '';
	const cellarFiles = [join(dataDir, 'uploads', cellarFile), join(dataDir, 'tiles', cellarFile.replace(/\.png$/, ''))];
	const onDisk = () => cellarFiles.filter((path) => existsSync(path)).length;
	check('the map behind a region gets an image and tiles of its own', furnished.status === 200 && onDisk() === 2);
	const shuts = () => playerSocket.messages.filter((m) => m.t === 'event' && m.event.patch.t === 'region.remove').length;
	const shutsBefore = shuts();
	gmSocket.ws.send(JSON.stringify({ t: 'cmd', id: 22, cmd: { t: 'region.delete', id: cellar?.id } }));
	const gmAck = (id: number) => gmSocket.messages.find((m) => m.t === 'ack' && m.id === id);
	for (let i = 0; i < 50 && !gmAck(22); i++) await pause(100);
	check('the GM can delete a region, and is offered no undo', gmAck(22)?.ok === true && gmAck(22).undo.length === 0);
	check(
		'the GM is told it went',
		gmSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'region.remove' && m.event.patch.id === cellar?.id)
	);
	check('its map is gone, for the GM too', (await gm.request(cellarPath)).status === 404);
	check('and so are the image and its tiles', onDisk() === 0, `${onDisk()} left`);
	check('the first map keeps its own', existsSync(join(dataDir, 'uploads', file)));
	check('a hidden region goes without a word to the player', shuts() === shutsBefore);

	// The app checks the login on every forwarded command, so an open socket
	// stops working the moment its session ends.
	await player.form('/?/logout', {});
	playerSocket.ws.send(
		JSON.stringify({
			t: 'cmd',
			id: 9,
			cmd: { t: 'marker.create', mapId, kind: 'player', title: 'After logout', x: 0.3, y: 0.3 }
		})
	);
	const code = await Promise.race([playerSocket.closed, pause(2000).then(() => 0)]);
	check('logging out ends the live connection', ack(9)?.ok === false && code === 4401, `close code ${code}`);
	check('and nothing was written', !(await (await gm.request(mapPath)).text()).includes('After logout'));
	check(
		'their pointer leaves with them',
		gmSocket.messages.some((m) => m.t === 'cursor.left' && m.id === pointer?.id)
	);

	gmSocket.ws.close();
}

let crashed: unknown;
try {
	await Promise.all([waitFor(app), waitFor(`http://127.0.0.1:${WS_PORT}/health`)]);
	await run();
} catch (err) {
	crashed = err;
} finally {
	for (const server of servers) server.kill();
	await Promise.all(servers.map((server) => server.exited));
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

for (const { name, ok, detail } of results) {
	console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
if (crashed) console.error('\nThe run stopped early:', crashed);
process.exit(failed || crashed ? 1 : 0);
