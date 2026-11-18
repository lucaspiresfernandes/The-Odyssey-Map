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
	/** Who added it. Among players, only this person can delete a table note. */
	authorId: string;
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
	/** What kind of map that is. */
	kind: MapKind;
	points: Point[];
	/**
	 * Only ever sent to the GM as true. To players a hidden region is not
	 * there, and neither is its map nor anything inside it.
	 */
	hidden: boolean;
}

/**
 * A world map is a place to explore: markers, notes, regions to step into.
 * A battle map is a table to play on as well: it has a grid, and tokens
 * that the people at the table move around.
 */
export type MapKind = 'world' | 'battle';

/** The square grid of a battle map, measured in the map's own pixels. */
export interface Grid {
	/** The side of one cell. */
	size: number;
	/** Where a cell starts, from the map's top left corner. Each is less than one cell. */
	x: number;
	y: number;
	/** Whether the lines are drawn. A map image often brings its own. */
	shown: boolean;
}

export const DEFAULT_GRID: Grid = { size: 50, x: 0, y: 0, shown: true };

/** How many feet a cell stands for until the GM says otherwise. */
export const DEFAULT_CELL_FEET = 8;

/** A box on a map, in map space: its left, top, right and bottom. */
export type Rect = [number, number, number, number];

/**
 * The fog of war on a battle map. While it is on, the map is covered but
 * for the boxes in `clear`, which never overlap. Players see nothing of
 * what is under it; the GM sees through it.
 */
export interface Fog {
	on: boolean;
	clear: Rect[];
}

export const NO_FOG: Fog = { on: false, clear: [] };

/**
 * Where the party is: one spot, on one world map of the campaign. Every
 * map on the way down to that one shows the party in the region that leads
 * there. It never stands where players can't go.
 */
export interface Party {
	/** The campaign's id: it has one party. */
	id: string;
	mapId: string;
	x: number;
	y: number;
	/** The maps on the way to it, by id: the first map of the campaign first, its own last. */
	trail: string[];
}

export const TOKEN_COLORS = [
	'#e5544b',
	'#d9783a',
	'#e0a526',
	'#3fae7c',
	'#2bb8c4',
	'#5b8def',
	'#b072e0',
	'#ff8ad8',
	'#c9b891',
	'#6b7488'
] as const;

/**
 * A piece on a battle map: a character, a monster, anything that moves.
 * `x` and `y` are its middle.
 */
export interface Token {
	id: string;
	mapId: string;
	name: string;
	/** What a plain disc is filled with. A token with a picture keeps it, out of sight under the picture. */
	color: string;
	/**
	 * The colour of the ring around it, for telling apart tokens that look
	 * alike, or marking which belong together. Null for none.
	 */
	outline: string | null;
	/** File name of its picture, out of the gallery. Null for a plain disc. */
	image: string | null;
	x: number;
	y: number;
	/** How many cells it is across: a multiple of TOKEN_SIZE_STEP. */
	size: number;
	/** Which way it is turned, in degrees clockwise: a multiple of ROTATION_STEP under 360. */
	rotation: number;
	/** A locked token stays as it is put until someone unlocks it: not moved, resized or turned. */
	locked: boolean;
	/** Only ever sent to the GM as true. */
	hidden: boolean;
	updatedAt: number;
}

/** A token turns this many degrees at a time. */
export const ROTATION_STEP = 15;

/** A token grows and shrinks this many cells at a time. It is also the smallest one. */
export const TOKEN_SIZE_STEP = 0.5;

/** The colours the table draws and writes in. */
export const INK_COLORS = [
	'#fff8e4',
	'#12151c',
	'#e5544b',
	'#e0a526',
	'#3fae7c',
	'#5b8def',
	'#b072e0'
] as const;

/** A drawing is a line drawn freehand, or a line of text. */
export type DrawingKind = 'line' | 'text';

/** How big a drawing is unless it says otherwise, in cells: see `Drawing.size`. */
export const DRAWING_SIZE: Record<DrawingKind, number> = { line: 0.1, text: 0.5 };

/**
 * Something the table drew or wrote on a battle map. Anyone can add one.
 * Changing it or rubbing it out is for whoever made it, and the GM.
 */
export interface Drawing {
	id: string;
	mapId: string;
	kind: DrawingKind;
	/** The path of a line. A text has one point: the middle of its left edge. */
	points: Point[];
	/** What a text says. Empty for a line. */
	text: string;
	color: string;
	/** In cells, like a token's: how thick a line is, how tall a text's letters are. */
	size: number;
	authorId: string;
	authorName: string;
	updatedAt: number;
}

export interface MapInfo {
	id: string;
	campaignId: string;
	parentId: string | null;
	name: string;
	kind: MapKind;
	/** Kept on a world map too, so turning it into a battle map and back loses nothing. */
	grid: Grid;
	/** How many feet one cell of the grid stands for. Distances on the map are told in feet. */
	cellFeet: number;
	/** What of a battle map is under the fog of war. A world map has none. */
	fog: Fog;
	/** File name of the map image, out of the gallery, or null for a blank map. */
	imageFile: string | null;
	width: number;
	height: number;
}

/** What a picture in the gallery is for: to lay under a map, or to put on a token. */
export type GalleryKind = 'map' | 'token';

/** A picture the campaign keeps, to use on as many maps or tokens as it likes. */
export interface GalleryItem {
	id: string;
	kind: GalleryKind;
	name: string;
	/** What maps and tokens point at. It never changes, and neither do the bytes behind it. */
	file: string;
	width: number;
	height: number;
	/**
	 * True until the GM reveals the picture to the players. Only ever sent to
	 * the GM as true: to a player a hidden picture is not in the gallery.
	 */
	hidden: boolean;
}

/** What the gallery endpoints answer with. */
export interface GalleryResponse {
	ok: boolean;
	error?: string;
	/** The gallery as it is now, after whatever was asked for. */
	items?: GalleryItem[];
}

/**
 * Where the browser loads a picture from. A file name always means the same
 * bytes, so the address can be cached for good. `part` asks for something
 * made from the picture instead of the file itself: `thumb` for a small
 * copy, and for a big map image its `preview` or one tile as `level/x/y`
 * (see src/lib/shared/tiles.ts).
 */
export function imageUrl(campaignId: string, file: string, part?: string): string {
	const url = `/c/${campaignId}/image/${file}`;
	return part ? `${url}?part=${part}` : url;
}

export function mapImageUrl(
	map: Pick<MapInfo, 'campaignId' | 'imageFile'>,
	part?: string
): string | null {
	return map.imageFile ? imageUrl(map.campaignId, map.imageFile, part) : null;
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
	/** Empty on a world map. */
	tokens: Token[];
	/** Empty on a world map. */
	drawings: Drawing[];
	/** Where the party is, on this map or any other, or null while it is nowhere. */
	party: Party | null;
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

export interface TokenInput {
	name: string;
	color: string;
	/** One of the token colours, or null for no ring. */
	outline: string | null;
	/** The file name of a token picture in the gallery, or null for none. */
	image: string | null;
	x: number;
	y: number;
	size: number;
	rotation: number;
	/** Anyone's to set, like the name: the two things the whole table shares about a token. */
	locked: boolean;
	/** The GM's to set. */
	hidden: boolean;
}

export interface DrawingInput {
	kind: DrawingKind;
	points: Point[];
	text: string;
	color: string;
	size: number;
}

/** What can be changed about a drawing once it is made. */
export interface DrawingChanges {
	text?: string;
	color?: string;
	/** Slides the whole drawing this far across the map, in map space. */
	move?: Point;
}

/** Everything a client can ask the server to change. */
export type Command =
	| ({ t: 'marker.create'; mapId: string; kind: MarkerKind } & Partial<MarkerInput>)
	| { t: 'marker.update'; id: string; changes: Partial<MarkerInput> }
	| { t: 'marker.delete'; id: string }
	| { t: 'marker.restore'; id: string }
	| ({ t: 'token.create'; mapId: string } & Partial<TokenInput>)
	/** Moving a token is this, with a new `x` and `y`. */
	| { t: 'token.update'; id: string; changes: Partial<TokenInput> }
	/** Puts a copy of a token beside it. Anyone can, of any token they see. */
	| { t: 'token.duplicate'; id: string }
	| { t: 'token.delete'; id: string }
	| { t: 'token.restore'; id: string }
	| ({ t: 'drawing.create'; mapId: string } & Partial<DrawingInput>)
	| { t: 'drawing.update'; id: string; changes: DrawingChanges }
	| { t: 'drawing.delete'; id: string }
	| { t: 'drawing.restore'; id: string }
	/** `kind` is the kind of map the region leads to: a world map unless it says otherwise. */
	| {
			t: 'region.create';
			mapId: string;
			name: string;
			points: Point[];
			hidden?: boolean;
			kind?: MapKind;
	  }
	/** Reshapes a region, hides or reveals it, or both. */
	| { t: 'region.update'; id: string; points?: Point[]; hidden?: boolean }
	/** For good, along with the map behind the region and everything inside it. */
	| { t: 'region.delete'; id: string }
	/**
	 * Renames a map, sets up its grid, says how many feet a cell stands for,
	 * lays an image under it, covers it with fog or clears some: whichever are
	 * given. `image` is the file name of a map image in the gallery. A map's
	 * kind is not here: it is chosen when its region is drawn, and stays.
	 */
	| {
			t: 'map.update';
			id: string;
			name?: string;
			grid?: Partial<Grid>;
			cellFeet?: number;
			image?: string;
			fog?: Partial<Fog>;
	  }
	/** Puts the party at a spot of a world map, wherever it was before. */
	| { t: 'party.move'; mapId: string; x: number; y: number }
	/** Takes back the change with this sequence number by performing its opposite. */
	| { t: 'history.revert'; seq: number }
	/**
	 * Several commands as one: all of them happen, or if any is refused, none.
	 * For what is done to a whole selection at once. A batch holds no batches.
	 */
	| { t: 'batch'; cmds: Command[] };

// ------------------------------------------------------------------ events

export type EntityType = 'marker' | 'region' | 'map' | 'token' | 'drawing' | 'party';

/** A full copy of one of them, as the event log keeps it. */
export type Entity = Marker | Region | MapInfo | Token | Drawing | Party;
export type EventAction = 'create' | 'update' | 'delete' | 'restore';

/**
 * One row of the append-only event log. `before` and `after` are full
 * snapshots of the entity, so this is GM-level data: it is never sent to a
 * client as-is, only through `toLiveEvent`.
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
	before: Entity | null;
	after: Entity | null;
}

/** What a client has to do to its local copy of a map to reflect an event. */
export type Patch =
	| { t: 'marker.upsert'; marker: Marker }
	| { t: 'marker.remove'; id: string; mapId: string }
	| { t: 'region.upsert'; region: Region }
	/** `targetMapId` is the map that can no longer be reached through it. */
	| { t: 'region.remove'; id: string; mapId: string; targetMapId: string }
	/**
	 * `tokens` comes along when the fog on the map changed for a player: the
	 * tokens of that map they can see now, in place of the ones they had.
	 */
	| { t: 'map.upsert'; map: MapInfo; tokens?: Token[] }
	/** Where the party is now, or null once it is nowhere. */
	| { t: 'party.set'; party: Party | null }
	| { t: 'token.upsert'; token: Token }
	| { t: 'token.remove'; id: string; mapId: string }
	| { t: 'drawing.upsert'; drawing: Drawing }
	| { t: 'drawing.remove'; id: string; mapId: string };

export interface LiveEvent {
	seq: number;
	at: number;
	actor: { id: string; name: string };
	patch: Patch;
}

// ---------------------------------------------------------------- protocol

export interface Presence {
	id: string;
	name: string;
	role: Role;
}

/** A spot on one map, in map space. A little outside 0..1 is the margin around the map. */
export interface CursorSpot {
	mapId: string;
	x: number;
	y: number;
	/**
	 * A token this person has in hand, and where they are holding it. It
	 * only moves for good once they let go: that is a `token.update`.
	 */
	drag?: { id: string; x: number; y: number };
	/** A distance they are measuring, from one spot to another. */
	ruler?: [Point, Point];
}

/**
 * Where someone at the table is pointing right now. Passed from browser to
 * browser by the WebSocket server and never stored.
 */
export interface Cursor extends CursorSpot {
	/** One per connection, so the same person in two windows is two pointers. */
	id: string;
	userId: string;
	name: string;
	role: Role;
}

/**
 * What of a map someone has on screen: the spot in the middle, and how much
 * of the map shows across and down. All in map space, so a screen of
 * another shape can frame the same part.
 */
export interface Sight {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The GM bringing everyone to what they are looking at. It is not a change
 * to the world, so it is never stored: the app checks who may follow, and
 * the WebSocket server passes it on.
 */
export interface Gather {
	mapId: string;
	view: Sight;
	/** The name of whoever is bringing everyone along. */
	by: string;
	/** Names the browser it came from, which is there already and stays put. */
	from: string;
}

/** What the gather endpoint answers with. */
export interface GatherResponse {
	ok: boolean;
	error?: string;
	/** False when the map is one players are kept out of: only the GM's own screens follow. */
	players?: boolean;
}

export type ClientMessage =
	| { t: 'cmd'; id: number; cmd: Command }
	/** Where this browser's pointer is, or null once it has left the map. */
	| { t: 'cursor'; at: CursorSpot | null };

export type ServerMessage =
	| {
			t: 'hello';
			user: { id: string; name: string };
			role: Role;
			seq: number;
			online: Presence[];
			cursors: Cursor[];
	  }
	| { t: 'presence'; online: Presence[] }
	| { t: 'event'; event: LiveEvent }
	| { t: 'cursor'; cursor: Cursor }
	| { t: 'cursor.left'; id: string }
	| { t: 'gather'; gather: Gather }
	| { t: 'ack'; id: number; ok: true; undo: number[] }
	| { t: 'ack'; id: number; ok: false; error: string };

export interface CommandResponse {
	ok: boolean;
	error?: string;
	events?: LiveEvent[];
	/**
	 * Sequence numbers of the changes this command made that `history.revert`
	 * can take back. The browser keeps them to undo its own work.
	 */
	undo?: number[];
}

// ------------------------------------------------------------------ bridge

// What the app and the WebSocket server say to each other. The WebSocket
// server keeps no data of its own: it asks the app who a visitor is, hands
// the app their commands, and is told by the app what to deliver to whom.

/** Who a session belongs to in a campaign, and the newest event the app has for it. */
export interface LiveIdentity {
	user: { id: string; name: string };
	role: Role;
	seq: number;
}

/**
 * What the app hands the WebSocket server to deliver: events it has just
 * written, each already cut down to what a role may see, or the GM bringing
 * everyone along, to the roles that may follow.
 */
export interface Broadcast {
	campaignId: string;
	events: { seq: number; to: Record<Role, LiveEvent | null> }[];
	gather?: Record<Role, Gather | null>;
}

export const LIMITS = {
	title: 120,
	description: 4000,
	name: 80,
	tokenName: 40,
	/** The most cells a token can be across. */
	tokenSize: 6,
	/** The most points a drawn line is kept as. The browser thins a line out before sending it. */
	drawingPoints: 800,
	drawingText: 200,
	/** How thin and how thick a drawing can be, in cells. */
	drawingSizeMin: 0.02,
	drawingSizeMax: 3,
	/** The most drawings one map holds. */
	drawings: 500,
	/** The most commands in one batch. */
	batch: 200,
	/** The smallest and the largest a grid cell can be, in map pixels. */
	gridMin: 8,
	gridMax: 2000,
	/** The fewest and the most feet a cell can stand for. */
	cellFeetMin: 0.5,
	cellFeetMax: 1000,
	/** The most boxes the fog on one map is cleared by. */
	fogRects: 400,
	regionPoints: 200,
	// Room for a big map that has been through an upscaler.
	imageBytes: 256 * 1024 * 1024,
	/** The longest a map image may be on either side, in pixels. */
	imageSide: 30000,
	/** A token's picture is made small before it is kept, so this is only what may be sent. */
	tokenImageBytes: 32 * 1024 * 1024
} as const;

/** The longest side a token's picture is kept at, in pixels. */
export const TOKEN_IMAGE_SIZE = 512;

export const DEFAULT_MAP_SIZE = { width: 1600, height: 1000 } as const;
