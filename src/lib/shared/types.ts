// Types shared by the SvelteKit app, the WebSocket server and the browser.
// Nothing in here may import server-only code.

export type Role = 'gm' | 'player';

/** World markers belong to the GM. Player markers are the table's shared notes. */
export type MarkerKind = 'world' | 'player';

export const MARKER_TYPES = [
	{ id: 'quest', label: 'Quest', color: '#e0a526' },
	{ id: 'city', label: 'City', color: '#5b8def' },
	{ id: 'location', label: 'Location', color: '#3fae7c' },
	{ id: 'danger', label: 'Danger', color: '#e5544b' },
	{ id: 'npc', label: 'Character', color: '#b072e0' },
	{ id: 'treasure', label: 'Treasure', color: '#2bb8c4' },
	{ id: 'camp', label: 'Camp', color: '#d9783a' },
	{ id: 'note', label: 'Note', color: '#c9b891' }
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number]['id'];

export const MARKER_TYPE_IDS: readonly string[] = MARKER_TYPES.map((t) => t.id);

export function markerType(id: string) {
	return MARKER_TYPES.find((t) => t.id === id) ?? MARKER_TYPES[MARKER_TYPES.length - 1];
}

/** A point in map space, normalised so 0..1 spans the map's width / height. */
export type Point = [number, number];

export interface Marker {
	id: string;
	mapId: string;
	kind: MarkerKind;
	type: MarkerType;
	title: string;
	description: string;
	x: number;
	y: number;
	/** Only ever true for world markers, and only ever sent to the GM. */
	hidden: boolean;
	authorName: string;
	updatedAt: number;
}

export interface Region {
	id: string;
	/** The map this region is drawn on. */
	mapId: string;
	/** The map you step into. */
	targetMapId: string;
	/** Name of the target map. */
	name: string;
	points: Point[];
}

export interface MapInfo {
	id: string;
	campaignId: string;
	parentId: string | null;
	name: string;
	/** File name of the uploaded map image, or null for a blank map. */
	imageFile: string | null;
	width: number;
	height: number;
}

/** Where the browser loads a map image from. The file name doubles as a cache key. */
export function mapImageUrl(map: Pick<MapInfo, "campaignId" | "id" | "imageFile">): string | null {
	if (!map.imageFile) return null;
	return `/c/${map.campaignId}/m/${map.id}/image?v=${encodeURIComponent(map.imageFile)}`;
}

export interface Crumb {
	id: string;
	name: string;
}

export interface MapSnapshot {
	map: MapInfo;
	/** Root map first, current map last. */
	trail: Crumb[];
	regions: Region[];
	markers: Marker[];
	/** Sequence number of the newest event already reflected in this snapshot. */
	lastSeq: number;
}

// ---------------------------------------------------------------- commands

export interface MarkerInput {
	type: MarkerType;
	title: string;
	description: string;
	x: number;
	y: number;
	hidden: boolean;
}

/** Everything a client can ask the server to change. */
export type Command =
	| ({ t: 'marker.create'; mapId: string; kind: MarkerKind } & Partial<MarkerInput>)
	| { t: 'marker.update'; id: string; changes: Partial<MarkerInput> }
	| { t: 'marker.delete'; id: string }
	| { t: 'marker.restore'; id: string }
	| { t: 'region.create'; mapId: string; name: string; points: Point[] }
	| { t: 'region.update'; id: string; points: Point[] }
	| { t: 'region.delete'; id: string }
	| { t: 'region.restore'; id: string }
	| { t: 'map.update'; id: string; name: string }
	| { t: 'history.revert'; seq: number };

// ------------------------------------------------------------------ events

export type EntityType = 'marker' | 'region' | 'map';
export type EventAction = 'create' | 'update' | 'delete' | 'restore';

/**
 * One row of the append-only event log. `before` and `after` are full
 * snapshots of the entity, so this is GM-level data: it is never sent to a
 * client as-is, only through `projectEvent` / `toHistoryEntry`.
 */
export interface StoredEvent {
	seq: number;
	campaignId: string;
	mapId: string;
	actorId: string;
	actorName: string;
	at: number;
	entity: EntityType;
	entityId: string;
	action: EventAction;
	before: Marker | Region | MapInfo | null;
	after: Marker | Region | MapInfo | null;
}

/** What a client has to do to its local copy of a map to reflect an event. */
export type Patch =
	| { t: 'marker.upsert'; marker: Marker }
	| { t: 'marker.remove'; id: string; mapId: string }
	| { t: 'region.upsert'; region: Region }
	| { t: 'region.remove'; id: string; mapId: string }
	| { t: 'map.upsert'; map: MapInfo };

export interface LiveEvent {
	seq: number;
	at: number;
	actor: { id: string; name: string };
	patch: Patch;
}

export interface HistoryEntry {
	seq: number;
	at: number;
	actorName: string;
	mapId: string;
	mapName: string;
	entity: EntityType;
	entityId: string;
	action: EventAction;
	before: Marker | Region | MapInfo | null;
	after: Marker | Region | MapInfo | null;
	canRevert: boolean;
}

// ---------------------------------------------------------------- protocol

export interface Presence {
	id: string;
	name: string;
	role: Role;
}

export type ClientMessage = { t: 'cmd'; id: number; cmd: Command };

export type ServerMessage =
	| { t: 'hello'; user: { id: string; name: string }; role: Role; seq: number; online: Presence[] }
	| { t: 'presence'; online: Presence[] }
	| { t: 'event'; event: LiveEvent }
	| { t: 'ack'; id: number; ok: true }
	| { t: 'ack'; id: number; ok: false; error: string };

export interface CommandResponse {
	ok: boolean;
	error?: string;
	events?: LiveEvent[];
}

export const LIMITS = {
	title: 120,
	description: 4000,
	name: 80,
	regionPoints: 200,
	imageBytes: 25 * 1024 * 1024
} as const;

export const DEFAULT_MAP_SIZE = { width: 1600, height: 1000 } as const;
