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
//     filtered for each role. The same goes for the GM bringing everyone to
//     what they are looking at: the app says who may follow.
//   - Where each browser's pointer is goes straight from one browser to the
//     others, along with the token it is dragging or the distance it is
//     measuring. None of that is a change to the world, so the app never
//     hears of it, and nothing about it is kept once the browser disconnects.
//     A token only moves for good when it is let go: that is a command.

import type { ServerWebSocket } from 'bun';
import type {
	Broadcast,
	ClientMessage,
	CommandResponse,
	Cursor,
	CursorSpot,
	LiveIdentity,
	Presence,
	Role,
	ServerMessage
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
	/** Made up here, one per socket. It names this browser's pointer to the others. */
	id: string;
	campaignId: string;
	user: { id: string; name: string };
	role: Role;
	/**
	 * A table display: a screen that shows the players' view and takes no
	 * part. It is nobody at the table, and has no pointer of its own.
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
	/** Where this browser last said its pointer was, for people who connect later. */
	cursor: Cursor | null;
	/** When that was, to keep one browser from flooding the others. */
	pointedAt: number;
}

let connections = 0;

type Socket = ServerWebSocket<Connection>;

const rooms = new Map<string, Set<Socket>>();

/** The newest event delivered per campaign since this server started. */
const delivered = new Map<string, number>();

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
function askApp(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
	return fetch(APP_URL + path, {
		...init,
		headers: { ...init.headers, cookie },
		redirect: 'manual',
		signal: AbortSignal.timeout(10000)
	});
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
		console.error('The app did not answer:', err);
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
		console.error('The app did not answer:', err);
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

// ----------------------------------------------------------------- pointers

/** Sends to everyone in the campaign except the socket it came from. */
function relay(from: Socket, message: ServerMessage) {
	const text = JSON.stringify(message);
	for (const ws of rooms.get(from.data.campaignId) ?? []) {
		if (ws !== from) ws.send(text);
	}
}

/** Where everyone but `ws` is pointing. */
function cursors(ws: Socket): Cursor[] {
	const others: Cursor[] = [];
	for (const other of rooms.get(ws.data.campaignId) ?? []) {
		if (other !== ws && other.data.cursor) others.push(other.data.cursor);
	}
	return others;
}

// The pointer can be over the margin around a map, so a little outside 0..1 is fine.
const nearMap = (n: unknown): n is number => typeof n === 'number' && Math.abs(n) <= 16;

/** A browser saying where its pointer is, or (with null) that it has left the map. */
function point(ws: Socket, at: unknown) {
	if (ws.data.display) return;
	if (at === null) {
		if (!ws.data.cursor) return;
		ws.data.cursor = null;
		return relay(ws, { t: 'cursor.left', id: ws.data.id });
	}

	const spot = at as Partial<CursorSpot> | undefined;
	if (typeof spot !== 'object' || typeof spot.mapId !== 'string' || !ID_SHAPE.test(spot.mapId)) {
		return;
	}
	if (!nearMap(spot.x) || !nearMap(spot.y)) return;

	// What they have in hand comes along: a token being dragged, a distance
	// being measured. Whether that token is theirs to move is not known
	// here. The browsers that are shown this know the token, and decide.
	const { drag, ruler } = spot;
	if (drag !== undefined) {
		if (typeof drag !== 'object' || drag === null) return;
		if (typeof drag.id !== 'string' || !ID_SHAPE.test(drag.id)) return;
		if (!nearMap(drag.x) || !nearMap(drag.y)) return;
	}
	if (ruler !== undefined) {
		const ends = Array.isArray(ruler) && ruler.length === 2 ? ruler : [];
		const sound = (end: unknown) =>
			Array.isArray(end) && end.length === 2 && nearMap(end[0]) && nearMap(end[1]);
		if (!sound(ends[0]) || !sound(ends[1])) return;
	}

	// A browser sends about twenty of these a second. Much faster is dropped.
	const now = Date.now();
	if (now - ws.data.pointedAt < 15) return;
	ws.data.pointedAt = now;

	// Who is pointing comes from the connection, never from the message.
	const { id, user, role } = ws.data;
	const cursor: Cursor = {
		id,
		userId: user.id,
		name: user.name,
		role,
		mapId: spot.mapId,
		x: spot.x,
		y: spot.y
	};
	if (drag) cursor.drag = { id: drag.id, x: drag.x, y: drag.y };
	if (ruler) cursor.ruler = [[ruler[0][0], ruler[0][1]], [ruler[1][0], ruler[1][1]]];
	ws.data.cursor = cursor;
	relay(ws, { t: 'cursor', cursor });
}

/** The app handing over events to deliver. Nobody else may call this. */
async function publish(request: Request): Promise<Response> {
	if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${SECRET}`) {
		return new Response('Forbidden', { status: 403 });
	}
	const { campaignId, events, gather } = (await request.json()) as Broadcast;
	// The GM bringing everyone along: the app has said which roles may follow.
	for (const role of ROLES) {
		const call = gather?.[role];
		if (!call) continue;
		const message: ServerMessage = { t: 'gather', gather: call };
		server.publish(topic(campaignId, role), JSON.stringify(message));
	}
	for (const event of events) {
		delivered.set(campaignId, Math.max(delivered.get(campaignId) ?? 0, event.seq));
		for (const role of ROLES) {
			// The app has already decided what each role may see. A null
			// means this role must not learn that anything happened.
			const live = event.to[role];
			if (!live) continue;
			const message: ServerMessage = { t: 'event', event: live };
			server.publish(topic(campaignId, role), JSON.stringify(message));
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
			cursor: null,
			pointedAt: 0
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

			send(ws, {
				t: 'hello',
				user,
				role,
				// Anything delivered between the app identifying this browser
				// and the subscription above went past it. Counting those in
				// tells the browser its snapshot is behind, and it reloads.
				seq: Math.max(ws.data.seq, delivered.get(campaignId) ?? 0),
				online: presence(campaignId),
				cursors: cursors(ws)
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
			if (message?.t === 'cursor') return point(ws, message.at);
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
			if (ws.data.cursor) relay(ws, { t: 'cursor.left', id: ws.data.id });
			if (room?.size === 0) rooms.delete(campaignId);
			else if (!ws.data.display) announcePresence(campaignId);
		}
	}
});

console.log(`Live sync listening on ws://${server.hostname}:${server.port}, forwarding to ${APP_URL}`);
