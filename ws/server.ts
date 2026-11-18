// The live half of The Odyssey Map: a small Bun WebSocket server that runs
// beside the SvelteKit app.
//
// It shares the app's database, session cookie and rules module. Clients
// send commands, which go through `perform` exactly as they do over HTTP.
// Everything clients receive comes from tailing the event log, so a change
// reaches the table the same way whichever server wrote it.

import type { ServerWebSocket } from 'bun';
import { SESSION_COOKIE, getSessionUser, readCookie } from '#lib/server/auth.ts';
import { actorFor, getMembership } from '#lib/server/campaigns.ts';
import { openDb } from '#lib/server/db.ts';
import { toLiveEvent } from '#lib/server/visibility.ts';
import { ActionError, eventsAfter, latestSeq, perform, type Actor } from '#lib/server/world.ts';
import type { ClientMessage, Presence, Role, ServerMessage } from '#lib/shared/types.ts';

const PORT = Number(process.env.WS_PORT || 3001);
const HOST = process.env.WS_HOST || '127.0.0.1';
const POLL_MS = 250;
const ROLES: Role[] = ['gm', 'player'];

/** Extra origins allowed to connect, for deployments behind a proxy. */
const TRUSTED_ORIGINS = new Set(
	(process.env.ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean)
);

interface Connection {
	actor: Actor;
	sessionToken: string;
	/** Timestamps of recent commands, for rate limiting. */
	recent: number[];
}

type Socket = ServerWebSocket<Connection>;

const db = openDb();
const rooms = new Map<string, Set<Socket>>();

// Players and the GM listen on separate topics, because the same event can
// mean different things to each (or nothing at all to a player).
const topic = (campaignId: string, role: Role) => `${campaignId}:${role}`;

function send(ws: Socket, message: ServerMessage) {
	ws.send(JSON.stringify(message));
}

function presence(campaignId: string): Presence[] {
	const seen = new Map<string, Presence>();
	for (const ws of rooms.get(campaignId) ?? []) {
		const { userId, name, role } = ws.data.actor;
		seen.set(userId, { id: userId, name, role });
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

const server = Bun.serve({
	port: PORT,
	hostname: HOST,

	fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === '/health') return new Response('ok');
		if (!originAllowed(request, url)) return new Response('Forbidden', { status: 403 });

		// The same session cookie the SvelteKit app set at login.
		const sessionToken = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
		const user = getSessionUser(db, sessionToken);
		if (!user || !sessionToken) return new Response('Not logged in', { status: 401 });

		const membership = getMembership(db, url.searchParams.get('campaign') ?? '', user.id);
		if (!membership) return new Response('Campaign not found', { status: 404 });

		const data: Connection = { actor: actorFor(user, membership), sessionToken, recent: [] };
		if (server.upgrade(request, { data })) return;
		return new Response('Expected a WebSocket', { status: 426 });
	},

	websocket: {
		data: {} as Connection,
		maxPayloadLength: 64 * 1024,
		idleTimeout: 120,

		open(ws) {
			const { campaignId, role, userId, name } = ws.data.actor;
			// Subscribe before reading the sequence number, so nothing can
			// fall between "what you already have" and "what you'll be sent".
			ws.subscribe(topic(campaignId, role));
			let room = rooms.get(campaignId);
			if (!room) rooms.set(campaignId, (room = new Set()));
			room.add(ws);

			send(ws, {
				t: 'hello',
				user: { id: userId, name },
				role,
				seq: latestSeq(db, campaignId),
				online: presence(campaignId)
			});
			announcePresence(campaignId);
		},

		message(ws, raw) {
			let message: ClientMessage;
			try {
				message = JSON.parse(String(raw));
			} catch {
				return;
			}
			if (message?.t !== 'cmd' || typeof message.id !== 'number') return;
			const refuse = (error: string) => send(ws, { t: 'ack', id: message.id, ok: false, error });

			const now = Date.now();
			ws.data.recent = ws.data.recent.filter((at) => now - at < 5000);
			if (ws.data.recent.length >= 40) return refuse('Too many changes at once. Give it a moment.');
			ws.data.recent.push(now);

			// The login may have ended since this socket opened.
			const user = getSessionUser(db, ws.data.sessionToken);
			const membership = user && getMembership(db, ws.data.actor.campaignId, user.id);
			if (!user || !membership) {
				refuse('You are no longer logged in.');
				ws.close(4401, 'Session ended');
				return;
			}

			try {
				perform(db, actorFor(user, membership), message.cmd);
			} catch (err) {
				if (err instanceof ActionError) return refuse(err.message);
				console.error(err);
				return refuse('Something went wrong.');
			}
			// Deliver the change before the acknowledgement, so the sender has
			// already seen its effect by the time its request resolves.
			pump();
			send(ws, { t: 'ack', id: message.id, ok: true });
		},

		close(ws) {
			const { campaignId } = ws.data.actor;
			const room = rooms.get(campaignId);
			room?.delete(ws);
			if (room?.size === 0) rooms.delete(campaignId);
			else announcePresence(campaignId);
		}
	}
});

// --------------------------------------------------------------- event pump

let cursor = latestSeq(db);

/** Publishes every event written since the last call, by either server. */
function pump() {
	for (;;) {
		const batch = eventsAfter(db, cursor, 200);
		for (const event of batch) {
			cursor = event.seq;
			for (const role of ROLES) {
				// `toLiveEvent` decides what each role may see. Nothing from
				// the log is published without passing through it.
				const live = toLiveEvent(event, role);
				if (!live) continue;
				const message: ServerMessage = { t: 'event', event: live };
				server.publish(topic(event.campaignId, role), JSON.stringify(message));
			}
		}
		if (batch.length < 200) return;
	}
}

setInterval(() => {
	try {
		pump();
	} catch (err) {
		console.error('Event pump failed:', err);
	}
}, POLL_MS);

console.log(`Live sync listening on ws://${server.hostname}:${server.port}`);
