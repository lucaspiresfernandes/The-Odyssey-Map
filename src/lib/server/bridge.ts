// The app's line to the WebSocket server.
//
// The WebSocket server never reads the database. After every change the app
// tells it what to deliver, already filtered for each role by `toLiveEvent`,
// so nothing hidden is ever handed over to be sent to a player.

import type { Broadcast, Shown, StoredEvent } from '../shared/types';
import type { Db } from './db';
import { playersOf } from './queries';
import { knocksOf } from './seats';
import { toLiveEvent } from './visibility';

const BRIDGE_URL = `http://127.0.0.1:${process.env.WS_PORT || 3001}`;

let queue: Promise<void> = Promise.resolve();
let failing = false;

async function deliver(message: Broadcast) {
	try {
		const response = await fetch(`${BRIDGE_URL}/publish`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				// Proves this is the app, so nobody else on the network can
				// have events delivered to the table.
				authorization: `Bearer ${process.env.BRIDGE_SECRET ?? ''}`
			},
			body: JSON.stringify(message),
			signal: AbortSignal.timeout(2000)
		});
		if (!response.ok) throw new Error(`it answered ${response.status}`);
		failing = false;
	} catch (err) {
		// Delivery is best effort. The change is saved either way, and a
		// browser fetches a fresh snapshot when its socket comes back.
		if (!failing) console.warn(`Live updates are not reaching the WebSocket server: ${err}`);
		failing = true;
	}
}

/** One at a time, so everything arrives in the order it happened. */
function send(message: Broadcast): Promise<void> {
	queue = queue.then(() => deliver(message));
	return queue;
}

/**
 * Hands the events of one change to the WebSocket server. Resolves once they
 * are on their way to the table (or delivery failed); it never rejects.
 */
export function announce(db: Db, events: StoredEvent[]): Promise<void> {
	if (events.length === 0) return Promise.resolve();
	const campaignId = events[0].campaignId;
	const players = playersOf(db, campaignId);
	return send({
		campaignId,
		events: events.map((event) => {
			const table = toLiveEvent(db, event, 'player');
			const said = JSON.stringify(table);
			// A player who is let in on a secret may be owed something else than
			// the table is: more, or with a secret taken back, less. Only the
			// ones for whom it differs are named.
			const only: Record<string, ReturnType<typeof toLiveEvent>> = {};
			for (const player of players) {
				const theirs = toLiveEvent(db, event, { role: 'player', userId: player.id });
				if (JSON.stringify(theirs) !== said) only[player.id] = theirs;
			}
			return {
				seq: event.seq,
				to: { gm: toLiveEvent(db, event, 'gm'), player: table },
				...(Object.keys(only).length ? { only } : {})
			};
		})
	});
}

/**
 * Who is at a campaign's table this minute, by user id. The one thing the
 * app asks the WebSocket server, which alone knows who is connected: a seat
 * whose player is there is nobody else's to ask for. If it can't be
 * reached, nobody is at the table through it, so the answer is nobody.
 */
export async function onlineAt(campaignId: string): Promise<string[]> {
	try {
		const response = await fetch(`${BRIDGE_URL}/online?campaign=${encodeURIComponent(campaignId)}`, {
			headers: { authorization: `Bearer ${process.env.BRIDGE_SECRET ?? ''}` },
			signal: AbortSignal.timeout(2000)
		});
		if (!response.ok) return [];
		const ids: unknown = await response.json();
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/**
 * Tells the GM who is asking for a seat, in place of whoever was asking a
 * moment ago. Nobody else is told.
 */
export function knocked(db: Db, campaignId: string): Promise<void> {
	return send({ campaignId, events: [], knocks: knocksOf(db, campaignId) });
}

/**
 * Tells the table of seats the GM has changed: what a player is called now,
 * or with null for a name, that the seat was taken away. The browsers that
 * sat in a seat that is gone are shown out.
 */
export function seated(
	campaignId: string,
	seats: { id: string; name: string | null }[]
): Promise<void> {
	return send({ campaignId, events: [], seats });
}

/** Tells everyone what date it is in the world now, or with nothing, that there is none. */
export function dated(campaignId: string, date: string): Promise<void> {
	return send({ campaignId, events: [], date });
}

/**
 * Tells the table which picture the GM is holding up, or with null that it
 * is put away. `to` names the players it is for: empty for all of them.
 */
export function holdUp(campaignId: string, shown: Shown | null, to: string[] = []): Promise<void> {
	return send({ campaignId, events: [], show: { shown, to } });
}
