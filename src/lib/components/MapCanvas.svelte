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
	import { devicePixelRatio } from 'svelte/reactivity/window';
	import { KEY, ariaKey, chord, isTyping, keyLabel, usesArrows } from '#lib/client/keys.ts';
	import { frameOf } from '#lib/shared/backdrop.ts';
	import {
		boxOf,
		capped,
		linePath,
		templateBox,
		templateHolds,
		templatePath,
		templateSpan,
		thinOut,
		touchesBox
	} from '#lib/shared/drawing.ts';
	import {
		boxed,
		brushMarks,
		brushReach,
		brushSize,
		marked,
		stampPath,
		sweepPath
	} from '#lib/shared/fog.ts';
	import {
		cellsToFeet,
		feetAlong,
		feetCount,
		milesAlong,
		milesCount,
		pixelsToFeet,
		sitsOnCorner,
		snapToGrid,
		snapToHalfCell,
		templatePoints,
		travelTime
	} from '#lib/shared/grid.ts';
	import {
		canChangeDrawing,
		canEditMarkerKind,
		canEditWorld,
		canMoveToken,
		canRemoveMarker
	} from '#lib/shared/rules.ts';
	import { tileLevelFor, tileLevels, tilesIn, type Tile } from '#lib/shared/tiles.ts';
	import {
		DRAWING_SIZE,
		FOG_BRUSH,
		LIMITS,
		ROTATION_STEP,
		MARK_LOOKS,
		TOKEN_SIZE_STEP,
		imageUrl,
		isTemplate,
		markerType,
		type Backdrop,
		type Command,
		type Drawing,
		type Fog,
		type FogMark,
		type Grid,
		type Hand,
		type HandSpot,
		type MapInfo,
		type MarkLook,
		type Marker,
		type Ping,
		type Player,
		type Point,
		type Rect,
		type Region,
		type Role,
		type TemplateKind,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import MarkerCard from './MarkerCard.svelte';
	import MarkIcon from './MarkIcon.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import ToolButton from './ToolButton.svelte';

	/** What this browser has in hand on the map in front of it. */
	type Holding = Omit<HandSpot, 'mapId'>;

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
		/** The GM is to say who sees these tokens. */
		ontokenvisibility?: (tokens: Token[]) => void;
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
		ontokenvisibility = () => {},
		onhand,
		onping
	}: Props = $props();

	interface View {
		x: number;
		y: number;
		k: number;
	}

	const PIN_HEIGHT = 44;

	let viewport = $state<HTMLDivElement>();
	let surface = $state<HTMLDivElement>();
	let world = $state<HTMLDivElement>();
	let cw = $state(0);
	let ch = $state(0);
	let view = $state.raw<View>({ x: 0, y: 0, k: 1 });
	let ready = $state(false);
	let dragging = $state(false);
	/** The middle button of a mouse is down: it moves the map, whatever tool is in hand. */
	let handing = $state(false);
	let hoveredMarkerId = $state<string | null>(null);
	let hoveredRegionId = $state<string | null>(null);
	let draft = $state<Point[]>([]);
	let cursor = $state<Point | null>(null);
	/** A region's corners while they are being changed, before the server confirms. */
	let reshape = $state<{ id: string; points: Point[] } | null>(null);
	let cardW = $state(0);
	let cardH = $state(0);
	let barW = $state(0);
	let barH = $state(0);
	let regionBarW = $state(0);
	let regionBarH = $state(0);
	/** How tall each region's name stands on screen, by the region's id: a long one runs to more lines. */
	const nameHeights = $state<Record<string, number>>({});
	let bar = $state<ReturnType<typeof SelectionBar>>();
	let card = $state<ReturnType<typeof MarkerCard>>();
	/**
	 * What this person has in hand: one token or drawing, or a whole
	 * selection picked up by one of its own, the `lead`. On a world map it
	 * is the markers selected together. `origins` is where
	 * each of them was when it was picked up (a drawing by its first point).
	 * `by` is how far the pointer has taken them, and `rest` how far they
	 * will have gone once let go: the lead token comes down on the grid, and
	 * the others keep their places around it. Once let go they wait here, no
	 * longer `held`, until the server has moved them for everyone.
	 */
	let carry = $state.raw<{
		lead: string;
		origins: Record<string, Point>;
		by: Point;
		rest: Point;
		/** Whether the lead is a token: then the way it has come is measured. */
		measured: boolean;
		held: boolean;
	} | null>(null);
	/**
	 * A token being turned or resized by one of its handles, and what it has
	 * come to so far. Once let go it waits here, no longer `held`, until the
	 * server has changed it for everyone. `at` is where it comes to rest then,
	 * if resizing it moved it. `swing` is how far round the token the pointer
	 * has taken the handle that turns it, in degrees: not in steps like the
	 * token's own turn, so the handle stays with the pointer.
	 */
	let shaping = $state.raw<{
		id: string;
		size?: number;
		rotation?: number;
		swing?: number;
		at?: Point;
		held: boolean;
	} | null>(null);
	/**
	 * A distance being measured with the ruler tool: the spots it runs
	 * through, the last of them under the pointer. Dragged, it has two. Laid
	 * along a road a click at a time, it bends at every click.
	 */
	let measure = $state.raw<Point[] | null>(null);
	/** The ruler is being laid a click at a time: its last spot follows the pointer until it is ended. */
	let routing = $state(false);
	/** When and where the last spot of such a ruler was clicked: twice in one place ends it. */
	let lastBend = { at: 0, x: 0, y: 0 };

	/** Ends a ruler laid a click at a time. It stays on the map to be read, until the next is begun. */
	function endRoute() {
		routing = false;
		if (!measure) return;
		// Its last spot was only ever under the pointer.
		const laid = measure.slice(0, -1);
		measure = laid.length >= 2 ? laid : null;
	}

	/** Takes back the last bend of a ruler being laid, or with none left, the ruler. */
	function unbend() {
		if (!measure) return;
		if (measure.length <= 2) {
			measure = null;
			routing = false;
		} else {
			measure = [...measure.slice(0, -2), measure[measure.length - 1]];
		}
	}
	/** A line being drawn, in map space, and the ones let go that the server hasn't answered for yet. */
	let stroke = $state.raw<Point[] | null>(null);
	let inked = $state.raw<{ points: Point[]; color: string }[]>([]);
	/**
	 * A template being dragged out: where the press began, where the pointer
	 * is, and whether Alt is keeping it off the grid.
	 */
	let casting = $state.raw<{ from: Point; to: Point; free: boolean } | null>(null);
	/** The templates let go that the server hasn't answered for yet. */
	let cast = $state.raw<{ kind: TemplateKind; points: [Point, Point]; color: string }[]>([]);
	/** The box being dragged around things to select them: one corner, and the other. */
	let marquee = $state.raw<[Point, Point] | null>(null);
	/** Where the GM has swept the brush over the fog so far, with its button still down. */
	let sweep = $state.raw<Point[] | null>(null);
	/**
	 * The fog as the GM last left it, until the server has it so for
	 * everyone: the next thing done to it is done to this.
	 */
	let fogSent = $state.raw<Fog | null>(null);
	/** What was done to the fog goes to the server one after the other: each is the whole of it. */
	let fogQueue: Promise<unknown> = Promise.resolve();
	/** The box the GM is dragging over the squares of the map's picture: one corner, and the other. */
	let aligning = $state.raw<[Point, Point] | null>(null);
	/**
	 * Where this person is pointing: where their pointer is on the map, for
	 * as long as they hold it down with the pointing tool in hand.
	 */
	let pointing = $state.raw<Point | null>(null);
	/** A text being typed onto the map: a new one, or with an `id`, one being reworded. */
	let writing = $state.raw<{ id: string | null; at: Point; color: string } | null>(null);
	/** What has been typed of it so far. Kept apart, so the box has it to the last. */
	let words = $state('');
	/** When the box for it opened. */
	let writingSince = 0;

	/**
	 * Puts the caret in the box the moment it is on the page. The map itself
	 * has the focus by then, from the click that asked for the box, and the
	 * browser only focuses a new field by itself when nothing else has it.
	 */
	function takeFocus(box: HTMLInputElement) {
		box.focus();
	}

	/** The box lost the focus: what is in it is kept, as if Enter had been pressed. */
	function leftBox(box: HTMLInputElement) {
		// A touch screen follows a tap with a click of its own, which can land
		// beside the box that the tap just opened. That is no reason to close it.
		if (!words && performance.now() - writingSince < 400) box.focus();
		else doneWriting(true);
	}

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
	const fitK = $derived(cw > 0 && ch > 0 ? Math.min(cw / W, ch / H) * 0.94 : 1);
	const minK = $derived(fitK * 0.5);
	// A picture is only so sharp, so the zoom stops at twice its own pixels.
	// A map without one is drawn fresh at any size.
	const maxK = $derived(image ? Math.max(fitK * 2, 2 / blownUp) : Math.max(fitK * 16, 4));

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

	/**
	 * Where a card goes for something at this spot of the map: `above` it by
	 * that many screen pixels when there is room, `below` it when there is not.
	 */
	function cardSpot([x, y]: Point, above: number, below: number, w: number, h: number) {
		const sx = x * W * view.k + view.x;
		const sy = y * H * view.k + view.y;
		if (sx < -30 || sx > cw + 30 || sy < -30 || sy > ch + above + 30) return null;
		const fits = sy - above - h >= 6;
		return {
			left: Math.min(Math.max(sx - w / 2, 8), Math.max(8, cw - w - 8)),
			top: fits ? sy - above - h : Math.min(sy + below, Math.max(6, ch - h - 6))
		};
	}

	const cardPosition = $derived(
		active && cardSpot([active.x, active.y], PIN_HEIGHT + 12, 12, cardW, cardH)
	);

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

	/** How far what is in hand has been taken: with the pointer while held, onto the grid once let go. */
	const carried = $derived(carry ? (carry.held ? carry.by : carry.rest) : null);

	/** Where something in this person's hand is right now, or null if it isn't in it. */
	function inHandAt(id: string): Point | null {
		const from = carry?.origins[id];
		return from && carried ? [from[0] + carried[0], from[1] + carried[1]] : null;
	}

	/** Where a token is drawn: in a hand if it is in one, or where it stands. */
	function spotOf(token: Token): Point {
		const resized = shaping?.id === token.id ? shaping.at : undefined;
		return inHandAt(token.id) ?? resized ?? heldByOthers.get(token.id) ?? [token.x, token.y];
	}

	/** How big a token is drawn, and which way round: as its handles have it, or as it is. */
	const sizeOf = (token: Token) =>
		(shaping?.id === token.id ? shaping.size : undefined) ?? token.size;
	const turnOf = (token: Token) =>
		(shaping?.id === token.id ? shaping.rotation : undefined) ?? token.rotation;

	/** How far from where it is kept a drawing is drawn, while it is in hand. */
	function shiftOf(drawing: Drawing): Point {
		const at = inHandAt(drawing.id);
		return at ? [at[0] - drawing.points[0][0], at[1] - drawing.points[0][1]] : [0, 0];
	}

	const lines = $derived(battle ? drawings.filter((d) => d.kind === 'line') : []);
	const texts = $derived(battle ? drawings.filter((d) => d.kind === 'text') : []);
	/** The templates laid on the map, each with the two points it is kept as, in the map's pixels. */
	const templates = $derived(
		battle
			? drawings.flatMap((drawing) => {
					const { kind, points } = drawing;
					if (!isTemplate(kind) || points.length !== 2) return [];
					const [a, b] = inPixels(points);
					return [{ drawing, kind, a, b }];
				})
			: []
	);
	/** The template being dragged out, as it will be kept: on the grid, unless Alt is held. */
	const casted = $derived(
		casting && templatePoints(map, shape, casting.from, casting.to, casting.free)
	);

	/**
	 * The tokens a template catches: the ones whose middle is inside it,
	 * wherever each is drawn right now. `a` and `b` are in the map's pixels.
	 * A hair of slack takes in a middle that sits right on the line.
	 */
	function tokensIn(kind: TemplateKind, a: Point, b: Point): Token[] {
		return tokens.filter((token) => {
			const [x, y] = spotOf(token);
			return templateHolds(kind, a, b, [x * W, y * H], cell * 0.02);
		});
	}

	/** The tokens inside the templates that are selected, wherever those are being carried. */
	const insideSelected = $derived.by(() => {
		if (!selecting) return [];
		const found = new Map<string, Token>();
		for (const { drawing, kind, a, b } of templates) {
			if (!selectedIds.includes(drawing.id)) continue;
			const [sx, sy] = shiftOf(drawing);
			const carried = ([x, y]: Point): Point => [x + sx * W, y + sy * H];
			for (const token of tokensIn(kind, carried(a), carried(b))) found.set(token.id, token);
		}
		return [...found.values()];
	});

	/**
	 * The tokens that light up as caught: inside the template being dragged
	 * out, or inside the ones selected while no token is. Only on this
	 * person's own screen.
	 */
	const caughtIds = $derived.by(() => {
		const ids = new Set<string>();
		if (selectedTokens.length === 0) for (const token of insideSelected) ids.add(token.id);
		if (casted) {
			const [a, b] = inPixels(casted);
			for (const token of tokensIn(shape, a, b)) ids.add(token.id);
		}
		return ids;
	});

	/** How big a template is, in words: "20 ft radius", "30 ft cone", "10 × 20 ft". */
	function templateSize(kind: TemplateKind, a: Point, b: Point): string {
		const feet = templateSpan(kind, a, b).map((pixels) => pixelsToFeet(map, pixels));
		if (kind === 'rect') return `${feet[0]} × ${feetCount(feet[1])}`;
		return `${feetCount(feet[0])} ${kind === 'circle' ? 'radius' : 'cone'}`;
	}

	/** Where the size of a template is written: its middle, or for a cone, half way along it. */
	function templateMiddle(kind: TemplateKind, a: Point, b: Point): Point {
		return kind === 'circle' ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	}

	/** The token whose turn it is, if it is one this person can see. */
	const turnId = $derived(battle ? map.turns.current : null);
	/**
	 * The pips a token wears on its rim, one for each of its marks but
	 * `down`: where round the rim each sits, in degrees clockwise from the
	 * top, and how big it is in fractions of the token. A pip with an icon is
	 * a little bigger than a plain one, to be made out. They sit side by side
	 * from the top right, and close up once there are more than fit round.
	 */
	function pipsOf(token: Token): { look: MarkLook; angle: number; size: number }[] {
		const looks = MARK_LOOKS.filter((look) => look.id !== 'down' && token.marks.includes(look.id));
		const wide = (look: MarkLook) => (look.icon ? 36 : 28);
		const all = looks.reduce((sum, look) => sum + wide(look), 0);
		const squeeze = Math.min(1, 350 / all);
		let at = 6;
		return looks.map((look) => {
			const takes = wide(look) * squeeze;
			at += takes;
			return { look, angle: at - takes / 2, size: look.icon ? 0.31 : 0.24 };
		});
	}

	/** Map space to the map's own pixels, where a line is drawn. */
	const inPixels = (points: Point[]): Point[] => points.map(([x, y]) => [x * W, y * H]);
	/** What goes around letters so they read on any map: dark around light ink, light around dark. */
	const haloOf = (color: string) => (color === '#12151c' ? '#fff8e4' : '#0c0e14');

	const isToken = (thing: Token | Drawing): thing is Token => !('points' in thing);
	/** A token is picked up by anyone, unless it is locked. */
	const canGrabToken = (token: Token) => canMoveToken(token);
	const canGrabDrawing = (drawing: Drawing) => canChangeDrawing(role, userId, drawing);
	const canGrab = (thing: Token | Drawing) =>
		isToken(thing) ? canGrabToken(thing) : canGrabDrawing(thing);
	const isMarker = (thing: Token | Drawing | Marker): thing is Marker => 'title' in thing;
	/** A marker is moved by whoever may change it: the GM any of them, a player the table's notes. */
	const canGrabMarker = (marker: Marker) => canEditMarkerKind(role, marker.kind);

	/** The hand is out on a battle map: what is on it can be selected and dragged. */
	const selecting = $derived(battle && tool === 'pan' && !passive);
	/** The GM has the fog's brush in hand: it paints as it is swept, and its outline shows what it reaches. */
	const brushing = $derived(tool === 'reveal' || tool === 'cover');
	/** The marks the brush in hand leaves, swept through these spots. */
	const sweptMarks = (cover: boolean, swept: Point[]) =>
		brushMarks(cover, swept, { width: W, height: H }, fogSize, fogShape === 'square');
	/** How far the brush reaches across the map and down it, in map space. */
	const reach = $derived(brushReach({ width: W, height: H }, fogSize));
	/** The fog as this person left it, the server's answer still to come or not. */
	const fogNow = $derived(fogSent ?? map.fog);
	/** The fog as it is drawn: with the sweep being made, as it will be once the brush is lifted. */
	const fog = $derived(
		sweep && brushing ? marked(fogNow, sweptMarks(tool === 'cover', sweep)) : fogNow
	);
	/** Where the outline of the brush is: under the pointer, kept on the map. */
	const brushAt = $derived.by((): Point | null => {
		if (!brushing) return null;
		if (cursor) return clamped(cursor);
		return sweep ? sweep[sweep.length - 1] : null;
	});

	/**
	 * Makes these marks on the fog. It shows at once, and is the fog the next
	 * marks are made on, whether or not the server has answered for these.
	 */
	function markFog(marks: FogMark[]) {
		const next = marked(fogNow, marks);
		// Fog that is off has nothing to clear, and comes back as it was.
		if (next === fogNow) return;
		fogSent = next;
		// The marks are said even when there are none: left unsaid, the server keeps the ones it has.
		const whole = { on: next.on, clear: next.clear, marks: next.marks ?? [] };
		fogQueue = fogQueue
			.then(() => send([{ t: 'map.update', id: map.id, fog: whole }]))
			.then(() => {
				if (fogSent === next) fogSent = null;
			});
	}
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

	/**
	 * Where the buttons for those markers float: under the lowest of them,
	 * or over the top of them all when that is too low on the screen.
	 */
	const markerBarPosition = $derived.by(() => {
		if (carry?.held || marquee || tool !== 'pan' || selectedMarkers.length === 0) return null;
		const box = boxOf(selectedMarkers.map(markerSpot));
		const sx = ((box.x0 + box.x1) / 2) * W * view.k + view.x;
		const top = box.y0 * H * view.k + view.y - PIN_HEIGHT;
		const bottom = box.y1 * H * view.k + view.y;
		if (sx < -30 || sx > cw + 30 || bottom < -30 || top > ch + 30) return null;
		const under = bottom + 8;
		const fits = under + barH <= ch - 6;
		return {
			left: Math.min(Math.max(sx - barW / 2, 8), Math.max(8, cw - barW - 8)),
			top: fits ? under : Math.max(6, top - 8 - barH),
			under: fits
		};
	});

	/**
	 * Where the buttons for the selected region float: right over its name,
	 * however big the region is. With no room up there they go under the
	 * name, clear of the line that says how to get in. A name that is off
	 * screen leaves them at the edge it went out by, for as long as some of
	 * the region is in sight. They are out of the way while a corner is in hand.
	 */
	const regionBarPosition = $derived.by(() => {
		if (!selectedRegion || tool !== 'pan' || reshape || selectedMarkers.length > 0) return null;
		const box = boxOf(selectedRegion.points);
		if (
			box.x1 * W * view.k + view.x < 0 ||
			box.x0 * W * view.k + view.x > cw ||
			box.y1 * H * view.k + view.y < 0 ||
			box.y0 * H * view.k + view.y > ch
		) {
			return null;
		}
		const [x, y] = labelSpot(selectedRegion.points);
		const sx = x * W * view.k + view.x;
		const sy = y * H * view.k + view.y;
		// The name is lettered around its spot: half of it is above, half below.
		const half = (nameHeights[selectedRegion.id] ?? 20) / 2;
		const over = sy - half - 6 - regionBarH;
		const above = over >= 6;
		const top = Math.min(
			Math.max(above ? over : sy + half + 24, 6),
			Math.max(6, ch - regionBarH - 6)
		);
		// The tooltips come out away from the name, where the screen has room for them.
		const tip = above ? top >= 64 : top + regionBarH + 64 > ch;
		return {
			left: Math.min(Math.max(sx - regionBarW / 2, 8), Math.max(8, cw - regionBarW - 8)),
			top,
			tip: tip ? ('top' as const) : ('bottom' as const)
		};
	});

	/** The world markers among the ones selected together: what the GM hides, and says who sees. */
	const selectedPins = $derived(selectedMarkers.filter((m) => m.kind === 'world'));

	/** Hides the selected world markers from the players, or with all of them hidden, shows them again. */
	function hideMarkers() {
		const pins = selectedMarkers.filter((m) => m.kind === 'world');
		const hidden = !pins.every((m) => m.hidden);
		send(
			pins
				.filter((m) => m.hidden !== hidden)
				.map((m) => ({ t: 'marker.update', id: m.id, changes: { hidden } }))
		);
	}

	/** Takes the selected markers off the map: all of them the GM's to take, a player's own notes theirs. */
	function removeMarkers() {
		const gone = selectedMarkers.filter((m) => canRemoveMarker(role, userId, m));
		if (!gone.length) return;
		selectedIds = [];
		send(
			gone.map((m) => ({ t: 'marker.delete', id: m.id })),
			gone.length === 1 ? `Deleted “${gone[0].title}”.` : `Deleted ${gone.length} markers.`
		);
	}

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

	/**
	 * Where the buttons for the selection float: just under it, in the middle,
	 * or over the top of it when it is too low on the screen for that.
	 */
	const barPosition = $derived.by(() => {
		if (carry?.held || shaping?.held || marquee || writing) return null;
		if (selectedTokens.length + selectedDrawings.length === 0) return null;
		const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
		const take = (x: number, y: number, rx: number, ry: number) => {
			box.x0 = Math.min(box.x0, x - rx);
			box.x1 = Math.max(box.x1, x + rx);
			box.y0 = Math.min(box.y0, y - ry);
			box.y1 = Math.max(box.y1, y + ry);
		};
		for (const token of selectedTokens) {
			const half = (sizeOf(token) * cell) / 2;
			take(...spotOf(token), half / W, half / H);
		}
		for (const drawing of selectedDrawings) {
			const [sx, sy] = shiftOf(drawing);
			const half = (drawing.size * cell) / 2;
			if (isTemplate(drawing.kind) && drawing.points.length === 2) {
				const [a, b] = inPixels(drawing.points);
				const box = templateBox(drawing.kind, a, b);
				take(box.x0 / W + sx, box.y0 / H + sy, 0, 0);
				take(box.x1 / W + sx, box.y1 / H + sy, 0, 0);
			} else if (drawing.kind === 'line') {
				const b = boxOf(drawing.points);
				take(b.x0 + sx, b.y0 + sy, half / W, half / H);
				take(b.x1 + sx, b.y1 + sy, half / W, half / H);
			} else {
				// A text starts at its point and runs to the right: about this far.
				const [x, y] = drawing.points[0];
				const long = (drawing.text.length * drawing.size * cell * 0.55) / W;
				take(x + sx, y + sy, 0, half / H);
				take(x + sx + long, y + sy, 0, half / H);
			}
		}
		// On screen: the middle of the selection, its top and its bottom.
		const sx = ((box.x0 + box.x1) / 2) * W * view.k + view.x;
		const top = box.y0 * H * view.k + view.y;
		const bottom = box.y1 * H * view.k + view.y;
		if (sx < -30 || sx > cw + 30 || bottom < -30 || top > ch + 30) return null;
		// A token's name is written under it, so the buttons go under that.
		const under = bottom + 6 + (selectedTokens.length ? 18 : 0);
		const fits = under + barH <= ch - 6;
		// With no room left down there they go over the top, clear of the
		// handle that turns a token.
		const clear = handled ? turnReach + 18 * grip : 0;
		return {
			left: Math.min(Math.max(sx - barW / 2, 8), Math.max(8, cw - barW - 8)),
			top: fits ? under : Math.max(6, top - 12 - clear - barH),
			under: fits
		};
	});

	interface Ruler {
		key: string;
		/** The spots it runs through: its two ends, and every bend between them. */
		points: Point[];
		/**
		 * "30 ft" on a battle map. On a world map "84 mi", and how long that is
		 * on the road: "about 3½ days". Empty where the map has no scale, and
		 * for a ruler that has gone nowhere yet.
		 */
		length: string;
		tint: string;
	}

	/** How long a way through these spots is, in words: feet on a battle map, miles and days on a world map. */
	function distance(points: Point[]): string {
		const [first] = points;
		if (points.every(([x, y]) => x === first[0] && y === first[1])) return '';
		if (battle) return feetCount(feetAlong(map, points));
		if (miles === null) return '';
		const far = milesAlong({ width: W, height: H }, miles, points);
		const long = travelTime(far, dayMiles);
		return long ? `${milesCount(far)} · ${long}` : milesCount(far);
	}

	/** Every distance being measured on this map right now: this person's, then everyone else's. */
	const rulers = $derived.by(() => {
		const drawn: Omit<Ruler, 'length'>[] = [];
		// Carrying a token measures how far it has come.
		if (carry?.held && carry.measured) {
			const from = carry.origins[carry.lead];
			const to: Point = [from[0] + carry.rest[0], from[1] + carry.rest[1]];
			drawn.push({ key: 'mine', points: [from, to], tint: '#fff' });
		} else if (measure) drawn.push({ key: 'mine', points: measure, tint: '#fff' });
		for (const other of hands) {
			if (!other.ruler || other.ruler.length < 2) continue;
			drawn.push({ key: other.id, points: other.ruler.map(clamped), tint: tintOf(other) });
		}
		return drawn.map((ruler): Ruler => ({ ...ruler, length: distance(ruler.points) }));
	});

	/** The first letters of a token's name, to write on it. */
	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	}

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

	// ---------------------------------------------------- turning and resizing

	/** How far a pointer is from the middle of a token, in the map's pixels. */
	function fromMiddle(token: Token, e: PointerEvent): Point {
		const [px, py] = toMap(e.clientX, e.clientY);
		const [x, y] = spotOf(token);
		return [(px - x) * W, (py - y) * H];
	}

	/** Which way that is, in degrees clockwise from straight up: the way a token's turn is counted. */
	const bearing = ([dx, dy]: Point) => (Math.atan2(dx, -dy) * 180) / Math.PI;

	/**
	 * What to ask of the server for a token that has been turned or resized,
	 * or null when it is as it was. A token an even number of cells across
	 * sits where four cells meet and any other in the middle of one, so going
	 * from one to the other shifts it half a cell to sit squarely again.
	 * `free` leaves it where it is.
	 */
	function reshaped(
		token: Token,
		to: { size?: number; rotation?: number },
		free = false
	): Partial<TokenInput> | null {
		const changes: Partial<TokenInput> = {};
		if (to.rotation !== undefined && to.rotation !== token.rotation) changes.rotation = to.rotation;
		if (to.size !== undefined && to.size !== token.size) {
			changes.size = to.size;
			if (!free && sitsOnCorner(to.size) !== sitsOnCorner(token.size)) {
				[changes.x, changes.y] = snapToGrid(map, [token.x, token.y], to.size);
			}
		}
		return Object.keys(changes).length ? changes : null;
	}

	/**
	 * A handle with the focus: the left and right arrow keys do what dragging
	 * it does, a step at a time. `side` is which side of the token a resize
	 * handle is on, so that the arrow pointing away from the token grows it.
	 */
	function handleKey(e: KeyboardEvent, token: Token, how: 'turn' | 'resize', side = 1) {
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		if (e.repeat) return;
		const changes = reshaped(
			token,
			how === 'turn'
				? { rotation: (token.rotation + step * ROTATION_STEP + 360) % 360 }
				: {
						size: within(
							token.size + step * side * TOKEN_SIZE_STEP,
							TOKEN_SIZE_STEP,
							LIMITS.tokenSize
						)
					}
		);
		if (changes) send([{ t: 'token.update', id: token.id, changes }]);
	}

	// What a tool was in the middle of is put away with the tool.
	$effect(() => {
		if (tool !== 'measure') {
			measure = null;
			routing = false;
		}
		if (tool !== 'sketch') stroke = null;
		if (tool !== 'select') marquee = null;
		if (tool !== 'template') casting = null;
		if (tool !== 'reveal' && tool !== 'cover') sweep = null;
		if (tool !== 'align') aligning = null;
		if (tool !== 'point') pointing = null;
	});

	// --------------------------------------------------- drawing and writing

	/** A line was drawn: it is thinned to what gives it its shape, and kept. */
	function keepStroke(drawn: Point[]) {
		// Thinned in the map's pixels, to within less than a pixel on screen.
		let points = capped(thinOut(inPixels(drawn), 0.75 / view.k), LIMITS.drawingPoints).map(
			([x, y]): Point => [x / W, y / H]
		);
		// A press that never moved is a dot.
		if (points.length === 1) points = [points[0], points[0]];
		// It stays on the map as drawn until the server sends it back for good.
		const pending = { points, color: ink };
		inked = [...inked, pending];
		send([{ t: 'drawing.create', mapId: map.id, kind: 'line', points, color: ink }]).then(() => {
			inked = inked.filter((line) => line !== pending);
		});
	}

	/** A template was dragged out: it is kept as it came to rest, unless it has no size. */
	function keepTemplate(points: [Point, Point]) {
		const [a, b] = inPixels(points);
		const kind = shape;
		// Less than a few pixels of it on screen was a click, not a template.
		if (templateSpan(kind, a, b).some((span) => span * view.k < 4)) return;
		// It stays on the map as dragged until the server sends it back for good.
		const pending = { kind, points, color: ink };
		cast = [...cast, pending];
		const had = new Set(drawings.map((drawing) => drawing.id));
		send([{ t: 'drawing.create', mapId: map.id, kind, points, color: ink }]).then((made) => {
			cast = cast.filter((each) => each !== pending);
			// Laid, it is what is selected: to pick the tokens inside it, slide
			// it over, or rub it out once the spell is done. Unless this person
			// has gone on to select something else in the meantime.
			const mine = drawings.filter(
				(drawing) => !had.has(drawing.id) && drawing.kind === kind && drawing.authorId === userId
			);
			if (made && mine.length === 1 && selectedIds.length === 0) selectedIds = [mine[0].id];
		});
		ondone();
	}

	/** Starts a new text at `at`, or opens one that is there to be reworded. */
	function write(drawing: Drawing | null, at: Point = [0, 0]) {
		words = drawing?.text ?? '';
		writingSince = performance.now();
		writing = drawing
			? { id: drawing.id, at: drawing.points[0], color: drawing.color }
			: { id: null, at, color: ink };
	}

	/** The text is done: kept if there is any and `keep` says so, dropped otherwise. */
	function doneWriting(keep: boolean) {
		const written = writing;
		if (!written) return;
		writing = null;
		const text = words.trim();
		if (keep && text) {
			if (written.id) send([{ t: 'drawing.update', id: written.id, changes: { text } }]);
			else {
				const { at: point, color } = written;
				send([{ t: 'drawing.create', mapId: map.id, kind: 'text', points: [point], text, color }]);
			}
		}
		if (!written.id) ondone();
	}

	/** How tall the letters of the text being typed are, on screen. */
	const writingSize = $derived.by(() => {
		const size = drawings.find((d) => d.id === writing?.id)?.size ?? DRAWING_SIZE.text;
		return size * cell * view.k;
	});

	// ------------------------------------------------------------ selecting

	/** A box was dragged: whatever it touches is selected, or with `add`, selected as well. */
	function catchIn([a, b]: [Point, Point], add: boolean) {
		const box = boxOf([a, b]);
		const caught: string[] = [];
		for (const token of tokens) {
			// A disc against a box, in the map's pixels: from its middle to the
			// nearest spot of the box is no further than its edge.
			const nx = within(token.x, box.x0, box.x1);
			const ny = within(token.y, box.y0, box.y1);
			const away = Math.hypot((token.x - nx) * W, (token.y - ny) * H);
			if (away <= (token.size * cell) / 2) caught.push(token.id);
		}
		for (const drawing of drawings) {
			if (isTemplate(drawing.kind) && drawing.points.length === 2) {
				// A template is caught by the box around it.
				const [a, b] = inPixels(drawing.points);
				const around = templateBox(drawing.kind, a, b);
				const apart =
					around.x0 / W > box.x1 ||
					around.x1 / W < box.x0 ||
					around.y0 / H > box.y1 ||
					around.y1 / H < box.y0;
				if (!apart) caught.push(drawing.id);
				continue;
			}
			if (drawing.kind === 'line') {
				if (touchesBox(drawing.points, box)) caught.push(drawing.id);
				continue;
			}
			// How much room a text takes is the browser's to say.
			const letters = world?.querySelector(`[data-drawing-id="${drawing.id}"]`);
			if (!letters) continue;
			const rect = letters.getBoundingClientRect();
			const [x0, y0] = toMap(rect.left, rect.top);
			const [x1, y1] = toMap(rect.right, rect.bottom);
			if (x0 <= box.x1 && x1 >= box.x0 && y0 <= box.y1 && y1 >= box.y0) caught.push(drawing.id);
		}
		if (!battle) {
			// A pin stands on its spot, and is as big on screen at any zoom: it is
			// caught by the box around it.
			const wide = 16 / (view.k * W);
			const tall = PIN_HEIGHT / (view.k * H);
			for (const marker of markers) {
				if (!canGrabMarker(marker)) continue;
				const apart =
					marker.x - wide > box.x1 ||
					marker.x + wide < box.x0 ||
					marker.y - tall > box.y1 ||
					marker.y < box.y0;
				if (!apart) caught.push(marker.id);
			}
		}
		selectedIds = add ? [...new Set([...selectedIds, ...caught])] : caught;
		selectedMarkerId = null;
		selectedRegionId = null;
		if (caught.length) ondone();
	}

	/** Copies of tokens were asked for. Once they are made, they are what is selected. */
	async function copy(commands: Command[]) {
		const had = new Set(tokens.map((t) => t.id));
		if (await send(commands)) {
			selectedIds = tokens.filter((t) => !had.has(t.id)).map((t) => t.id);
		}
	}

	/**
	 * Puts away whatever box is out beside what is selected: a label being
	 * typed, the marks, the players of a secret. True if one was.
	 */
	export function shut(): boolean {
		return !!bar?.shut();
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
		if (!viewport) return null;
		const rect = viewport.getBoundingClientRect();
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

	function pointsOf(region: Region): Point[] {
		return reshape && reshape.id === region.id ? reshape.points : region.points;
	}

	const within = (value: number, low: number, high: number) =>
		Math.min(high, Math.max(low, value));

	/**
	 * Where a region's name goes: the middle of its outline. When that is off
	 * screen the name slides to the nearest spot that is still on screen and
	 * still over the region, so a region you have zoomed into keeps its name.
	 */
	function labelSpot(points: Point[]): Point {
		const b = boundsOf(points);
		const sx = view.k * W;
		const sy = view.k * H;
		// Room for the name itself, and for the toolbars that float over the
		// top and bottom of the map.
		const mx = Math.min(170, cw / 2);
		const my = Math.min(80, ch / 2);
		return [
			within(within(b.cx, (mx - view.x) / sx, (cw - mx - view.x) / sx), b.x0, b.x1),
			within(within(b.cy, (my - view.y) / sy, (ch - my - view.y) / sy), b.y0, b.y1)
		];
	}

	function svgPoints(points: Point[]): string {
		return points.map(([x, y]) => `${x * W},${y * H}`).join(' ');
	}

	// -------------------------------------------------------------- the view

	function fitted(): View {
		return { k: fitK, x: (cw - W * fitK) / 2, y: (ch - H * fitK) / 2 };
	}

	/** Keeps at least a strip of the map on screen, so it can't be lost. */
	function bounded(next: View): View {
		const margin = 80;
		return {
			k: next.k,
			x: Math.min(cw - margin, Math.max(margin - W * next.k, next.x)),
			y: Math.min(ch - margin, Math.max(margin - H * next.k, next.y))
		};
	}

	function zoomedAt(cx: number, cy: number, k: number): View {
		k = Math.min(maxK, Math.max(minK, k));
		const wx = (cx - view.x) / view.k;
		const wy = (cy - view.y) / view.k;
		return bounded({ k, x: cx - wx * k, y: cy - wy * k });
	}

	/** True while the view is the automatic fit, false once the user has moved it. */
	let fitting = true;
	let frame = 0;
	let settle: (() => void) | null = null;
	let fade: Animation | null = null;

	function stopAnimation() {
		cancelAnimationFrame(frame);
		settle?.();
		settle = null;
	}

	function calm(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function animateTo(target: View, ms: number): Promise<void> {
		stopAnimation();
		if (calm()) {
			view = target;
			return Promise.resolve();
		}
		const from = view;
		const start = performance.now();
		return new Promise((resolve) => {
			settle = resolve;
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / ms);
				const e = 1 - (1 - t) ** 3;
				view = {
					x: from.x + (target.x - from.x) * e,
					y: from.y + (target.y - from.y) * e,
					k: from.k + (target.k - from.k) * e
				};
				if (t < 1) {
					frame = requestAnimationFrame(step);
				} else {
					settle = null;
					resolve();
				}
			};
			frame = requestAnimationFrame(step);
		});
	}

	function fadeWorld(from: number, to: number, ms: number) {
		fade?.cancel();
		fade = calm()
			? null
			: (world?.animate([{ opacity: from }, { opacity: to }], {
					duration: ms,
					easing: 'ease-in-out',
					fill: 'forwards'
				}) ?? null);
	}

	/** Zooms into a region until it fills the screen. Used just before stepping inside. */
	export async function flyTo(region: Region) {
		const b = boundsOf(region.points);
		const k = Math.min(cw / Math.max(1, (b.x1 - b.x0) * W), ch / Math.max(1, (b.y1 - b.y0) * H));
		fadeWorld(1, 0, 400);
		await animateTo({ k, x: cw / 2 - b.cx * W * k, y: ch / 2 - b.cy * H * k }, 400);
	}

	/** Back to the whole map, for when a transition was started but didn't complete. */
	export function reset() {
		fade?.cancel();
		fit();
	}

	/** Brings a spot of the map to the middle of the screen, as close up as it is now. */
	export function centreOn([x, y]: Point) {
		if (cw === 0 || ch === 0) return;
		fitting = false;
		const k = view.k;
		animateTo(bounded({ k, x: cw / 2 - x * W * k, y: ch / 2 - y * H * k }), 400);
	}

	function zoomBy(factor: number) {
		fitting = false;
		animateTo(zoomedAt(cw / 2, ch / 2, view.k * factor), 180);
	}

	function fit() {
		fitting = true;
		animateTo(fitted(), 250);
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
				if (fitting && !settle) view = fitted();
				return;
			}
			fitting = true;
			const target = fitted();
			if (shown.id === '' || shown.id === map.id) {
				stopAnimation();
				view = target;
			} else {
				const scale = depth >= shown.depth ? 0.6 : 1.5;
				view = {
					k: target.k * scale,
					x: cw / 2 - (cw / 2 - target.x) * scale,
					y: ch / 2 - (ch / 2 - target.y) * scale
				};
				fadeWorld(0, 1, 350);
				animateTo(target, 450);
			}
			if (shown.id !== map.id) {
				clearHover();
				carry = null;
				shaping = null;
				measure = null;
				routing = false;
				stroke = null;
				inked = [];
				casting = null;
				cast = [];
				marquee = null;
				sweep = null;
				fogSent = null;
				aligning = null;
				pointing = null;
				writing = null;
			}
			shown = { key, id: map.id, depth };
			ready = true;
		});
	});

	// ---------------------------------------------------------------- tiles

	// A big image is a small preview with tiles over it: see
	// src/lib/shared/tiles.ts. A small one is shown whole, as it was uploaded.
	const levels = $derived(source ? tileLevels(source.width, source.height) : 0);
	const picture = $derived(
		source && levels > 0 ? imageUrl(map.campaignId, source.file, 'preview') : image
	);

	interface PlacedTile extends Tile {
		src: string;
	}

	/**
	 * The tiles on screen: `over` at the level the zoom calls for. When the
	 * zoom moves on to another level, the tiles it leaves stay `under` the new
	 * ones until those have loaded, so the map doesn't drop back to the
	 * blurry preview in between.
	 */
	let tiling = $state.raw<{
		/** The image these tiles are cut from. */
		of: string | null;
		level: number;
		under: PlacedTile[];
		over: PlacedTile[];
	}>({ of: null, level: 0, under: [], over: [] });
	/** The tiles on screen that have finished loading. */
	const arrived = new Set<string>();

	function retile() {
		// Screen pixels to one pixel of the picture.
		const k = view.k * blownUp;
		const level = tileLevelFor(k * (window.devicePixelRatio || 1));
		let over: PlacedTile[] = [];
		if (source && level < levels) {
			const { file, x, y, w, h } = source;
			// A little more than the screen, so a pan doesn't outrun them at once.
			// Never more than the part of the picture the map shows.
			const pad = 256;
			over = tilesIn(source.width, source.height, level, {
				x0: Math.max(x, x + (-pad - view.x) / k),
				y0: Math.max(y, y + (-pad - view.y) / k),
				x1: Math.min(x + w, x + (cw + pad - view.x) / k),
				y1: Math.min(y + h, y + (ch + pad - view.y) / k)
			}).map((tile) => ({
				...tile,
				src: imageUrl(map.campaignId, file, `${tile.level}/${tile.x}/${tile.y}`)
			}));
		}

		let under = tiling.under;
		if (tiling.of !== image || over.length === 0) {
			under = [];
		} else if (tiling.level !== level) {
			// A level that was left before it finished loading isn't worth
			// keeping over the one that was already under it.
			const loaded = tiling.over.filter((tile) => arrived.has(tile.src));
			if (loaded.length === tiling.over.length || under.length === 0) under = loaded;
			under = under.filter((tile) => tile.level !== level);
		}
		tiling = { of: image, level, under, over };

		const shown = new Set([...under, ...over].map((tile) => tile.src));
		for (const src of arrived) if (!shown.has(src)) arrived.delete(src);
		settleTiles();
	}

	function settleTiles() {
		if (tiling.under.length > 0 && tiling.over.every((tile) => arrived.has(tile.src))) {
			tiling = { ...tiling, under: [] };
		}
	}

	/** Loaded or failed, a tile is no longer worth waiting for. */
	function tileArrived(src: string) {
		arrived.add(src);
		settleTiles();
	}

	// The tiles follow the view a beat behind, so a zoom that sweeps through
	// several levels doesn't fetch them all.
	let tileTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		void [view, cw, ch, source];
		if (levels === 0) return;
		tileTimer ??= setTimeout(() => {
			tileTimer = undefined;
			retile();
		}, 80);
	});

	$effect(() => () => clearTimeout(tileTimer));

	// ----------------------------------------------------------- sharpening

	// Zoomed in past its own pixels a picture is stretched, and the browser
	// stretches it soft. An unsharp mask puts the edges back: the picture,
	// plus its difference from a blurred copy of itself. See the filter in
	// the markup.

	/** How much of that difference is added at full zoom. 0 leaves the picture as it is. */
	const SHARPEN = 0.9;
	/** How far the blurred copy is blurred, in pixels of the picture. */
	const SHARPEN_RADIUS = 0.7;
	// Safari draws a filtered picture at its unzoomed size and stretches that,
	// which is softer than no filter at all. Every browser on an iPhone or an
	// iPad is Safari underneath.
	const filtersStretch =
		typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
	/**
	 * How much to sharpen at this zoom. Nothing until the picture is shown
	 * larger than its own pixels, then more with the zoom, so it never pops.
	 */
	const sharpen = $derived.by(() => {
		if (filtersStretch) return 0;
		// Screen pixels to one pixel of the picture.
		const stretch = view.k * blownUp * (devicePixelRatio.current ?? 1);
		return SHARPEN * within(stretch - 1, 0, 1);
	});
	/** What each image of the picture wears while there is something to sharpen. */
	const sharpening = $derived(sharpen > 0 ? 'url(#sharpen)' : undefined);

	// ------------------------------------------------------------- gestures

	type Gesture =
		| {
				type: 'pan';
				sx: number;
				sy: number;
				vx: number;
				vy: number;
				moved: boolean;
				/** Held still long enough to ping: letting go is then not a tap. */
				pinged?: boolean;
				/** The middle button of a mouse began it: it only ever moves the map. */
				hand?: boolean;
				target: Element;
		  }
		| { type: 'pinch'; distance: number; k: number; wx: number; wy: number }
		| {
				type: 'vertex';
				region: Region;
				index: number;
				/** The corner is new: it was pulled out of the middle of an edge. */
				added: boolean;
				sx: number;
				sy: number;
				moved: boolean;
		  }
		| {
				type: 'grab';
				/** The one under the pointer. A token snaps to the grid, and the rest follow it. */
				lead: Token | Drawing | Marker;
				/** Where everything that comes along was when it was picked up. */
				origins: Record<string, Point>;
				/** How far it can all go each way before something leaves the map. */
				room: { x0: number; x1: number; y0: number; y1: number };
				sx: number;
				sy: number;
				moved: boolean;
				pinged?: boolean;
				target: Element;
		  }
		| {
				/** A handle of a token is being dragged: the one that turns it, or one that resizes it. */
				type: 'shape';
				how: 'turn' | 'resize';
				token: Token;
				/**
				 * How far off its mark the handle was caught, so the token doesn't
				 * jump to the pointer: in degrees for a turn, map pixels for a size.
				 */
				slack: number;
				/** Which way the pointer was from the token's middle when it caught the handle. */
				bearing: number;
		  }
		/**
		 * The ruler: dragged from one spot to another, or with `route`, being
		 * laid a click at a time, each click another bend in it.
		 */
		| { type: 'measure'; sx: number; sy: number; moved: boolean; route: boolean }
		| { type: 'sketch' }
		/** The area of a spell, dragged out from where the press began. */
		| { type: 'template' }
		/** `add` keeps what was already selected. */
		| { type: 'marquee'; add: boolean }
		/** The brush, swept over the fog of war to clear it there or to put it back. */
		| { type: 'sweep'; how: 'reveal' | 'cover' }
		/** A box over the squares of the map's picture, to line the grid up by. */
		| { type: 'align' }
		/** The pointer held down with the pointing tool: the table is shown where it is. */
		| { type: 'point'; sx: number; sy: number; at: number; moved: boolean };

	const pointers = new Map<number, { x: number; y: number }>();
	let gesture: Gesture | null = null;
	let lastTap = {
		at: 0,
		x: 0,
		y: 0,
		regionId: null as string | null,
		/** The token or drawing that was tapped, on a battle map. */
		thingId: null as string | null
	};
	/** The last corner that was clicked without being dragged. A second click removes it. */
	let lastCorner = { at: 0, regionId: '', index: -1 };

	function toMap(clientX: number, clientY: number): Point {
		const rect = viewport!.getBoundingClientRect();
		return [
			(clientX - rect.left - view.x) / (view.k * W),
			(clientY - rect.top - view.y) / (view.k * H)
		];
	}

	const inside = ([x, y]: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
	const clamped = ([x, y]: Point): Point => [
		Math.min(1, Math.max(0, x)),
		Math.min(1, Math.max(0, y))
	];

	/** Keeps a drag alive when the pointer leaves the map. Losing capture only costs that. */
	function capture(pointerId: number) {
		try {
			surface!.setPointerCapture(pointerId);
		} catch {
			// the pointer is already gone
		}
	}

	function midpoint() {
		const [a, b] = [...pointers.values()];
		const rect = viewport!.getBoundingClientRect();
		return {
			x: (a.x + b.x) / 2 - rect.left,
			y: (a.y + b.y) / 2 - rect.top,
			distance: Math.hypot(a.x - b.x, a.y - b.y) || 1
		};
	}

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

	/**
	 * Tells the table what this person has in hand: a token being dragged,
	 * a distance being measured, a spot being pointed at. With none of them
	 * there is nothing to tell, and where the mouse is stays here.
	 */
	function reportHand() {
		if (!viewport || !ready) return onhand(null);
		const held = carry && inHandAt(carry.lead);
		const holding: Holding = {};
		if (pointing) holding.point = pointing;
		if (carry && held) {
			// The table is shown the token under the pointer in this hand. The
			// rest of a selection arrives when it is put down. A hidden token is
			// moved in secret: nobody is shown it in the GM's hand.
			const { lead, origins, rest } = carry;
			const token = carry.measured ? tokens.find((t) => t.id === lead) : null;
			if (token && !token.hidden) {
				holding.drag = { id: lead, x: held[0], y: held[1] };
				const from = origins[lead];
				if (carry.held) holding.ruler = [from, [from[0] + rest[0], from[1] + rest[1]]];
			}
		} else if (measure) {
			holding.ruler = measure;
		}
		onhand(holding.drag || holding.ruler || holding.point ? holding : null);
	}

	// Whenever a token is picked up, carried or put down, the ruler moves,
	// or the pointer does while it is pointing.
	$effect(() => {
		void [map.id, ready, carry, measure, pointing];
		untrack(reportHand);
	});

	/**
	 * How long a press with the pointing tool can last and still be a click:
	 * one that went nowhere and was let go at once. Nobody would have seen
	 * that pointer, so it leaves a ping behind instead.
	 */
	const POINT_CLICK = 250;

	/** Every spot being pointed at on this map right now: this person's, then everyone else's. */
	const pointed = $derived.by(() => {
		const shown: { key: string; at: Point; tint: string; name: string | null }[] = [];
		// This person's own is drawn where their pointer is, in place of the cursor.
		if (pointing) shown.push({ key: 'mine', at: pointing, tint: tintOf({ role, userId }), name: null });
		for (const other of hands) {
			if (!other.point) continue;
			shown.push({ key: other.id, at: clamped(other.point), tint: tintOf(other), name: other.name });
		}
		return shown;
	});

	/**
	 * The cursor of the pointing tool: a dot in a ring, so the spot it is on
	 * shows through. While the button is down, the dot the table sees is
	 * drawn there in its place.
	 */
	const POINT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
			'<circle cx="12" cy="12" r="8" fill="none" stroke="#12151c" stroke-width="3.5"/>' +
			'<circle cx="12" cy="12" r="8" fill="none" stroke="#fff8e4" stroke-width="1.5"/>' +
			'<circle cx="12" cy="12" r="3" fill="#fff8e4" stroke="#12151c" stroke-width="1.5"/>' +
			'</svg>'
	)}") 12 12, crosshair`;

	$effect(() => () => onhand(null));

	/** How long a finger rests on one spot before that is a ping, in milliseconds. */
	const PING_PRESS = 550;

	/** Points a spot out to the table, if it is a spot of the map and there is a table to tell. */
	function pingAt(clientX: number, clientY: number): boolean {
		if (passive) return false;
		const at = toMap(clientX, clientY);
		if (!inside(at)) return false;
		onping(at[0], at[1]);
		return true;
	}

	/**
	 * A finger has no Alt key, so resting it on the map pings instead. If
	 * this press is still down after a moment and hasn't gone anywhere, it
	 * was that, and letting go does nothing more.
	 */
	function awaitPing(e: PointerEvent, g: Extract<Gesture, { type: 'pan' | 'grab' }>) {
		if (e.pointerType === 'mouse' || tool !== 'pan' || passive) return;
		const { clientX, clientY } = e;
		setTimeout(() => {
			if (gesture !== g || g.moved) return;
			g.pinged = pingAt(clientX, clientY);
		}, PING_PRESS);
	}

	// Each person keeps one colour for as long as this page is open. The GM's
	// is the gold of everything else that is the GM's.
	const TINTS = [
		'#ff7a90',
		'#5cc8ff',
		'#7be495',
		'#c79bff',
		'#4fe0d0',
		'#ff8ad8',
		'#c3e24f',
		'#8fa2ff'
	];
	const tints = new Map<string, string>();

	function tintOf(other: { role: Role; userId: string }): string {
		if (other.role === 'gm') return 'var(--color-accent)';
		let tint = tints.get(other.userId);
		if (!tint) tints.set(other.userId, (tint = TINTS[tints.size % TINTS.length]));
		return tint;
	}

	function onpointerdown(e: PointerEvent) {
		trackHover(e);
		if (e.pointerType === 'mouse') {
			if (e.button !== 0 && e.button !== 1) return;
			pointers.clear();
		}
		stopAnimation();
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
			if (carry?.held) carry = null;
			if (shaping?.held) shaping = null;
			measure = null;
			routing = false;
			stroke = null;
			casting = null;
			marquee = null;
			sweep = null;
			aligning = null;
			pointing = null;
			const mid = midpoint();
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
		const corner = target.closest<SVGElement>('[data-vertex]');
		const edge = corner ? null : target.closest<SVGElement>('[data-edge]');
		if ((corner || edge) && selectedRegion) {
			const points = pointsOf(selectedRegion).map(([x, y]) => [x, y] as Point);
			let index = Number(corner?.dataset.vertex);
			if (edge) {
				// The dot in the middle of an edge: a new corner goes in there, and
				// is dragged from there like any other.
				const from = Number(edge.dataset.edge);
				const [ax, ay] = points[from];
				const [bx, by] = points[(from + 1) % points.length];
				index = from + 1;
				points.splice(index, 0, [(ax + bx) / 2, (ay + by) / 2]);
			}
			reshape = { id: selectedRegion.id, points };
			gesture = {
				type: 'vertex',
				region: selectedRegion,
				index,
				added: !!edge,
				sx: e.clientX,
				sy: e.clientY,
				moved: false
			};
			capture(e.pointerId);
			return;
		}

		// One of the handles on the selected token: it is turned or resized
		// from here until the pointer lets go.
		const handle = handled && target.closest<HTMLElement>('[data-handle]');
		if (handle && handled) {
			const how = handle.dataset.handle === 'turn' ? 'turn' : 'resize';
			const from = fromMiddle(handled, e);
			gesture = {
				type: 'shape',
				how,
				token: handled,
				slack:
					how === 'turn'
						? bearing(from) - turnOf(handled)
						: Math.hypot(...from) - (sizeOf(handled) * cell) / 2,
				bearing: bearing(from)
			};
			// A size being changed is written over the token from the first, so
			// it starts out as the size it is. A turn is read off the token.
			shaping =
				how === 'turn'
					? { id: handled.id, held: true }
					: { id: handled.id, size: sizeOf(handled), held: true };
			dragging = true;
			capture(e.pointerId);
			return;
		}

		if (tool === 'measure') {
			const at = aim(e);
			// A ruler being laid takes this spot for its end. Otherwise a new one
			// starts here, in place of any that was left on the map to be read.
			if (routing && measure) measure = [...measure.slice(0, -1), at];
			else {
				routing = false;
				measure = [at, at];
			}
			gesture = { type: 'measure', sx: e.clientX, sy: e.clientY, moved: false, route: routing };
			capture(e.pointerId);
			return;
		}

		if (tool === 'sketch') {
			stroke = [clamped(toMap(e.clientX, e.clientY))];
			gesture = { type: 'sketch' };
			capture(e.pointerId);
			return;
		}

		if (tool === 'template') {
			const at = toMap(e.clientX, e.clientY);
			casting = { from: at, to: at, free: e.altKey };
			gesture = { type: 'template' };
			capture(e.pointerId);
			return;
		}

		if (tool === 'select') {
			const at = toMap(e.clientX, e.clientY);
			marquee = [at, at];
			gesture = { type: 'marquee', add: e.shiftKey };
			capture(e.pointerId);
			return;
		}

		if (tool === 'reveal' || tool === 'cover') {
			// The brush paints from where it is put down: a press alone is a dab.
			sweep = [clamped(toMap(e.clientX, e.clientY))];
			gesture = { type: 'sweep', how: tool };
			capture(e.pointerId);
			return;
		}

		if (tool === 'align') {
			const at = clamped(toMap(e.clientX, e.clientY));
			aligning = [at, at];
			gesture = { type: 'align' };
			capture(e.pointerId);
			return;
		}

		// With the pointing tool, a press is the start of pointing: the table
		// is shown where the pointer is until it is let go.
		if (tool === 'point' && !passive) {
			pointing = clamped(toMap(e.clientX, e.clientY));
			gesture = { type: 'point', sx: e.clientX, sy: e.clientY, at: performance.now(), moved: false };
			capture(e.pointerId);
			return;
		}

		// A token or a drawing that is this person's to move is picked up.
		// Anything else is part of the map: pressing it pans, clicking it
		// selects it. With Shift held a click adds to the selection, so
		// nothing is picked up then either.
		const thing = selecting ? (tokenAt(target) ?? drawingAt(target)) : null;
		if (thing && canGrab(thing) && !e.shiftKey) {
			const grab = pickUp(thing, e, target);
			gesture = grab;
			awaitPing(e, grab);
			return;
		}

		// On a world map, one of the markers selected together is picked up
		// with the rest of them. Any other marker is part of the map.
		const pin = tool === 'pan' && !e.shiftKey ? markerAt(target) : null;
		if (pin && pickedMarkerIds.has(pin.id) && canGrabMarker(pin)) {
			const grab = pickUpMarkers(pin, e, target);
			gesture = grab;
			awaitPing(e, grab);
			return;
		}

		const pan: Extract<Gesture, { type: 'pan' }> = {
			type: 'pan',
			sx: e.clientX,
			sy: e.clientY,
			vx: view.x,
			vy: view.y,
			moved: false,
			target
		};
		gesture = pan;
		awaitPing(e, pan);
	}

	/**
	 * Picks up what was pressed. When it is part of the selection, the rest
	 * of the selection that is this person's to move comes along.
	 */
	function pickUp(
		lead: Token | Drawing,
		e: PointerEvent,
		target: Element
	): Extract<Gesture, { type: 'grab' }> {
		const together = selectedIds.includes(lead.id);
		const along = (thing: Token | Drawing) =>
			thing.id === lead.id || (together && selectedIds.includes(thing.id) && canGrab(thing));
		const origins: Record<string, Point> = {};
		const reached: Point[] = [];
		for (const token of tokens.filter(along)) {
			origins[token.id] = [token.x, token.y];
			reached.push(origins[token.id]);
		}
		for (const drawing of drawings.filter(along)) {
			origins[drawing.id] = drawing.points[0];
			reached.push(...drawing.points);
		}
		const box = boxOf(reached);
		return {
			type: 'grab',
			lead,
			origins,
			room: { x0: -box.x0, x1: 1 - box.x1, y0: -box.y0, y1: 1 - box.y1 },
			sx: e.clientX,
			sy: e.clientY,
			moved: false,
			target
		};
	}

	function markerAt(target: Element): Marker | null {
		const id = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId;
		return markers.find((m) => m.id === id) ?? null;
	}

	/** Picks up the markers selected together, by one of them. */
	function pickUpMarkers(
		lead: Marker,
		e: PointerEvent,
		target: Element
	): Extract<Gesture, { type: 'grab' }> {
		const origins: Record<string, Point> = {};
		for (const marker of selectedMarkers) {
			if (canGrabMarker(marker)) origins[marker.id] = [marker.x, marker.y];
		}
		const box = boxOf(Object.values(origins));
		return {
			type: 'grab',
			lead,
			origins,
			room: { x0: -box.x0, x1: 1 - box.x1, y0: -box.y0, y1: 1 - box.y1 },
			sx: e.clientX,
			sy: e.clientY,
			moved: false,
			target
		};
	}

	/** What to ask of the server once something carried has been put down. */
	function movesOf(origins: Record<string, Point>, [dx, dy]: Point): Command[] {
		const commands: Command[] = [];
		for (const [id, [x, y]] of Object.entries(origins)) {
			if (markers.some((m) => m.id === id)) {
				const changes = { x: within(x + dx, 0, 1), y: within(y + dy, 0, 1) };
				commands.push({ t: 'marker.update', id, changes });
			} else if (tokens.some((t) => t.id === id)) {
				const changes = { x: within(x + dx, 0, 1), y: within(y + dy, 0, 1) };
				commands.push({ t: 'token.update', id, changes });
			} else {
				commands.push({ t: 'drawing.update', id, changes: { move: [dx, dy] } });
			}
		}
		return commands;
	}

	function onpointermove(e: PointerEvent) {
		// The outline being drawn and the ring of the fog's brush follow the mouse.
		if ((tool === 'draw' || brushing) && e.pointerType === 'mouse') {
			cursor = toMap(e.clientX, e.clientY);
		}
		// The end of a ruler being laid follows the mouse between clicks.
		if (routing && measure && e.pointerType === 'mouse' && !pointers.has(e.pointerId)) {
			measure = [...measure.slice(0, -1), aim(e)];
		}
		trackHover(e);

		const pointer = pointers.get(e.pointerId);
		if (!pointer) return;
		// The button came up somewhere this element never heard about.
		if (e.pointerType === 'mouse' && e.buttons === 0) return release(e, false);
		pointer.x = e.clientX;
		pointer.y = e.clientY;

		const g = gesture;
		if (g?.type === 'pinch' && pointers.size >= 2) {
			const mid = midpoint();
			fitting = false;
			const k = Math.min(maxK, Math.max(minK, (g.k * mid.distance) / g.distance));
			view = bounded({ k, x: mid.x - g.wx * k, y: mid.y - g.wy * k });
		} else if (g?.type === 'pan') {
			const dx = e.clientX - g.sx;
			const dy = e.clientY - g.sy;
			if (!g.moved && Math.hypot(dx, dy) > (e.pointerType === 'mouse' ? 4 : 10)) {
				// Capture only once a drag is certain. Capturing on press
				// would swallow the hover state of whatever was pressed.
				g.moved = true;
				fitting = false;
				dragging = true;
				capture(e.pointerId);
			}
			if (g.moved) view = bounded({ k: view.k, x: g.vx + dx, y: g.vy + dy });
		} else if (g?.type === 'vertex' && reshape) {
			// A press that barely moves is a click, not a drag. It leaves the
			// corner where it is, so that two of them can remove it.
			const slack = e.pointerType === 'mouse' ? 3 : 8;
			if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > slack) g.moved = true;
			if (g.moved) reshape.points[g.index] = clamped(toMap(e.clientX, e.clientY));
		} else if (g?.type === 'grab') {
			if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > (e.pointerType === 'mouse' ? 4 : 10)) {
				g.moved = true;
				dragging = true;
				// Dragging something that isn't selected lets go of what is.
				if (!selectedIds.includes(g.lead.id)) selectedIds = [];
				capture(e.pointerId);
			}
			if (g.moved) {
				const fit = ([dx, dy]: Point): Point => [
					within(dx, g.room.x0, g.room.x1),
					within(dy, g.room.y0, g.room.y1)
				];
				let by = fit([(e.clientX - g.sx) / (view.k * W), (e.clientY - g.sy) / (view.k * H)]);
				let rest = by;
				// A token comes down on the grid, and takes the others the same
				// way. With Alt held it stays exactly where it is put. A marker
				// of a world map has no grid to come down on.
				const lead = isMarker(g.lead) ? null : g.lead;
				if (lead && isToken(lead) && !e.altKey) {
					const { x, y, size } = lead;
					const [rx, ry] = snapToGrid(map, [x + by[0], y + by[1]], size);
					rest = fit([rx - x, ry - y]);
				} else if (lead && !isToken(lead) && isTemplate(lead.kind) && !e.altKey) {
					// A shape keeps to the grid it was drawn on, and all the way
					// there, so the cells it covers can be read while it moves. A
					// box goes from corner to corner of the cells. A circle and a
					// cone start from a corner, the middle of a cell or of a side.
					const [x, y] = lead.points[0];
					const to: Point = [x + by[0], y + by[1]];
					const [rx, ry] = lead.kind === 'rect' ? snapToGrid(map, to, 2) : snapToHalfCell(map, to);
					rest = by = fit([rx - x, ry - y]);
				}
				carry = {
					lead: g.lead.id,
					origins: g.origins,
					by,
					rest,
					measured: !!lead && isToken(lead),
					held: true
				};
			}
		} else if (g?.type === 'shape') {
			const from = fromMiddle(g.token, e);
			const away = Math.hypot(...from);
			if (g.how === 'turn') {
				// It turns as far as the pointer has gone round it, a step at a
				// time, and its handle goes round with the pointer. Right over its
				// middle there is no telling which way the pointer is.
				if (away * view.k >= 6) {
					const turned = Math.round((bearing(from) - g.slack) / ROTATION_STEP) * ROTATION_STEP;
					shaping = {
						id: g.token.id,
						rotation: ((turned % 360) + 360) % 360,
						swing: bearing(from) - g.bearing,
						held: true
					};
				}
			} else {
				// Its rim follows the pointer, and its middle stays where it is.
				const across = ((away - g.slack) * 2) / cell;
				const size = within(
					Math.round(across / TOKEN_SIZE_STEP) * TOKEN_SIZE_STEP,
					TOKEN_SIZE_STEP,
					LIMITS.tokenSize
				);
				shaping = { id: g.token.id, size, held: true };
			}
		} else if (g?.type === 'measure' && measure) {
			if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > (e.pointerType === 'mouse' ? 4 : 10)) {
				g.moved = true;
			}
			if (g.moved || g.route) measure = [...measure.slice(0, -1), aim(e)];
		} else if (g?.type === 'sketch' && stroke) {
			// A new point once the pointer has gone a couple of pixels on.
			const at = clamped(toMap(e.clientX, e.clientY));
			const [lx, ly] = stroke[stroke.length - 1];
			if (Math.hypot((at[0] - lx) * W, (at[1] - ly) * H) * view.k >= 2) stroke = [...stroke, at];
		} else if (g?.type === 'template' && casting) {
			casting = { from: casting.from, to: toMap(e.clientX, e.clientY), free: e.altKey };
		} else if (g?.type === 'marquee' && marquee) {
			marquee = [marquee[0], toMap(e.clientX, e.clientY)];
		} else if (g?.type === 'sweep' && sweep) {
			// A new spot once the brush has gone a little of its own reach on.
			const at = clamped(toMap(e.clientX, e.clientY));
			const [lx, ly] = sweep[sweep.length - 1];
			if (Math.hypot((at[0] - lx) / reach[0], (at[1] - ly) / reach[1]) >= 0.04) sweep = [...sweep, at];
		} else if (g?.type === 'align' && aligning) {
			aligning = [aligning[0], clamped(toMap(e.clientX, e.clientY))];
		} else if (g?.type === 'point') {
			if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > (e.pointerType === 'mouse' ? 4 : 10)) {
				g.moved = true;
			}
			pointing = clamped(toMap(e.clientX, e.clientY));
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
						target: surface!
					}
				: null;
			return;
		}

		gesture = null;
		dragging = false;
		handing = false;
		if (g?.type === 'pan' && !g.moved && !g.pinged && !g.hand && completed) tap(e, g.target);
		if (g?.type === 'measure') {
			const now = performance.now();
			const twice =
				now - lastBend.at < 400 &&
				Math.hypot(e.clientX - lastBend.x, e.clientY - lastBend.y) < 28;
			if (!completed || (!g.route && g.moved)) {
				// Dragged from one spot to another: it was read on the way, and is gone.
				measure = null;
				routing = false;
			} else if (!g.route) {
				// A click that went nowhere is where a ruler laid along a road starts.
				routing = true;
				lastBend = { at: now, x: e.clientX, y: e.clientY };
			} else if (twice || !measure || measure.length >= LIMITS.rulerPoints) {
				endRoute();
			} else {
				// It bends here, and its end goes on with the pointer.
				measure = [...measure, measure[measure.length - 1]];
				lastBend = { at: now, x: e.clientX, y: e.clientY };
			}
		}
		if (g?.type === 'template') {
			const laid = casted;
			casting = null;
			if (laid && completed) keepTemplate(laid);
		}
		if (g?.type === 'sketch') {
			const drawn = stroke;
			stroke = null;
			if (drawn && completed) keepStroke(drawn);
		}
		if (g?.type === 'marquee') {
			const box = marquee;
			marquee = null;
			if (box && completed) catchIn(box, g.add);
		}
		if (g?.type === 'sweep') {
			const swept = sweep;
			sweep = null;
			if (swept && completed) markFog(sweptMarks(g.how === 'cover', swept));
		}
		if (g?.type === 'point') {
			pointing = null;
			// Let go at once without having gone anywhere, it was a click: too
			// short for anyone to have seen, so the spot is pinged instead.
			const clicked = !g.moved && performance.now() - g.at < POINT_CLICK;
			if (clicked && completed) pingAt(e.clientX, e.clientY);
		}
		if (g?.type === 'align') {
			const box = alignBox;
			aligning = null;
			// A box too small to have been meant is a click: the one before it stays.
			const meant =
				box && (box[2] - box[0]) * W * view.k >= 8 && (box[3] - box[1]) * H * view.k >= 8;
			if (box && meant && completed) onalign(box);
		}
		if (g?.type === 'grab') {
			const held = carry;
			if (!g.moved) {
				if (completed && !g.pinged) tap(e, g.target);
			} else if (held && completed && (held.rest[0] !== 0 || held.rest[1] !== 0)) {
				// Put down where it comes to rest, and kept there until the
				// server has moved it. The table sees it in this hand until then,
				// so it never flickers back to where it was.
				const settled = { ...held, held: false };
				carry = settled;
				send(movesOf(settled.origins, settled.rest)).then(() => {
					if (carry === settled) carry = null;
				});
			} else {
				carry = null;
			}
		}
		if (g?.type === 'shape') {
			const shaped = shaping;
			// With Alt held, a resized token stays exactly where it is.
			const changes = shaped && completed ? reshaped(g.token, shaped, e.altKey) : null;
			if (shaped && changes) {
				// Kept as it was let go until the server has changed it, so it
				// never flickers back to what it was.
				const at: Point | undefined =
					changes.x !== undefined && changes.y !== undefined ? [changes.x, changes.y] : undefined;
				const settled = { ...shaped, at, held: false };
				shaping = settled;
				send([{ t: 'token.update', id: g.token.id, changes }]).then(() => {
					if (shaping === settled) shaping = null;
				});
			} else {
				shaping = null;
			}
		}
		if (g?.type === 'vertex') {
			const pending = reshape;
			const now = performance.now();
			const clicked = completed && !g.moved && !g.added;
			const twice =
				clicked &&
				lastCorner.regionId === g.region.id &&
				lastCorner.index === g.index &&
				now - lastCorner.at < 400;
			lastCorner =
				clicked && !twice
					? { at: now, regionId: g.region.id, index: g.index }
					: { at: 0, regionId: '', index: -1 };
			// A corner clicked twice goes, as long as the region keeps three.
			let removed = false;
			if (pending && twice && pending.points.length > 3) {
				pending.points.splice(g.index, 1);
				removed = true;
			}

			if (pending && completed && (g.moved || removed)) {
				const points = pending.points.map(([x, y]) => [x, y] as Point);
				onreshape(g.region, points).then((ok) => {
					if (!ok && reshape === pending) reshape = null;
				});
			} else {
				reshape = null;
			}
		}
	}

	// Once the server's version of a reshaped region arrives, drop the local one.
	$effect(() => {
		void selectedRegion?.points;
		untrack(() => {
			if (gesture?.type !== 'vertex') reshape = null;
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
			pingAt(e.clientX, e.clientY);
			return;
		}

		if (tool === 'place') {
			if (inside(point)) onplace(point[0], point[1]);
			return;
		}

		if (tool === 'draw') {
			// Only the first corner closes the region. A click on the corner just
			// laid, a double click included, does nothing: it would only stack a
			// second corner on top of it.
			if (draft.length >= 3 && nearCorner(e, draft[0])) return finishDraft();
			const last = draft.at(-1);
			if (last && nearCorner(e, last, 0.5)) return;
			if (inside(point)) draft.push(point);
			return;
		}

		if (tool === 'text') {
			if (inside(point)) write(null, point);
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
				write(thing);
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

	// ------------------------------------------------------ drawing regions

	/** Whether the pointer is on a corner of the draft. The first one is drawn
	 *  larger than the rest, so the others are given a smaller reach. */
	function nearCorner(e: PointerEvent, [x, y]: Point, reach = 1): boolean {
		const rect = viewport!.getBoundingClientRect();
		const sx = x * W * view.k + view.x + rect.left;
		const sy = y * H * view.k + view.y + rect.top;
		const within = (e.pointerType === 'mouse' ? 14 : 24) * reach;
		return Math.hypot(e.clientX - sx, e.clientY - sy) < within;
	}

	function finishDraft() {
		const points = draft.map(([x, y]) => [x, y] as Point);
		draft = [];
		cursor = null;
		ondrawn(points);
	}

	$effect(() => {
		if (tool !== 'draw') {
			draft = [];
			cursor = null;
		}
	});

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
			if (!held) bar?.remove();
			return true;
		}
		// The same for the markers selected together on a world map.
		if (selectedMarkers.length && tool === 'pan' && remove) {
			if (!held) removeMarkers();
			return true;
		}
		// A ruler being laid along a road: Enter ends it, Backspace takes a bend back.
		if (tool === 'measure' && routing && (key === 'Enter' || key === 'Backspace')) {
			if (key === 'Enter') endRoute();
			else unbend();
			return true;
		}
		// A region being drawn: Enter closes it, Backspace takes a corner back.
		if (tool === 'draw' && key === 'Enter' && draft.length >= 3) {
			finishDraft();
			return true;
		}
		if (tool === 'draw' && key === 'Backspace') {
			draft.pop();
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
				if (bar?.key(key, held)) return true;
			}
			// A marker with its card pinned: the buttons on the card.
			if (card?.key(key, held)) return true;
			// Markers selected together are hidden and revealed together, and
			// who sees them is said for all of them at once.
			if (key === KEY.hide && canShape && selectedPins.length) {
				if (!held) hideMarkers();
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
			fitting = false;
			stopAnimation();
			view = bounded({ k: view.k, x: view.x - move[0] * 80, y: view.y - move[1] * 80 });
			return true;
		}
		if (key === KEY.zoomIn || key === '=') zoomBy(1.6);
		else if (key === KEY.zoomOut) zoomBy(1 / 1.6);
		else if (key === KEY.fit) fit();
		else return false;
		return true;
	}

	// Wheel listeners added through the template can be passive, and a
	// passive listener can't stop the page from scrolling.
	$effect(() => {
		const element = surface;
		if (!element) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			if (brushing && e.shiftKey) {
				// With Shift held, some browsers turn the wheel on its side.
				const turned = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : 1);
				fogSize = brushSize(fogSize * Math.exp(-turned * 0.0016));
				return;
			}
			stopAnimation();
			fitting = false;
			const rect = viewport!.getBoundingClientRect();
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			// Trackpad pinches arrive as small ctrl+wheel deltas.
			const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016));
			view = zoomedAt(e.clientX - rect.left, e.clientY - rect.top, view.k * factor);
		};
		element.addEventListener('wheel', onwheel, { passive: false });
		return () => element.removeEventListener('wheel', onwheel);
	});

	function toggleMarker(e: KeyboardEvent, marker: Marker) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		selectedMarkerId = selectedMarkerId === marker.id ? null : marker.id;
	}

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

	/** What every handle on a token looks like. Each keeps its size on screen: scale-(--inv). */
	const handleLook =
		'absolute top-0 left-0 -translate-1/2 scale-(--inv) rounded-full border-[1.5px] border-accent-ink bg-white text-accent-ink shadow-[0_1px_3px_rgb(0_0_0/0.55)] [-webkit-tap-highlight-color:transparent]';

	// ---------------------------------------------------------------- looks

	// How a region's outline is drawn. One of these at a time: selected beats
	// hovered, hovered beats the rest.
	const OUTLINE = {
		idle: 'fill-transparent stroke-[#fff8e4]/90 stroke-[1.5] [stroke-dasharray:7_6]',
		hover: 'fill-accent/22 stroke-accent stroke-[2.5]',
		selected: 'fill-accent/14 stroke-white stroke-[2.5]',
		// The GM has these to draw, and so has a player who is let in on the
		// secret: dotted, and veiled, so it reads as shut on a pale map as well
		// as on a dark one.
		hidden: 'fill-[#0c0e14]/35 stroke-[#f2c14e] stroke-[1.5] [stroke-dasharray:2_5]',
		// There for everyone to see, and nobody but the GM to step into yet.
		closed: 'fill-[#0c0e14]/25 stroke-[#fff8e4]/75 stroke-[1.5] [stroke-dasharray:2_5]'
	};

	function outlineOf(region: Region): string {
		if (selectedRegionId === region.id) return OUTLINE.selected;
		if (hoveredRegionId === region.id) return OUTLINE.hover;
		if (region.hidden) return OUTLINE.hidden;
		if (region.closed) return OUTLINE.closed;
		return OUTLINE.idle;
	}

	/** Who a region is hidden from or closed to, in a few words, or nothing for one that is neither. */
	function shutOf(region: Region): string {
		const said: string[] = [];
		if (region.hidden) {
			const names = players.filter((p) => region.seenBy.includes(p.id)).map((p) => p.name);
			said.push(
				!canShape ? 'A secret' : names.length ? `A secret with ${names.join(', ')}` : 'Hidden from players'
			);
		}
		if (region.closed) said.push(canShape ? 'Closed to players' : 'Not open yet');
		return said.join(' · ');
	}

	/** The instruction shown at the top while a tool is waiting for a click. */
	// On a narrow screen it leaves the corner to the zoom buttons, and may wrap.
	const hint =
		'absolute top-3.5 left-1/2 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-full border border-accent bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl';
	const zoomButton = 'h-9 w-9.5 cursor-pointer hover:bg-panel-2 touch:size-11';
	/** Typed only where there are keys to type it on. */
	const keys = 'ml-1.5 text-muted touch:hidden';
</script>

<svelte:window {onkeydown} />

<div
	class="relative h-full w-full overflow-hidden bg-[#0b0d12] bg-[radial-gradient(ellipse_at_center,#1a2030_0%,#0b0d12_75%)]"
	bind:this={viewport}
	bind:clientWidth={cw}
	bind:clientHeight={ch}
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
		bind:this={surface}
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
			bind:this={world}
			style:width="{W}px"
			style:height="{H}px"
			style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
			style:--inv={1 / view.k}
		>
			{#if source && picture}
				<!-- The picture never takes the pointer, so holding a finger on the map
				     doesn't bring up the browser's menu for saving it. The map is a
				     window onto it: all of the map's own image, or the part of a
				     borrowed one that belongs here, moved and blown up to fill it. -->
				<div class="pointer-events-none absolute inset-0 overflow-hidden rounded-[3px] shadow-map">
					<div
						class="absolute top-0 left-0 origin-top-left"
						style:width="{source.width}px"
						style:height="{source.height}px"
						style:transform={borrowed
							? `scale(${blownUp}) translate(${-source.x}px, ${-source.y}px)`
							: undefined}
					>
						<!-- Each image is sharpened on its own. Sharpened as one picture,
						     the hairline where two tiles meet would be sharpened too, into a
						     line across the map. -->
						<svg class="absolute h-0 w-0" aria-hidden="true">
							<filter
								id="sharpen"
								x="0"
								y="0"
								width="100%"
								height="100%"
								color-interpolation-filters="sRGB"
							>
								<!-- Measured in pixels of the picture, so it grows with the zoom. -->
								<feGaussianBlur stdDeviation={SHARPEN_RADIUS} result="soft" />
								<!-- At the edge of an image the blur fades to nothing, which would
								     sharpen into a bright rim. Made opaque, it is the average of
								     what is inside the image, and then it is cut back to its shape. -->
								<feColorMatrix
									in="soft"
									type="matrix"
									values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1"
									result="opaque"
								/>
								<feComposite in="opaque" in2="SourceGraphic" operator="in" result="cut" />
								<feComposite
									in="SourceGraphic"
									in2="cut"
									operator="arithmetic"
									k1="0"
									k2={1 + sharpen}
									k3={-sharpen}
									k4="0"
								/>
							</filter>
						</svg>
						<img
							class="block h-full w-full [-webkit-user-drag:none]"
							src={picture}
							alt=""
							width={source.width}
							height={source.height}
							draggable="false"
							style:filter={sharpening}
						/>
						{#if tiling.of === image}
							{#each [...tiling.under, ...tiling.over] as tile (tile.src)}
								<img
									class="absolute [-webkit-user-drag:none]"
									src={tile.src}
									alt=""
									draggable="false"
									style:left="{tile.left}px"
									style:top="{tile.top}px"
									style:width="{tile.width}px"
									style:height="{tile.height}px"
									style:filter={sharpening}
									onload={() => tileArrived(tile.src)}
									onerror={() => tileArrived(tile.src)}
								/>
							{/each}
						{/if}
					</div>
				</div>
			{:else}
				<div
					class={[
						'grid h-full w-full place-content-center gap-2.5 rounded-[3px] text-center text-[#6d5f43] shadow-map',
						// A battle map draws a grid of its own over the paper.
						battle ? 'bg-parchment-plain' : 'bg-parchment'
					]}
				>
					<strong class="font-serif text-[64px] font-semibold text-[#4d4129]">{map.name}</strong>
					<span class="text-[22px]">No map image yet</span>
				</div>
			{/if}

			<svg
				class="pointer-events-none absolute inset-0 overflow-visible"
				viewBox="0 0 {W} {H}"
				width={W}
				height={H}
				aria-hidden="true"
			>
				<!-- The grid of a battle map: a pale line on a dark one, to read on any
				     map. Left out once the cells are too small to tell apart. -->
				{#if gridLines && cell * view.k >= 6}
					<path class="fill-none stroke-[#0c0e14]/30 stroke-[3] stroke-steady" d={gridLines} />
					<path class="fill-none stroke-[#fff8e4]/45 stroke-1 stroke-steady" d={gridLines} />
				{/if}

				<!-- The templates laid on a battle map, under everything else drawn on
				     it: the area of a spell, tinted in its colour so the map and the
				     tokens in it still show through. It is caught by its edge, so that
				     pressing inside one still pans the map and picks up tokens. -->
				<g class="[stroke-linejoin:round]">
					{#each templates as { drawing, kind, a, b } (drawing.id)}
						{@const d = templatePath(kind, a, b)}
						{@const [sx, sy] = shiftOf(drawing)}
						{@const thick = drawing.size * cell}
						<g transform="translate({sx * W} {sy * H})">
							{#if selecting && selectedIds.includes(drawing.id)}
								<path class="fill-none stroke-accent" {d} stroke-width={thick + 6 / view.k} />
							{/if}
							<path
								{d}
								fill={drawing.color}
								fill-opacity="0.2"
								stroke={drawing.color}
								stroke-width={thick}
							/>
							{#if selecting}
								<path
									class={[
										'fill-none stroke-transparent [pointer-events:stroke]',
										canGrabDrawing(drawing) ? 'cursor-move' : 'cursor-pointer'
									]}
									data-drawing-id={drawing.id}
									{d}
									stroke-width={Math.max(thick, (14 * grip) / view.k)}
								/>
							{/if}
						</g>
					{/each}
					<!-- Templates this person has just laid down, and the one being dragged out. -->
					{#each cast as pending (pending)}
						{@const [a, b] = inPixels(pending.points)}
						<path
							d={templatePath(pending.kind, a, b)}
							fill={pending.color}
							fill-opacity="0.2"
							stroke={pending.color}
							stroke-width={DRAWING_SIZE[pending.kind] * cell}
						/>
					{/each}
					{#if casted}
						{@const [a, b] = inPixels(casted)}
						<path
							d={templatePath(shape, a, b)}
							fill={ink}
							fill-opacity="0.2"
							stroke={ink}
							stroke-width={DRAWING_SIZE[shape] * cell}
						/>
					{/if}
				</g>

				<!-- What the table has drawn on a battle map, under the pieces. A line is
				     as thick as it says in cells, so it grows and shrinks with the map. -->
				<g class="fill-none [stroke-linecap:round] [stroke-linejoin:round]">
					{#each lines as drawing (drawing.id)}
						{@const d = linePath(inPixels(drawing.points))}
						{@const [sx, sy] = shiftOf(drawing)}
						{@const thick = drawing.size * cell}
						<g transform="translate({sx * W} {sy * H})">
							{#if selecting && selectedIds.includes(drawing.id)}
								<path class="stroke-accent" {d} stroke-width={thick + 6 / view.k} />
							{/if}
							<path {d} stroke={drawing.color} stroke-width={thick} />
							{#if selecting}
								<!-- What the pointer catches it by: never thinner than a finger can find. -->
								<path
									class={[
										'stroke-transparent [pointer-events:stroke]',
										canGrabDrawing(drawing) ? 'cursor-move' : 'cursor-pointer'
									]}
									data-drawing-id={drawing.id}
									{d}
									stroke-width={Math.max(thick, (14 * grip) / view.k)}
								/>
							{/if}
						</g>
					{/each}
					<!-- Lines this person has just drawn, and the one being drawn. -->
					{#each inked as line (line)}
						<path
							d={linePath(inPixels(line.points))}
							stroke={line.color}
							stroke-width={DRAWING_SIZE.line * cell}
						/>
					{/each}
					{#if stroke}
						<path
							d={linePath(inPixels(stroke))}
							stroke={ink}
							stroke-width={DRAWING_SIZE.line * cell}
						/>
					{/if}
				</g>

				{#each orderedRegions as region (region.id)}
					<!-- A dark line under the outline, so it reads on a pale map too. -->
					<polygon
						class="fill-none stroke-[#0c0e14]/50 stroke-[4] stroke-steady"
						points={svgPoints(pointsOf(region))}
					/>
					<polygon
						data-region-id={region.id}
						points={svgPoints(pointsOf(region))}
						class={[
							'stroke-steady transition-[fill,stroke] duration-150',
							tool === 'pan' ? 'cursor-pointer [pointer-events:visible]' : 'pointer-events-none',
							outlineOf(region)
						]}
					/>
					{#if fresh.includes(region.id)}
						<!-- New to whoever is looking: its outline glints in gold until
						     they have looked at it. -->
						<polygon
							class="animate-glint-line fill-accent/10 stroke-accent stroke-[3.5] stroke-steady motion-reduce:animate-none"
							points={svgPoints(pointsOf(region))}
							data-fresh={region.id}
						/>
					{/if}
				{/each}

				{#if draft.length}
					<polyline
						class="fill-accent/15 stroke-accent stroke-2 stroke-steady"
						points={svgPoints(cursor ? [...draft, cursor] : draft)}
					/>
					{#each draft as [x, y], i (i)}
						<circle
							class={[
								'stroke-accent-ink stroke-[1.5] stroke-steady',
								i === 0 && draft.length >= 3 ? 'fill-white' : 'fill-accent'
							]}
							cx={x * W}
							cy={y * H}
							r={(i === 0 ? 7 : 4) / view.k}
						/>
					{/each}
				{/if}

				<!-- The selected region's corners, for the GM to reshape it by: drag one
				     to move it, click it twice to remove it. The smaller dot in the
				     middle of each edge pulls out into a new corner. -->
				{#if canShape && selectedRegion && tool === 'pan'}
					{@const corners = pointsOf(selectedRegion)}
					{#if corners.length < LIMITS.regionPoints}
						{#each corners as [x, y], i (i)}
							{@const [nx, ny] = corners[(i + 1) % corners.length]}
							<!-- Only on an edge long enough to keep the dot clear of its corners. -->
							{#if Math.hypot((nx - x) * W, (ny - y) * H) * view.k > 44 * grip}
								<circle
									class="cursor-copy fill-accent stroke-accent-ink stroke-[1.5] stroke-steady [pointer-events:visible]"
									data-edge={i}
									cx={((x + nx) / 2) * W}
									cy={((y + ny) / 2) * H}
									r={(4.5 * grip) / view.k}
								>
									<title>Drag to add a corner</title>
								</circle>
							{/if}
						{/each}
					{/if}
					{#each corners as [x, y], i (i)}
						<circle
							class="cursor-move fill-white stroke-accent-ink stroke-[1.5] stroke-steady [pointer-events:visible]"
							data-vertex={i}
							cx={x * W}
							cy={y * H}
							r={(7 * grip) / view.k}
						>
							<title>Drag to move · double-click to remove</title>
						</circle>
					{/each}
				{/if}

				<!-- What is being measured, each ruler in the colour (--c) of whoever holds it. -->
				{#each rulers as ruler (ruler.key)}
					{@const path = svgPoints(ruler.points)}
					<g style:--c={ruler.tint}>
						<polyline
							class="fill-none stroke-[#0c0e14]/60 stroke-[5] stroke-steady [stroke-linecap:round]"
							points={path}
						/>
						<polyline
							class="fill-none stroke-(--c) stroke-[2.5] stroke-steady [stroke-dasharray:7_5]"
							points={path}
						/>
						{#each ruler.points as [x, y], i (i)}
							<circle
								class="fill-(--c) stroke-[#12151c] stroke-[1.5] stroke-steady"
								cx={x * W}
								cy={y * H}
								r={4 / view.k}
							/>
						{/each}
					</g>
				{/each}

				<!-- The box the grid is being lined up by. -->
				{#if alignBox}
					{@const [x0, y0, x1, y1] = alignBox}
					<rect
						class="fill-accent/15 stroke-accent stroke-2 stroke-steady"
						x={x0 * W}
						y={y0 * H}
						width={(x1 - x0) * W}
						height={(y1 - y0) * H}
					/>
				{/if}

				<!-- The box being dragged around things to select them. -->
				{#if marquee}
					{@const box = boxOf(marquee)}
					<rect
						class="fill-accent/12 stroke-accent stroke-[1.5] stroke-steady [stroke-dasharray:5_4]"
						x={box.x0 * W}
						y={box.y0 * H}
						width={(box.x1 - box.x0) * W}
						height={(box.y1 - box.y0) * H}
					/>
				{/if}
			</svg>

			<!-- What the table has written on a battle map: each text starts at its
			     spot and runs to the right, its letters as tall as it says in cells.
			     The one being reworded is out of sight while its words are in the box. -->
			{#each texts as drawing (drawing.id)}
				{@const [x, y] = drawing.points[0]}
				{@const [sx, sy] = shiftOf(drawing)}
				{@const halo = haloOf(drawing.color)}
				{#if writing?.id !== drawing.id}
					<div
						class={[
							'absolute -translate-y-1/2 rounded-[0.12em] leading-none font-semibold whitespace-pre',
							!selecting
								? 'pointer-events-none'
								: canGrabDrawing(drawing)
									? 'cursor-move'
									: 'cursor-pointer',
							selecting &&
								selectedIds.includes(drawing.id) &&
								'outline-[0.06em] outline-offset-[0.14em] outline-accent'
						]}
						data-drawing-id={drawing.id}
						style:left="{(x + sx) * W}px"
						style:top="{(y + sy) * H}px"
						style:font-size="{drawing.size * cell}px"
						style:color={drawing.color}
						style:text-shadow="0 0 0.08em {halo}, 0 0 0.18em {halo}, 0 0 0.35em {halo}"
					>
						{drawing.text}
					</div>
				{/if}
			{/each}

			<!-- How big a template is, written on it while it is selected or being
			     dragged out: the one thing about it the map can't show. -->
			{#each templates as { drawing, kind, a, b } (drawing.id)}
				{#if selecting && selectedIds.includes(drawing.id) && !carry?.held}
					{@const [mx, my] = templateMiddle(kind, a, b)}
					<div
						class="pointer-events-none absolute top-0 left-0 z-3 size-0 scale-(--inv)"
						style:translate="{mx}px {my}px"
					>
						<span
							class="absolute -translate-1/2 rounded-full border border-accent bg-night/90 px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
						>
							{templateSize(kind, a, b)}
						</span>
					</div>
				{/if}
			{/each}
			{#if casted}
				{@const [a, b] = inPixels(casted)}
				{@const [mx, my] = templateMiddle(shape, a, b)}
				<div
					class="pointer-events-none absolute top-0 left-0 z-3 size-0 scale-(--inv)"
					style:translate="{mx}px {my}px"
				>
					<span
						class="absolute -translate-1/2 rounded-full border border-accent bg-night/90 px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
					>
						{templateSize(shape, a, b)}
					</span>
				</div>
			{/if}

			<!-- Every region wears its name, lettered straight onto the map like a place
			     name in an atlas: quiet until the region is hovered, and never boxed in.
			     It comes before the markers, so it is never drawn over one, and it never
			     takes the pointer, so the outline beneath it still does. -->
			{#each orderedRegions as region (region.id)}
				{@const [x, y] = labelSpot(pointsOf(region))}
				{@const lit = litRegionId === region.id}
				{@const shut = shutOf(region)}
				{@const open = canShape || !region.closed}
				<div
					class={[
						'pointer-events-none absolute w-max -translate-1/2 scale-(--inv) text-center text-shadow-map',
						// A table display is read from across the room.
						passive ? 'max-w-[420px] text-[25px]' : 'max-w-[300px] text-[17px]'
					]}
					style:left="{x * W}px"
					style:top="{y * H}px"
					bind:clientHeight={null, (tall) => (nameHeights[region.id] = tall ?? 0)}
				>
					<strong
						class={[
							'block font-serif leading-[1.2] font-semibold tracking-[0.02em] wrap-anywhere transition-[opacity,color] duration-150',
							lit ? 'text-white' : 'text-[#fff8e4] opacity-55'
						]}
						>{#if region.closed}<!-- A lock before the name of a region that is
							     not open to players yet. --><svg
								class="mr-1 inline-block size-[0.8em] -translate-y-px drop-shadow-[0_0_2px_rgb(8_10_15/0.9)]"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								role="img"
								aria-label="Closed:"
							>
								<path d="M5 11h14v10H5Z M8 11V7a4 4 0 0 1 8 0v4" />
							</svg>{/if}{region.name}</strong
					>
					{#if lit || region.hidden}
						<!-- How to get in, and whether players can. Out of the flow, so the
						     name does not jump when it appears. -->
						<span
							class="absolute top-[calc(100%+2px)] left-1/2 -translate-x-1/2 text-xs whitespace-nowrap text-[#e4dcc6]"
						>
							{#if shut}
								<span class="font-semibold text-[#f2c14e]">{shut}{lit && open ? ' ·' : ''}</span>
							{/if}
							{#if lit && open}
								{#if region.kind === 'battle'}Battle map ·{/if}
								<span class="touch:hidden">Double-click to enter</span>
								<span class="hidden touch:inline">Double-tap to enter</span>
							{/if}
						</span>
					{/if}
				</div>
			{/each}

			<!-- The pieces on a battle map. Each is as many cells across as it says, so
			     unlike a pin it grows and shrinks with the map. It is a disc in its own
			     colour (--c) with its initials on it, or its picture. Either can wear
			     a ring in its outline colour (--o), to tell it from the next one. Its
			     name is lettered underneath once it is big enough on screen to tell
			     from its neighbours. The one whose turn it is stands in a ring of
			     gold. What a token is marked with shows on its rim, a pip for each
			     mark, and one that is down is crossed out. -->
			{#if battle}
				{#each tokens as token (token.id)}
					{@const [x, y] = spotOf(token)}
					{@const mine = canGrabToken(token) && !passive}
					{@const inHand = !!carry?.held && token.id in carry.origins}
					{@const selected = selecting && selectedIds.includes(token.id)}
					{@const across = sizeOf(token) * cell}
					{@const turn = turnOf(token)}
					{@const down = token.marks.includes('down')}
					{@const pips = pipsOf(token)}
					<!-- Only the position glides, from one report of a drag to the next and
					     onto the grid when it is let go. Never in the hand that holds it. -->
					<div
						class={[
							'absolute top-0 left-0 size-0',
							inHand
								? 'z-2'
								: 'transition-[translate] duration-100 ease-linear motion-reduce:transition-none',
							selected && 'z-1'
						]}
						style:translate="{x * W}px {y * H}px"
					>
						{#if caughtIds.has(token.id)}
							<!-- Inside a shape that is being laid, or is selected: a pale ring
							     around what it would catch. -->
							<span
								class="pointer-events-none absolute -translate-1/2 rounded-full border-[#fff8e4] shadow-[0_0_0.45em_0.1em_#fff8e4]"
								data-caught={token.id}
								style:width="{across * 1.16}px"
								style:height="{across * 1.16}px"
								style:border-width="{across * 0.05}px"
								style:font-size="{across * 0.4}px"
								aria-hidden="true"
							></span>
						{/if}
						{#if turnId === token.id}
							<!-- Whose turn it is: a ring of gold around the token, breathing. -->
							<span
								class="pointer-events-none absolute -translate-1/2 animate-pulse rounded-full border-accent shadow-[0_0_0.5em_0.1em_var(--color-accent)] motion-reduce:animate-none"
								style:width="{across * 1.2}px"
								style:height="{across * 1.2}px"
								style:border-width="{across * 0.06}px"
								style:font-size="{across * 0.4}px"
								aria-hidden="true"
							></span>
						{/if}
						<button
							class={[
								'absolute grid -translate-1/2 place-items-center overflow-hidden rounded-full border-(--o) bg-(--c) leading-none font-semibold text-[#12151c] [-webkit-tap-highlight-color:transparent]',
								inHand ? 'cursor-grabbing' : mine ? 'cursor-grab' : 'cursor-pointer',
								selected ? 'token-selected' : inHand ? 'token-lifted' : 'token-shadow',
								// Only the GM ever has a hidden one to draw.
								token.hidden && 'border-dashed opacity-55',
								down && 'brightness-60 saturate-0',
								tool !== 'pan' && 'pointer-events-none'
							]}
							data-token-id={token.id}
							style:width="{across}px"
							style:height="{across}px"
							style:border-width="{across * (token.outline ? 0.09 : 0.06)}px"
							style:font-size="{across * 0.4}px"
							style:rotate="{turn}deg"
							style:--c={token.color}
							style:--o={token.outline ?? '#12151c'}
							title="{token.name}{token.ownerName
								? token.ownerId === userId
									? ' · yours'
									: ` · ${token.ownerName}’s`
								: ''}{token.locked ? ' · locked' : ''}"
							aria-label="Token: {token.name}{token.count != null
								? `, ${token.count}${token.countHidden ? ' (only you see the number)' : ''}`
								: ''}{caughtIds.has(token.id) ? ' (inside the shape)' : ''}{token.hidden ? (canShape ? ' (hidden from players)' : ' (a secret)') : ''}{down
								? ' (down)'
								: ''}{turnId === token.id ? ' (their turn)' : ''}{mine
								? '. Arrow keys move it.'
								: ''}"
							aria-pressed={selected}
							tabindex={tool === 'pan' && !passive ? 0 : -1}
							onkeydown={(e) => tokenKey(e, token)}
						>
							{initials(token.name)}
							{#if token.image}
								<!-- Over the initials, which show through if the picture can't be loaded. -->
								<img
									class="pointer-events-none absolute inset-0 size-full object-cover"
									src={imageUrl(map.campaignId, token.image)}
									alt=""
									draggable="false"
									onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
								/>
							{/if}
						</button>
						{#if down}
							<svg
								class="pointer-events-none absolute -translate-1/2"
								style:width="{across}px"
								style:height="{across}px"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									class="fill-none stroke-[#12151c] stroke-[5] [stroke-linecap:round]"
									d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
								/>
								<path
									class="fill-none stroke-[#e5544b] stroke-[2.5] [stroke-linecap:round]"
									d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
								/>
							</svg>
						{/if}
						{#each pips as { look, angle, size } (look.id)}
							<!-- Round its rim from the top, clockwise. A plain one is a disc of
							     its colour (--c). One with an icon is a dark disc, ringed in
							     the icon's colour, with the icon on it. -->
							{@const round = (angle * Math.PI) / 180}
							<span
								class={[
									'pointer-events-none absolute grid -translate-1/2 place-items-center rounded-full',
									look.icon ? 'border-(--c) bg-[#12151c]' : 'border-[#12151c] bg-(--c)'
								]}
								style:left="{Math.sin(round) * (across / 2)}px"
								style:top="{-Math.cos(round) * (across / 2)}px"
								style:width="{across * size}px"
								style:height="{across * size}px"
								style:border-width="{across * (look.icon ? 0.02 : 0.03)}px"
								style:--c={look.color}
								aria-hidden="true"
							>
								<MarkIcon {look} />
							</span>
						{/each}
						{#if token.count != null}
							<!-- The number it carries, on its rim at the upper left, where
							     the pips leave room: hit points, charges, rounds left. One
							     the GM keeps to themself is gold in a broken ring: nobody
							     else is sent it. -->
							<span
								class={[
									'pointer-events-none absolute grid -translate-1/2 place-items-center rounded-full bg-[#12151c] px-[0.3em] leading-none font-bold whitespace-nowrap tabular-nums',
									token.countHidden
										? 'border-dashed border-accent text-accent'
										: 'border-[#fff8e4]/85 text-[#fff8e4]'
								]}
								data-count={token.countHidden ? 'kept' : 'shown'}
								style:left="{-0.354 * across}px"
								style:top="{-0.354 * across}px"
								style:min-width="{across * 0.36}px"
								style:height="{across * 0.36}px"
								style:font-size="{across * 0.23}px"
								style:border-width="{across * 0.02}px"
								aria-hidden="true"
							>
								{token.count}
							</span>
						{/if}
						{#if across * view.k >= 26 || selected}
							<span
								class={[
									'pointer-events-none absolute left-0 w-max origin-top -translate-x-1/2 scale-(--inv) truncate pt-0.5 font-semibold text-[#fff8e4] text-shadow-map',
									passive ? 'max-w-[260px] text-lg' : 'max-w-[160px] text-xs'
								]}
								style:top="{across / 2}px"
							>
								{token.name}
							</span>
						{/if}
						{#if handled?.id === token.id}
							<!-- The handles of the one token selected. A dot on each side of it
							     is dragged out or in to resize it, half a cell at a time. The
							     one above it is dragged around it to turn it: it goes round
							     with the pointer while it is held, and the token turns as far.
							     Let go, it is back on top. -->
							{@const out = across / 2 + turnReach / view.k}
							{@const swing = shaping?.held && shaping.id === token.id ? (shaping.swing ?? 0) : 0}
							{@const round = (swing * Math.PI) / 180}
							{#each [-1, 1] as side (side)}
								<button
									class="{handleLook} size-3 cursor-ew-resize touch:size-5"
									data-handle="resize"
									style:left="{side * (across / 2 + sizeReach / view.k)}px"
									title="Drag to resize"
									aria-label="Resize {token.name}: drag, or use the left and right arrow keys"
									onkeydown={(e) => handleKey(e, token, 'resize', side)}
								></button>
							{/each}
							<button
								class="{handleLook} grid size-5.5 cursor-grab place-items-center touch:size-8"
								data-handle="turn"
								style:left="{Math.sin(round) * out}px"
								style:top="{-Math.cos(round) * out}px"
								title="Drag around the token to turn it"
								aria-label="Turn {token.name}: drag around it, or use the left and right arrow keys"
								onkeydown={(e) => handleKey(e, token, 'turn')}
							>
								<svg
									class="pointer-events-none size-[62%]"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.75"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5" />
								</svg>
							</button>
							{#if shaping?.held && shaping.id === token.id}
								<!-- How big it is being made, or how far round it is being turned,
								     written over the top of it for as long as a handle is held. -->
								<div
									class="pointer-events-none absolute left-0 size-0 scale-(--inv)"
									style:top="{-out}px"
									aria-hidden="true"
								>
									<span
										class="absolute bottom-4.5 left-0 -translate-x-1/2 rounded-full border border-accent bg-night/90 px-2 py-0.5 text-xs font-semibold whitespace-nowrap touch:bottom-6"
									>
										{shaping.size !== undefined ? `${feetCount(cellsToFeet(map, shaping.size))} across` : `${turn}°`}
									</span>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			{/if}

			<!-- The fog of war: one dark sheet, cut through a mask. The mask is
			     the marks made on the fog in the order they were made, each one
			     black where it cleared and white where it covered again: the
			     line a round brush swept along, as wide as the brush, what a
			     square one went over, or a box. Players can't see through the
			     fog. The GM can, enough to tell what is under it. On a battle
			     map it lies over everything that stands there, and on a world
			     map under the pins. The outline of the brush is drawn with it. -->
			{#if fog.on || brushAt}
				<svg
					class={['pointer-events-none absolute inset-0 overflow-visible', battle && 'z-2']}
					viewBox="0 0 {W} {H}"
					width={W}
					height={H}
					aria-hidden="true"
				>
					{#if fog.on}
						<defs>
							<mask id="fog-marks" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
								<rect width={W} height={H} fill="white" />
								{#each fog.clear as [x0, y0, x1, y1], i (i)}
									<rect x={x0 * W} y={y0 * H} width={(x1 - x0) * W} height={(y1 - y0) * H} fill="black" />
								{/each}
								{#each fog.marks ?? [] as mark, i (i)}
									{@const paint = mark.cover ? 'white' : 'black'}
									{#if 'box' in mark}
										{@const [x0, y0, x1, y1] = mark.box}
										<rect x={x0 * W} y={y0 * H} width={(x1 - x0) * W} height={(y1 - y0) * H} fill={paint} />
									{:else if mark.square}
										<!-- Drawn in brushes, like the line below: filled, since a
										     line that wide would turn its ends with the way it goes. -->
										<path
											d={stampPath(mark)}
											transform="scale({mark.r[0] * W} {mark.r[1] * H})"
											fill={paint}
										/>
									{:else}
										<!-- Drawn in brushes: a line two across is as wide as the brush. -->
										<path
											d={sweepPath(mark)}
											transform="scale({mark.r[0] * W} {mark.r[1] * H})"
											fill="none"
											stroke={paint}
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									{/if}
								{/each}
							</mask>
						</defs>
						<rect
							class={canShape ? 'fill-[#0b0d12]/55' : 'fill-[#0d1017]'}
							width={W}
							height={H}
							mask="url(#fog-marks)"
						/>
					{/if}
					{#if brushAt}
						<!-- What the brush reaches from where it is: dark under light, to show on any map. -->
						{@const ring = { cx: brushAt[0] * W, cy: brushAt[1] * H, rx: reach[0] * W, ry: reach[1] * H }}
						{@const dark = 'fill-none stroke-[#0c0e14]/60 stroke-[3.5] stroke-steady'}
						{@const light = [
							'stroke-[1.5] stroke-steady',
							tool === 'cover' ? 'fill-[#0b0d12]/25 stroke-[#fff8e4]' : 'fill-white/10 stroke-white'
						]}
						{#if fogShape === 'square'}
							{@const sides = {
								x: ring.cx - ring.rx,
								y: ring.cy - ring.ry,
								width: ring.rx * 2,
								height: ring.ry * 2
							}}
							<rect class={dark} {...sides} />
							<rect class={light} {...sides} />
						{:else}
							<ellipse class={dark} {...ring} />
							<ellipse class={light} {...ring} />
						{/if}
					{/if}
				</svg>
			{/if}

			<!-- Pins live in the scaled layer, so they follow the map for free. World
			     markers are teardrops in their type's colour (--c). Table notes look
			     like paper tags, so the two can be told apart at a glance. -->
			{#each orderedMarkers as marker (marker.id)}
				{@const type = markerType(marker.type)}
				{@const picked = pickedMarkerIds.has(marker.id)}
				{@const selected = selectedMarkerId === marker.id || picked}
				{@const raised = active?.id === marker.id}
				{@const [mx, my] = markerSpot(marker)}
				{@const shape = [
					'block',
					selected ? 'pin-selected' : 'pin-shadow group-focus-visible:pin-focused',
					marker.hidden && 'opacity-55'
				]}
				<button
					class={[
						'group absolute origin-bottom -translate-x-1/2 -translate-y-full scale-(--inv) cursor-pointer text-[#12151c] [-webkit-tap-highlight-color:transparent] focus-visible:outline-none',
						(selected || raised) && 'z-1',
						// With another tool in hand they are part of the picture. The
						// box that selects them shows them as they are.
						tool !== 'pan' && 'pointer-events-none',
						tool !== 'pan' && tool !== 'select' && 'opacity-60',
						picked && tool === 'pan' && (carry?.held ? 'cursor-grabbing' : 'cursor-grab')
					]}
					data-marker-id={marker.id}
					data-picked={picked ? '' : undefined}
					style:left="{mx * W}px"
					style:top="{my * H}px"
					style:--c={type.color}
					aria-label="{type.label}: {marker.title}{marker.hidden
						? canShape
							? ' (hidden from players)'
							: ' (a secret)'
						: ''}{fresh.includes(marker.id) ? ' (new)' : ''}"
					aria-pressed={selected}
					tabindex={tool === 'pan' ? 0 : -1}
					onfocus={() => (hoveredMarkerId = marker.id)}
					onblur={() => hoveredMarkerId === marker.id && (hoveredMarkerId = null)}
					onkeydown={(e) => toggleMarker(e, marker)}
				>
					<span
						class={[
							'relative block origin-bottom transition-transform duration-120 group-hover:scale-115',
							raised && 'scale-115'
						]}
					>
						{#if fresh.includes(marker.id)}
							<!-- New to whoever is looking: a ring of gold breathing around
							     its head, until its card has been read. -->
							<span
								class="pointer-events-none absolute top-[15px] left-1/2 size-13 -translate-1/2 animate-glint rounded-full border-[3px] border-accent shadow-[0_0_10px_2px_var(--color-accent),inset_0_0_6px_var(--color-accent)] motion-reduce:animate-none"
								data-fresh={marker.id}
								aria-hidden="true"
							></span>
						{/if}
						{#if marker.kind === 'world'}
							<svg class={shape} viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
								<path
									class={['fill-(--c) stroke-[#12151c] stroke-[1.5]', marker.hidden && '[stroke-dasharray:3_2.5]']}
									d="M16 41C16 41 3 26.5 3 15.5a13 13 0 0 1 26 0C29 26.5 16 41 16 41Z"
								/>
							</svg>
						{:else}
							<svg class={shape} viewBox="0 0 34 38" width="34" height="38" aria-hidden="true">
								<path
									class="fill-[#f4e7c3] stroke-(color:--c) stroke-[2.5]"
									d="M7 2h20a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5h-5.5L17 37l-4.5-8H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
								/>
							</svg>
						{/if}
						<span
							class={[
								'absolute top-[7.5px] left-1/2 flex -translate-x-1/2',
								marker.kind === 'player' && 'text-[#4a3b18]'
							]}
						>
							<MarkerGlyph type={marker.type} size={16} />
						</span>
					</span>
				</button>
			{/each}

			<!-- A spot someone is pointing out: rings spreading from it in their
			     colour (--c), with their name under it, gone again after a moment.
			     The same size on screen at any zoom, and never in the way of the
			     pointer. -->
			{#each pings as ping (ping.key)}
				<div
					class="pointer-events-none absolute top-0 left-0 z-3 size-0 animate-ping-fade scale-(--inv)"
					style:translate="{ping.x * W}px {ping.y * H}px"
					style:--c={tintOf(ping)}
					role="status"
					aria-label="{ping.name} is pointing here"
				>
					<span
						class="absolute size-24 -translate-1/2 animate-ping-ring rounded-full border-[3px] border-(--c) shadow-[0_0_6px_rgb(0_0_0/0.7),inset_0_0_6px_rgb(0_0_0/0.7)] motion-reduce:size-12 motion-reduce:animate-none"
					></span>
					<span
						class="absolute size-24 -translate-1/2 animate-ping-ring rounded-full border-[3px] border-(--c) shadow-[0_0_6px_rgb(0_0_0/0.7),inset_0_0_6px_rgb(0_0_0/0.7)] [animation-delay:0.35s] motion-reduce:hidden"
					></span>
					<span
						class="absolute size-3 -translate-1/2 rounded-full border-[1.5px] border-[#12151c] bg-(--c)"
					></span>
					<span
						class={[
							'absolute left-0 w-max -translate-x-1/2 truncate rounded-full bg-(--c) px-2 leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
							passive ? 'top-4 max-w-[240px] text-base' : 'top-3 max-w-[150px] text-xs'
						]}>{ping.name}</span
					>
				</div>
			{/each}

			<!-- Where someone is pointing, for as long as they hold the button
			     down: a dot in their colour (--c) with a glow around it, and for
			     everyone but themself, their name under it. The same size on
			     screen at any zoom. Another person's glides from one report of
			     it to the next; this person's own is under their pointer. -->
			{#each pointed as pointer (pointer.key)}
				<div
					class={[
						'pointer-events-none absolute top-0 left-0 z-3 size-0 scale-(--inv)',
						pointer.name !== null &&
							'transition-[translate] duration-75 ease-linear motion-reduce:transition-none'
					]}
					style:translate="{pointer.at[0] * W}px {pointer.at[1] * H}px"
					style:--c={pointer.tint}
					data-pointer={pointer.key}
					role={pointer.name === null ? undefined : 'status'}
					aria-label={pointer.name === null ? undefined : `${pointer.name} is pointing here`}
				>
					<span
						class="absolute size-7 -translate-1/2 rounded-full bg-(--c)/35 shadow-[0_0_10px_2px_var(--c)]"
					></span>
					<span
						class="absolute size-3 -translate-1/2 rounded-full border-[1.5px] border-[#12151c] bg-(--c)"
					></span>
					{#if pointer.name !== null}
						<span
							class={[
								'absolute left-0 w-max -translate-x-1/2 truncate rounded-full bg-(--c) px-2 leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
								passive ? 'top-5 max-w-[240px] text-base' : 'top-4 max-w-[150px] text-xs'
							]}>{pointer.name}</span
						>
					{/if}
				</div>
			{/each}

			<!-- How long each ruler is, written at the end it is being pulled to. -->
			{#each rulers as ruler (ruler.key)}
				{#if ruler.length}
					{@const [ex, ey] = ruler.points[ruler.points.length - 1]}
					<div
						class="pointer-events-none absolute top-0 left-0 z-3 size-0 origin-top-left scale-(--inv)"
						style:translate="{ex * W}px {ey * H}px"
						style:--c={ruler.tint}
					>
						<span
							class={[
								'absolute bottom-3 left-0 -translate-x-1/2 rounded-full border border-(--c) bg-night/90 px-2 py-0.5 font-semibold whitespace-nowrap',
								passive ? 'text-base' : 'text-xs'
							]}
						>
							{ruler.length}
						</span>
					</div>
				{/if}
			{/each}
		</div>
	</div>

	<!-- What floats over the map. Only the parts that ask for the pointer get it. -->
	<div class="pointer-events-none absolute inset-0">
		{#if active && cardPosition}
			{@const pinned = active.id === selectedMarkerId && !passive}
			<!-- A table display only ever informs: its cards are never pinned, and offer nothing to do. -->

			<!-- Kept out of sight until its size is known, so it never flashes in the wrong place. -->
			<div
				class={['absolute', cardW === 0 && 'invisible', pinned && 'pointer-events-auto']}
				style:left="{cardPosition.left}px"
				style:top="{cardPosition.top}px"
				bind:clientWidth={cardW}
				bind:clientHeight={cardH}
			>
				<MarkerCard
					bind:this={card}
					marker={active}
					campaignId={map.campaignId}
					{role}
					{userId}
					{pinned}
					onclose={() => (selectedMarkerId = null)}
					{onedit}
					{onmove}
					{ondelete}
					{onhide}
					{players}
					onvisibility={canShape ? (marker) => onmarkervisibility([marker]) : undefined}
				/>
			</div>
		{/if}

		<!-- The buttons for whatever is selected on a battle map, floating just
		     under it. They stay mounted while it is off screen or in hand, out
		     of sight, so the Delete key still has them to ask. -->
		{#if selectedTokens.length + selectedDrawings.length > 0}
			<div
				class={['absolute', barPosition && barW > 0 ? 'pointer-events-auto' : 'invisible']}
				style:left="{barPosition?.left ?? 0}px"
				style:top="{barPosition?.top ?? 0}px"
				bind:clientWidth={barW}
				bind:clientHeight={barH}
			>
				<SelectionBar
					bind:this={bar}
					tokens={selectedTokens}
					drawings={selectedDrawings}
					inside={insideSelected}
					{role}
					{userId}
					tip={barPosition?.under === false ? 'top' : 'bottom'}
					{send}
					oncopy={copy}
					onedit={onedittoken}
					onwrite={(drawing) => {
						selectedIds = [];
						write(drawing);
					}}
					onclear={() => (selectedIds = [])}
					onpick={(picked) => (selectedIds = picked.map((token) => token.id))}
					onvisibility={ontokenvisibility}
				/>
			</div>
		{/if}

		<!-- The buttons for the markers selected together on a world map,
		     floating under them the same way. -->
		{#if selectedMarkers.length > 0}
			{@const pins = selectedPins}
			{@const hidden = pins.filter((m) => m.hidden).length}
			{@const mine = selectedMarkers.filter((m) => canRemoveMarker(role, userId, m))}
			{@const tip = markerBarPosition?.under === false ? 'top' : 'bottom'}
			<div
				class={['absolute', markerBarPosition && barW > 0 ? 'pointer-events-auto' : 'invisible']}
				style:left="{markerBarPosition?.left ?? 0}px"
				style:top="{markerBarPosition?.top ?? 0}px"
				bind:clientWidth={barW}
				bind:clientHeight={barH}
			>
				<div
					class="flex items-center gap-1 rounded-xl border border-[#55607a] bg-panel/94 p-1 shadow-pop"
					role="toolbar"
					aria-label="Selected markers"
				>
					<span class="px-1.5 text-xs whitespace-nowrap text-muted tabular-nums">
						{selectedMarkers.length} selected
					</span>
					{#if canShape && pins.length}
						<ToolButton
							small
							{tip}
							icon={hidden ? 'hide' : 'reveal'}
							label="Visibility"
							hint={pins.length < selectedMarkers.length
								? 'Of the world markers among them'
								: !hidden
									? 'Everyone sees them'
									: hidden < pins.length
										? 'Some of them are hidden'
										: 'They are hidden'}
							shortcut={KEY.share}
							active={hidden > 0}
							onclick={() => onmarkervisibility(pins)}
						/>
					{/if}
					<ToolButton
						small
						{tip}
						icon="delete"
						label="Delete"
						hint={mine.length === 0
							? 'None of these are yours to delete'
							: mine.length < selectedMarkers.length
								? `The ${mine.length} that are yours to delete`
								: 'Ctrl+Z brings them back'}
						shortcut={KEY.remove}
						danger
						disabled={mine.length === 0}
						onclick={removeMarkers}
					/>
				</div>
			</div>
		{/if}

		<!-- The buttons for the region selected on a world map, floating over its
		     name. Out of sight until their size is known, and while the
		     region is off screen or a corner of it is in hand. -->
		{#if regionBar && canShape && selectedRegion && tool === 'pan'}
			<div
				class={[
					'absolute',
					regionBarPosition && regionBarW > 0 ? 'pointer-events-auto' : 'invisible'
				]}
				style:left="{regionBarPosition?.left ?? 0}px"
				style:top="{regionBarPosition?.top ?? 0}px"
				bind:clientWidth={regionBarW}
				bind:clientHeight={regionBarH}
			>
				{@render regionBar(selectedRegion, regionBarPosition?.tip ?? 'top')}
			</div>
		{/if}

		<!-- A text being typed, right where it will stand on the map and as big. -->
		{#if writing}
			{@const [x, y] = writing.at}
			<input
				class="pointer-events-auto absolute -ml-[calc(0.2em+1px)] -translate-y-1/2 rounded-[0.15em] border border-accent bg-night/75 px-[0.2em] py-[0.1em] leading-none font-semibold outline-none"
				style:left="{x * W * view.k + view.x}px"
				style:top="{y * H * view.k + view.y}px"
				style:font-size="{Math.max(13, writingSize)}px"
				style:color={writing.color}
				bind:value={words}
				size={Math.max(8, words.length + 2)}
				maxlength={LIMITS.drawingText}
				aria-label="Text to write on the map"
				use:takeFocus
				onblur={(e) => leftBox(e.currentTarget)}
				onkeydown={(e) => {
					if (e.key === 'Enter') doneWriting(true);
					if (e.key !== 'Escape') return;
					// Only the text is dropped. What Escape does next is for the next press.
					e.stopPropagation();
					doneWriting(false);
				}}
			/>
		{/if}

		{#if tool === 'draw'}
			<p class={hint}>
				{#if draft.length < 3}
					<span class="touch:hidden">Click to mark the corners of the region.</span>
					<span class="hidden touch:inline">Tap to mark the corners of the region.</span>
				{:else}
					<span class="touch:hidden">Click the first corner or press Enter to finish.</span>
					<span class="hidden touch:inline">Tap the first corner to finish.</span>
				{/if}
				<span class={keys}>Backspace removes a corner · Esc cancels</span>
			</p>
		{:else if tool === 'place'}
			<p class={hint}>
				<span class="touch:hidden">Click the map where it belongs.</span>
				<span class="hidden touch:inline">Tap the map where it belongs.</span>
				<span class={keys}>Esc cancels</span>
			</p>
		{:else if tool === 'measure'}
			<p class={hint}>
				{#if routing}
					<span class="touch:hidden">Click along the way. Double-click to end it.</span>
					<span class="hidden touch:inline">Tap along the way. Double-tap to end it.</span>
					<span class={keys}>Backspace takes a bend back · Esc puts the ruler away</span>
				{:else}
					<span class="touch:hidden">Drag to measure, or click along a road to follow it.</span>
					<span class="hidden touch:inline">Drag to measure, or tap along a road to follow it.</span>
					<span class={keys}>
						{#if battle}Alt measures off the grid ·{/if} Esc puts the ruler away
					</span>
				{/if}
			</p>
		{:else if tool === 'template'}
			<p class={hint}>
				{#if shape === 'circle'}
					Drag out from the middle of the circle.
				{:else if shape === 'cone'}
					Drag from the tip of the cone the way it points.
				{:else}
					Drag from one corner of the box to the other.
				{/if}
				<span class={keys}>Alt leaves the grid · Esc puts the pen away</span>
			</p>
		{:else if tool === 'select'}
			<p class={hint}>
				{battle
					? 'Drag a box around what you want to select.'
					: 'Drag a box around the markers to move, hide or delete together.'}
				<span class={keys}>Shift adds to the selection · Esc cancels</span>
			</p>
		{:else if tool === 'sketch'}
			<p class={hint}>
				Drag across the map to draw.
				<span class={keys}>Esc puts the pen away</span>
			</p>
		{:else if tool === 'reveal'}
			<p class={hint}>
				{#if fogNow.on}
					Paint over what the players may see.
					<span class={keys}>
						{keyLabel(KEY.brushSmaller)} {keyLabel(KEY.brushBigger)} size the brush ·
						{keyLabel(KEY.fogSwap)} covers instead · Esc puts it away
					</span>
				{:else}
					There is no fog on this map yet. Cover some of it first.
				{/if}
			</p>
		{:else if tool === 'cover'}
			<p class={hint}>
				Paint over what the fog should cover.
				<span class={keys}>
					{keyLabel(KEY.brushSmaller)} {keyLabel(KEY.brushBigger)} size the brush ·
					{#if fogNow.on}{keyLabel(KEY.fogSwap)} clears instead ·{/if} Esc puts it away
				</span>
			</p>
		{:else if tool === 'point'}
			<p class={hint}>
				<span class="touch:hidden">Hold the button down: the table sees where you point.</span>
				<span class="hidden touch:inline">Press and move a finger: the table sees where you point.</span>
				<span class={keys}>A click leaves a ping · Esc puts it away</span>
			</p>
		{:else if tool === 'align'}
			<p class={hint}>
				Drag a box over a few squares of the map's own grid, from corner to corner.
				<span class={keys}>Esc cancels</span>
			</p>
		{:else if tool === 'text' && !writing}
			<p class={hint}>
				<span class="touch:hidden">Click the map where the text goes.</span>
				<span class="hidden touch:inline">Tap the map where the text goes.</span>
				<span class={keys}>Esc cancels</span>
			</p>
		{/if}

		<!-- In the bottom corner, beside the tools. A narrow screen gives the
		     whole bottom edge to the tools, so there it sits in a top corner:
		     the left one, since tools are docked in the right. Fingers zoom by
		     pinching, which leaves only Fit to offer them. A table display has
		     none: its keys still zoom. -->
		<div
			class={[
				'pointer-events-auto absolute right-3.5 bottom-3.5 grid overflow-hidden rounded-[10px] border bg-panel max-[720px]:top-3.5 max-[720px]:right-auto max-[720px]:bottom-auto max-[720px]:left-3.5',
				passive && 'hidden'
			]}
		>
			<button
				class="{zoomButton} border-b text-[19px] touch:hidden"
				aria-label="Zoom in"
				aria-keyshortcuts={ariaKey(KEY.zoomIn)}
				title="Zoom in ({keyLabel(KEY.zoomIn)})"
				onclick={() => zoomBy(1.6)}
			>
				+
			</button>
			<button
				class="{zoomButton} border-b text-[19px] touch:hidden"
				aria-label="Zoom out"
				aria-keyshortcuts={ariaKey(KEY.zoomOut)}
				title="Zoom out ({keyLabel(KEY.zoomOut)})"
				onclick={() => zoomBy(1 / 1.6)}
			>
				−
			</button>
			<button
				class="{zoomButton} text-xs"
				aria-label="Fit the whole map"
				aria-keyshortcuts={ariaKey(KEY.fit)}
				title="Fit the whole map ({keyLabel(KEY.fit)})"
				onclick={fit}>Fit</button
			>
		</div>
	</div>
</div>
