<script lang="ts">
	// The map itself: pan, zoom, regions you can step into, and markers that
	// explain themselves. No map library, just one transformed layer.
	//
	// Markers and regions live in map space (0..1 across the image). The
	// `view` turns map space into screen pixels: screen = map * size * k + offset.
	//
	// A battle map is the same sheet used as a table: a grid drawn over it,
	// tokens to drag from cell to cell, a ruler that counts the cells
	// between, and lines, words and spell templates the table draws on it.
	// It holds no markers and no regions.
	//
	// Nobody's mouse is shown to anyone else as it wanders. What the table
	// sees of the others is what they have in hand, a token or a ruler, the
	// spots they point out with a ping, and where they point for as long as
	// they hold the button down with the pointing tool.

	import { untrack, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { KEY, chord, isTyping, usesArrows } from '#lib/client/keys.ts';
	import { nameSpot, type Frame } from '#lib/client/placement.ts';
	import { Stage, clamped, inside } from '#lib/client/stage.svelte.ts';
	import { POINT_CURSOR, tintOf } from '#lib/client/tints.ts';
	import { dragSlack, type Board, type Gesture, type GestureOf } from '#lib/client/tools/board.ts';
	import { Carry } from '#lib/client/tools/carry.svelte.ts';
	import { FogBrush } from '#lib/client/tools/fog-brush.svelte.ts';
	import { InHand, type Holding } from '#lib/client/tools/in-hand.svelte.ts';
	import { caughtIn } from '#lib/client/tools/marquee.ts';
	import { Pen } from '#lib/client/tools/pen.svelte.ts';
	import { Pointing } from '#lib/client/tools/pointing.svelte.ts';
	import { RegionShaper } from '#lib/client/tools/regions.svelte.ts';
	import { RulerTool } from '#lib/client/tools/ruler.svelte.ts';
	import { Shaper } from '#lib/client/tools/shaper.svelte.ts';
	import { Shapes } from '#lib/client/tools/shapes.svelte.ts';
	import { frameOf } from '#lib/shared/backdrop.ts';
	import { boxOf } from '#lib/shared/drawing.ts';
	import { brushSize, isEye } from '#lib/shared/fog.ts';
	import { snapToGrid } from '#lib/shared/grid.ts';
	import {
		canChangeDrawing,
		canEditMarkerKind,
		canEditWorld,
		canMoveToken
	} from '#lib/shared/rules.ts';
	import {
		FOG_BRUSH,
		imageUrl,
		type Backdrop,
		type Command,
		type Diagonal,
		type Drawing,
		type Grid,
		type Hand,
		type MapInfo,
		type Marker,
		type Ping,
		type Player,
		type Point,
		type Rect,
		type Region,
		type Role,
		type TemplateKind,
		type Token,
		type Units
	} from '#lib/shared/types.ts';
	import BattleInk from './BattleInk.svelte';
	import BattleTokens from './BattleTokens.svelte';
	import FogLayer from './FogLayer.svelte';
	import MapLines from './MapLines.svelte';
	import MapOverlays from './MapOverlays.svelte';
	import MapPicture from './MapPicture.svelte';
	import MapPins from './MapPins.svelte';
	import RegionNames from './RegionNames.svelte';
	import TableSigns from './TableSigns.svelte';

	interface Props {
		map: MapInfo;
		/** What a world map shows while it has no image of its own, or null for plain paper. */
		backdrop: Backdrop | null;
		regions: Region[];
		markers: Marker[];
		/** The pieces on a battle map. A world map shows none. */
		tokens: Token[];
		/** What has been drawn and written on a battle map. */
		drawings: Drawing[];
		/** How many miles across a world map is, or null when nothing says. */
		miles: number | null;
		/** How many miles a day's travel covers on a world map: what the ruler tells time by. */
		dayMiles: number;
		/** What distances are told in here: feet and miles, or metres and kilometres. */
		units: Units;
		/** How a diagonal step is counted by the ruler of a battle map. */
		diagonal: Diagonal;
		/** What the other people looking at this map have in hand. */
		hands: Hand[];
		/** The spots of this map being pointed out right now. `key` tells one from the next. */
		pings: (Ping & { key: number })[];
		role: Role;
		userId: string;
		/** The players of the campaign, for the GM to choose who something hidden is a secret with. */
		players: Player[];
		/**
		 * A grid the GM is trying on the map before keeping it: it is drawn in
		 * place of the map's own, and the tokens are sized by it.
		 */
		gridPreview?: Pick<Grid, 'size' | 'x' | 'y'> | null;
		/** The box the GM dragged over the squares of the map's picture, to line that grid up by. */
		aligned?: Rect | null;
		/**
		 * A table display: the map is shown and can be moved about, and nothing
		 * on it can be picked up or changed.
		 */
		passive?: boolean;
		/**
		 * `pan` is the hand: it moves the map, and on a battle map selects and
		 * drags what is on it. `place` waits for a click that positions a
		 * marker, `draw` outlines a region. `select` drags a box around
		 * several things, to select them together: the tokens and drawings of
		 * a battle map, the markers of a world map. Whatever is in hand, the
		 * middle button of a mouse moves the map. A battle map has `sketch`,
		 * which draws a line
		 * freehand, `text`, which waits for a click to start writing at,
		 * `template`, which drags out the area of a spell, and for the GM
		 * `align`, which drags a box over the squares of the map's own picture
		 * to line the grid up by. `reveal` and `cover` are the GM's on either
		 * kind of map: one clears the fog of war from where it is used, the
		 * other puts it back. See `fogShape`. `measure` drags a ruler across
		 * either kind of map. With `point` in hand, on either, the table is
		 * shown where the pointer is for as long as its button is held down.
		 */
		tool:
			| 'pan'
			| 'point'
			| 'align'
			| 'place'
			| 'draw'
			| 'measure'
			| 'select'
			| 'sketch'
			| 'text'
			| 'template'
			| 'reveal'
			| 'cover';
			/**
			 * What `reveal` and `cover` do it with: a brush swept over the map,
			 * `round` or `square`.
			 */
			fogShape?: 'round' | 'square';
			/**
			 * How big that brush is: its radius, or half the side of a square one,
			 * as a part of the map's longer side. The wheel changes it, with Shift
			 * held.
			 */
			fogSize?: number;
		/**
		 * The colour `sketch` draws in, `text` writes in and a template is laid
		 * down in. To the table those three are one tool, the pen: the page
		 * says which of them it is being used as.
		 */
		ink: string;
		/** Which template the `template` tool lays down. */
		shape: TemplateKind;
		/** How many maps deep this one is. Decides which way the arrival animation zooms. */
		depth: number;
		selectedMarkerId: string | null;
		selectedRegionId: string | null;
		/**
		 * The tokens and drawings selected on a battle map, by id. On a world
		 * map, the markers selected together.
		 */
		selectedIds: string[];
		/**
		 * Carries out what was done to tokens, drawings, or several markers
		 * at once. Resolves once the
		 * server has done it, or refused. `note` is said when it has, with a
		 * way to undo.
		 */
		send: (commands: Command[], note?: string) => Promise<boolean>;
		/** A tool that does one thing has done it: `select` caught something, `text` was written. */
		ondone: () => void;
		onplace: (x: number, y: number) => void;
		/** A bare spot of a world map was double-clicked: a note is wanted there. */
		onnote: (x: number, y: number) => void;
		ondrawn: (points: Point[]) => void;
		onenter: (region: Region) => void;
		onreshape: (region: Region, points: Point[]) => Promise<boolean>;
		/**
		 * The buttons for the region that is selected, which the map floats over
		 * it. `tip` is the side their tooltips come out on: away from the region.
		 */
		regionBar?: Snippet<[region: Region, tip: 'top' | 'bottom']>;
		onedit: (marker: Marker) => void;
		onmove: (marker: Marker) => void;
		ondelete: (marker: Marker) => void;
		onhide: (marker: Marker, hidden: boolean) => void;
		/** The GM is to say who sees these world markers. */
		onmarkervisibility?: (markers: Marker[]) => void;
		/**
		 * The markers and regions that are new to whoever is looking, by id:
		 * revealed, or out of the fog, since they last looked. Each glints until
		 * it is looked at.
		 */
		fresh?: string[];
		/** One of those has been looked at: its card read, its name lit. */
		onseen?: (id: string) => void;
		/** A box was dragged over the squares of the map's picture, in map space. */
		onalign: (box: Rect) => void;
		/** The rest of what a token is, is to be changed: its picture, its colour, its outline. */
		onedittoken: (token: Token) => void;
		/** The GM is to say who sees these tokens and drawings. */
		onpiecevisibility?: (things: (Token | Drawing)[]) => void;
		/** What this browser has in hand on the map, or null when it holds nothing. */
		onhand: (at: Holding | null) => void;
		/** This person is pointing a spot of the map out to the table. */
		onping: (x: number, y: number) => void;
	}

	let {
		map,
		backdrop,
		regions,
		markers,
		tokens,
		drawings,
		miles,
		dayMiles,
		units,
		diagonal,
		hands,
		pings,
		role,
		userId,
		players,
		gridPreview = null,
		aligned = null,
		passive = false,
		tool,
		fogShape = 'round',
		fogSize = $bindable(FOG_BRUSH.start),
		ink,
		shape,
		depth,
		selectedMarkerId = $bindable(),
		selectedRegionId = $bindable(),
		selectedIds = $bindable(),
		send,
		ondone,
		onplace,
		onnote,
		ondrawn,
		onenter,
		onreshape,
		regionBar,
		onedit,
		onmove,
		ondelete,
		onhide,
		onmarkervisibility = () => {},
		fresh = [],
		onseen,
		onalign,
		onedittoken,
		onpiecevisibility = () => {},
		onhand,
		onping
	}: Props = $props();

	// How the map lies on the screen, and how it is moved about. The rest of
	// this component reads the view and the size of the screen from it.
	const stage = new Stage(() => ({ W, H, blownUp: image ? blownUp : null }));
	const view = $derived(stage.view);
	const cw = $derived(stage.cw);
	const ch = $derived(stage.ch);
	const toMap = (clientX: number, clientY: number) => stage.toMap(clientX, clientY);

	let ready = $state(false);
	let dragging = $state(false);
	/** The middle button of a mouse is down: it moves the map, whatever tool is in hand. */
	let handing = $state(false);
	let hoveredMarkerId = $state<string | null>(null);
	let hoveredRegionId = $state<string | null>(null);
	/** Where the mouse is over the map: the outline being drawn and the ring of the fog's brush follow it. */
	let cursor = $state<Point | null>(null);
	/** How tall each region's name stands on screen, by the region's id: a long one runs to more lines. */
	const nameHeights = $state<Record<string, number>>({});
	/** What floats over the map: the card, the buttons beside the selection, the hints. */
	let overlays = $state<ReturnType<typeof MapOverlays>>();
	/** The box being dragged around things to select them: one corner, and the other. */
	let marquee = $state.raw<[Point, Point] | null>(null);
	/** The box the GM is dragging over the squares of the map's picture: one corner, and the other. */
	let aligning = $state.raw<[Point, Point] | null>(null);

	// What the tools are given to work with: the map as it stands now. Each
	// tool keeps what it is in the middle of, and takes its part of a press,
	// a drag and a release: see src/lib/client/tools.
	const board: Board = {
		stage,
		get map() {
			return map;
		},
		get W() {
			return W;
		},
		get H() {
			return H;
		},
		get cell() {
			return cell;
		},
		get battle() {
			return battle;
		},
		get tokens() {
			return tokens;
		},
		get drawings() {
			return drawings;
		},
		get markers() {
			return markers;
		},
		get selectedIds() {
			return selectedIds;
		},
		set selectedIds(ids) {
			selectedIds = ids;
		},
		send: (commands, note) => send(commands, note),
		aim: (e) => aim(e)
	};
	/** What this person has in hand: a token, a drawing, or the markers selected together. */
	const hand = new Carry(board, {
		canGrab: (thing) => canGrab(thing),
		canGrabMarker: (marker) => canGrabMarker(marker),
		selectedMarkers: () => selectedMarkers
	});
	const ruler = new RulerTool(board);
	/** The pen of a battle map: its lines, its shapes and its text. */
	const pen = new Pen(board, {
		ink: () => ink,
		shape: () => shape,
		userId: () => userId,
		ondone: () => ondone()
	});
	/** The handles that turn and resize the one token selected. */
	const shaper = new Shaper(board, (token) => spotOf(token));
	/** The GM's brush for the fog. */
	const brush = new FogBrush(board, {
		tool: () => tool,
		shape: () => fogShape,
		size: () => fogSize,
		cursor: () => cursor
	});
	/** The outline of a region: the one being drawn, and the one being reshaped. */
	const outlines = new RegionShaper(board, {
		ondrawn: (points) => {
			cursor = null;
			ondrawn(points);
		},
		onreshape: (region, points) => onreshape(region, points)
	});

	/** The pointing tool, and the pings a click or a resting finger leaves. */
	const pointer = new Pointing(board, {
		tool: () => tool,
		passive: () => passive,
		gesture: () => gesture,
		onping: (x, y) => onping(x, y)
	});
	/** What everyone at the table has in hand on this map, and what this browser tells them of its own. */
	const inHand = new InHand(board, hand, ruler, pointer, {
		hands: () => hands,
		me: () => ({ role, userId }),
		scale: () => ({ miles, dayMiles, units, diagonal })
	});
	/** The shapes laid on a battle map, and the tokens they catch. */
	const shapes = new Shapes(board, {
		selecting: () => selecting,
		spotOf: (token) => spotOf(token),
		shiftOf: (drawing) => shiftOf(drawing),
		casted: () => pen.casted,
		shape: () => shape,
		tokensSelected: () => selectedTokens.length,
		units: () => units
	});

	// What the tools hold, under the names the rest of this component reads them by.
	const pointing = $derived(pointer.at);
	const rulers = $derived(inHand.rulers);
	const pointed = $derived(inHand.pointed);
	const templates = $derived(shapes.laid);
	const insideSelected = $derived(shapes.inside);
	const caughtIds = $derived(shapes.caughtIds);
	const templateSize = shapes.size;
	const carry = $derived(hand.now);
	const shaping = $derived(shaper.now);
	const measure = $derived(ruler.measure);
	const routing = $derived(ruler.routing);
	const draft = $derived(outlines.draft);
	const writing = $derived(pen.writing);
	const casted = $derived(pen.casted);

	/**
	 * The GM selects a region with one click, and gets its corners to reshape
	 * it by. What else can be done with it is up to the page, which knows the
	 * selection too. Players only step inside.
	 */
	const canShape = $derived(canEditWorld(role));
	/** A finger is pointing, not a mouse: the corners of a region grow to be caught by one. */
	const coarse = new MediaQuery('(pointer: coarse)');
	const grip = $derived(coarse.current ? 1.6 : 1);
	/**
	 * The picture under the map, and the part of it that shows. A map's own
	 * image shows whole. A world map without one borrows a part of an image
	 * from further out: see src/lib/shared/backdrop.ts.
	 */
	const source = $derived.by((): Backdrop | null => {
		if (!map.imageFile) return map.kind === 'world' ? backdrop : null;
		const { width, height } = map;
		return { file: map.imageFile, width, height, x: 0, y: 0, w: width, h: height };
	});
	/** The size of a map with a borrowed picture, which is the size of the part it shows. */
	const borrowed = $derived(!map.imageFile && source ? frameOf(source) : null);
	const W = $derived(borrowed?.width ?? map.width);
	const H = $derived(borrowed?.height ?? map.height);
	/** How many pixels of the map one pixel of the picture covers: more than one for a small borrowed part. */
	const blownUp = $derived(borrowed?.scale ?? 1);
	const image = $derived(source && imageUrl(map.campaignId, source.file));

	// Small regions go on top, so a district inside a larger outline stays reachable.
	const orderedRegions = $derived(
		[...regions].sort((a, b) => boundsOf(b.points).area - boundsOf(a.points).area)
	);
	const orderedMarkers = $derived([...markers].sort((a, b) => a.y - b.y));
	const selectedRegion = $derived(regions.find((r) => r.id === selectedRegionId) ?? null);
	/** The region whose name is lit, because the mouse is over it. */
	const litRegionId = $derived(tool === 'pan' ? hoveredRegionId : null);

	// Markers take priority over the region beneath them: they sit above the
	// regions and get the pointer first, so hovering one shows its card.
	const active = $derived.by(() => {
		if (tool !== 'pan' || carry?.held) return null;
		const id = hoveredMarkerId ?? selectedMarkerId;
		return markers.find((m) => m.id === id) ?? null;
	});

	/** The map as it lies on the screen, for placing what floats over it. */
	const frame = $derived<Frame>({ view, W, H, cw, ch });

	/** How long a card has to be open, or a region's name lit, before it counts as looked at. */
	const LOOKED_AT = 600;

	// What is new to this person glints until they look at it: a marker whose
	// card they have open, a region the pointer rests on. Passing over one on
	// the way somewhere else is not looking.
	$effect(() => {
		const id = tool === 'pan' ? (active?.id ?? hoveredRegionId) : null;
		if (!id || !fresh.includes(id)) return;
		const timer = setTimeout(() => onseen?.(id), LOOKED_AT);
		return () => clearTimeout(timer);
	});

	// ---------------------------------------------------------- battle maps

	const battle = $derived(map.kind === 'battle');
	/** The grid as it is drawn: the map's own, or one the GM is trying on it, which always shows. */
	const grid = $derived(gridPreview ? { ...gridPreview, shown: true } : map.grid);
	/** The side of one grid cell, in map pixels. */
	const cell = $derived(grid.size);

	/** Every line of the grid as one path. Empty when there is no grid to draw. */
	const gridLines = $derived.by(() => {
		if (!battle || !grid.shown) return '';
		let d = '';
		for (let x = grid.x; x <= W; x += cell) d += `M${x} 0V${H}`;
		for (let y = grid.y; y <= H; y += cell) d += `M0 ${y}H${W}`;
		return d;
	});
	/** The box that grid is lined up by: the one being dragged, or the one let go. */
	const alignBox = $derived.by((): Rect | null => {
		if (!aligning) return tool === 'align' ? aligned : null;
		const box = boxOf(aligning);
		return [box.x0, box.y0, box.x1, box.y1];
	});

	/** Tokens someone else has in hand right now, and where they are holding them. */
	const heldByOthers = $derived.by(() => {
		const spots = new Map<string, Point>();
		for (const other of hands) {
			const { drag } = other;
			const token = drag && tokens.find((t) => t.id === drag.id);
			// Only one that can really be moved. A drag is one browser's word,
			// and the server that passes it on doesn't check.
			if (drag && token && canMoveToken(token)) {
				spots.set(token.id, clamped([drag.x, drag.y]));
			}
		}
		return spots;
	});

	/** Where something in this person's hand is right now, or null if it isn't in it. */
	const inHandAt = (id: string) => hand.at(id);

	/** Where a token is drawn: in a hand if it is in one, or where it stands. */
	function spotOf(token: Token): Point {
		const resized = shaping?.id === token.id ? shaping.at : undefined;
		return inHandAt(token.id) ?? resized ?? heldByOthers.get(token.id) ?? [token.x, token.y];
	}

	/** How big a token is drawn, and which way round: as its handles have it, or as it is. */
	const { sizeOf, turnOf } = shaper;

	/** How far from where it is kept a drawing is drawn, while it is in hand. */
	function shiftOf(drawing: Drawing): Point {
		const at = inHandAt(drawing.id);
		return at ? [at[0] - drawing.points[0][0], at[1] - drawing.points[0][1]] : [0, 0];
	}

	const lines = $derived(battle ? drawings.filter((d) => d.kind === 'line') : []);
	const texts = $derived(battle ? drawings.filter((d) => d.kind === 'text') : []);
	/** The token whose turn it is, if it is one this person can see. */
	const turnId = $derived(battle ? map.turns.current : null);

	const isToken = (thing: Token | Drawing): thing is Token => !('points' in thing);
	/** A token is picked up by anyone, unless it is locked. */
	const canGrabToken = (token: Token) => canMoveToken(token);
	const canGrabDrawing = (drawing: Drawing) => canChangeDrawing(role, userId, drawing);
	const canGrab = (thing: Token | Drawing) =>
		isToken(thing) ? canGrabToken(thing) : canGrabDrawing(thing);
	/** A marker is moved by whoever may change it: the GM any of them, a player the table's notes. */
	const canGrabMarker = (marker: Marker) => canEditMarkerKind(role, marker.kind);

	/** The hand is out on a battle map: what is on it can be selected and dragged. */
	const selecting = $derived(battle && tool === 'pan' && !passive);
	/**
	 * Where the fog follows the tokens: how far each of the players' tokens
	 * sees, in the map's pixels. Null on any other map.
	 */
	const sightReach = $derived(
		battle && map.sight != null ? (map.sight / map.cellFeet) * cell : null
	);
	/**
	 * Where those tokens are drawn right now, in a hand or where they stand:
	 * the fog opens around each. What comes into sight of one that is being
	 * carried arrives when it is put down.
	 */
	const eyes = $derived(sightReach === null ? [] : tokens.filter(isEye).map(spotOf));

	// The fog the GM lays by hand, and the brush it is painted with, as the brush has them.
	const brushing = $derived(brush.brushing);
	const reach = $derived(brush.reach);
	const fog = $derived(brush.drawn);
	const brushAt = $derived(brush.at);

	const selectedTokens = $derived(
		selecting ? tokens.filter((t) => selectedIds.includes(t.id)) : []
	);
	const selectedDrawings = $derived(
		selecting ? drawings.filter((d) => selectedIds.includes(d.id)) : []
	);
	/**
	 * The markers of a world map selected together: a box was dragged around
	 * them, or they were clicked with Shift held. Dragging one moves them
	 * all, and their buttons float under them.
	 */
	const selectedMarkers = $derived(
		!battle && !passive ? markers.filter((m) => selectedIds.includes(m.id)) : []
	);
	const pickedMarkerIds = $derived(new Set(selectedMarkers.map((m) => m.id)));

	/** Where a marker is drawn: in this person's hand if it is in it, or where it stands. */
	const markerSpot = (marker: Marker): Point => inHandAt(marker.id) ?? [marker.x, marker.y];

	/** The world markers among the ones selected together: what the GM hides, and says who sees. */
	const selectedPins = $derived(selectedMarkers.filter((m) => m.kind === 'world'));

	/**
	 * The token that wears handles to turn and resize it by: the only one
	 * selected, as long as it isn't locked or being carried.
	 */
	const handled = $derived(
		selectedTokens.length === 1 && canGrabToken(selectedTokens[0]) && !carry?.held
			? selectedTokens[0]
			: null
	);
	/**
	 * How far beyond a token's rim its handles stand, on screen: the dots that
	 * resize it just clear of it, so a small token isn't lost under them, and
	 * the one that turns it clear of those.
	 */
	const sizeReach = $derived(4 * grip);
	const turnReach = $derived(26 * grip);

	function tokenAt(target: Element): Token | null {
		const id = target.closest<HTMLElement>('[data-token-id]')?.dataset.tokenId;
		return tokens.find((t) => t.id === id) ?? null;
	}

	function drawingAt(target: Element): Drawing | null {
		const id = target.closest<HTMLElement | SVGElement>('[data-drawing-id]')?.dataset.drawingId;
		return drawings.find((d) => d.id === id) ?? null;
	}

	/**
	 * Where a press is aiming: the middle of the cell under it, or with Alt
	 * held, the exact spot. A world map has no cells to aim at.
	 */
	function aim(e: PointerEvent): Point {
		const at = clamped(toMap(e.clientX, e.clientY));
		return e.altKey || !battle ? at : snapToGrid(map, at);
	}

	// What a tool was in the middle of is put away with the tool.
	$effect(() => {
		if (tool !== 'measure') ruler.putAway();
		if (tool !== 'sketch') pen.stroke = null;
		if (tool !== 'select') marquee = null;
		if (tool !== 'template') pen.casting = null;
		if (tool !== 'reveal' && tool !== 'cover') brush.sweep = null;
		if (tool !== 'align') aligning = null;
		if (tool !== 'point') pointer.at = null;
		if (tool !== 'draw') {
			outlines.clear();
			cursor = null;
		}
	});

	// ------------------------------------------------------------ selecting

	/** A box was dragged: whatever it touches is selected, or with `add`, selected as well. */
	function catchIn(box: [Point, Point], add: boolean) {
		const caught = caughtIn(board, box, canGrabMarker);
		selectedIds = add ? [...new Set([...selectedIds, ...caught])] : caught;
		selectedMarkerId = null;
		selectedRegionId = null;
		if (caught.length) ondone();
	}

	/**
	 * Puts away whatever box is out beside what is selected: a label being
	 * typed, the marks, the players of a secret. True if one was.
	 */
	export function shut(): boolean {
		return !!overlays?.shut();
	}

	/**
	 * Selects everything there is to select: the tokens and drawings of a
	 * battle map, the markers of a world map that are this person's to move.
	 */
	function selectAll() {
		selectedIds = battle
			? [...tokens.map((token) => token.id), ...drawings.map((drawing) => drawing.id)]
			: markers.filter(canGrabMarker).map((marker) => marker.id);
		selectedMarkerId = null;
		selectedRegionId = null;
	}

	/** Which way each arrow key goes, in cells. */
	const STEPS: Record<string, Point> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	/**
	 * Walks the tokens selected one cell that way, each coming down on the
	 * grid. False when none of them is there to be moved. `held` says the key
	 * is being held down: a press is one step.
	 */
	function walk([dx, dy]: Point, held: boolean): boolean {
		const movers = selectedTokens.filter(canGrabToken);
		if (movers.length === 0) return false;
		if (held) return true;
		const moves: Command[] = [];
		for (const token of movers) {
			const next: Point = [token.x + (dx * cell) / W, token.y + (dy * cell) / H];
			// At the edge of the map they all stay put, so that a group keeps its shape.
			if (!inside(next)) return true;
			const [x, y] = snapToGrid(map, next, token.size);
			moves.push({ t: 'token.update', id: token.id, changes: { x, y } });
		}
		send(moves);
		return true;
	}

	/** Where on the map a spot of the screen is, or null when it is off the map. */
	export function spotAt(clientX: number, clientY: number): Point | null {
		if (!stage.viewport) return null;
		const rect = stage.viewport.getBoundingClientRect();
		if (clientX < rect.left || clientX > rect.right) return null;
		if (clientY < rect.top || clientY > rect.bottom) return null;
		const at = toMap(clientX, clientY);
		return inside(at) ? at : null;
	}

	/** The spot of the map in the middle of the view, or the nearest spot that is on the map. */
	export function middle(): Point {
		return clamped([(cw / 2 - view.x) / (view.k * W), (ch / 2 - view.y) / (view.k * H)]);
	}

	function boundsOf(points: Point[]) {
		const xs = points.map((p) => p[0]);
		const ys = points.map((p) => p[1]);
		const x0 = Math.min(...xs);
		const x1 = Math.max(...xs);
		const y0 = Math.min(...ys);
		const y1 = Math.max(...ys);
		return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, area: (x1 - x0) * (y1 - y0) };
	}

	const pointsOf = outlines.pointsOf;

	/** Where a region's name goes: the middle of its outline, kept on screen. */
	const labelSpot = (points: Point[]) => nameSpot(frame, points);

	// -------------------------------------------------------------- the view

	/** Zooms into a region until it fills the screen. Used just before stepping inside. */
	export function flyTo(region: Region) {
		return stage.flyInto(region.points);
	}

	/** Back to the whole map, for when a transition was started but didn't complete. */
	export function reset() {
		stage.reset();
	}

	/** Brings a spot of the map to the middle of the screen, as close up as it is now. */
	export function centreOn(spot: Point) {
		stage.centreOn(spot);
	}

	// Fit the map when it first appears, and play an arrival when it changes:
	// going deeper zooms in out of the region you entered, going back up
	// pulls away.
	let shown = { key: '', id: '', depth: 0 };
	$effect(() => {
		const key = `${map.id}:${W}x${H}`;
		if (cw === 0 || ch === 0) return;
		untrack(() => {
			if (key === shown.key) {
				// Same map, new space around it (a panel opened, the window
				// resized). Follow along unless the user has their own view.
				if (stage.fitting && !stage.moving) stage.view = stage.fitted();
				return;
			}
			stage.fitting = true;
			const target = stage.fitted();
			if (shown.id === '' || shown.id === map.id) {
				stage.stopAnimation();
				stage.view = target;
			} else {
				const scale = depth >= shown.depth ? 0.6 : 1.5;
				stage.view = {
					k: target.k * scale,
					x: cw / 2 - (cw / 2 - target.x) * scale,
					y: ch / 2 - (ch / 2 - target.y) * scale
				};
				stage.fadeWorld(0, 1, 350);
				stage.animateTo(target, 450);
			}
			if (shown.id !== map.id) {
				// Whatever a tool was in the middle of belonged to the map that was left.
				clearHover();
				hand.now = null;
				shaper.now = null;
				ruler.putAway();
				pen.stroke = null;
				pen.inked = [];
				pen.casting = null;
				pen.cast = [];
				pen.writing = null;
				marquee = null;
				brush.sweep = null;
				brush.sent = null;
				aligning = null;
				pointer.at = null;
			}
			shown = { key, id: map.id, depth };
			ready = true;
		});
	});

	// ------------------------------------------------------------- gestures

	const pointers = new Map<number, { x: number; y: number }>();
	/** What the press that is under way has turned into. */
	let gesture: Gesture | null = null;
	let lastTap = {
		at: 0,
		x: 0,
		y: 0,
		regionId: null as string | null,
		/** The token or drawing that was tapped, on a battle map. */
		thingId: null as string | null
	};

	/**
	 * Hover follows whatever is under the mouse right now. A marker sits
	 * above the region it stands in, so hovering one never lights the region.
	 */
	function trackHover(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		const target = e.target as Element;
		const markerId = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId ?? null;
		hoveredMarkerId = markerId;
		hoveredRegionId = markerId
			? null
			: (target.closest<SVGElement>('[data-region-id]')?.dataset.regionId ?? null);
	}

	function clearHover() {
		cursor = null;
		hoveredMarkerId = null;
		hoveredRegionId = null;
	}

	// ------------------------------------------------------ hands and pings

	// Whenever a token is picked up, carried or put down, the ruler moves,
	// or the pointer does while it is pointing, the table is told what this
	// person has in hand. With nothing in it there is nothing to tell, and
	// where the mouse is stays here.
	$effect(() => {
		void [map.id, ready, carry, measure, pointing];
		untrack(() => onhand(stage.viewport && ready ? inHand.mine() : null));
	});

	$effect(() => () => onhand(null));

	function markerAt(target: Element): Marker | null {
		const id = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId;
		return markers.find((m) => m.id === id) ?? null;
	}

	// A press, a drag and a release: each is looked at here, and handed to
	// the tool whose it is. What that tool is in the middle of is its own to
	// keep. The gesture under way says which tool that is.

	function onpointerdown(e: PointerEvent) {
		trackHover(e);
		if (e.pointerType === 'mouse') {
			if (e.button !== 0 && e.button !== 1) return;
			pointers.clear();
		}
		stage.stopAnimation();
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		// The middle button moves the map and does nothing else, whatever tool
		// is in hand and whatever is under the pointer.
		if (e.pointerType === 'mouse' && e.button === 1) {
			e.preventDefault();
			handing = true;
			gesture = {
				type: 'pan',
				sx: e.clientX,
				sy: e.clientY,
				vx: view.x,
				vy: view.y,
				moved: false,
				hand: true,
				target: e.target as Element
			};
			return;
		}

		if (pointers.size === 2) {
			// A second finger makes it a pinch, and drops whatever the first one held.
			if (carry?.held) hand.now = null;
			if (shaping?.held) shaper.now = null;
			ruler.putAway();
			pen.stroke = null;
			pen.casting = null;
			marquee = null;
			brush.sweep = null;
			aligning = null;
			pointer.at = null;
			const mid = stage.midpoint(pointers);
			gesture = {
				type: 'pinch',
				distance: mid.distance,
				k: view.k,
				wx: (mid.x - view.x) / view.k,
				wy: (mid.y - view.y) / view.k
			};
			return;
		}
		if (pointers.size > 2) return;

		const target = e.target as Element;
		// A corner of the selected region, or the dot in the middle of one of
		// its edges: the region is reshaped from here.
		const corner = selectedRegion && outlines.press(selectedRegion, target, e);
		if (corner) {
			gesture = corner;
			return;
		}

		// One of the handles on the selected token: it is turned or resized
		// from here until the pointer lets go.
		const handle = handled && target.closest<HTMLElement>('[data-handle]');
		if (handle && handled) {
			gesture = shaper.press(handled, handle, e);
			dragging = true;
			return;
		}

		if (tool === 'measure') {
			gesture = ruler.press(e);
			return;
		}

		if (tool === 'sketch') {
			gesture = pen.pressSketch(e);
			return;
		}

		if (tool === 'template') {
			gesture = pen.pressTemplate(e);
			return;
		}

		if (tool === 'select') {
			const at = toMap(e.clientX, e.clientY);
			marquee = [at, at];
			gesture = { type: 'marquee', add: e.shiftKey };
			stage.capture(e.pointerId);
			return;
		}

		if (tool === 'reveal' || tool === 'cover') {
			gesture = brush.press(tool, e);
			return;
		}

		if (tool === 'align') {
			const at = clamped(toMap(e.clientX, e.clientY));
			aligning = [at, at];
			gesture = { type: 'align' };
			stage.capture(e.pointerId);
			return;
		}

		// With the pointing tool, a press is the start of pointing: the table
		// is shown where the pointer is until it is let go.
		if (tool === 'point' && !passive) {
			gesture = pointer.press(e);
			return;
		}

		// A token or a drawing that is this person's to move is picked up.
		// Anything else is part of the map: pressing it pans, clicking it
		// selects it. With Shift held a click adds to the selection, so
		// nothing is picked up then either.
		const thing = selecting ? (tokenAt(target) ?? drawingAt(target)) : null;
		if (thing && canGrab(thing) && !e.shiftKey) {
			const grab = hand.pickUp(thing, e, target);
			gesture = grab;
			pointer.awaitPing(e, grab);
			return;
		}

		// On a world map, one of the markers selected together is picked up
		// with the rest of them. Any other marker is part of the map.
		const pin = tool === 'pan' && !e.shiftKey ? markerAt(target) : null;
		if (pin && pickedMarkerIds.has(pin.id) && canGrabMarker(pin)) {
			const grab = hand.pickUpMarkers(pin, e, target);
			gesture = grab;
			pointer.awaitPing(e, grab);
			return;
		}

		const pan: GestureOf<'pan'> = {
			type: 'pan',
			sx: e.clientX,
			sy: e.clientY,
			vx: view.x,
			vy: view.y,
			moved: false,
			target
		};
		gesture = pan;
		pointer.awaitPing(e, pan);
	}

	function onpointermove(e: PointerEvent) {
		// The outline being drawn and the ring of the fog's brush follow the mouse.
		if ((tool === 'draw' || brushing) && e.pointerType === 'mouse') {
			cursor = toMap(e.clientX, e.clientY);
		}
		// The end of a ruler being laid follows the mouse between clicks.
		if (!pointers.has(e.pointerId)) ruler.hover(e);
		trackHover(e);

		const down = pointers.get(e.pointerId);
		if (!down) return;
		// The button came up somewhere this element never heard about.
		if (e.pointerType === 'mouse' && e.buttons === 0) return release(e, false);
		down.x = e.clientX;
		down.y = e.clientY;

		const g = gesture;
		if (g?.type === 'pinch' && pointers.size >= 2) {
			const mid = stage.midpoint(pointers);
			stage.fitting = false;
			const k = Math.min(stage.maxK, Math.max(stage.minK, (g.k * mid.distance) / g.distance));
			stage.view = stage.bounded({ k, x: mid.x - g.wx * k, y: mid.y - g.wy * k });
		} else if (g?.type === 'pan') {
			const dx = e.clientX - g.sx;
			const dy = e.clientY - g.sy;
			if (!g.moved && Math.hypot(dx, dy) > dragSlack(e)) {
				// Capture only once a drag is certain. Capturing on press
				// would swallow the hover state of whatever was pressed.
				g.moved = true;
				stage.fitting = false;
				dragging = true;
				stage.capture(e.pointerId);
			}
			if (g.moved) stage.view = stage.bounded({ k: view.k, x: g.vx + dx, y: g.vy + dy });
		} else if (g?.type === 'vertex') {
			outlines.drag(g, e);
		} else if (g?.type === 'grab') {
			if (hand.drag(g, e)) dragging = true;
		} else if (g?.type === 'shape') {
			shaper.drag(g, e);
		} else if (g?.type === 'measure') {
			ruler.drag(g, e);
		} else if (g?.type === 'sketch') {
			pen.dragSketch(e);
		} else if (g?.type === 'template') {
			pen.dragTemplate(e);
		} else if (g?.type === 'marquee' && marquee) {
			marquee = [marquee[0], toMap(e.clientX, e.clientY)];
		} else if (g?.type === 'sweep') {
			brush.drag(e);
		} else if (g?.type === 'align' && aligning) {
			aligning = [aligning[0], clamped(toMap(e.clientX, e.clientY))];
		} else if (g?.type === 'point') {
			pointer.drag(g, e);
		}
	}

	function release(e: PointerEvent, completed: boolean) {
		if (!pointers.delete(e.pointerId)) return;
		const g = gesture;

		if (g?.type === 'pinch') {
			// One finger is still down: carry on as a pan from where it is.
			const rest = [...pointers.values()][0];
			gesture = rest
				? {
						type: 'pan',
						sx: rest.x,
						sy: rest.y,
						vx: view.x,
						vy: view.y,
						moved: true,
						target: stage.surface!
					}
				: null;
			return;
		}

		gesture = null;
		dragging = false;
		handing = false;
		if (g?.type === 'pan' && !g.moved && !g.pinged && !g.hand && completed) tap(e, g.target);
		if (g?.type === 'measure') ruler.lift(g, e, completed);
		if (g?.type === 'template') pen.liftTemplate(completed);
		if (g?.type === 'sketch') pen.liftSketch(completed);
		if (g?.type === 'marquee') {
			const box = marquee;
			marquee = null;
			if (box && completed) catchIn(box, g.add);
		}
		if (g?.type === 'sweep') brush.lift(g, completed);
		if (g?.type === 'point') pointer.lift(g, e, completed);
		if (g?.type === 'align') {
			const box = alignBox;
			aligning = null;
			// A box too small to have been meant is a click: the one before it stays.
			const meant =
				box && (box[2] - box[0]) * W * view.k >= 8 && (box[3] - box[1]) * H * view.k >= 8;
			if (box && meant && completed) onalign(box);
		}
		if (g?.type === 'grab') {
			// Pressed and let go where it was, it was a click on it.
			if (!g.moved) {
				if (completed && !g.pinged) tap(e, g.target);
			} else {
				hand.lift(completed);
			}
		}
		if (g?.type === 'shape') shaper.lift(g, e, completed);
		if (g?.type === 'vertex') outlines.lift(g, completed);
	}

	// Once the server's version of a reshaped region arrives, drop the local one.
	$effect(() => {
		void selectedRegion?.points;
		untrack(() => {
			if (gesture?.type !== 'vertex') outlines.reshape = null;
		});
	});

	function tap(e: PointerEvent, target: Element) {
		const point = toMap(e.clientX, e.clientY);
		const now = performance.now();
		const double =
			now - lastTap.at < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28;

		// With Alt held, a click points the spot out to the table and does
		// nothing else, whatever is under it.
		if (e.altKey && tool === 'pan' && !passive) {
			pointer.ping(e.clientX, e.clientY);
			return;
		}

		if (tool === 'place') {
			if (inside(point)) onplace(point[0], point[1]);
			return;
		}

		if (tool === 'draw') {
			outlines.tap(e, point);
			return;
		}

		if (tool === 'text') {
			if (inside(point)) pen.write(null, point);
			return;
		}

		const thing = selecting ? (tokenAt(target) ?? drawingAt(target)) : null;
		if (thing) {
			const again = double && lastTap.thingId === thing.id;
			if (e.shiftKey) {
				// With Shift, a click adds to what is selected, or takes away from it.
				selectedIds = selectedIds.includes(thing.id)
					? selectedIds.filter((id) => id !== thing.id)
					: [...selectedIds, thing.id];
			} else if (again && !isToken(thing) && thing.kind === 'text' && canGrabDrawing(thing)) {
				// Twice on a text opens it to be reworded.
				selectedIds = [];
				pen.write(thing);
			} else {
				const only = selectedIds.length === 1 && selectedIds[0] === thing.id;
				selectedIds = only ? [] : [thing.id];
			}
			selectedMarkerId = null;
			selectedRegionId = null;
			lastTap = { at: now, x: e.clientX, y: e.clientY, regionId: null, thingId: thing.id };
			return;
		}

		const markerId = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId;
		if (markerId) {
			const marker = markers.find((m) => m.id === markerId);
			if (e.shiftKey && !battle && !passive && marker && canGrabMarker(marker)) {
				// With Shift, a click adds a marker to the ones selected together,
				// or takes it away from them. One whose card was pinned is the
				// first of them.
				const pinned = markers.find((m) => m.id === selectedMarkerId && m.id !== markerId);
				const had =
					pinned && canGrabMarker(pinned) && !selectedIds.includes(pinned.id)
						? [...selectedIds, pinned.id]
						: selectedIds;
				selectedIds = had.includes(markerId)
					? had.filter((id) => id !== markerId)
					: [...had, markerId];
				selectedMarkerId = null;
				selectedRegionId = null;
				lastTap.at = 0;
				return;
			}
			selectedMarkerId = selectedMarkerId === markerId ? null : markerId;
			selectedRegionId = null;
			selectedIds = [];
			lastTap.at = 0;
			return;
		}

		const regionId = target.closest<SVGElement>('[data-region-id]')?.dataset.regionId ?? null;
		const region = regions.find((r) => r.id === regionId);
		selectedMarkerId = null;
		if (!e.shiftKey) selectedIds = [];

		if (region && double && lastTap.regionId === region.id) {
			lastTap.at = 0;
			hoveredRegionId = null;
			selectedRegionId = null;
			onenter(region);
			return;
		}
		// The same goes for a bare spot of a world map: twice, and a note starts
		// there. A battle map takes no notes.
		if (!battle && !region && double && lastTap.regionId === null && inside(point)) {
			lastTap.at = 0;
			selectedRegionId = null;
			onnote(point[0], point[1]);
			return;
		}
		selectedRegionId = region && canShape ? region.id : null;
		// Touch has no hover, so the first tap is what names the region.
		if (e.pointerType !== 'mouse') hoveredRegionId = region?.id ?? null;
		lastTap = {
			at: now,
			x: e.clientX,
			y: e.clientY,
			regionId: region?.id ?? null,
			thingId: null
		};
	}

	// The keys of the map itself: what is selected on it, what a tool is in
	// the middle of, and the view. The page listens first, for the tools and
	// everything around the map, and a key it took is not pressed twice.
	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		if (e.target instanceof Element && e.target.closest('dialog')) return;
		// In a text field, a letter is a letter.
		if (isTyping(e.target)) return;
		if (pressed(chord(e), e)) e.preventDefault();
	}

	/** Does what a key does on the map as it stands. True if it was one of the map's. */
	function pressed(key: string, e: KeyboardEvent): boolean {
		const held = e.repeat;
		const remove = key === KEY.remove || key === 'Backspace';
		// Delete takes off the map whatever is selected on it.
		if (selecting && selectedIds.length && remove) {
			if (!held) overlays?.removeSelection();
			return true;
		}
		// The same for the markers selected together on a world map.
		if (selectedMarkers.length && tool === 'pan' && remove) {
			if (!held) overlays?.removeMarkers();
			return true;
		}
		// A ruler being laid along a road: Enter ends it, Backspace takes a bend back.
		if (tool === 'measure' && routing && (key === 'Enter' || key === 'Backspace')) {
			if (key === 'Enter') ruler.endRoute();
			else ruler.unbend();
			return true;
		}
		// A region being drawn: Enter closes it, Backspace takes a corner back.
		if (tool === 'draw' && key === 'Enter' && draft.length >= 3) {
			outlines.finish();
			return true;
		}
		if (tool === 'draw' && key === 'Backspace') {
			outlines.back();
			return true;
		}

		if (tool === 'pan' && !passive) {
			if (key === KEY.selectAll) {
				if (!held) selectAll();
				return true;
			}
			// What is selected on a battle map: the arrows walk its tokens, and
			// every button under it has a key.
			if (selecting && selectedIds.length) {
				const step = STEPS[key];
				if (step && !usesArrows(e.target) && walk(step, held)) return true;
				if (overlays?.barKey(key, held)) return true;
			}
			// A marker with its card pinned: the buttons on the card.
			if (overlays?.cardKey(key, held)) return true;
			// Markers selected together are hidden and revealed together, and
			// who sees them is said for all of them at once.
			if (key === KEY.hide && canShape && selectedPins.length) {
				if (!held) overlays?.hideMarkers();
				return true;
			}
			if (key === KEY.share && canShape && selectedPins.length) {
				if (!held) onmarkervisibility(selectedPins);
				return true;
			}
		}

		// The view: the arrows move the map, plus and minus zoom, zero fits it.
		// Wherever the focus is, unless the arrows have a job of their own there.
		const move = STEPS[key];
		if (move) {
			if (usesArrows(e.target)) return false;
			stage.fitting = false;
			stage.stopAnimation();
			stage.view = stage.bounded({ k: view.k, x: view.x - move[0] * 80, y: view.y - move[1] * 80 });
			return true;
		}
		if (key === KEY.zoomIn || key === '=') stage.zoomBy(1.6);
		else if (key === KEY.zoomOut) stage.zoomBy(1 / 1.6);
		else if (key === KEY.fit) stage.fit();
		else return false;
		return true;
	}

	// Wheel listeners added through the template can be passive, and a
	// passive listener can't stop the page from scrolling.
	$effect(() => {
		const element = stage.surface;
		if (!element) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			if (brushing && e.shiftKey) {
				// With Shift held, some browsers turn the wheel on its side.
				const turned = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : 1);
				fogSize = brushSize(fogSize * Math.exp(-turned * 0.0016));
				return;
			}
			stage.stopAnimation();
			stage.fitting = false;
			const rect = stage.viewport!.getBoundingClientRect();
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			// Trackpad pinches arrive as small ctrl+wheel deltas.
			const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016));
			stage.view = stage.zoomedAt(e.clientX - rect.left, e.clientY - rect.top, view.k * factor);
		};
		element.addEventListener('wheel', onwheel, { passive: false });
		return () => element.removeEventListener('wheel', onwheel);
	});

	/**
	 * A token with the focus: Enter selects it, the arrow keys walk it a cell
	 * at a time. One that is selected is walked with the rest of what is,
	 * by the keys of the map.
	 */
	function tokenKey(e: KeyboardEvent, token: Token) {
		// On a table display nothing is picked up or moved.
		if (passive) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			const only = selectedIds.length === 1 && selectedIds[0] === token.id;
			selectedIds = only ? [] : [token.id];
			return;
		}
		const steps: Record<string, Point> = {
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0],
			ArrowUp: [0, -1],
			ArrowDown: [0, 1]
		};
		const step = steps[e.key];
		if (!step || !canGrabToken(token) || selectedIds.includes(token.id)) return;
		e.preventDefault();
		if (e.repeat) return;
		const next: Point = [token.x + (step[0] * cell) / W, token.y + (step[1] * cell) / H];
		if (!inside(next)) return;
		const [x, y] = snapToGrid(map, next, token.size);
		send([{ t: 'token.update', id: token.id, changes: { x, y } }]);
	}

</script>

<svelte:window {onkeydown} />

<div
	class="relative h-full w-full overflow-hidden bg-[#0b0d12] bg-[radial-gradient(ellipse_at_center,#1a2030_0%,#0b0d12_75%)]"
	bind:this={stage.viewport}
	bind:clientWidth={stage.cw}
	bind:clientHeight={stage.ch}
>
	<!-- The map is a custom widget: it takes focus so it can be panned and zoomed from the keyboard. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class={[
			'absolute inset-0 touch-none select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2',
			handing
				? 'cursor-grabbing'
				: tool === 'text'
					? 'cursor-text'
					: tool !== 'pan'
						? 'cursor-crosshair'
						: dragging
							? 'cursor-grabbing'
							: 'cursor-grab'
		]}
		data-tool={tool}
		style:cursor={tool === 'point' && !passive && !handing
			? pointing
				? 'none'
				: POINT_CURSOR
			: undefined}
		bind:this={stage.surface}
		role="application"
		aria-label="Map of {map.name}. Arrow keys pan, plus and minus zoom, zero fits the map."
		tabindex="0"
		{onpointerdown}
		{onpointermove}
		onmousedown={(e) => {
			// The middle button moves the map: the browser's own scrolling by it stays out of it.
			if (e.button === 1) e.preventDefault();
		}}
		onpointerup={(e) => release(e, true)}
		onpointercancel={(e) => release(e, false)}
		onpointerleave={clearHover}
	>
		<!-- Everything inside scales with the map. --inv undoes that scale, for
		     the things that should stay the same size on screen: scale-(--inv). -->
		<div
			class={['absolute top-0 left-0 origin-top-left', !ready && 'invisible']}
			bind:this={stage.world}
			style:width="{W}px"
			style:height="{H}px"
			style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
			style:--inv={1 / view.k}
		>
			<MapPicture {map} {source} {borrowed} {blownUp} {image} {battle} {view} {cw} {ch} />

			{#if battle}
				<BattleInk
					{W}
					{H}
					{cell}
					{view}
					{gridLines}
					{templates}
					{lines}
					{texts}
					cast={pen.cast}
					{casted}
					inked={pen.inked}
					stroke={pen.stroke}
					{ink}
					{shape}
					{selecting}
					{selectedIds}
					{grip}
					{writing}
					carrying={!!carry?.held}
					{shiftOf}
					{canGrabDrawing}
					{templateSize}
				/>
			{/if}

			<MapLines
				{orderedRegions}
				{pointsOf}
				{tool}
				{fresh}
				{draft}
				{cursor}
				{view}
				{W}
				{H}
				{canShape}
				{selectedRegion}
				{selectedRegionId}
				{hoveredRegionId}
				{grip}
				{rulers}
				{alignBox}
				{marquee}
			/>

			<RegionNames
				{orderedRegions}
				{labelSpot}
				{pointsOf}
				{litRegionId}
				{canShape}
				{passive}
				{W}
				{H}
				{players}
				onheight={(id, tall) => (nameHeights[id] = tall)}
			/>

			<BattleTokens
				{battle}
				{tokens}
				{spotOf}
				{canGrabToken}
				{passive}
				{carry}
				{selecting}
				{selectedIds}
				{sizeOf}
				{turnOf}
				{cell}
				{W}
				{H}
				{caughtIds}
				{turnId}
				{tool}
				{userId}
				{canShape}
				{map}
				{handled}
				{shaping}
				{turnReach}
				{sizeReach}
				{view}
				{units}
				{tokenKey}
				handleKey={shaper.handleKey}
			/>

			<FogLayer
				{fog}
				{brushAt}
				{battle}
				{W}
				{H}
				{canShape}
				{reach}
				{tool}
				{fogShape}
				{sightReach}
				{eyes}
			/>

			<MapPins
				{orderedMarkers}
				{pickedMarkerIds}
				bind:selectedMarkerId
				bind:hoveredMarkerId
				{active}
				{markerSpot}
				{tool}
				carrying={!!carry?.held}
				{W}
				{H}
				{canShape}
				{fresh}
			/>

			<TableSigns {pings} {tintOf} {passive} {pointed} {rulers} {W} {H} />
		</div>
	</div>

	<MapOverlays
		bind:this={overlays}
		{map}
		{role}
		{userId}
		{players}
		{canShape}
		{passive}
		{tool}
		{battle}
		{shape}
		{frame}
		{view}
		{W}
		{H}
		{cell}
		{active}
		bind:selectedMarkerId
		bind:selectedIds
		{tokens}
		{selectedTokens}
		{selectedDrawings}
		{insideSelected}
		{selectedMarkers}
		{selectedPins}
		{selectedRegion}
		{handled}
		{markerSpot}
		{spotOf}
		{shiftOf}
		{marquee}
		{grip}
		{turnReach}
		{nameHeights}
		{stage}
		{hand}
		{shaper}
		{pen}
		{outlines}
		{ruler}
		{brush}
		{send}
		{onedit}
		{onmove}
		{ondelete}
		{onhide}
		{onmarkervisibility}
		{onedittoken}
		{onpiecevisibility}
		{regionBar}
	/>
</div>
