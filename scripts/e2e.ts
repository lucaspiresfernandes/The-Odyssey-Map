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
	/** What it holds while it waits to be let back into a seat. */
	seat = '';

	async request(path: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		const cookies = [this.cookie, this.seat].filter(Boolean).join('; ');
		if (cookies) headers.set('cookie', cookies);
		if (!headers.has('origin')) headers.set('origin', app);
		const response = await fetch(app + path, { ...init, headers, redirect: 'manual' });
		for (const cookie of response.headers.getSetCookie()) {
			const pair = cookie.split(';')[0];
			if (pair.startsWith('odyssey_session=')) this.cookie = pair;
			// Taken away, it comes back empty.
			if (pair.startsWith('odyssey_seat=')) this.seat = pair === 'odyssey_seat=' ? '' : pair;
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

	/** `display` connects the way a table display does: as a screen, not as someone at the table. */
	connect(campaign: string, origin = app, display = false) {
		const messages: any[] = [];
		const ws = new WebSocket(`${live}/?campaign=${campaign}${display ? '&display=1' : ''}`, {
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

	// The WebSocket server asks the app who each session belongs to.
	const gmSocket = gm.connect(campaign);
	check('the GM connects with the app session', await gmSocket.opened);

	// The seats are the GM's to make. The invite link gets someone to the
	// door, where they pick their name among them, and the GM lets them in.
	/** Who the GM was last told is waiting to be let in. */
	const door = (): any[] =>
		gmSocket.messages.findLast((m) => m.t === 'knocks' || m.t === 'hello')?.knocks ?? [];
	const answerSeat = (who: Visitor, id: string | undefined, grant: boolean) =>
		who.request(`/c/${campaign}/seats`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, grant })
		});
	const seatOf = async (who: Visitor) => (await (await who.request(`${invite}/seat`)).json()).status;
	/** The seats as the GM is told they are. */
	const roster = async (): Promise<any[]> => (await (await gm.request(`/c/${campaign}/seats`)).json()).seats ?? [];
	/** The GM makes a seat by that name. Answers with its id. */
	const makeSeat = async (name: string): Promise<string> => {
		const made = await gm.request(`/c/${campaign}/seats`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		return ((await made.json()).seats ?? []).find((seat: any) => seat.name === name)?.id ?? '';
	};
	const unmakeSeat = (id: string) => gm.request(`/c/${campaign}/seats/${id}`, { method: 'DELETE' });
	/** Picks a seat on the invite link. */
	const ask = (who: Visitor, seat: string) => who.form(`${invite}?/claim`, { seat });
	/** Has the GM make a seat by that name, asks for it, has the GM say yes, and sits down. */
	const sitDown = async (who: Visitor, name: string) => {
		await ask(who, await makeSeat(name));
		await pause(300);
		await answerSeat(gm, door().find((knock) => knock.name === name)?.id, true);
		return seatOf(who);
	};
	/** What a table display asked to show the invite is handed. */
	const invitingDisplay = async () => (await gm.request(`${mapPath}?display&invite`)).text();

	check('with no seat made, the link offers nobody a name', (await (await new Visitor().request(invite)).text()).includes('no seats at this table'));
	const gatecrasher = await new Visitor().form(`${invite}?/join`, { name: 'Gatecrasher' });
	await pause(300);
	check('and a name of their own gets nobody to the GM', gatecrasher.status !== 200 && door().length === 0, `status ${gatecrasher.status}`);
	check('nor is there an invite to put on the table display', !(await invitingDisplay()).includes('/join/'));

	const testerSeat = await makeSeat('Tester');
	const otherSeat = await makeSeat('Unwelcome');
	const offered = await (await new Visitor().request(invite)).text();
	check('the GM makes seats, which the link offers by name', testerSeat !== '' && offered.includes('Tester') && offered.includes(testerSeat));
	check('and with one free, the display is handed the invite', (await invitingDisplay()).includes(invite));

	const joined = await ask(player, testerSeat);
	await pause(300);
	check(
		'the link and a name seat nobody: the GM is asked',
		joined.status === 200 && player.cookie === '' && player.seat !== '' && door().length === 1 && door()[0].name === 'Tester' && door()[0].taken === false,
		`status ${joined.status} ${JSON.stringify(door())}`
	);
	check('until the GM answers, they wait outside', (await seatOf(player)) === 'waiting' && (await player.request(mapPath)).status === 303);
	const unwelcome = new Visitor();
	await ask(unwelcome, otherSeat);
	await pause(300);
	check('nobody lets themselves in', (await answerSeat(unwelcome, door().find((knock) => knock.name === 'Unwelcome')?.id, true)).status === 401, JSON.stringify(door()));
	await answerSeat(gm, door().find((knock) => knock.name === 'Unwelcome')?.id, false);
	check('a no leaves them outside', (await seatOf(unwelcome)) === 'refused' && unwelcome.cookie === '' && unwelcome.seat === '');
	check('a seat that is not there is not asked for', (await ask(new Visitor(), 'nobody')).status === 400);
	check('the GM lets the player in', (await answerSeat(gm, door()[0]?.id, true)).status === 200);
	check('a yes seats them, logged in', (await seatOf(player)) === 'granted' && player.cookie !== '' && player.seat === '');
	const playerPage = await (await player.request(mapPath)).text();
	check('the player is not shown the invite link', !playerPage.includes('/join/'));
	const sat = await roster();
	check(
		'the seat sat in is taken, and the one refused is free still',
		sat.find((seat) => seat.id === testerSeat)?.taken === true && sat.find((seat) => seat.id === otherSeat)?.taken === false,
		JSON.stringify(sat)
	);
	await unmakeSeat(otherSeat);
	check('with every seat taken, there is no invite for the display', !(await invitingDisplay()).includes('/join/'));

	const playerSocket = player.connect(campaign);
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

	// A ping goes from browser to browser through the WebSocket server alone.
	const pingsSeen = (socket: { messages: any[] }) => socket.messages.filter((m) => m.t === 'ping');
	const handsSeen = (socket: { messages: any[] }) => socket.messages.filter((m) => m.t === 'hand');
	playerSocket.ws.send(JSON.stringify({ t: 'ping', at: { mapId, x: 0.25, y: 0.75 } }));
	await pause(300);
	const pinged = pingsSeen(gmSocket)[0]?.ping;
	check(
		'the GM sees the spot a player points out',
		pinged?.name === 'Tester' && pinged.role === 'player' && pinged.mapId === mapId && pinged.x === 0.25 && pinged.y === 0.75
	);
	check('the player is not sent their own ping', pingsSeen(playerSocket).length === 0);
	for (const at of [{ mapId, x: 'left', y: 0.5 }, { mapId: '../x', x: 0.5, y: 0.5 }, { mapId, x: 1e9, y: 0.5 }, 'here', null]) {
		playerSocket.ws.send(JSON.stringify({ t: 'ping', at }));
		await pause(40);
	}
	await pause(300);
	check('a malformed ping goes nowhere', pingsSeen(gmSocket).length === 1, `${pingsSeen(gmSocket).length} delivered`);
	for (let i = 0; i < 5; i++) playerSocket.ws.send(JSON.stringify({ t: 'ping', at: { mapId, x: 0.5, y: 0.5 } }));
	await pause(300);
	check('a flurry of pings is thinned to one', pingsSeen(gmSocket).length === 2, `${pingsSeen(gmSocket).length} delivered`);

	// Where a mouse is, is nobody else's business: nothing passes it on.
	playerSocket.ws.send(JSON.stringify({ t: 'cursor', at: { mapId, x: 0.25, y: 0.75 } }));
	playerSocket.ws.send(JSON.stringify({ t: 'hand', at: { mapId } }));
	await pause(300);
	check(
		'a mouse that holds nothing is passed on to nobody',
		handsSeen(gmSocket).length === 0 && !gmSocket.messages.some((m) => m.t === 'cursor')
	);

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
	// Pictures go into the campaign's gallery first, and are put to use from there.
	const galleryPath = `/c/${campaign}/gallery`;
	/** A picture of the given kind, as the form the gallery takes it in. */
	const picture = (kind: string, bytes: BlobPart, name: string) => {
		const form = new FormData();
		form.set('kind', kind);
		form.set('file', new File([bytes], name, { type: 'image/png' }));
		return form;
	};
	/** Adds a picture from a file of this name, and returns it as the gallery has it under `name`. */
	const add = async (kind: string, bytes: BlobPart, fileName: string, name: string) => {
		const response = await gm.request(galleryPath, { method: 'POST', body: picture(kind, bytes, fileName) });
		const items: any[] = (await response.json().catch(() => null))?.items ?? [];
		return { status: response.status, item: items.find((item) => item.name === name) };
	};
	const spare = (await add('map', pixels, 'Sunless_Reach.png', 'Sunless Reach')).item;
	check('a picture is named after the file it came in', !!spare);
	const uploaded = await add('map', pixels, 'The Reach.png', 'The Reach');
	const file: string = uploaded.item?.file;
	check('the GM can add a large map image to the gallery', uploaded.status === 200 && !!file, `status ${uploaded.status}`);
	check('the server measures it', uploaded.item?.width === 2400 && uploaded.item?.height === 1500);
	check(
		'a file that only claims to be an image is refused',
		(await gm.request(galleryPath, { method: 'POST', body: picture('map', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), 'map.png') })).status === 415
	);
	const imagePath = `/c/${campaign}/image/${file}`;
	const patch = (who: Visitor, id: string, body: unknown) =>
		who.request(`${galleryPath}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	/** What the player is shown of the gallery. */
	const playersShelf = async (): Promise<any[]> => (await (await player.request(galleryPath)).json()).items;
	check('every picture starts hidden from the player', (await playersShelf()).length === 0 && uploaded.item?.hidden === true);
	check('and is not theirs to load', (await gm.request(imagePath)).status === 200 && (await player.request(imagePath)).status === 404);
	check(
		'the player cannot add a map image to the gallery, rename in it, reveal in it or tidy it',
		(await player.request(galleryPath, { method: 'POST', body: picture('map', pixels, 'mine.png') })).status === 403 &&
			(await patch(player, uploaded.item?.id, { name: 'Mine' })).status === 403 &&
			(await patch(player, uploaded.item?.id, { hidden: false })).status === 403 &&
			// To them a hidden picture is not there at all.
			(await player.request(`${galleryPath}/${uploaded.item?.id}`, { method: 'DELETE' })).status === 404 &&
			(await playersShelf()).length === 0
	);
	// A token picture of their own is another matter: theirs to add, to find
	// in the gallery, and to take out again. Nobody else at the table has it there.
	const own = await player.request(galleryPath, { method: 'POST', body: picture('token', pixels, 'My_face.png') });
	const ownFace = ((await own.json().catch(() => null))?.items ?? []).find((item: any) => item.name === 'My face');
	const gmsShelf: any[] = (await (await gm.request(galleryPath)).json()).items;
	check(
		'but adds a token picture of their own, there for them and the GM',
		own.status === 200 &&
			ownFace?.hidden === true &&
			!!ownFace?.ownerId &&
			(await playersShelf()).length === 1 &&
			gmsShelf.some((item) => item.id === ownFace?.id) &&
			(await player.request(`/c/${campaign}/image/${ownFace?.file}`)).status === 200
	);
	check(
		'which is theirs to take out again, and not to rename or reveal',
		(await patch(player, ownFace?.id, { name: 'Mine' })).status === 403 &&
			(await patch(player, ownFace?.id, { hidden: false })).status === 403 &&
			(await player.request(`${galleryPath}/${ownFace?.id}`, { method: 'DELETE' })).status === 200 &&
			(await playersShelf()).length === 0
	);
	const shown = await patch(gm, uploaded.item?.id, { hidden: false });
	check(
		'the GM reveals a picture, and the player has it in their gallery',
		shown.status === 200 &&
			(await playersShelf()).some((item) => item.id === uploaded.item?.id && item.hidden === false) &&
			(await player.request(imagePath)).status === 200
	);
	await patch(gm, uploaded.item?.id, { hidden: true });
	check('hidden again, it is gone from there', (await playersShelf()).length === 0 && (await player.request(imagePath)).status === 404);

	const laid = await gm.command(campaign, { t: 'map.update', id: mapId, image: file });
	const laidMap = laid.body.events?.[0]?.patch.map;
	check('the GM lays it under a map, which takes its size', laidMap?.imageFile === file && laidMap?.width === 2400 && laidMap?.height === 1500, `status ${laid.status}`);
	check('the player cannot', (await player.command(campaign, { t: 'map.update', id: mapId, image: file })).status === 403);
	await pause(500);
	check(
		'the new image reaches the player live',
		playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'map.upsert' && m.event.patch.map.imageFile === file)
	);
	const fetched = await player.request(imagePath);
	check('the player can load the image', fetched.status === 200 && (await fetched.arrayBuffer()).byteLength === pixels.length);
	check('a stranger cannot', (await new Visitor().request(imagePath)).status === 401);
	const preview = await player.request(`${imagePath}?part=preview`);
	check('a big image has a preview', preview.status === 200 && preview.headers.get('content-type') === 'image/webp');
	const thumb = await gm.request(`${imagePath}?part=thumb`);
	check('and a thumbnail for the gallery', thumb.status === 200 && thumb.headers.get('content-type') === 'image/webp');
	// 2400 x 1500 in 512 pixel tiles: five across, three down.
	check('and tiles', (await player.request(`${imagePath}?part=0/4/2`)).status === 200);
	check('but none past its edge', (await player.request(`${imagePath}?part=0/5/0`)).status === 404);

	const rename = (id: string, name: string) =>
		gm.request(`${galleryPath}/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
	const relabelled = await rename(spare?.id, 'Spare');
	check('the GM renames a picture', relabelled.status === 200 && (await relabelled.json()).items.some((item: any) => item.name === 'Spare'));
	check('but not one that is not in the gallery', (await rename('nosuchpicture', 'Spare')).status === 404);

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

	// A picture taken out of the gallery stays for as long as a map shows it.
	// Deleting a region is for good: the map behind it goes, and with it the
	// last thing that held on to such a picture.
	const cellarFile: string = spare?.file ?? '';
	const furnished = await gm.command(campaign, { t: 'map.update', id: cellar?.targetMapId, image: cellarFile });
	const cellarFiles = [
		join(dataDir, 'uploads', cellarFile),
		join(dataDir, 'tiles', cellarFile.replace(/\.png$/, '')),
		join(dataDir, 'thumbs', cellarFile.replace(/\.png$/, '.webp'))
	];
	const onDisk = () => cellarFiles.filter((path) => existsSync(path)).length;
	check('the map behind a region takes an image from the gallery', furnished.status === 200 && onDisk() === 3, `${onDisk()} on disk`);
	const takenOut = await gm.request(`${galleryPath}/${spare?.id}`, { method: 'DELETE' });
	check(
		'taken out of the gallery, it stays on the map that shows it',
		takenOut.status === 200 &&
			!(await takenOut.json()).items.some((item: any) => item.id === spare?.id) &&
			onDisk() === 3 &&
			(await gm.request(`/c/${campaign}/image/${cellarFile}`)).status === 200
	);
	check('but a player is no longer shown it, on a map they cannot open', (await player.request(`/c/${campaign}/image/${cellarFile}`)).status === 404);
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
	check('and so is the picture only that map still held', onDisk() === 0, `${onDisk()} left`);
	check('the first map keeps its own', existsSync(join(dataDir, 'uploads', file)));
	check('a hidden region goes without a word to the player', shuts() === shutsBefore);

	// A battle map: a region can lead to one, and the pieces on it are moved
	// by whoever they belong to.
	const field = await gm.command(campaign, {
		t: 'region.create',
		mapId,
		name: 'The Bridge',
		points: [[0.5, 0.5], [0.8, 0.5], [0.8, 0.8], [0.5, 0.8]],
		kind: 'battle'
	});
	const bridge = field.body.events?.find((e: any) => e.patch.t === 'region.upsert')?.patch.region;
	const bridgeId: string = bridge?.targetMapId;
	check('a region can lead to a battle map', bridge?.kind === 'battle');
	const squared = await gm.command(campaign, { t: 'map.update', id: bridgeId, grid: { size: 70 } });
	check('the GM sets up its grid', squared.body.events?.[0]?.patch.map?.grid?.size === 70, `status ${squared.status}`);
	check('a player cannot', (await player.command(campaign, { t: 'map.update', id: bridgeId, grid: { size: 10 } })).status === 403);
	check('a cell starts out as eight feet', squared.body.events?.[0]?.patch.map?.cellFeet === 8);
	const scaled = await gm.command(campaign, { t: 'map.update', id: bridgeId, cellFeet: 5 });
	check('the GM says how many feet a cell is', scaled.body.events?.[0]?.patch.map?.cellFeet === 5, `status ${scaled.status}`);
	check('but not a nonsense number of them', (await gm.command(campaign, { t: 'map.update', id: bridgeId, cellFeet: 0 })).status === 400);
	check('tokens stay off a world map', (await gm.command(campaign, { t: 'token.create', mapId, name: 'Lost', x: 0.5, y: 0.5 })).status === 400);
	check(
		'notes and markers stay off a battle map',
		(await player.command(campaign, { t: 'marker.create', mapId: bridgeId, kind: 'player', title: 'Scribble', x: 0.5, y: 0.5 })).status === 400 &&
			(await gm.command(campaign, { t: 'marker.create', mapId: bridgeId, kind: 'world', title: 'Trapdoor', x: 0.5, y: 0.5 })).status === 400
	);
	check(
		'and so do regions: nothing leads further in',
		(await gm.command(campaign, { t: 'region.create', mapId: bridgeId, name: 'Under the bridge', points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]] })).status === 400
	);
	check(
		'a map stays the kind it was made as',
		(await gm.command(campaign, { t: 'map.update', id: mapId, kind: 'battle' })).status === 400 &&
			(await gm.command(campaign, { t: 'map.update', id: bridgeId, kind: 'world' })).status === 400
	);

	// A token wears a picture from the gallery, kept small however big it came.
	const face = await add('token', pixels, 'Ogre face.png', 'Ogre face');
	const faceFile: string = face.item?.file;
	check('a token picture is shrunk to fit', face.status === 200 && face.item?.width === 512 && face.item?.height === 320 && faceFile?.endsWith('.webp'));
	check('a map image is no picture for a token', (await gm.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Wrong', x: 0.5, y: 0.5, image: file })).status === 409);
	const ogre = await gm.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Ogre', x: 0.5, y: 0.5, size: 2, image: faceFile });
	const ogreId: string = ogre.body.events?.[0]?.patch.token?.id;
	check('the GM gives a token its picture', ogre.body.events?.[0]?.patch.token?.image === faceFile, `status ${ogre.status}`);
	check('and the player sees it on the token', (await player.request(`/c/${campaign}/image/${faceFile}`)).status === 200);

	// A player picks from what the GM has revealed, for a token of their own.
	const tooSoon = await player.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Hero', x: 0.4, y: 0.4, image: faceFile });
	check('a hidden picture is not the player\'s to pick, though they see it on the ogre', tooSoon.status === 409, `status ${tooSoon.status}`);
	await patch(gm, face.item?.id, { hidden: false });
	const dressed = await player.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Hero', x: 0.4, y: 0.4, image: faceFile });
	const heroId: string = dressed.body.events?.[0]?.patch.token?.id;
	check('once the GM reveals it, a player gives their own token that picture', dressed.body.events?.[0]?.patch.token?.image === faceFile, `status ${dressed.status}`);
	check('and takes it off again', (await player.command(campaign, { t: 'token.update', id: heroId, changes: { image: null } })).body.events?.[0]?.patch.token?.image === null);
	check('and makes the GM\'s token half a cell smaller', (await player.command(campaign, { t: 'token.update', id: ogreId, changes: { size: 1.5 } })).body.events?.[0]?.patch.token?.size === 1.5);
	// Short enough to fit in a token's name.
	const lurker = crypto.randomUUID().slice(0, 18);
	const lurking = await gm.command(campaign, { t: 'token.create', mapId: bridgeId, name: `Lurker ${lurker}`, x: 0.2, y: 0.2, hidden: true });
	const lurkerId: string = lurking.body.events?.[0]?.patch.token?.id;
	const tokenCommand = (id: number, cmd: unknown) => playerSocket.ws.send(JSON.stringify({ t: 'cmd', id, cmd }));
	tokenCommand(30, { t: 'token.create', mapId: bridgeId, name: 'Tester', x: 0.3, y: 0.3 });
	tokenCommand(31, { t: 'token.update', id: ogreId, changes: { x: 0.1 } });
	tokenCommand(34, { t: 'token.update', id: lurkerId, changes: { x: 0.1 } });
	await pause(600);
	const tokenEvents = (socket: { messages: any[] }, id: string) =>
		socket.messages.filter((m) => m.t === 'event' && m.event.patch.token?.id === id).map((m) => m.event.patch.token);
	check('a token the GM adds reaches the player live', !!ogreId && tokenEvents(playerSocket, ogreId)[0]?.name === 'Ogre');
	const lurkerSeen = {
		id: !!lurkerId,
		gm: tokenEvents(gmSocket, lurkerId).length,
		live: JSON.stringify(playerSocket.messages).includes(lurker),
		page: (await (await player.request(`/c/${campaign}/m/${bridgeId}`)).text()).includes(lurker)
	};
	check(
		'a hidden token never does',
		lurkerSeen.id && lurkerSeen.gm === 1 && !lurkerSeen.live && !lurkerSeen.page,
		JSON.stringify(lurkerSeen)
	);
	check('and to the player it does not exist', ack(34)?.ok === false);
	const mine = gmSocket.messages.find((m) => m.t === 'event' && m.event.patch.token?.name === 'Tester')?.event.patch.token;
	check('a player can add a token', ack(30)?.ok === true && !!mine?.id);
	check('a player moves the GM\'s token, and the GM sees it go', ack(31)?.ok === true && tokenEvents(gmSocket, ogreId).at(-1)?.x === 0.1);
	tokenCommand(32, { t: 'token.update', id: mine?.id, changes: { x: 0.6, y: 0.6 } });
	await pause(500);
	check('and the one they added', ack(32)?.ok === true && tokenEvents(gmSocket, mine?.id).at(-1)?.x === 0.6);
	tokenCommand(33, { t: 'history.revert', seq: ack(32)?.undo?.[0] });
	await pause(500);
	check('and can undo the move', ack(33)?.ok === true && tokenEvents(gmSocket, mine?.id).at(-1)?.x === 0.3);
	const handed = await gm.command(campaign, { t: 'token.update', id: mine?.id, changes: { x: 0.7, hidden: true } });
	await pause(300);
	check(
		'the GM moves and hides anyone\'s token, and to the player it is gone',
		handed.status === 200 &&
			playerSocket.messages.some((m) => m.t === 'event' && m.event.patch.t === 'token.remove' && m.event.patch.id === mine?.id)
	);

	// What the table shares about a token, and what is the GM's alone. The
	// player's token is hidden by now, so this is about the ogre.
	tokenCommand(40, { t: 'token.update', id: ogreId, changes: { name: 'Ogre chief', locked: true } });
	tokenCommand(41, { t: 'token.duplicate', id: ogreId });
	await pause(700);
	const chief = tokenEvents(gmSocket, ogreId).at(-1);
	check('a player labels and locks the GM\'s token', ack(40)?.ok === true && chief?.name === 'Ogre chief' && chief?.locked === true);
	// The copy takes the next number after its name, to tell it from the first.
	const twin = gmSocket.messages.filter((m) => m.t === 'event' && m.event.patch.token?.name === 'Ogre chief 2').map((m) => m.event.patch.token).find((t) => t.id !== ogreId);
	check('and duplicates it, into one that is numbered and not locked', ack(41)?.ok === true && !!twin && twin.locked === false);
	// Anyone takes a token off the map, and whoever did can change their mind.
	// The last the GM heard of the copy: that it is on the map, or off it.
	const twinNews = () => gmSocket.messages.filter((m) => m.t === 'event' && (m.event.patch.token?.id ?? m.event.patch.id) === twin?.id).at(-1)?.event.patch.t;
	tokenCommand(42, { t: 'token.delete', id: twin?.id });
	await pause(500);
	check('and deletes the copy, which the GM sees go', ack(42)?.ok === true && twinNews() === 'token.remove');
	tokenCommand(43, { t: 'token.restore', id: twin?.id });
	await pause(300);
	check('putting it back is not theirs to ask for', ack(43)?.ok === false && twinNews() === 'token.remove');
	tokenCommand(44, { t: 'history.revert', seq: ack(42)?.undo?.[0] });
	await pause(500);
	check('except by undoing what they did', ack(44)?.ok === true && twinNews() === 'token.upsert');
	check('a locked token stays where it is, for the GM too', (await gm.command(campaign, { t: 'token.update', id: ogreId, changes: { x: 0.2 } })).status === 409);
	// Several changes as one: turned and unlocked together, or not at all.
	const both = await gm.command(campaign, {
		t: 'batch',
		cmds: [
			{ t: 'token.update', id: ogreId, changes: { locked: false, rotation: 45 } },
			{ t: 'token.update', id: twin?.id, changes: { rotation: 45 } }
		]
	});
	check('a batch changes several tokens at once', both.status === 200 && both.body.events?.length === 2 && both.body.undo?.length === 2);
	const none = await gm.command(campaign, { t: 'batch', cmds: [{ t: 'token.update', id: ogreId, changes: { rotation: 90 } }, { t: 'token.delete', id: 'nothing' }] });
	await pause(300);
	check('and changes none of them when one is refused', none.status === 404 && tokenEvents(gmSocket, ogreId).at(-1)?.rotation === 45);

	// Anyone draws and writes on a battle map. What is there is its maker's and the GM's.
	const drawingEvents = (socket: { messages: any[] }) => socket.messages.filter((m) => m.t === 'event' && m.event.patch.t.startsWith('drawing.')).map((m) => m.event.patch);
	tokenCommand(50, { t: 'drawing.create', mapId: bridgeId, kind: 'line', points: [[0.1, 0.1], [0.2, 0.15], [0.3, 0.1]], color: '#e5544b' });
	await pause(400);
	const scrawl = drawingEvents(gmSocket).at(-1)?.drawing;
	check('a line a player draws reaches the GM live', ack(50)?.ok === true && scrawl?.kind === 'line' && scrawl.points.length === 3 && scrawl.authorName === 'Tester');
	const caption = await gm.command(campaign, { t: 'drawing.create', mapId: bridgeId, kind: 'text', points: [[0.5, 0.5]], text: 'Mind the gap' });
	const captionId: string = caption.body.events?.[0]?.patch.drawing?.id;
	await pause(300);
	check('a text the GM writes reaches the player', drawingEvents(playerSocket).some((p) => p.drawing?.text === 'Mind the gap'));
	tokenCommand(51, { t: 'drawing.delete', id: captionId });
	tokenCommand(52, { t: 'drawing.update', id: scrawl?.id, changes: { move: [0.1, 0.1] } });
	await pause(500);
	check('a player cannot rub out the GM\'s text', ack(51)?.ok === false);
	check('but slides their own line across the map', ack(52)?.ok === true && drawingEvents(gmSocket).at(-1)?.drawing?.points[0][0] === 0.2);
	check('drawings stay off a world map', (await gm.command(campaign, { t: 'drawing.create', mapId, kind: 'line', points: [[0.1, 0.1], [0.2, 0.2]] })).status === 400);
	check('the GM rubs out anyone\'s', (await gm.command(campaign, { t: 'drawing.delete', id: scrawl?.id })).status === 200);
	check('and both are in the map a player loads, or not', await (async () => {
		const page = await (await player.request(`/c/${campaign}/m/${bridgeId}`)).text();
		return page.includes('Mind the gap') && !page.includes(scrawl?.id);
	})());

	// A token in someone's hand, and a ruler, are shown to the table.
	playerSocket.ws.send(
		JSON.stringify({
			t: 'hand',
			at: { mapId: bridgeId, drag: { id: ogreId, x: 0.45, y: 0.4 }, ruler: [[0.3, 0.3], [0.4, 0.3], [0.45, 0.4]] }
		})
	);
	await pause(300);
	const inHand = handsSeen(gmSocket).at(-1)?.hand;
	check(
		'a token being dragged is shown to the table, with how far it has come',
		inHand?.name === 'Tester' && inHand.mapId === bridgeId && inHand.drag?.id === ogreId && inHand.drag.x === 0.45 && inHand.ruler?.length === 3 && inHand.ruler[2][0] === 0.45
	);
	check('the player is not sent their own hand', handsSeen(playerSocket).length === 0);
	const latecomer = gm.connect(campaign);
	await latecomer.opened;
	await pause(300);
	check(
		'someone who connects later is told what everyone already has in hand',
		latecomer.messages[0]?.hands?.some((h: any) => h.id === inHand?.id && h.drag?.id === ogreId)
	);
	latecomer.ws.close();
	const shownSoFar = handsSeen(gmSocket).length;
	for (const extra of [{ drag: { id: '../x', x: 0.4, y: 0.4 } }, { drag: { id: ogreId, x: 'far', y: 0.4 } }, { drag: 'ogre' }, { ruler: [[0.3, 0.3]] }, { ruler: [[0.3, 0.3], [0.4, 1e9]] }, { ruler: Array.from({ length: 40 }, () => [0.3, 0.3]) }]) {
		playerSocket.ws.send(JSON.stringify({ t: 'hand', at: { mapId: bridgeId, ...extra } }));
		await pause(40);
	}
	await pause(200);
	check('a malformed drag or ruler goes nowhere', handsSeen(gmSocket).length === shownSoFar, `${handsSeen(gmSocket).length - shownSoFar} delivered`);

	// Pointing: where a pointer is, for as long as its button is held down.
	playerSocket.ws.send(JSON.stringify({ t: 'hand', at: { mapId: bridgeId, point: [0.62, 0.38] } }));
	await pause(300);
	const pointed = handsSeen(gmSocket).at(-1)?.hand;
	check(
		'a spot someone is pointing at is shown to the table, under their name',
		pointed?.name === 'Tester' && pointed.mapId === bridgeId && pointed.point?.[0] === 0.62 && pointed.point[1] === 0.38 && !pointed.drag
	);
	const pointedSoFar = handsSeen(gmSocket).length;
	for (const point of [[0.5], 'there', [0.5, 1e9], [0.5, '0.5']]) {
		playerSocket.ws.send(JSON.stringify({ t: 'hand', at: { mapId: bridgeId, point } }));
		await pause(40);
	}
	await pause(200);
	check('a malformed one goes nowhere', handsSeen(gmSocket).length === pointedSoFar);
	playerSocket.ws.send(JSON.stringify({ t: 'hand', at: null }));
	await pause(300);
	check(
		'let go, it is gone for everyone',
		gmSocket.messages.filter((m) => m.t === 'hand.left').at(-1)?.id === pointed?.id
	);

	// Fog of war: what stands under it is not in the page a player loads, and
	// when it moves they are sent the tokens they may see now.
	const bridgePage = async () => (await player.request(`/c/${campaign}/m/${bridgeId}`)).text();
	const inSight = (await bridgePage()).includes(ogreId);
	const fogged = await gm.command(campaign, { t: 'map.update', id: bridgeId, fog: { on: true, clear: [] } });
	await pause(300);
	const fogNews = playerSocket.messages.filter((m) => m.t === 'event' && m.event.patch.t === 'map.upsert' && m.event.patch.map.fog?.on);
	check('the GM covers a battle map with fog', fogged.status === 200 && inSight);
	check('the player is told there is nothing left to see on it', Array.isArray(fogNews.at(-1)?.event.patch.tokens) && fogNews.at(-1).event.patch.tokens.length === 0);
	check('and loads none of what is under it', !(await bridgePage()).includes(ogreId));
	check('nor can they act on it', (await player.command(campaign, { t: 'token.update', id: ogreId, changes: { name: 'Seen' } })).status === 404);
	check('a player cannot lift it', (await player.command(campaign, { t: 'map.update', id: bridgeId, fog: { on: false } })).status === 403);
	await gm.command(campaign, { t: 'map.update', id: bridgeId, fog: { on: false } });
	check('lifted, it is all back', (await bridgePage()).includes(ogreId));

	// A table display is whoever opened it, shown what a player is: the GM's
	// own login gets a player's page and a player's events.
	const displayPage = await (await gm.request(`${mapPath}?display`)).text();
	check('a display opened by the GM is not handed the invite link', !displayPage.includes('/join/'));
	const spareSeat = await makeSeat('Spare');
	check('until the GM asks it to show the invite', (await invitingDisplay()).includes(invite));
	check('which a player\'s display is never handed', !(await (await player.request(`${mapPath}?display&invite`)).text()).includes('/join/'));
	await unmakeSeat(spareSeat);
	const displaySocket = gm.connect(campaign, app, true);
	check('a display connects', await displaySocket.opened);
	await pause(300);
	check('and listens as a player does', displaySocket.messages[0]?.role === 'player');
	const atTable = gmSocket.messages.findLast((m) => m.t === 'presence')?.online ?? [];
	check('it is nobody at the table: the GM is still the GM there', atTable.some((p: any) => p.role === 'gm') && atTable.length === 2, JSON.stringify(atTable));
	const shrouded = `SHROUDED ${crypto.randomUUID()}`;
	const crypt = await gm.command(campaign, { t: 'region.create', mapId, name: shrouded, points: [[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]], hidden: true });
	const cryptId: string = crypt.body.events?.find((e: any) => e.patch.t === 'region.upsert')?.patch.region.targetMapId;
	await pause(400);
	check('a hidden region reaches the GM, and never the display', JSON.stringify(gmSocket.messages).includes(shrouded) && !JSON.stringify(displaySocket.messages).includes(shrouded));
	const strayed = await gm.request(`/c/${campaign}/m/${cryptId}?display`);
	check(
		'a display sent where players can\'t go falls back to the first map',
		strayed.status === 307 && strayed.headers.get('location') === `${mapPath}?display`,
		`${strayed.status} ${strayed.headers.get('location')}`
	);

	// The finder is told of every map and marker a person may go to, and no others.
	const found = async (who: Visitor): Promise<any[]> => (await (await who.request(`/c/${campaign}/find`)).json()).entries;
	const [gmFinds, playerFinds] = [await found(gm), await found(player)];
	check(
		'the finder knows the maps, and keeps the one behind a hidden region from the player',
		gmFinds.some((e) => e.mapId === cryptId && e.hidden) && playerFinds.some((e) => e.mapId === bridgeId) && !playerFinds.some((e) => e.mapId === cryptId)
	);

	// A picture that is in the gallery and nowhere else is the GM's alone:
	// there is no holding one up for the table.
	const lich = (await add('map', pixels, 'The Lich.png', 'The Lich')).item;
	const lichPath = `/c/${campaign}/image/${lich?.file}`;
	check('a player cannot load a picture nothing on a map shows them', (await player.request(lichPath)).status === 404);
	const hold = await gm.request(`/c/${campaign}/show`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: lich?.id })
	});
	check(
		'and the GM has no way to hold one up for the table',
		hold.status === 404 && (await player.request(lichPath)).status === 404,
		`status ${hold.status}`
	);

	displaySocket.ws.close();

	// What some players are let in on and the rest are not: the app says what
	// each of them is owed, and the WebSocket server sends each socket its own.
	const friend = new Visitor();
	await sitDown(friend, 'Friend');
	const friendSocket = friend.connect(campaign);
	const screen = gm.connect(campaign, app, true);
	await Promise.all([friendSocket.opened, screen.opened]);
	await pause(300);
	const friendId: string = friendSocket.messages[0]?.user.id;
	const whisper = crypto.randomUUID();
	const told = (socket: { messages: any[] }) => JSON.stringify(socket.messages).includes(whisper);
	const shared = await gm.command(campaign, {
		t: 'marker.create',
		mapId,
		kind: 'world',
		title: `WHISPER ${whisper}`,
		x: 0.2,
		y: 0.2,
		hidden: true,
		seenBy: [friendId]
	});
	await pause(500);
	check('a secret reaches the player it is shared with, live', shared.status === 200 && told(friendSocket));
	check('and not the other player, nor a table display', !told(playerSocket) && !told(screen));
	check(
		'their pages agree',
		(await (await friend.request(mapPath)).text()).includes(whisper) &&
			!(await (await player.request(mapPath)).text()).includes(whisper) &&
			!(await (await gm.request(`${mapPath}?display`)).text()).includes(whisper)
	);
	const whisperId: string = shared.body.events?.[0]?.patch.marker.id;
	await gm.command(campaign, { t: 'marker.update', id: whisperId, changes: { seenBy: [] } });
	await pause(400);
	check(
		'taken back, it goes from their map like a marker deleted',
		friendSocket.messages.at(-1)?.event?.patch.t === 'marker.remove' && friendSocket.messages.at(-1)?.event.patch.id === whisperId
	);

	// A closed region: on the map for everyone, and nobody but the GM steps in.
	const tomb = await gm.command(campaign, {
		t: 'region.create',
		mapId,
		name: 'The Tomb',
		closed: true,
		points: [[0.6, 0.1], [0.8, 0.1], [0.8, 0.3]]
	});
	const tombRegion = tomb.body.events?.find((e: any) => e.patch.t === 'region.upsert')?.patch.region;
	await pause(300);
	check(
		'a closed region is on the players’ map, and its map is not theirs to open',
		(await (await player.request(mapPath)).text()).includes('The Tomb') &&
			(await player.request(`/c/${campaign}/m/${tombRegion?.targetMapId}`)).status === 404 &&
			(await gm.request(`/c/${campaign}/m/${tombRegion?.targetMapId}`)).status === 200
	);
	await gm.command(campaign, { t: 'region.update', id: tombRegion?.id, closed: false });
	check('opened, it is', (await player.request(`/c/${campaign}/m/${tombRegion?.targetMapId}`)).status === 200);

	friendSocket.ws.close();
	screen.ws.close();

	// Ending a turn is the table's: a player does it over the socket.
	const fighter = await gm.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Fighter', x: 0.5, y: 0.5, count: 12 });
	const fighterId: string = fighter.body.events?.[0]?.patch.token.id;
	await gm.command(campaign, { t: 'map.update', id: bridgeId, turns: { order: [fighterId], current: fighterId, round: 1, rolls: { [fighterId]: 15 } } });
	playerSocket.ws.send(JSON.stringify({ t: 'cmd', id: 900, cmd: { t: 'turn.next', mapId: bridgeId, from: fighterId } }));
	await pause(500);
	const turned = playerSocket.messages.filter((m) => m.t === 'event' && m.event.patch.t === 'map.upsert' && m.event.patch.map.id === bridgeId).at(-1);
	check(
		'a player ends the turn of a token they can see, with nothing of it theirs to undo',
		ack(900)?.ok === true && ack(900)?.undo.length === 0 && turned?.event.patch.map.turns.round === 2,
		JSON.stringify([ack(900), turned?.event.patch.map.turns])
	);
	check('and is not sent what the tokens rolled', turned?.event.patch.map.turns.rolls === undefined);
	check('a token carries its number to everyone', fighter.body.events?.[0]?.patch.token.count === 12);

	// A number the GM keeps: the token goes to the players without it, and
	// what the GM does to it afterwards never leaves the app.
	const heard = (id: string) =>
		playerSocket.messages.filter((m) => m.t === 'event' && m.event.patch.t === 'token.upsert' && m.event.patch.token.id === id);
	const brute = await gm.command(campaign, { t: 'token.create', mapId: bridgeId, name: 'Ogre', x: 0.6, y: 0.5, count: 40, countHidden: true });
	const bruteId: string = brute.body.events?.[0]?.patch.token.id;
	await pause(300);
	check('the GM is sent a number they keep', brute.body.events?.[0]?.patch.token.count === 40 && brute.body.events?.[0]?.patch.token.countHidden === true);
	check(
		'a player is sent the token without it',
		heard(bruteId).length === 1 && heard(bruteId)[0].event.patch.token.count === null && heard(bruteId)[0].event.patch.token.countHidden === false,
		JSON.stringify(heard(bruteId))
	);
	await gm.command(campaign, { t: 'token.update', id: bruteId, changes: { count: 31 } });
	await pause(300);
	check('and hears nothing when it changes', heard(bruteId).length === 1 && !JSON.stringify(playerSocket.messages).includes('"count":31'));
	const guessed = await player.command(campaign, { t: 'token.update', id: bruteId, changes: { count: 31 } });
	check('nor can a player set it, right or wrong', guessed.status === 403 && (await player.command(campaign, { t: 'token.update', id: bruteId, changes: { count: 5 } })).status === 403);

	// An encounter saved from tokens on the map, put down again hidden, and thrown away.
	const encounters = (who: Visitor, method = 'GET', body?: unknown, id = '') =>
		who.request(`/c/${campaign}/encounters${id && `/${id}`}`, {
			method,
			headers: body ? { 'content-type': 'application/json' } : {},
			body: body ? JSON.stringify(body) : undefined
		});
	const savedEncounter = await (await encounters(gm, 'POST', { name: 'Bridge guard', from: [bruteId, fighterId] })).json();
	const guard = savedEncounter.items?.[0];
	check(
		'the GM saves tokens as an encounter, kept number and all',
		savedEncounter.ok && savedEncounter.items.length === 1 && savedEncounter.made === guard.id && guard.name === 'Bridge guard' && guard.tokens.length === 2 && guard.tokens.some((t: any) => t.count === 31 && t.countHidden),
		JSON.stringify(savedEncounter)
	);
	check(
		'encounters are nothing a player sees, makes, changes or throws away',
		(await encounters(player)).status === 403 &&
			(await encounters(player, 'POST', { name: 'Mine' })).status === 403 &&
			(await encounters(player, 'POST', { name: 'Mine', from: [fighterId] })).status === 403 &&
			(await encounters(player, 'PATCH', { name: 'Mine' }, guard?.id)).status === 403 &&
			(await encounters(player, 'DELETE', undefined, guard?.id)).status === 403
	);
	const heardBefore = playerSocket.messages.length;
	const putDown = await gm.command(campaign, {
		t: 'batch',
		cmds: (guard?.tokens ?? []).map(({ dx, dy, ...token }: any) => ({
			t: 'token.create',
			mapId: bridgeId,
			...token,
			hidden: true,
			x: 0.3 + dx * 0.01,
			y: 0.3 + dy * 0.01
		}))
	});
	await pause(300);
	check(
		'put down again it is hidden, and a player hears nothing of it',
		putDown.status === 200 && putDown.body.events?.length === 2 && putDown.body.events.every((e: any) => e.patch.token.hidden) && playerSocket.messages.length === heardBefore,
		JSON.stringify(putDown.body).slice(0, 300)
	);
	// One made in the gallery: empty at first, then filled, its tokens side by side.
	const fresh = await (await encounters(gm, 'POST', { name: 'Wolf pack' })).json();
	const filled = await (
		await encounters(gm, 'PATCH', { name: 'Wolves', tokens: [{ name: 'Wolf' }, { name: 'Wolf', size: 2 }] }, fresh.made)
	).json();
	const pack = filled.items?.find((each: any) => each.id === fresh.made);
	check(
		'the GM makes an encounter with nothing on a map, and fills it',
		fresh.ok && fresh.items.length === 2 && pack?.name === 'Wolves' && pack.tokens.length === 2 && pack.tokens[1].size === 2 && pack.tokens[0].dx < pack.tokens[1].dx,
		JSON.stringify(filled)
	);
	check('and one that is not there is not changed', (await encounters(gm, 'PATCH', { name: 'Ghost' }, 'nothing')).status === 404);
	await encounters(gm, 'DELETE', undefined, fresh.made);
	const thrown = await (await encounters(gm, 'DELETE', undefined, guard?.id)).json();
	check('and thrown away, it is gone', thrown.ok && thrown.items.length === 0 && (await encounters(gm, 'DELETE', undefined, guard?.id)).status === 404);

	// A whole campaign out to one file, and back in as a new one.
	const exported = await gm.request(`/c/${campaign}/export`);
	const archive = new Uint8Array(await exported.arrayBuffer());
	check('the GM exports the campaign as one file', exported.status === 200 && archive.length > 1024);
	check('a player cannot', (await player.request(`/c/${campaign}/export`)).status === 403);
	const sendIn = (who: Visitor, bytes: Uint8Array) =>
		who.request('/import', {
			method: 'POST',
			headers: { 'content-type': 'application/x-tar' },
			body: new Blob([new Uint8Array(bytes)])
		});
	const imported = await sendIn(gm, archive);
	const copy = await imported.json();
	check('and imports it as a new campaign of their own', imported.status === 200 && copy.ok && copy.id !== campaign);
	const copyPage = await (await gm.request((await gm.request(`/c/${copy.id}`)).headers.get('location') ?? '')).text();
	check('with its maps and what is on them', copyPage.includes('End To End') && copyPage.includes('The Tomb'));
	check('a guest imports nothing', (await sendIn(player, archive)).status === 403);
	check('nor is a file that is not a campaign taken', (await sendIn(gm, new TextEncoder().encode('nothing of the kind'))).status === 400);

	// A seat got back into: someone with no login asks for a player's seat,
	// only the GM hears of it, and a yes logs that browser in as them. Not
	// while the player is at the table, though: a seat holds one browser.
	const wanderer = new Visitor();
	await sitDown(wanderer, 'Wanderer');
	const wandererSocket = wanderer.connect(campaign);
	await wandererSocket.opened;
	await pause(300);
	const playerId: string = wandererSocket.messages[0]?.user.id;
	const returning = new Visitor();
	const seats = await (await returning.request(invite)).text();
	check('the invite link offers the seats that are taken', seats.includes('Wanderer') && seats.includes(playerId));
	check('and says whose player is at the table', seats.includes('at the table'));
	const early = await ask(returning, playerId);
	await pause(300);
	check('a seat whose player is at the table is nobody else\'s to ask for', early.status === 400 && returning.seat === '' && door().length === 0, `status ${early.status} ${JSON.stringify(door())}`);
	wandererSocket.ws.close();
	await pause(300);
	const asked = await ask(returning, playerId);
	await pause(400);
	const knocks: any[] = gmSocket.messages.findLast((m) => m.t === 'knocks')?.knocks ?? [];
	const overheard = [playerSocket, displaySocket].some((socket) => socket.messages.some((m) => m.t === 'knocks'));
	check('once they have left, asking for it reaches the GM', asked.status === 200 && returning.seat !== '' && knocks.length === 1 && knocks[0].name === 'Wanderer' && knocks[0].taken === true, JSON.stringify(knocks));
	check('and nobody else', !overheard);
	// They come back to the table before the GM has answered.
	const backFirst = wanderer.connect(campaign);
	await backFirst.opened;
	await pause(300);
	check('nobody is let into a seat whose player came back meanwhile', (await answerSeat(gm, knocks[0]?.id, true)).status === 409 && (await seatOf(returning)) === 'waiting');
	backFirst.ws.close();
	await pause(300);
	const seatStatus = () => seatOf(returning);
	check('until the GM answers, they wait, logged in as nobody', (await seatStatus()) === 'waiting' && returning.cookie === '');
	const answer = (who: Visitor, grant: boolean) => answerSeat(who, knocks[0]?.id, grant);
	check('a player cannot let them in', (await answer(player, true)).status === 403);
	check('the GM can', (await answer(gm, true)).status === 200);
	await pause(300);
	check('and is told nobody is waiting any more', gmSocket.messages.findLast((m) => m.t === 'knocks')?.knocks.length === 0);
	check('a yes logs that browser in', (await seatStatus()) === 'granted' && returning.cookie !== '' && returning.seat === '');
	check('and logs out the browser that sat there before', (await wanderer.request(mapPath)).status === 303);
	const backSocket = returning.connect(campaign);
	await backSocket.opened;
	await pause(300);
	check('as the player they were', backSocket.messages[0]?.user.id === playerId && backSocket.messages[0]?.role === 'player');
	check('the answer lets one browser in, once', (await seatStatus()) === 'gone');
	backSocket.ws.close();

	// Someone logged in at some other table picks a name like anyone: there
	// is no seat for the account itself, and the yes makes that browser the
	// player whose seat it is.
	const member = new Visitor();
	await member.form('/?/register', { username: `pc_${secret.slice(0, 8)}`, password: secret });
	const memberSession = member.cookie;
	const lateSeat = await makeSeat('Latecomer');
	const memberAsked = await ask(member, lateSeat);
	await pause(300);
	const memberKnock = door().find((knock) => knock.name === 'Latecomer');
	check('someone logged in asks for a seat like anyone', memberAsked.status === 200 && memberKnock?.taken === false && member.seat !== '', JSON.stringify(door()));
	check('and is no member until the GM says so', (await member.request(mapPath)).status !== 200);
	await answerSeat(gm, memberKnock?.id, true);
	check('a yes makes that browser the player whose seat it is', (await seatOf(member)) === 'granted' && member.cookie !== memberSession && (await member.request(mapPath)).status === 200);
	check('with a seat already, the link leads straight to the map', (await member.request(invite)).status === 303 && (await ask(member, lateSeat)).status === 303);

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
		'what they had in hand leaves with them',
		gmSocket.messages.some((m) => m.t === 'hand.left' && m.id === inHand?.id)
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
