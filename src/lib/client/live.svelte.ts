// The browser's connection to the WebSocket server.
//
// Commands go out over the socket when it is open and over plain HTTP when
// it is not, so the map stays usable while the connection is down. Either
// way, changes come back as events and are handed to whoever subscribed.
//
// The socket also carries what everyone has in hand: a token they are
// dragging, a distance they are measuring. And pings, which point a spot
// out to the table for a moment. Those are only ever live: nothing about
// them is kept, and none of it is sent while offline. Where a mouse is
// otherwise is never sent.

import { getContext, setContext } from 'svelte';
import type {
	ClientMessage,
	Command,
	CommandResponse,
	Gather,
	GatherResponse,
	Hand,
	HandSpot,
	LiveEvent,
	Ping,
	PingSpot,
	Presence,
	Role,
	ServerMessage,
	ShowResponse,
	Shown,
	Sight
} from '#lib/shared/types.ts';

interface Options {
	/** Built lazily: it needs `location`, which only exists in the browser. */
	url: () => string;
	campaignId: string;
	/** Called when the server says hello, with the newest sequence number it has. */
	onHello: (seq: number) => void;
}

interface Pending {
	resolve: (undo: number[]) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const KEY = Symbol('live');

/** The least time between two reports of what this browser has in hand, in milliseconds. */
const HAND_INTERVAL = 50;

/** How long a ping stays on the map, in milliseconds. */
export const PING_LASTS = 2600;

/** A ping while it is on the map. `key` tells one from the next. */
export interface LivePing extends Ping {
	key: number;
}

export class Live {
	status = $state<'connecting' | 'open' | 'offline'>('connecting');
	online = $state<Presence[]>([]);
	/** What everyone else has in hand, on whichever map they are looking at. */
	hands = $state.raw<Hand[]>([]);
	/** The spots being pointed out right now, this browser's own among them. */
	pings = $state.raw<LivePing[]>([]);
	/** The picture the GM is holding up for the table, if any. */
	shown = $state.raw<Shown | null>(null);

	/**
	 * The last few events received. A page that finishes loading while
	 * events are streaming replays these over its snapshot to catch up.
	 */
	recent: LiveEvent[] = [];

	#options: Options;
	#ws: WebSocket | null = null;
	#listeners = new Set<(event: LiveEvent) => void>();
	#gatherers = new Set<(gather: Gather, late: boolean) => void>();
	/** A call that came before anyone was listening for one. */
	#waiting: { gather: Gather; late: boolean } | null = null;
	/** Who this browser is at the table, once the server has said. */
	#me: { id: string; name: string; role: Role } | null = null;
	#pingKey = 0;
	/** Names this browser, so that its own call to gather passes it by. */
	#name = Math.random().toString(36).slice(2);
	#pending = new Map<number, Pending>();
	#nextId = 1;
	#attempt = 0;
	#retry: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;
	/** What this browser has in hand, and what the server was last told about it. */
	#spot: HandSpot | null = null;
	#toldSpot: HandSpot | null = null;
	#toldAt = 0;
	#telling: ReturnType<typeof setTimeout> | undefined;

	constructor(options: Options) {
		this.#options = options;
	}

	connect() {
		if (this.#stopped) return;
		const ws = new WebSocket(this.#options.url());
		this.#ws = ws;

		ws.onmessage = (message) => this.#receive(JSON.parse(message.data) as ServerMessage);
		ws.onclose = () => {
			if (this.#ws !== ws) return;
			this.#ws = null;
			this.status = 'offline';
			this.hands = [];
			for (const [id, pending] of this.#pending) {
				clearTimeout(pending.timer);
				pending.reject(new Error('The connection dropped. Check the map and try again.'));
				this.#pending.delete(id);
			}
			if (this.#stopped) return;
			const delay = Math.min(15000, 500 * 2 ** this.#attempt++);
			this.#retry = setTimeout(() => this.connect(), delay);
		};
	}

	stop() {
		this.#stopped = true;
		clearTimeout(this.#retry);
		clearTimeout(this.#telling);
		this.#ws?.close();
	}

	#receive(message: ServerMessage) {
		switch (message.t) {
			case 'hello':
				this.#attempt = 0;
				this.status = 'open';
				this.online = message.online;
				this.hands = message.hands;
				this.shown = message.shown;
				this.#me = { ...message.user, role: message.role };
				// A new connection is a new hand to everyone else.
				this.#toldSpot = null;
				this.#tell();
				this.#options.onHello(message.seq);
				break;
			case 'presence':
				this.online = message.online;
				break;
			case 'hand': {
				const { hand } = message;
				const known = this.hands.some((h) => h.id === hand.id);
				this.hands = known
					? this.hands.map((h) => (h.id === hand.id ? hand : h))
					: [...this.hands, hand];
				break;
			}
			case 'hand.left':
				this.hands = this.hands.filter((h) => h.id !== message.id);
				break;
			case 'ping':
				this.#pinged(message.ping);
				break;
			case 'show':
				this.shown = message.shown;
				break;
			case 'event':
				this.#dispatch(message.event);
				break;
			case 'gather':
				this.#called(message.gather, message.late === true);
				break;
			case 'ack': {
				const pending = this.#pending.get(message.id);
				if (!pending) break;
				this.#pending.delete(message.id);
				clearTimeout(pending.timer);
				if (message.ok) pending.resolve(message.undo);
				else pending.reject(new Error(message.error));
			}
		}
	}

	#dispatch(event: LiveEvent) {
		this.recent.push(event);
		if (this.recent.length > 200) this.recent.shift();
		for (const listener of this.#listeners) listener(event);
	}

	/** Calls `listener` for every event from now on. Returns the unsubscribe function. */
	subscribe(listener: (event: LiveEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Resolves once the server has applied the command, with the sequence
	 * numbers of the changes it made that can be undone. Rejects with the
	 * server's reason if it refuses.
	 */
	async send(command: Command): Promise<number[]> {
		const ws = this.#ws;
		if (ws && this.status === 'open' && ws.readyState === WebSocket.OPEN) {
			const id = this.#nextId++;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					this.#pending.delete(id);
					reject(new Error('The server took too long to answer.'));
				}, 10000);
				this.#pending.set(id, { resolve, reject, timer });
				ws.send(JSON.stringify({ t: 'cmd', id, cmd: command } satisfies ClientMessage));
			});
		}

		let body: CommandResponse;
		try {
			const response = await fetch(`/c/${this.#options.campaignId}/command`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(command)
			});
			body = await response.json();
		} catch {
			throw new Error("Can't reach the server.");
		}
		if (!body.ok) throw new Error(body.error ?? 'Something went wrong.');
		this.receive(body.events ?? []);
		return body.undo ?? [];
	}

	/**
	 * Calls `listener` whenever the GM brings everyone somewhere. `late` says
	 * the call was made before this browser connected: it is where the table
	 * is, not news. Returns the unsubscribe function.
	 */
	onGather(listener: (gather: Gather, late: boolean) => void): () => void {
		this.#gatherers.add(listener);
		const waiting = this.#waiting;
		this.#waiting = null;
		if (waiting) listener(waiting.gather, waiting.late);
		return () => this.#gatherers.delete(listener);
	}

	/** Where this browser keeps the time of the last call it answered, or made. */
	get #answeredKey() {
		return `odyssey:gathered:${this.#options.campaignId}`;
	}

	/**
	 * A call to gather has come in. This browser's own passes it by, and so
	 * does one it has answered before: the last call is sent again whenever
	 * a browser connects, and a reload is no reason to be brought back.
	 */
	#called(gather: Gather, late: boolean) {
		if (gather.from === this.#name) return;
		try {
			if (Number(sessionStorage.getItem(this.#answeredKey)) >= gather.at) return;
			sessionStorage.setItem(this.#answeredKey, String(gather.at));
		} catch {
			// No storage to remember it in: a late call is then left alone, so
			// that nobody is brought back on every reload.
			if (late) return;
		}
		if (this.#gatherers.size === 0) this.#waiting = { gather, late };
		for (const listener of this.#gatherers) listener(gather, late);
	}

	/**
	 * Brings everyone else to this part of a map: the GM's to do. Resolves to
	 * whether the players may follow, which they may not onto a map behind a
	 * hidden region. Rejects with the server's reason if it refuses.
	 */
	async gather(mapId: string, view: Sight): Promise<boolean> {
		let body: GatherResponse;
		try {
			const response = await fetch(`/c/${this.#options.campaignId}/gather`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mapId, view, from: this.#name })
			});
			body = await response.json();
		} catch {
			throw new Error("Can't reach the server.");
		}
		if (!body.ok) throw new Error(body.error ?? 'Something went wrong.');
		try {
			// A reload of this window is not brought back by its own call.
			if (body.at) sessionStorage.setItem(this.#answeredKey, String(body.at));
		} catch {
			// Nothing to remember it in.
		}
		return body.players === true;
	}

	/**
	 * Holds a picture of the gallery up, by its id, or with null puts away
	 * the one that is up: the GM's to do. `to` names the players it is for,
	 * by id: with none, it is for the whole table. Rejects with the server's
	 * reason if it refuses.
	 */
	async show(id: string | null, to: string[] = []): Promise<void> {
		let body: ShowResponse;
		try {
			const response = await fetch(`/c/${this.#options.campaignId}/show`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id, to })
			});
			body = await response.json();
		} catch {
			throw new Error("Can't reach the server.");
		}
		if (!body.ok) throw new Error(body.error ?? 'Something went wrong.');
	}

	/**
	 * Points a spot out to everyone looking at that map. It shows here at
	 * once, and for the others as soon as the server has passed it on.
	 */
	ping(spot: PingSpot) {
		const ws = this.#ws;
		if (!this.#me || !ws || this.status !== 'open' || ws.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify({ t: 'ping', at: spot } satisfies ClientMessage));
		const { id, name, role } = this.#me;
		this.#pinged({ ...spot, userId: id, name, role });
	}

	/** A ping goes on the map, and comes off again by itself. */
	#pinged(ping: Ping) {
		const key = ++this.#pingKey;
		this.pings = [...this.pings, { ...ping, key }];
		setTimeout(() => {
			this.pings = this.pings.filter((each) => each.key !== key);
		}, PING_LASTS);
	}

	/** Feeds in events that arrived some other way, such as an HTTP response. */
	receive(events: LiveEvent[]) {
		for (const event of events) this.#dispatch(event);
	}

	/**
	 * Says what this browser has in hand on a map, or null once it holds
	 * nothing. Call it as often as that moves: only the latest is sent, and
	 * not more often than every HAND_INTERVAL.
	 */
	hold(spot: HandSpot | null) {
		// Nothing in hand, and nothing said of one: there is nothing to tell.
		if (!spot && !this.#spot && !this.#toldSpot) return;
		this.#spot = spot;
		this.#telling ??= setTimeout(
			() => {
				this.#telling = undefined;
				this.#tell();
			},
			Math.max(0, this.#toldAt + HAND_INTERVAL - Date.now())
		);
	}

	#tell() {
		const ws = this.#ws;
		if (!ws || this.status !== 'open' || ws.readyState !== WebSocket.OPEN) return;
		const spot = this.#spot;
		if (JSON.stringify(spot) === JSON.stringify(this.#toldSpot)) return;
		this.#toldSpot = spot;
		this.#toldAt = Date.now();
		ws.send(JSON.stringify({ t: 'hand', at: spot } satisfies ClientMessage));
	}
}

export function setLive(live: Live) {
	setContext(KEY, live);
}

export function getLive(): Live {
	return getContext<Live>(KEY);
}
