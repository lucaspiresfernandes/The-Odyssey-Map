// End-to-end check of the real thing:  bun run test:e2e
//
// Starts the production build and the WebSocket server on spare ports with
// a throwaway database, then acts as a GM and a player over HTTP and
// WebSockets. The unit tests cover the rules; this covers the wiring
// between the two servers, above all that nothing hidden reaches a player.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
		return { ws, messages, opened };
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

	// The WebSocket server recognises the session the app created.
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

	// Written by the SvelteKit process, delivered by the WebSocket process.
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
	check(
		'the player cannot load it either',
		!(await (await player.request(mapPath)).text()).includes(secret) &&
			!(await (await player.request(`/c/${campaign}/history`)).text()).includes(secret)
	);
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

	// Larger than the adapter's default 512 KB request limit.
	const pixels = new Uint8Array(2 * 1024 * 1024);
	pixels.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const upload = new FormData();
	upload.set('file', new File([pixels], 'map.png', { type: 'image/png' }));
	upload.set('width', '1200');
	upload.set('height', '800');
	const imagePath = `/c/${campaign}/m/${mapId}/image`;
	const uploaded = await gm.request(imagePath, { method: 'POST', body: upload });
	const file = (await uploaded.json().catch(() => null))?.events?.[0]?.patch.map.imageFile;
	check('the GM can upload a 2 MB map image', uploaded.status === 200 && !!file, `status ${uploaded.status}`);
	check('the player cannot upload one', (await player.request(imagePath, { method: 'POST', body: upload })).status === 403);
	await pause(500);
	check(
		'the new image reaches the player live',
		playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'map.upsert')
	);
	const fetched = await player.request(`${imagePath}?v=${file}`);
	check('the player can load the image', fetched.status === 200 && (await fetched.arrayBuffer()).byteLength === pixels.length);
	check('a stranger cannot', (await new Visitor().request(imagePath)).status === 401);

	gmSocket.ws.close();
	playerSocket.ws.close();
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
