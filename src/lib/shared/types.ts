// Types shared by the SvelteKit app, the WebSocket server and the browser.
// Nothing in here may import server-only code.

export type Role = "gm" | "player";

/**
 * Who is looking at the world: their role, and which person they are. A
 * player with no id is nobody in particular: a table display, which is shown
 * what every player may see and none of what only some of them may.
 */
export interface Viewer {
  role: Role;
  userId: string | null;
}

/** Someone who plays in a campaign, for the GM to choose who is let in on a secret. */
export interface Player {
  id: string;
  name: string;
}

/** World markers belong to the GM. Player markers are the table's shared notes. */
export type MarkerKind = "world" | "player";

export const MARKER_TYPES = [
  { id: "quest", label: "Quest", color: "#e0a526" },
  { id: "treasure", label: "Hidden Treasure", color: "#2bb8c4" },
  { id: "cache", label: "Cache", color: "#2bb8c4" },
  { id: "merchant", label: "Merchant", color: "#f0c040" },
  { id: "harbor", label: "Harbor", color: "#3f7f9f" },
  { id: "temple", label: "Temple/Shrine", color: "#7aa6ff" },
  { id: "ruins", label: "Ruins", color: "#9ad8ff" },
  { id: "camp", label: "Camp", color: "#d9783a" },
  { id: "natural_feature", label: "Natural Feature", color: "#3fae7c" },
  { id: "point_of_interest", label: "Point of Interest", color: "#5b8def" },
  { id: "note", label: "Note", color: "#c9b891" },
] as const;

export type MarkerType = (typeof MARKER_TYPES)[number]["id"];

export const MARKER_TYPE_IDS: readonly string[] = MARKER_TYPES.map((t) => t.id);

export function markerType(id: string) {
  return (
    MARKER_TYPES.find((t) => t.id === id) ??
    MARKER_TYPES[MARKER_TYPES.length - 1]
  );
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
  /**
   * Only ever true for world markers. The GM is sent it so, and so are the
   * players it is a secret with: see `seenBy`.
   */
  hidden: boolean;
  /**
   * The players a hidden marker is shown to all the same, by id: a secret
   * between them and the GM. A player is only ever sent it empty.
   */
  seenBy: string[];
  /**
   * File name of a picture out of the gallery that its card shows: the face
   * of whoever stands there, the thing to be found. Null for none. Only a
   * world marker carries one.
   */
  image: string | null;
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
   * To players a hidden region is not there, and neither is its map nor
   * anything inside it: but for the ones named in `seenBy`.
   */
  hidden: boolean;
  /** The players a hidden region is there for all the same, by id. A player is only ever sent it empty. */
  seenBy: string[];
  /**
   * A closed region is on the map for players to see, and to wonder about:
   * they can't step into it until the GM opens it.
   */
  closed: boolean;
}

/**
 * A world map is a place to explore: markers, notes, regions to step into.
 * A battle map is a table to play on as well: it has a grid, and tokens
 * that the people at the table move around.
 */
export type MapKind = "world" | "battle";

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
 * One thing the GM did to the fog by hand: cleared it from a part of the
 * map, or with `cover` put it back there. The part is where a brush
 * swept: the spots it went through in `path`, and in `r` how far it
 * reaches across the map and down it. That is two numbers because the
 * brush is round on the map's picture, and map space is not square. With
 * `square` the brush is a square that far from its middle to its sides,
 * which stay level with the map's. A `box` is a part of the map said
 * outright: maps from when the fog was cleared by dragging one have them.
 */
export type FogMark =
  | { cover: boolean; box: Rect }
  | { cover: boolean; path: Point[]; r: [number, number]; square?: true };

/**
 * The fog of war. While it is on, the map is covered but for what has been
 * cleared. Players see nothing of what is under it; the GM sees through it.
 *
 * It is the same on either kind of map: the GM clears it by hand, with a
 * round brush or a square one, and covers what was cleared the same way. Each
 * of those is one of the `marks`, in the order they were made: a spot is
 * under the fog or not by the last mark that holds it. Where no mark does,
 * the boxes in `clear` are what the fog started out without: all of the
 * map, when the fog began by covering a part of it.
 */
export interface Fog {
  on: boolean;
  clear: Rect[];
  /** Left out where there are none. */
  marks?: FogMark[];
}

/**
 * How big the brush the fog is painted with can be: its radius, or for a
 * square one half its side, as a part of the map's longer side. `start` is
 * what it is until the GM changes it.
 */
export const FOG_BRUSH = { min: 0.004, max: 0.3, start: 0.04 };

/** How many miles a day's travel covers until the GM says otherwise: a day on foot, on a road. */
export const DEFAULT_DAY_MILES = 24;

export const NO_FOG: Fog = { on: false, clear: [] };

/**
 * Whose turn it is on a battle map: the tokens that take turns, in the
 * order they take them, and the one whose turn it is now. A token that has
 * been taken off the map keeps its place, in case it comes back.
 *
 * A player is only ever sent the tokens in it that they can see.
 */
export interface Turns {
  /** Token ids, the first to act first. */
  order: string[];
  /** The token whose turn it is, or null before the first turn. */
  current: string | null;
  /** Which time round the order this is, from 1. */
  round: number;
  /**
   * What each token rolled for its place in the order, by token id, where
   * the GM has typed it in. Only the GM is sent these.
   */
  rolls?: Record<string, number>;
}

export const NO_TURNS: Turns = { order: [], current: null, round: 1 };

/**
 * The turn order as someone who sees only these tokens is shown it. A turn
 * that belongs to a token they can't see is, to them, nobody's.
 */
export function turnsAmong(turns: Turns, seen: Iterable<string>): Turns {
  const ids = new Set(seen);
  return {
    order: turns.order.filter((id) => ids.has(id)),
    current:
      turns.current !== null && ids.has(turns.current) ? turns.current : null,
    round: turns.round,
  };
}

export const TOKEN_COLORS = [
  "#e5544b",
  "#d9783a",
  "#e0a526",
  "#3fae7c",
  "#2bb8c4",
  "#5b8def",
  "#b072e0",
  "#ff8ad8",
  "#c9b891",
  "#6b7488",
] as const;

/** How one of the marks a token can wear looks. */
export interface MarkLook {
  id: string;
  label: string;
  /** The colour of a plain pip, or of the icon on a dark one. */
  color: string;
  /**
   * For a mark that is an icon: its outline as an SVG path on a 24 by 24
   * grid. It is filled, unless `line` says it is drawn in strokes.
   */
  icon?: string;
  line?: boolean;
}

/**
 * What a token can be marked with, for whatever the table says each one
 * means. `down` crosses the token out. The rest are small pips on its rim:
 * six in a plain colour, then a dark one for each of the icons.
 */
export const TOKEN_MARKS = [
  { id: "down", label: "Down", color: "#12151c" },
  { id: "red", label: "Red", color: "#e5544b" },
  { id: "yellow", label: "Yellow", color: "#e0a526" },
  { id: "green", label: "Green", color: "#3fae7c" },
  { id: "blue", label: "Blue", color: "#5b8def" },
  { id: "purple", label: "Purple", color: "#b072e0" },
  { id: "white", label: "White", color: "#fff8e4" },
  {
    id: "skull",
    label: "Skull",
    color: "#fff8e4",
    icon: "M12 2.5a8 8 0 0 0-8 8c0 2.9 1.5 5.2 3.5 6.5V20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3c2-1.3 3.5-3.6 3.5-6.5a8 8 0 0 0-8-8Z M9 9.3a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 1 0 0-3.8Z M15 9.3a1.9 1.9 0 1 0 0 3.8a1.9 1.9 0 1 0 0-3.8Z",
  },
  {
    id: "flame",
    label: "Flame",
    color: "#ff8a3d",
    icon: "M12.5 2c.5 3.5 4.5 5.5 4.5 10.5a5 5 0 0 1-10 0c0-2 .8-3.3 2-4.5.2 1.8 1 2.8 2 3 .3-3.5-1-6 1.5-9Z",
  },
  {
    id: "bolt",
    label: "Bolt",
    color: "#ffe66b",
    icon: "M13.5 2 5 13.5h5.5L9.5 22 19 10.5h-5.5Z",
  },
  {
    id: "drop",
    label: "Drop",
    color: "#6ddc8b",
    icon: "M12 2.5c3.5 4.5 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.5-6.5 6-11Z",
  },
  {
    id: "snowflake",
    label: "Snowflake",
    color: "#9ad8ff",
    icon: "M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25 3.8 16.75",
    line: true,
  },
  {
    id: "shield",
    label: "Shield",
    color: "#7aa6ff",
    icon: "M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5Z",
  },
  {
    id: "heart",
    label: "Heart",
    color: "#ff7aa8",
    icon: "M12 21C5 15.5 2.5 12 2.5 8.5A4.75 4.75 0 0 1 12 6.2a4.75 4.75 0 0 1 9.5 2.3C21.5 12 19 15.5 12 21Z",
  },
  {
    id: "star",
    label: "Star",
    color: "#f2c14e",
    icon: "M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6l-6.3 3.5 1.5-7L2 9.3l7-.8Z",
  },
  {
    id: "eye",
    label: "Eye",
    color: "#fff8e4",
    icon: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z",
  },
  {
    id: "moon",
    label: "Moon",
    color: "#c79bff",
    icon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z",
  },
  {
    id: "lowered",
    label: "Arrow down",
    color: "#ffb86b",
    icon: "M9 3h6v9h4.5L12 21 4.5 12H9Z",
  },
  {
    id: "raised",
    label: "Arrow up",
    color: "#9ad8ff",
    icon: "M9 21h6v-9h4.5L12 3 4.5 12H9Z",
  },
  {
    id: "target",
    label: "Target",
    color: "#ff6b61",
    icon: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M12 6.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11Z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5Z",
  },
  {
    id: "net",
    label: "Net",
    color: "#c9d1e0",
    icon: "M8.5 3v18M15.5 3v18M3 8.5h18M3 15.5h18",
    line: true,
  },
] as const satisfies readonly MarkLook[];

export type TokenMark = (typeof TOKEN_MARKS)[number]["id"];

export const TOKEN_MARK_IDS: readonly string[] = TOKEN_MARKS.map(
  (mark) => mark.id,
);

/** The same marks, each as how it looks: with an icon, or without. */
export const MARK_LOOKS: readonly (MarkLook & { id: TokenMark })[] =
  TOKEN_MARKS;

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
  /** What it is marked with, in the order of TOKEN_MARKS. Anyone's to set. */
  marks: TokenMark[];
  /**
   * A number the token carries, for whatever the table counts on it: hit
   * points, charges, rounds left. Null for none. Anyone's to set, unless
   * the GM keeps it: see `countHidden`.
   */
  count: number | null;
  /**
   * The GM keeps the number to themself: a monster's hit points. A player
   * is sent the token with no number and this false, and can't set one.
   */
  countHidden: boolean;
  /**
   * The player whose token this is, by user id, and what they are called:
   * null for one that is nobody's, like most of the GM's. It doesn't say
   * who may move it, which is anyone. It says whose turn it is when its turn
   * comes, and who ends that turn.
   */
  ownerId: string | null;
  ownerName: string | null;
  /** Sent as true to the GM, and to the players it is a secret with: see `seenBy`. */
  hidden: boolean;
  /** The players a hidden token is shown to all the same, by id. A player is only ever sent it empty. */
  seenBy: string[];
  updatedAt: number;
}

/** A token turns this many degrees at a time. */
export const ROTATION_STEP = 15;

/** A token grows and shrinks this many cells at a time. It is also the smallest one. */
export const TOKEN_SIZE_STEP = 0.5;

/** The colours the table draws and writes in. */
export const INK_COLORS = [
  "#fff8e4",
  "#12151c",
  "#e5544b",
  "#e0a526",
  "#3fae7c",
  "#5b8def",
  "#b072e0",
] as const;

/**
 * A drawing is a line drawn freehand, a line of text, or a template: the
 * area a spell or a breath covers, as a circle, a cone or a box.
 */
export type DrawingKind = "line" | "text" | "circle" | "cone" | "rect";

/** The templates among them. Each is kept as two points: see `Drawing.points`. */
export const TEMPLATE_KINDS = ["circle", "cone", "rect"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const isTemplate = (kind: string): kind is TemplateKind =>
  (TEMPLATE_KINDS as readonly string[]).includes(kind);

/** How big a drawing is unless it says otherwise, in cells: see `Drawing.size`. */
export const DRAWING_SIZE: Record<DrawingKind, number> = {
  line: 0.1,
  text: 0.5,
  circle: 0.06,
  cone: 0.06,
  rect: 0.06,
};

/**
 * Something the table drew or wrote on a battle map. Anyone can add one.
 * Changing it or rubbing it out is for whoever made it, and the GM.
 */
export interface Drawing {
  id: string;
  mapId: string;
  kind: DrawingKind;
  /**
   * The path of a line. A text has one point: the middle of its left edge.
   * A template has two: a circle its middle and a spot on its rim, a cone
   * its tip and the middle of its far end, a box two opposite corners.
   */
  points: Point[];
  /** What a text says. Empty for anything else. */
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
  /** What of the map is under the fog of war. */
  fog: Fog;
  /** Whose turn it is on a battle map, and who comes after. A world map has none. */
  turns: Turns;
  /**
   * How many miles a world map is from its left edge to its right, when the
   * GM has said so. Null leaves it to the maps further out: see
   * `MapSnapshot.miles`.
   */
  miles: number | null;
  /**
   * How many miles a day's travel covers on a world map, when the GM has
   * said so. Null leaves it to the maps further out: see
   * `MapSnapshot.dayMiles`.
   */
  dayMiles: number | null;
  /** File name of the map image, out of the gallery, or null for a blank map. */
  imageFile: string | null;
  width: number;
  height: number;
}

/**
 * What a token of an encounter is, apart from where it stands: what a token
 * put down from it starts out as.
 */
export interface EncounterPiece {
  name: string;
  color: string;
  outline: string | null;
  /** File name of a token picture out of the gallery. Null for a plain disc. */
  image: string | null;
  size: number;
  rotation: number;
  marks: TokenMark[];
  count: number | null;
  countHidden: boolean;
}

/**
 * One token of an encounter, and where it stands from the middle of the
 * encounter, in cells. So an encounter keeps its shape on a map whose grid
 * is another size. The server says where: see `arrangeInCells`.
 */
export interface EncounterToken extends EncounterPiece {
  dx: number;
  dy: number;
}

/**
 * An encounter: tokens made ahead of time, to put down on any battle map in
 * one go. The ambush, the patrol, the dragon and its cultists. It is put
 * together in the gallery, it is the campaign's, and only the GM ever sees
 * it.
 */
export interface Encounter {
  id: string;
  name: string;
  tokens: EncounterToken[];
}

/** What the endpoints for encounters answer with: the encounters as they are now. */
export interface EncountersResponse {
  ok: boolean;
  error?: string;
  items?: Encounter[];
  /** The one that was just made, by its id. */
  made?: string;
}

/** What a picture in the gallery is for: to lay under a map, or to put on a token. */
export type GalleryKind = "map" | "token";

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
  /**
   * What a token made from this picture starts out as, when the GM has said
   * so: how many cells across, and the colour of its ring. Null for the
   * usual: one cell, no ring. A map image has neither.
   */
  tokenSize: number | null;
  tokenOutline: string | null;
}

/** A picture the GM is holding up for the table to look at: all of it, or the players it is meant for. */
export interface Shown {
  file: string;
  name: string;
  width: number;
  height: number;
  /**
   * The players it is held up for, by id. Empty for the whole table. Only
   * the GM is told: a player is shown the picture or isn't.
   */
  to?: string[];
}

/** What the endpoint that holds a picture up for the table answers with. */
export interface ShowResponse {
  ok: boolean;
  error?: string;
}

/** What the endpoint that sets the date in the world answers with: the date as it was kept. */
export interface DateResponse {
  ok: boolean;
  error?: string;
  date?: string;
}

/** One thing the finder can take someone to: a map, or a marker on one. */
export interface FindEntry {
  kind: "map" | "marker";
  /** The map's id, or the marker's. */
  id: string;
  /** The map to go to: itself, or the one the marker is on. */
  mapId: string;
  name: string;
  /** The maps on the way there, by name, the first map of the campaign first. */
  path: string[];
  /** What kind of map it is, or what type of marker. */
  type: MapKind | MarkerType;
  /** Only ever true for the GM. */
  hidden: boolean;
}

export interface FindResponse {
  ok: boolean;
  entries: FindEntry[];
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
export function imageUrl(
  campaignId: string,
  file: string,
  part?: string,
): string {
  const url = `/c/${campaignId}/image/${file}`;
  return part ? `${url}?part=${part}` : url;
}

export interface Crumb {
  id: string;
  name: string;
}

/**
 * The picture a world map shows while it has none of its own: the part of
 * the image of a map further out that lies under the region leading here.
 * See src/lib/shared/backdrop.ts.
 */
export interface Backdrop {
  /** The image it is a part of: its file name, and its size in pixels. */
  file: string;
  width: number;
  height: number;
  /** The part that shows, in pixels of that image: its left and top, how wide and how tall. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapSnapshot {
  map: MapInfo;
  /**
   * What to show under the map while it has no image of its own, or null
   * for plain paper. Worked out whether or not it has one now.
   */
  backdrop: Backdrop | null;
  /** Root map first, current map last. */
  trail: Crumb[];
  regions: Region[];
  markers: Marker[];
  /** Empty on a world map. */
  tokens: Token[];
  /** Empty on a world map. */
  drawings: Drawing[];
  /**
   * How many miles this map is across: what the GM said of it, or worked
   * out from the nearest map further out that has a scale, by how much of
   * that map the way here covers. Null when no map on the way has one.
   */
  miles: number | null;
  /**
   * How many miles a day's travel covers here: what the GM said of this
   * map, or of the nearest map further out that has a pace of its own, or
   * `DEFAULT_DAY_MILES` when none has.
   */
  dayMiles: number;
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
  /** The GM's to set: the players a hidden marker is a secret with. */
  seenBy: string[];
  /** The file name of a picture in the gallery, or null for none. A world marker's only. */
  image: string | null;
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
  /** Anyone's to set. */
  marks: TokenMark[];
  /** Anyone's to set, unless the GM keeps it. Null takes the number off. */
  count: number | null;
  /** The GM's to set: the number is kept from the players. */
  countHidden: boolean;
  /** The GM's to set: the player whose token it is, by user id, or null for nobody's. */
  ownerId: string | null;
  /** The GM's to set. */
  hidden: boolean;
  /** The GM's to set: the players a hidden token is a secret with. */
  seenBy: string[];
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
  | ({
      t: "marker.create";
      mapId: string;
      kind: MarkerKind;
    } & Partial<MarkerInput>)
  | { t: "marker.update"; id: string; changes: Partial<MarkerInput> }
  | { t: "marker.delete"; id: string }
  | { t: "marker.restore"; id: string }
  | ({ t: "token.create"; mapId: string } & Partial<TokenInput>)
  /** Moving a token is this, with a new `x` and `y`. */
  | { t: "token.update"; id: string; changes: Partial<TokenInput> }
  /** Puts a copy of a token beside it. Anyone can, of any token they see. */
  | { t: "token.duplicate"; id: string }
  | { t: "token.delete"; id: string }
  | { t: "token.restore"; id: string }
  | ({ t: "drawing.create"; mapId: string } & Partial<DrawingInput>)
  | { t: "drawing.update"; id: string; changes: DrawingChanges }
  | { t: "drawing.delete"; id: string }
  | { t: "drawing.restore"; id: string }
  /** `kind` is the kind of map the region leads to: a world map unless it says otherwise. */
  | {
      t: "region.create";
      mapId: string;
      name: string;
      points: Point[];
      hidden?: boolean;
      closed?: boolean;
      kind?: MapKind;
    }
  /**
   * Reshapes a region, hides or reveals it, says which players a hidden
   * one is there for, closes it to players or opens it: whichever are given.
   */
  | {
      t: "region.update";
      id: string;
      points?: Point[];
      hidden?: boolean;
      seenBy?: string[];
      closed?: boolean;
    }
  /** For good, along with the map behind the region and everything inside it. */
  | { t: "region.delete"; id: string }
  /**
   * Renames a map, sets up its grid, says how many feet a cell stands for,
   * lays an image under it, covers it with fog or clears some, says whose
   * turn it is, how many miles across it is, or how many miles a day's
   * travel covers on it (null for none of its own): whichever are given.
   * `image` is the file name of a map image in the gallery. A map's kind is
   * not here: it is chosen when its region is drawn, and stays.
   */
  | {
      t: "map.update";
      id: string;
      name?: string;
      grid?: Partial<Grid>;
      cellFeet?: number;
      image?: string;
      fog?: Partial<Fog>;
      turns?: Partial<Turns>;
      miles?: number | null;
      dayMiles?: number | null;
    }
  /**
   * Ends the turn of `from` on a battle map and moves on to the next.
   * Anyone at the table can, for a token they can see. Naming whose turn
   * is being ended keeps two people who press at once from skipping one.
   */
  | { t: "turn.next"; mapId: string; from: string | null }
  /**
   * Takes a battle map back from the turn of `from` to the one before it:
   * the GM's, for a turn that was ended by mistake. Naming the turn it goes
   * back from keeps a press that comes late from going back twice.
   */
  | { t: "turn.back"; mapId: string; from: string }
  /** Takes back the change with this sequence number by performing its opposite. */
  | { t: "history.revert"; seq: number }
  /**
   * Several commands as one: all of them happen, or if any is refused, none.
   * For what is done to a whole selection at once. A batch holds no batches.
   */
  | { t: "batch"; cmds: Command[] };

/** One command of them all, by its name: `CommandOf<"marker.create">`. */
export type CommandOf<T extends Command["t"]> = Extract<Command, { t: T }>;

// ------------------------------------------------------------------ events

export type EntityType = "marker" | "region" | "map" | "token" | "drawing";

/** A full copy of one of them, as the event log keeps it. */
export type Entity = Marker | Region | MapInfo | Token | Drawing;
export type EventAction = "create" | "update" | "delete" | "restore";

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
  | { t: "marker.upsert"; marker: Marker }
  | { t: "marker.remove"; id: string; mapId: string }
  | { t: "region.upsert"; region: Region }
  /** `targetMapId` is the map that can no longer be reached through it. */
  | { t: "region.remove"; id: string; mapId: string; targetMapId: string }
  /**
   * When the fog on the map changed for a player, what they can see of it
   * now comes along, in place of what they had: the `tokens` of a battle
   * map, the `markers` and `regions` of a world map.
   */
  | {
      t: "map.upsert";
      map: MapInfo;
      tokens?: Token[];
      markers?: Marker[];
      regions?: Region[];
    }
  /**
   * `turns` comes along when a token that takes turns came into a player's
   * sight or went out of it: the turn order as they may see it now.
   */
  | { t: "token.upsert"; token: Token; turns?: Turns }
  | { t: "token.remove"; id: string; mapId: string; turns?: Turns }
  | { t: "drawing.upsert"; drawing: Drawing }
  | { t: "drawing.remove"; id: string; mapId: string };

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

/**
 * What someone has in hand on a map: a token they are dragging, a distance
 * they are measuring, a spot they are pointing at. Where their mouse is
 * otherwise is nobody's business, and is not sent.
 */
export interface HandSpot {
  mapId: string;
  /**
   * The spot they are pointing at: where their pointer is, for as long as
   * they hold it down with the pointing tool in hand.
   */
  point?: Point;
  /**
   * A token this person has in hand, and where they are holding it. It
   * only moves for good once they let go: that is a `token.update`.
   */
  drag?: { id: string; x: number; y: number };
  /**
   * A distance they are measuring: from one spot to another, by way of
   * every spot the ruler bends at in between.
   */
  ruler?: Point[];
}

/**
 * What someone at the table has in hand right now. Passed from browser to
 * browser by the WebSocket server and never stored.
 */
export interface Hand extends HandSpot {
  /** One per connection, so the same person in two windows is two hands. */
  id: string;
  userId: string;
  name: string;
  role: Role;
}

/** A spot of a map someone wants looked at. A little outside 0..1 is the margin around the map. */
export interface PingSpot {
  mapId: string;
  x: number;
  y: number;
}

/**
 * Someone pointing a spot out to the table: it pulses there for a moment,
 * for everyone looking at that map. Passed on like a hand, and never stored.
 */
export interface Ping extends PingSpot {
  userId: string;
  name: string;
  role: Role;
}

/**
 * Someone at the door asking for a seat: a new one, or the one they sat in
 * before, when their browser has forgotten them or they have come on
 * another device. The GM is told, and lets them in or doesn't. Nobody sits
 * down on the invite link alone.
 */
export interface Knock {
  id: string;
  /** The player whose seat is asked for. Null for someone new with only a name. */
  userId: string | null;
  name: string;
  /** They have no seat at this table yet, and ask for one. */
  newcomer: boolean;
  at: number;
}

/** What the endpoint that answers a knock says back. */
export interface SeatResponse {
  ok: boolean;
  error?: string;
}

/**
 * How it stands with a seat this browser asked for: still `waiting` on the
 * GM, `granted`, which seats this browser as that player, `refused`, or
 * `gone` when the asking has lapsed or was never made.
 */
export interface SeatStatus {
  status: "waiting" | "granted" | "refused" | "gone";
  /** Where to go once it is granted. */
  to?: string;
}

export type ClientMessage =
  | { t: "cmd"; id: number; cmd: Command }
  /** What this browser has in hand, or null once it has let go. */
  | { t: "hand"; at: HandSpot | null }
  /** A spot this person wants the table to look at. */
  | { t: "ping"; at: PingSpot };

export type ServerMessage =
  | {
      t: "hello";
      user: { id: string; name: string };
      role: Role;
      seq: number;
      online: Presence[];
      hands: Hand[];
      /** The picture the GM is holding up for the table, if any. */
      shown: Shown | null;
      /** For the GM: who is asking for a seat they sat in before. */
      knocks: Knock[];
      /** The date it is in the world, as the GM wrote it. Empty for none. */
      date: string;
    }
  | { t: "presence"; online: Presence[] }
  /** For the GM: everyone asking for a seat right now, in place of who was before. */
  | { t: "knocks"; knocks: Knock[] }
  | { t: "event"; event: LiveEvent }
  | { t: "hand"; hand: Hand }
  | { t: "hand.left"; id: string }
  | { t: "ping"; ping: Ping }
  /** The GM holds a picture up for the table, or with null puts it away. */
  | { t: "show"; shown: Shown | null }
  /** The GM has said what date it is in the world, or with nothing, that there is none. */
  | { t: "date"; date: string }
  | { t: "ack"; id: number; ok: true; undo: number[] }
  | { t: "ack"; id: number; ok: false; error: string };

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
  /** The picture the GM is holding up for the table, if any. */
  shown: Shown | null;
  /** Who is asking for a seat they sat in before. Only ever told to the GM. */
  knocks: Knock[];
  /** The date it is in the world. Empty for none. */
  date: string;
}

/**
 * What the app hands the WebSocket server to deliver: events it has just
 * written, each already cut down to what a role may see, and what else the
 * table is to be told.
 */
export interface Broadcast {
  campaignId: string;
  /**
   * `to` is what each role is sent. `only` is for the players who are let
   * in on something the rest are not, by user id: what each of them is sent
   * in place of what the players are, which may be nothing at all.
   */
  events: {
    seq: number;
    to: Record<Role, LiveEvent | null>;
    only?: Record<string, LiveEvent | null>;
  }[];
  /**
   * A picture held up, or null once it is put away. `to` names the players
   * it is held up for, by user id: empty for the whole table.
   */
  show?: { shown: Shown | null; to: string[] };
  /** Everyone asking for a seat right now. It goes to the GM and nobody else. */
  knocks?: Knock[];
  /** The date it is in the world now, for everyone. Empty once there is none. */
  date?: string;
}

export const LIMITS = {
  title: 120,
  description: 4000,
  name: 80,
  /** The date in the world, which is whatever the GM writes. */
  date: 80,
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
  /** The fewest and the most miles a world map can be across. */
  milesMin: 0.01,
  milesMax: 1000000,
  /** The fewest and the most miles a day's travel can cover. */
  dayMilesMin: 0.1,
  dayMilesMax: 10000,
  /** The most spots a ruler runs through: its two ends and the bends between. */
  rulerPoints: 32,
  /** The most people who can be asking for a seat in one campaign at once. */
  knocks: 8,
  /** The most tokens that take turns on one map. */
  turns: 100,
  /** The most boxes the fog on one map starts out cleared by. */
  fogRects: 400,
  /** The most marks made by hand on the fog of one map, and the most spots in the sweep of one. */
  fogMarks: 400,
  fogPath: 48,
  /** The most encounters a campaign keeps, and the most tokens in one. */
  encounters: 60,
  encounterTokens: 40,
  /** How far from the middle of its encounter a token can stand, in cells. */
  encounterReach: 200,
  /** The least and the most a token's number can be. */
  countMin: -999,
  countMax: 9999,
  /** The least and the most a token can have rolled for its place in the turn order. */
  rollMin: -99,
  rollMax: 999,
  /** The most players one secret is shared with. */
  seenBy: 64,
  regionPoints: 200,
  // Room for a big map that has been through an upscaler.
  imageBytes: 256 * 1024 * 1024,
  /** The longest a map image may be on either side, in pixels. */
  imageSide: 30000,
  /** A token's picture is made small before it is kept, so this is only what may be sent. */
  tokenImageBytes: 32 * 1024 * 1024,
} as const;

/** The longest side a token's picture is kept at, in pixels. */
export const TOKEN_IMAGE_SIZE = 512;

export const DEFAULT_MAP_SIZE = { width: 1600, height: 1000 } as const;
