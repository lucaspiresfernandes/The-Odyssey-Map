// The app's line to the WebSocket server.
//
// The WebSocket server never reads the database. After every change the app
// tells it what to deliver, already filtered for each role by `toLiveEvent`,
// so nothing hidden is ever handed over to be sent to a player.

import type { Broadcast, Gather, Role, StoredEvent } from '../shared/types';
import type { Db } from './db';
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
	return send({
		campaignId: events[0].campaignId,
		events: events.map((event) => ({
			seq: event.seq,
			to: { gm: toLiveEvent(db, event, 'gm'), player: toLiveEvent(db, event, 'player') }
		}))
	});
}

/**
 * Has the GM's call to gather delivered, to each role that may follow it:
 * a null keeps a role where it is.
 */
export function summon(campaignId: string, gather: Record<Role, Gather | null>): Promise<void> {
	return send({ campaignId, events: [], gather });
}
