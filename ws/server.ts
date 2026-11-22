// The live half of The Odyssey Map: a small Bun WebSocket server that runs
// beside the SvelteKit app.
//
// It is a bridge and keeps no data: it never opens the database. The app is
// the only one that does.
//
//   - When a browser connects, its cookies are passed to the app, which says
//     who that is and what role they have.
//   - A command from a browser is forwarded to the app exactly as the browser
//     would have posted it, and the app's answer is sent back.
//   - After every change the app tells this server what to deliver, already
//     filtered for each role, and for each player who is let in on something
//     the others are not. The picture the GM is holding up, and who for,
//     is kept for as long as this server runs, for whoever connects later:
//     the app also tells of it whenever a browser connects. So is who is
//     asking for a seat they sat in before, which only the GM is ever
//     told. And the date it is in the world, which everyone is.
//   - What a browser has in hand goes straight from one browser to the
//     others: the token it is dragging, the distance it is measuring, the
//     spot it is pointing at while its button is held down. So does a ping,
//     which points a spot out to the table for a moment. None of that is a
//     change to the world, so the app never hears of it, and nothing about
//     it is kept once the browser disconnects. A token only moves for good
//     when it is let go: that is a command. Where a mouse is otherwise is
//     never sent at all.

import type { ServerWebSocket } from 'bun';
import {
	LIMITS,
	type Broadcast,
	type ClientMessage,
	type CommandResponse,
	type Hand,
	type HandSpot,
	type Knock,
	type LiveIdentity,
	type Ping,
	type PingSpot,
	type Presence,
	type Role,
	type ServerMessage,
	type Shown
} from '#lib/shared/types.ts';

const PORT = Number(process.env.WS_PORT || 3001);
const HOST = process.env.WS_HOST || '127.0.0.1';
const ROLES: Role[] = ['gm', 'player'];

/** Where the app listens. Requests go there over this machine's loopback. */
const APP_URL = (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(
	/\/+$/,
	''
);

/** Shared with the app, so only the app can have events delivered. */
const SECRET = process.env.BRIDGE_SECRET;
if (!SECRET) {
	console.error(
		'BRIDGE_SECRET is not set. Start the servers with `bun run dev` or `bun run start`, ' +
			'which create one, or set the same value for both yourself.'
	);
	process.exit(1);
}

/** Extra origins allowed to connect, for deployments behind a proxy. */
const TRUSTED_ORIGINS = new Set(
	(process.env.ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
);

/** What an id from the app looks like. */
const ID_SHAPE = /^[A-Za-z0-9]{1,64}$/;

interface Connection {
	/** Made up here, one per socket. It names this browser's hand to the others. */
	id: string;
	campaignId: string;
	user: { id: string; name: string };
	role: Role;
	/**
	 * A table display: a screen that shows the players' view and takes no
	 * part. It is nobody at the table, and has no hand of its own.
	 */
	display: boolean;
	/** The browser's cookies. They go to the app with every command, and the app decides who is asking. */
	cookie: string;
	/** The newest event the app had when this browser was identified. */
	seq: number;
	/** Timestamps of recent commands, for rate limiting. */
	recent: number[];
	/** Commands from one socket are forwarded one at a time, in the order they came. */
	queue: Promise<void>;
	/** The picture the app said was held up for the table when this browser was identified, and when that was. */
	shown: Shown | null;
	/** Who the app said was asking for a seat then. Empty for anyone but the GM. */
	knocks: Knock[];
	/** The date the app said it was in the world then. */
	date: string;
	identifiedAt: number;
	/** What this browser last said it had in hand, for people who connect later. */
	hand: Hand | null;
	/** When that was, to keep one browser from flooding the others. */
	handAt: number;
	/** When this browser last pinged, for the same reason. */
	pingedAt: number;
}

let connections = 0;

type Socket = ServerWebSocket<Connection>;

const rooms = new Map<string, Set<Socket>>();

/** The newest event delivered per campaign since this server started. */
const delivered = new Map<string, number>();

/** The picture held up per campaign, the players it is for, and when the app last said so through here. */
const heldUp = new Map<string, { shown: Shown | null; to: string[]; at: number }>();

/** Who is asking for a seat per campaign, and when the app last said so through here. */
const knocking = new Map<string, { knocks: Knock[]; at: number }>();

/** The date in the world per campaign, and when the app last said so through here. */
const dates = new Map<string, { date: string; at: number }>();

/**
 * Who a socket is among the players, by user id, or null for the GM and for
 * a table display: a display is shown what every player may see, and none
 * of what only some of them may.
 */
const playerOf = (ws: Socket): string | null =>
	ws.data.role === 'player' && !ws.data.display ? ws.data.user.id : null;

/**
 * A picture held up for the players in `to`, or with none for the whole
 * table, as one socket is shown it. Only the GM is told who it is for.
 */
function shownFor(ws: Socket, shown: Shown | null, to: string[]): Shown | null {
	if (!shown) return null;
	const { to: _, ...bare } = shown;
	if (ws.data.role === 'gm') return { ...bare, to };
	const id = playerOf(ws);
	return to.length === 0 || (id !== null && to.includes(id)) ? bare : null;
}

// Players and the GM listen on separate topics, because the same event can
// mean different things to each (or nothing at all to a player).
const topic = (campaignId: string, role: Role) => `${campaignId}:${role}`;

function send(ws: Socket, message: ServerMessage) {
	ws.send(JSON.stringify(message));
}

function presence(campaignId: string): Presence[] {
	const seen = new Map<string, Presence>();
	for (const ws of rooms.get(campaignId) ?? []) {
		const { user, role, display } = ws.data;
		if (!display) seen.set(user.id, { id: user.id, name: user.name, role });
	}
	return [...seen.values()];
}

function announcePresence(campaignId: string) {
	const message = JSON.stringify({
		t: 'presence',
		online: presence(campaignId)
	} satisfies ServerMessage);
	for (const ws of rooms.get(campaignId) ?? []) ws.send(message);
}

/**
 * A browser sends cookies on any WebSocket handshake, including one started
 * by a page on another site, so the page's origin has to be checked here.
 */
function originAllowed(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	if (!origin) return true; // not a browser
	if (TRUSTED_ORIGINS.has(origin)) return true;
	try {
		return new URL(origin).hostname === url.hostname;
	} catch {
		return false;
	}
}

// ------------------------------------------------------------------ the app

/** A request to the app on behalf of a browser, carrying that browser's cookies. */
async function askApp(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
	const response = await fetch(APP_URL + path, {
		...init,
		headers: { ...init.headers, cookie },
		redirect: 'manual',
		signal: AbortSignal.timeout(10000)
	});
	if (!appListening) {
		appListening = true;
		console.log(`The app is answering at ${APP_URL}.`);
	}
	return response;
}

/** Whether something was listening at APP_URL the last time it was asked. */
let appListening = true;

/**
 * Notes a request the app gave no answer to. Nothing listening there is what
 * starting looks like when this server is ready before the app is, and
 * browsers try again on their own: it is said once, in a line, until the app
 * answers. Anything else is printed whole.
 */
function appSilent(err: unknown) {
	const code = (err as { code?: unknown } | null)?.code;
	if (code !== 'ECONNREFUSED' && code !== 'ConnectionRefused') {
		console.error('The app did not answer:', err);
		return;
	}
	if (appListening) {
		console.log(`Nothing is listening at ${APP_URL} yet. Browsers will try again until the app is up.`);
	}
	appListening = false;
}

/**
 * Asks the app who these cookies belong to in this campaign. For a table
 * display the app answers with the role its screen is to be shown as.
 */
async function identify(
	campaignId: string,
	cookie: string,
	display: boolean
): Promise<LiveIdentity | Response> {
	if (!cookie) return new Response('Not logged in', { status: 401 });
	// The id becomes part of a URL, so only the shape of a real id gets through.
	if (!ID_SHAPE.test(campaignId)) {
		return new Response('Campaign not found', { status: 404 });
	}
	try {
		const response = await askApp(`/c/${campaignId}/live${display ? '?display=1' : ''}`, cookie);
		if (response.status === 401) return new Response('Not logged in', { status: 401 });
		if (!response.ok) return new Response('Campaign not found', { status: 404 });
		return (await response.json()) as LiveIdentity;
	} catch (err) {
		appSilent(err);
		return new Response('The app is not reachable', { status: 503 });
	}
}

/** Forwards one command to the app and tells the sender how it went. */
async function forward(ws: Socket, message: Extract<ClientMessage, { t: 'cmd' }>) {
	const refuse = (error: string) => send(ws, { t: 'ack', id: message.id, ok: false, error });

	let status: number;
	let body: Partial<CommandResponse> | null;
	try {
		const response = await askApp(`/c/${ws.data.campaignId}/command`, ws.data.cookie, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(message.cmd ?? null)
		});
		status = response.status;
		body = await response.json().catch(() => null);
	} catch (err) {
		appSilent(err);
		return refuse('Something went wrong.');
	}

	// The login may have ended since this socket opened. The app answers 401
	// for that, and 404 without a reason of its own when the campaign is no
	// longer theirs.
	if (status === 401 || (status === 404 && typeof body?.error !== 'string')) {
		refuse('You are no longer logged in.');
		ws.close(4401, 'Session ended');
		return;
	}

	// The app delivers a change before it answers, so by now the sender has
	// already been sent the effect of their own command.
	if (body?.ok === true) {
		const undo = Array.isArray(body.undo) ? body.undo : [];
		return send(ws, { t: 'ack', id: message.id, ok: true, undo });
	}
	refuse(typeof body?.error === 'string' ? body.error : 'Something went wrong.');
}

// ----------------------------------------------------------- hands and pings

/** Sends to everyone in the campaign except the socket it came from. */
function relay(from: Socket, message: ServerMessage) {
	const text = JSON.stringify(message);
	for (const ws of rooms.get(from.data.campaignId) ?? []) {
		if (ws !== from) ws.send(text);
	}
}

/** What everyone but `ws` has in hand. */
function hands(ws: Socket): Hand[] {
	const others: Hand[] = [];
	for (const other of rooms.get(ws.data.campaignId) ?? []) {
		if (other !== ws && other.data.hand) others.push(other.data.hand);
	}
	return others;
}

// A hand can be over the margin around a map, so a little outside 0..1 is fine.
const nearMap = (n: unknown): n is number => typeof n === 'number' && Math.abs(n) <= 16;

/**
 * A browser pointing a spot out to the table. Everyone else in the campaign
 * is told, and the ones looking at that map show it. The browser that sent
 * it shows its own.
 */
function ping(ws: Socket, at: unknown) {
	if (ws.data.display) return;
	const spot = at as Partial<PingSpot> | null | undefined;
	if (typeof spot !== 'object' || spot === null) return;
	if (typeof spot.mapId !== 'string' || !ID_SHAPE.test(spot.mapId)) return;
	if (!nearMap(spot.x) || !nearMap(spot.y)) return;

	// A few a second is plenty to point with.
	const now = Date.now();
	if (now - ws.data.pingedAt < 250) return;
	ws.data.pingedAt = now;

	// Who is pointing comes from the connection, never from the message.
	const { user, role } = ws.data;
	const sent: Ping = {
		userId: user.id,
		name: user.name,
		role,
		mapId: spot.mapId,
		x: spot.x,
		y: spot.y
	};
	relay(ws, { t: 'ping', ping: sent });
}

/** A browser saying what it has in hand, or (with null) that it has let go. */
function hold(ws: Socket, at: unknown) {
	if (ws.data.display) return;
	if (at === null) {
		if (!ws.data.hand) return;
		ws.data.hand = null;
		return relay(ws, { t: 'hand.left', id: ws.data.id });
	}

	const spot = at as Partial<HandSpot> | undefined;
	if (typeof spot !== 'object' || typeof spot.mapId !== 'string' || !ID_SHAPE.test(spot.mapId)) {
		return;
	}

	// A token being dragged, a distance being measured, a spot being pointed
	// at. Whether that token is theirs to move is not known here. The
	// browsers that are shown this know the token, and decide.
	const { drag, ruler, point } = spot;
	// An empty hand is said with null.
	if (drag === undefined && ruler === undefined && point === undefined) return;
	if (point !== undefined) {
		if (!Array.isArray(point) || point.length !== 2 || !nearMap(point[0]) || !nearMap(point[1])) {
			return;
		}
	}
	if (drag !== undefined) {
		if (typeof drag !== 'object' || drag === null) return;
		if (typeof drag.id !== 'string' || !ID_SHAPE.test(drag.id)) return;
		if (!nearMap(drag.x) || !nearMap(drag.y)) return;
	}
	if (ruler !== undefined) {
		// Two ends, and the spots it bends at between them.
		if (!Array.isArray(ruler) || ruler.length < 2 || ruler.length > LIMITS.rulerPoints) return;
		const sound = (spot: unknown) =>
			Array.isArray(spot) && spot.length === 2 && nearMap(spot[0]) && nearMap(spot[1]);
		if (!ruler.every(sound)) return;
	}

	// A browser sends about twenty of these a second. Much faster is dropped.
	const now = Date.now();
	if (now - ws.data.handAt < 15) return;
	ws.data.handAt = now;

	// Whose hand it is comes from the connection, never from the message.
	const { id, user, role } = ws.data;
	const hand: Hand = { id, userId: user.id, name: user.name, role, mapId: spot.mapId };
	if (drag) hand.drag = { id: drag.id, x: drag.x, y: drag.y };
	if (ruler) hand.ruler = ruler.map(([x, y]) => [x, y]);
	if (point) hand.point = [point[0], point[1]];
	ws.data.hand = hand;
	relay(ws, { t: 'hand', hand });
}

/** The app handing over events to deliver. Nobody else may call this. */
async function publish(request: Request): Promise<Response> {
	if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${SECRET}`) {
		return new Response('Forbidden', { status: 403 });
	}
	const { campaignId, events, show, knocks, date, seats } = (await request.json()) as Broadcast;
	const room = rooms.get(campaignId) ?? [];
	// Seats the GM has changed. A player who was renamed is called the new
	// name from here on, by everyone who is told who is at the table. One
	// whose seat was taken away is told so and hung up on: the app would
	// refuse whatever they sent next, and they are owed nothing more of
	// what happens here.
	if (seats?.length) {
		for (const ws of [...room]) {
			const seat = seats.find((each) => each.id === ws.data.user.id);
			if (!seat || ws.data.role !== 'player') continue;
			if (seat.name === null) {
				send(ws, { t: 'bye' });
				ws.close(4403, 'Seat taken away');
			} else {
				ws.data.user = { ...ws.data.user, name: seat.name };
				if (ws.data.hand) ws.data.hand = { ...ws.data.hand, name: seat.name };
			}
		}
		announcePresence(campaignId);
	}
	// Who is asking for a seat they sat in before: the GM's to know, on
	// every screen of theirs but a table display, which listens as a player.
	if (knocks) {
		knocking.set(campaignId, { knocks, at: Date.now() });
		const message: ServerMessage = { t: 'knocks', knocks };
		server.publish(topic(campaignId, 'gm'), JSON.stringify(message));
	}
	// A picture held up, or put away. Everyone is told: the ones it is not
	// for, that nothing is up.
	if (show) {
		const to = show.to ?? [];
		heldUp.set(campaignId, { shown: show.shown, to, at: Date.now() });
		for (const ws of room) send(ws, { t: 'show', shown: shownFor(ws, show.shown, to) });
	}
	// The date in the world has been set, or with an empty one, taken away:
	// everyone's to know.
	if (typeof date === 'string') {
		dates.set(campaignId, { date, at: Date.now() });
		const message = JSON.stringify({ t: 'date', date } satisfies ServerMessage);
		for (const ws of room) ws.send(message);
	}
	for (const event of events) {
		delivered.set(campaignId, Math.max(delivered.get(campaignId) ?? 0, event.seq));
		const { only } = event;
		if (!only) {
			for (const role of ROLES) {
				// The app has already decided what each role may see. A null
				// means this role must not learn that anything happened.
				const live = event.to[role];
				if (!live) continue;
				const message: ServerMessage = { t: 'event', event: live };
				server.publish(topic(campaignId, role), JSON.stringify(message));
			}
			continue;
		}
		// Some players are owed something else than the rest: each socket is
		// sent what is its own.
		for (const ws of room) {
			const id = playerOf(ws);
			const live = id !== null && id in only ? only[id] : event.to[ws.data.role];
			if (live) send(ws, { t: 'event', event: live });
		}
	}
	return new Response('ok');
}

// --------------------------------------------------------------- the server

const server = Bun.serve({
	port: PORT,
	hostname: HOST,

	async fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === '/health') return new Response('ok');
		if (url.pathname === '/publish') return publish(request);
		if (!originAllowed(request, url)) return new Response('Forbidden', { status: 403 });

		const campaignId = url.searchParams.get('campaign') ?? '';
		const cookie = request.headers.get('cookie') ?? '';
		const display = url.searchParams.has('display');
		const asked = Date.now();
		const identity = await identify(campaignId, cookie, display);
		if (identity instanceof Response) return identity;

		const data: Connection = {
			id: String(++connections),
			campaignId,
			user: identity.user,
			role: identity.role,
			display,
			cookie,
			seq: identity.seq,
			recent: [],
			queue: Promise.resolve(),
			shown: identity.shown ?? null,
			knocks: identity.role === 'gm' ? (identity.knocks ?? []) : [],
			date: identity.date ?? '',
			identifiedAt: asked,
			hand: null,
			handAt: 0,
			pingedAt: 0
		};
		if (server.upgrade(request, { data })) return;
		return new Response('Expected a WebSocket', { status: 426 });
	},

	websocket: {
		data: {} as Connection,
		maxPayloadLength: 64 * 1024,
		idleTimeout: 120,

		open(ws) {
			const { campaignId, role, user } = ws.data;
			ws.subscribe(topic(campaignId, role));
			let room = rooms.get(campaignId);
			if (!room) rooms.set(campaignId, (room = new Set()));
			room.add(ws);

			const held = heldUp.get(campaignId);
			const asking = knocking.get(campaignId);
			const dated = dates.get(campaignId);
			send(ws, {
				t: 'hello',
				user,
				role,
				// Anything delivered between the app identifying this browser
				// and the subscription above went past it. Counting those in
				// tells the browser its snapshot is behind, and it reloads.
				seq: Math.max(ws.data.seq, delivered.get(campaignId) ?? 0),
				online: presence(campaignId),
				hands: hands(ws),
				// What the app said when it identified this browser, unless the
				// picture has been changed through here since it was asked.
				shown:
					held && held.at >= ws.data.identifiedAt
						? shownFor(ws, held.shown, held.to)
						: ws.data.shown,
				// The same goes for who is asking for a seat, which is the GM's to hear.
				knocks:
					role !== 'gm'
						? []
						: asking && asking.at >= ws.data.identifiedAt
							? asking.knocks
							: ws.data.knocks,
				// And for the date in the world.
				date: dated && dated.at >= ws.data.identifiedAt ? dated.date : ws.data.date
			});
			if (!ws.data.display) announcePresence(campaignId);
		},

		message(ws, raw) {
			let message: ClientMessage;
			try {
				message = JSON.parse(String(raw));
			} catch {
				return;
			}
			// A browser that was asleep asking whether this connection still lives.
			if (message?.t === 'hi') return send(ws, { t: 'hi' });
			if (message?.t === 'hand') return hold(ws, message.at);
			if (message?.t === 'ping') return ping(ws, message.at);
			if (message?.t !== 'cmd' || typeof message.id !== 'number') return;

			const now = Date.now();
			ws.data.recent = ws.data.recent.filter((at) => now - at < 5000);
			if (ws.data.recent.length >= 40) {
				send(ws, {
					t: 'ack',
					id: message.id,
					ok: false,
					error: 'Too many changes at once. Give it a moment.'
				});
				return;
			}
			ws.data.recent.push(now);

			ws.data.queue = ws.data.queue.then(() => forward(ws, message)).catch(console.error);
		},

		close(ws) {
			const { campaignId } = ws.data;
			const room = rooms.get(campaignId);
			room?.delete(ws);
			if (ws.data.hand) relay(ws, { t: 'hand.left', id: ws.data.id });
			if (room?.size === 0) rooms.delete(campaignId);
			else if (!ws.data.display) announcePresence(campaignId);
		}
	}
});

console.log(`Live sync listening on ws://${server.hostname}:${server.port}, forwarding to ${APP_URL}`);
