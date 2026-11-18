// The browser's connection to the WebSocket server.
//
// Commands go out over the socket when it is open and over plain HTTP when
// it is not, so the map stays usable while the connection is down. Either
// way, changes come back as events and are handed to whoever subscribed.
//
// The socket also carries where everyone's pointer is. That is only ever
// live: nothing about it is kept, and none of it is sent while offline.

import { getContext, setContext } from 'svelte';
import type {
	ClientMessage,
	Command,
	CommandResponse,
	Cursor,
	CursorSpot,
	LiveEvent,
	Presence,
	ServerMessage
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

/** The least time between two reports of this browser's pointer, in milliseconds. */
const POINTER_INTERVAL = 50;

export class Live {
	status = $state<'connecting' | 'open' | 'offline'>('connecting');
	online = $state<Presence[]>([]);
	/** Where everyone else is pointing, on whichever map they are looking at. */
	cursors = $state.raw<Cursor[]>([]);

	/**
	 * The last few events received. A page that finishes loading while
	 * events are streaming replays these over its snapshot to catch up.
	 */
	recent: LiveEvent[] = [];

	#options: Options;
	#ws: WebSocket | null = null;
	#listeners = new Set<(event: LiveEvent) => void>();
	#pending = new Map<number, Pending>();
	#nextId = 1;
	#attempt = 0;
	#retry: ReturnType<typeof setTimeout> | undefined;
	#stopped = false;
	/** Where this browser's pointer is, and what the server was last told about it. */
	#spot: CursorSpot | null = null;
	#toldSpot: CursorSpot | null = null;
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
			this.cursors = [];
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
				this.cursors = message.cursors;
				// A new connection is a new pointer to everyone else.
				this.#toldSpot = null;
				this.#tell();
				this.#options.onHello(message.seq);
				break;
			case 'presence':
				this.online = message.online;
				break;
			case 'cursor': {
				const { cursor } = message;
				const known = this.cursors.some((c) => c.id === cursor.id);
				this.cursors = known
					? this.cursors.map((c) => (c.id === cursor.id ? cursor : c))
					: [...this.cursors, cursor];
				break;
			}
			case 'cursor.left':
				this.cursors = this.cursors.filter((c) => c.id !== message.id);
				break;
			case 'event':
				this.#dispatch(message.event);
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

	/** Feeds in events that arrived some other way, such as an HTTP response. */
	receive(events: LiveEvent[]) {
		for (const event of events) this.#dispatch(event);
	}

	/**
	 * Says where this browser's pointer is, or null once it has left the map.
	 * Call it as often as the pointer moves: only the latest spot is sent,
	 * and not more often than every POINTER_INTERVAL.
	 */
	point(spot: CursorSpot | null) {
		this.#spot = spot;
		this.#telling ??= setTimeout(
			() => {
				this.#telling = undefined;
				this.#tell();
			},
			Math.max(0, this.#toldAt + POINTER_INTERVAL - Date.now())
		);
	}

	#tell() {
		const ws = this.#ws;
		if (!ws || this.status !== 'open' || ws.readyState !== WebSocket.OPEN) return;
		const spot = this.#spot;
		const told = this.#toldSpot;
		if (spot?.mapId === told?.mapId && spot?.x === told?.x && spot?.y === told?.y) return;
		this.#toldSpot = spot;
		this.#toldAt = Date.now();
		ws.send(JSON.stringify({ t: 'cursor', at: spot } satisfies ClientMessage));
	}
}

export function setLive(live: Live) {
	setContext(KEY, live);
}

export function getLive(): Live {
	return getContext<Live>(KEY);
}
