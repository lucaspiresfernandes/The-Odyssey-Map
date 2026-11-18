<script lang="ts">
	// The map itself: pan, zoom, regions you can step into, and markers that
	// explain themselves. No map library, just one transformed layer.
	//
	// Markers and regions live in map space (0..1 across the image). The
	// `view` turns map space into screen pixels: screen = map * size * k + offset.
	//
	// A battle map is the same sheet used as a table: a grid drawn over it,
	// tokens to drag from cell to cell, a ruler that counts the cells
	// between, and lines and words the table draws on it. It holds no
	// markers and no regions.

	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { boxOf, capped, linePath, thinOut, touchesBox } from '#lib/shared/drawing.ts';
	import {
		cellsToFeet,
		feetBetween,
		feetCount,
		sitsOnCorner,
		snapToGrid
	} from '#lib/shared/grid.ts';
	import { canChangeDrawing, canEditWorld, canMoveToken } from '#lib/shared/rules.ts';
	import { tileLevelFor, tileLevels, tilesIn, type Tile } from '#lib/shared/tiles.ts';
	import {
		DRAWING_SIZE,
		LIMITS,
		ROTATION_STEP,
		TOKEN_SIZE_STEP,
		imageUrl,
		mapImageUrl,
		markerType,
		type Command,
		type Cursor,
		type CursorSpot,
		type Drawing,
		type MapInfo,
		type Marker,
		type Point,
		type Region,
		type Role,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import MarkerCard from './MarkerCard.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import SelectionBar from './SelectionBar.svelte';

	/** Where this browser is pointing on the map in front of it, and what it has in hand. */
	type Pointing = Omit<CursorSpot, 'mapId'>;

	interface Props {
		map: MapInfo;
		regions: Region[];
		markers: Marker[];
		/** The pieces on a battle map. A world map shows none. */
		tokens: Token[];
		/** What has been drawn and written on a battle map. */
		drawings: Drawing[];
		/** Where the other people looking at this map are pointing. */
		cursors: Cursor[];
		role: Role;
		userId: string;
		/**
		 * `pan` is the hand: it moves the map, and on a battle map selects and
		 * drags what is on it. `place` waits for a click that positions a
		 * marker, `draw` outlines a region. The rest are a battle map's:
		 * `select` drags a box around several things, `measure` a ruler across
		 * the map, `sketch` draws a line freehand, `text` waits for a click to
		 * start writing at.
		 */
		tool: 'pan' | 'place' | 'draw' | 'measure' | 'select' | 'sketch' | 'text';
		/** The colour `sketch` draws in and `text` writes in. */
		ink: string;
		/** How many maps deep this one is. Decides which way the arrival animation zooms. */
		depth: number;
		selectedMarkerId: string | null;
		selectedRegionId: string | null;
		/** The tokens and drawings selected on a battle map, by id. */
		selectedIds: string[];
		/**
		 * Carries out what was done to tokens and drawings. Resolves once the
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
		onedit: (marker: Marker) => void;
		onmove: (marker: Marker) => void;
		ondelete: (marker: Marker) => void;
		onhide: (marker: Marker, hidden: boolean) => void;
		/** The rest of what a token is, is to be changed: its picture, its colour, its outline. */
		onedittoken: (token: Token) => void;
		/** Where this browser is pointing on the map, or null when it is not over it. */
		oncursor: (at: Pointing | null) => void;
	}

	let {
		map,
		regions,
		markers,
		tokens,
		drawings,
		cursors,
		role,
		userId,
		tool,
		ink,
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
		onedit,
		onmove,
		ondelete,
		onhide,
		onedittoken,
		oncursor
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
	let bar = $state<ReturnType<typeof SelectionBar>>();
	/**
	 * What this person has in hand: one token or drawing, or a whole
	 * selection picked up by one of its own, the `lead`. `origins` is where
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
	/** A distance being measured with the ruler tool: from, to. */
	let measure = $state.raw<[Point, Point] | null>(null);
	/** A line being drawn, in map space, and the ones let go that the server hasn't answered for yet. */
	let stroke = $state.raw<Point[] | null>(null);
	let inked = $state.raw<{ points: Point[]; color: string }[]>([]);
	/** The box being dragged around things to select them: one corner, and the other. */
	let marquee = $state.raw<[Point, Point] | null>(null);
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
	const W = $derived(map.width);
	const H = $derived(map.height);
	const image = $derived(mapImageUrl(map));
	const fitK = $derived(cw > 0 && ch > 0 ? Math.min(cw / W, ch / H) * 0.94 : 1);
	const minK = $derived(fitK * 0.5);
	// A picture is only so sharp, so the zoom stops at twice its own pixels.
	// A map without one is drawn fresh at any size.
	const maxK = $derived(image ? Math.max(fitK * 2, 2) : Math.max(fitK * 16, 4));

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
		if (tool !== 'pan') return null;
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

	// ---------------------------------------------------------- battle maps

	const battle = $derived(map.kind === 'battle');
	/** The side of one grid cell, in map pixels. */
	const cell = $derived(map.grid.size);

	/** Every line of the grid as one path. Empty when there is no grid to draw. */
	const gridLines = $derived.by(() => {
		if (!battle || !map.grid.shown) return '';
		let d = '';
		for (let x = map.grid.x; x <= W; x += cell) d += `M${x} 0V${H}`;
		for (let y = map.grid.y; y <= H; y += cell) d += `M0 ${y}H${W}`;
		return d;
	});

	/** Tokens someone else has in hand right now, and where they are holding them. */
	const heldByOthers = $derived.by(() => {
		const spots = new Map<string, Point>();
		for (const other of cursors) {
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

	/** The hand is out on a battle map: what is on it can be selected and dragged. */
	const selecting = $derived(battle && tool === 'pan');
	const selectedTokens = $derived(
		selecting ? tokens.filter((t) => selectedIds.includes(t.id)) : []
	);
	const selectedDrawings = $derived(
		selecting ? drawings.filter((d) => selectedIds.includes(d.id)) : []
	);

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
			if (drawing.kind === 'line') {
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
		from: Point;
		to: Point;
		/** "6 cells". */
		length: string;
		tint: string;
	}

	/** Every distance being measured on this map right now: this person's, then everyone else's. */
	const rulers = $derived.by(() => {
		if (!battle) return [];
		const drawn: Omit<Ruler, 'length'>[] = [];
		// Carrying a token measures how far it has come.
		if (carry?.held && carry.measured) {
			const from = carry.origins[carry.lead];
			const to: Point = [from[0] + carry.rest[0], from[1] + carry.rest[1]];
			drawn.push({ key: 'mine', from, to, tint: '#fff' });
		} else if (measure) drawn.push({ key: 'mine', from: measure[0], to: measure[1], tint: '#fff' });
		for (const other of cursors) {
			if (!other.ruler) continue;
			const [from, to] = other.ruler;
			drawn.push({ key: other.id, from: clamped(from), to: clamped(to), tint: tintOf(other) });
		}
		return drawn.map(
			(ruler): Ruler => ({ ...ruler, length: feetCount(feetBetween(map, ruler.from, ruler.to)) })
		);
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

	/** Where a press is aiming: the middle of the cell under it, or with Alt held, the exact spot. */
	function aim(e: PointerEvent): Point {
		const at = clamped(toMap(e.clientX, e.clientY));
		return e.altKey ? at : snapToGrid(map, at);
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
		if (tool !== 'measure') measure = null;
		if (tool !== 'sketch') stroke = null;
		if (tool !== 'select') marquee = null;
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
				stroke = null;
				inked = [];
				marquee = null;
				writing = null;
			}
			shown = { key, id: map.id, depth };
			ready = true;
		});
	});

	// ---------------------------------------------------------------- tiles

	// A big image is a small preview with tiles over it: see
	// src/lib/shared/tiles.ts. A small one is shown whole, as it was uploaded.
	const levels = $derived(image ? tileLevels(W, H) : 0);
	const picture = $derived(levels > 0 ? mapImageUrl(map, 'preview') : image);

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
		const level = tileLevelFor(view.k * (window.devicePixelRatio || 1));
		let over: PlacedTile[] = [];
		if (level < levels) {
			// A little more than the screen, so a pan doesn't outrun them at once.
			const pad = 256;
			over = tilesIn(W, H, level, {
				x0: (-pad - view.x) / view.k,
				y0: (-pad - view.y) / view.k,
				x1: (cw + pad - view.x) / view.k,
				y1: (ch + pad - view.y) / view.k
			}).map((tile) => ({
				...tile,
				src: mapImageUrl(map, `${tile.level}/${tile.x}/${tile.y}`)!
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
		void [view, cw, ch, image, W, H];
		if (levels === 0) return;
		tileTimer ??= setTimeout(() => {
			tileTimer = undefined;
			retile();
		}, 80);
	});

	$effect(() => () => clearTimeout(tileTimer));

	// ------------------------------------------------------------- gestures

	type Gesture =
		| {
				type: 'pan';
				sx: number;
				sy: number;
				vx: number;
				vy: number;
				moved: boolean;
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
				lead: Token | Drawing;
				/** Where everything that comes along was when it was picked up. */
				origins: Record<string, Point>;
				/** How far it can all go each way before something leaves the map. */
				room: { x0: number; x1: number; y0: number; y1: number };
				sx: number;
				sy: number;
				moved: boolean;
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
		| { type: 'measure' }
		| { type: 'sketch' }
		/** `add` keeps what was already selected. */
		| { type: 'marquee'; add: boolean };

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

	// ------------------------------------------------------------- pointers

	/** Where this browser's mouse is over the map, in client pixels. */
	let mouse: { x: number; y: number } | null = null;

	function followMouse(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		mouse = { x: e.clientX, y: e.clientY };
		reportCursor();
	}

	function reportCursor() {
		if (!viewport || !ready) return oncursor(null);
		// A finger leaves no pointer behind, but what it is dragging has a place.
		const held = carry && inHandAt(carry.lead);
		const hand: Point | null = held ?? measure?.[1] ?? null;
		const at = mouse ? toMap(mouse.x, mouse.y) : hand;
		if (!at) return oncursor(null);

		const pointing: Pointing = { x: at[0], y: at[1] };
		if (carry && held) {
			// The table is shown the token under the pointer in this hand. The
			// rest of a selection arrives when it is put down. A hidden token is
			// moved in secret: nobody is shown it in the GM's hand.
			const { lead, origins, rest } = carry;
			const token = carry.measured ? tokens.find((t) => t.id === lead) : null;
			if (token && !token.hidden) {
				pointing.drag = { id: lead, x: held[0], y: held[1] };
				const from = origins[lead];
				if (carry.held) pointing.ruler = [from, [from[0] + rest[0], from[1] + rest[1]]];
			}
		} else if (measure) {
			pointing.ruler = measure;
		}
		oncursor(pointing);
	}

	// The map can move under a mouse that is holding still: a zoom, an
	// arrival, stepping into another map. The mouse is then over a different
	// spot, and the table should see that too. So should it when a token is
	// picked up or put down, or the ruler moves.
	$effect(() => {
		void [view, W, H, map.id, ready, carry, measure];
		untrack(reportCursor);
	});

	$effect(() => () => oncursor(null));

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

	function tintOf(other: Cursor): string {
		if (other.role === 'gm') return 'var(--color-accent)';
		let tint = tints.get(other.userId);
		if (!tint) tints.set(other.userId, (tint = TINTS[tints.size % TINTS.length]));
		return tint;
	}

	function onpointerdown(e: PointerEvent) {
		trackHover(e);
		followMouse(e);
		if (e.pointerType === 'mouse') {
			if (e.button !== 0) return;
			pointers.clear();
		}
		stopAnimation();
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 2) {
			// A second finger makes it a pinch, and drops whatever the first one held.
			if (carry?.held) carry = null;
			if (shaping?.held) shaping = null;
			measure = null;
			stroke = null;
			marquee = null;
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
			const from = aim(e);
			measure = [from, from];
			gesture = { type: 'measure' };
			capture(e.pointerId);
			return;
		}

		if (tool === 'sketch') {
			stroke = [clamped(toMap(e.clientX, e.clientY))];
			gesture = { type: 'sketch' };
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

		// A token or a drawing that is this person's to move is picked up.
		// Anything else is part of the map: pressing it pans, clicking it
		// selects it. With Shift held a click adds to the selection, so
		// nothing is picked up then either.
		const thing = selecting ? (tokenAt(target) ?? drawingAt(target)) : null;
		if (thing && canGrab(thing) && !e.shiftKey) {
			gesture = pickUp(thing, e, target);
			return;
		}

		gesture = {
			type: 'pan',
			sx: e.clientX,
			sy: e.clientY,
			vx: view.x,
			vy: view.y,
			moved: false,
			target
		};
	}

	/**
	 * Picks up what was pressed. When it is part of the selection, the rest
	 * of the selection that is this person's to move comes along.
	 */
	function pickUp(lead: Token | Drawing, e: PointerEvent, target: Element): Gesture {
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

	/** What to ask of the server once something carried has been put down. */
	function movesOf(origins: Record<string, Point>, [dx, dy]: Point): Command[] {
		const commands: Command[] = [];
		for (const [id, [x, y]] of Object.entries(origins)) {
			if (tokens.some((t) => t.id === id)) {
				const changes = { x: within(x + dx, 0, 1), y: within(y + dy, 0, 1) };
				commands.push({ t: 'token.update', id, changes });
			} else {
				commands.push({ t: 'drawing.update', id, changes: { move: [dx, dy] } });
			}
		}
		return commands;
	}

	function onpointermove(e: PointerEvent) {
		if (tool === 'draw' && e.pointerType === 'mouse') cursor = toMap(e.clientX, e.clientY);
		trackHover(e);
		followMouse(e);

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
				const by = fit([(e.clientX - g.sx) / (view.k * W), (e.clientY - g.sy) / (view.k * H)]);
				let rest = by;
				// A token comes down on the grid, and takes the others the same
				// way. With Alt held it stays exactly where it is put.
				if (isToken(g.lead) && !e.altKey) {
					const { x, y, size } = g.lead;
					const [rx, ry] = snapToGrid(map, [x + by[0], y + by[1]], size);
					rest = fit([rx - x, ry - y]);
				}
				carry = {
					lead: g.lead.id,
					origins: g.origins,
					by,
					rest,
					measured: isToken(g.lead),
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
			measure = [measure[0], aim(e)];
		} else if (g?.type === 'sketch' && stroke) {
			// A new point once the pointer has gone a couple of pixels on.
			const at = clamped(toMap(e.clientX, e.clientY));
			const [lx, ly] = stroke[stroke.length - 1];
			if (Math.hypot((at[0] - lx) * W, (at[1] - ly) * H) * view.k >= 2) stroke = [...stroke, at];
		} else if (g?.type === 'marquee' && marquee) {
			marquee = [marquee[0], toMap(e.clientX, e.clientY)];
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
		if (g?.type === 'pan' && !g.moved && completed) tap(e, g.target);
		if (g?.type === 'measure') measure = null;
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
		if (g?.type === 'grab') {
			const held = carry;
			if (!g.moved) {
				if (completed) tap(e, g.target);
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

		if (tool === 'place') {
			if (inside(point)) onplace(point[0], point[1]);
			return;
		}

		if (tool === 'draw') {
			if (draft.length >= 3 && (double || nearFirstCorner(e))) return finishDraft();
			if (!double && inside(point)) draft.push(point);
			lastTap = { at: now, x: e.clientX, y: e.clientY, regionId: null, thingId: null };
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

	function nearFirstCorner(e: PointerEvent): boolean {
		const rect = viewport!.getBoundingClientRect();
		const [x, y] = draft[0];
		const sx = x * W * view.k + view.x + rect.left;
		const sy = y * H * view.k + view.y + rect.top;
		return Math.hypot(e.clientX - sx, e.clientY - sy) < (e.pointerType === 'mouse' ? 14 : 24);
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

	function onkeydown(e: KeyboardEvent) {
		if (e.target instanceof Element && e.target.closest('input, textarea, select, dialog')) return;
		// Delete takes off the map whatever is selected on it.
		if (selecting && selectedIds.length && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			if (!e.repeat) bar?.remove();
			return;
		}
		if (tool !== 'draw') return;
		if (e.key === 'Enter' && draft.length >= 3) {
			e.preventDefault();
			finishDraft();
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			draft.pop();
		}
	}

	// Wheel listeners added through the template can be passive, and a
	// passive listener can't stop the page from scrolling.
	$effect(() => {
		const element = surface;
		if (!element) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
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

	/** Keyboard control of the view, for when the map itself has focus. */
	function onsurfacekeydown(e: KeyboardEvent) {
		if (e.target !== surface) return;
		const step = 80;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const move = moves[e.key];
		if (move) {
			fitting = false;
			stopAnimation();
			view = bounded({ k: view.k, x: view.x + move[0], y: view.y + move[1] });
		} else if (e.key === '+' || e.key === '=') {
			zoomBy(1.6);
		} else if (e.key === '-') {
			zoomBy(1 / 1.6);
		} else if (e.key === '0') {
			fit();
		} else {
			return;
		}
		e.preventDefault();
	}

	function toggleMarker(e: KeyboardEvent, marker: Marker) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		selectedMarkerId = selectedMarkerId === marker.id ? null : marker.id;
	}

	/** A token with the focus: Enter selects it, the arrow keys walk it a cell at a time. */
	function tokenKey(e: KeyboardEvent, token: Token) {
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
		if (!step || !canGrabToken(token)) return;
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
		// Only the GM ever has one of these to draw: dotted, and veiled, so it
		// reads as shut on a pale map as well as on a dark one.
		hidden: 'fill-[#0c0e14]/35 stroke-[#f2c14e] stroke-[1.5] [stroke-dasharray:2_5]'
	};

	function outlineOf(region: Region): string {
		if (selectedRegionId === region.id) return OUTLINE.selected;
		if (hoveredRegionId === region.id) return OUTLINE.hover;
		if (region.hidden) return OUTLINE.hidden;
		return OUTLINE.idle;
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
			tool === 'text'
				? 'cursor-text'
				: tool !== 'pan'
					? 'cursor-crosshair'
					: dragging
						? 'cursor-grabbing'
						: 'cursor-grab'
		]}
		data-tool={tool}
		bind:this={surface}
		role="application"
		aria-label="Map of {map.name}. Arrow keys pan, plus and minus zoom, zero fits the map."
		tabindex="0"
		onkeydown={onsurfacekeydown}
		{onpointerdown}
		{onpointermove}
		onpointerup={(e) => release(e, true)}
		onpointercancel={(e) => release(e, false)}
		onpointerleave={() => {
			clearHover();
			mouse = null;
			reportCursor();
		}}
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
			{#if picture}
				<!-- The picture never takes the pointer, so holding a finger on the map
				     doesn't bring up the browser's menu for saving it. -->
				<img
					class="pointer-events-none block h-full w-full rounded-[3px] shadow-map [-webkit-user-drag:none]"
					src={picture}
					alt=""
					width={W}
					height={H}
					draggable="false"
				/>
				{#if tiling.of === image}
					<div class="pointer-events-none absolute inset-0 overflow-hidden rounded-[3px]">
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
								onload={() => tileArrived(tile.src)}
								onerror={() => tileArrived(tile.src)}
							/>
						{/each}
					</div>
				{/if}
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
					{@const [x1, y1] = ruler.from}
					{@const [x2, y2] = ruler.to}
					<g style:--c={ruler.tint}>
						<line
							class="stroke-[#0c0e14]/60 stroke-[5] stroke-steady [stroke-linecap:round]"
							x1={x1 * W}
							y1={y1 * H}
							x2={x2 * W}
							y2={y2 * H}
						/>
						<line
							class="stroke-(--c) stroke-[2.5] stroke-steady [stroke-dasharray:7_5]"
							x1={x1 * W}
							y1={y1 * H}
							x2={x2 * W}
							y2={y2 * H}
						/>
						{#each [ruler.from, ruler.to] as [x, y], i (i)}
							<circle
								class="fill-(--c) stroke-[#12151c] stroke-[1.5] stroke-steady"
								cx={x * W}
								cy={y * H}
								r={4 / view.k}
							/>
						{/each}
					</g>
				{/each}

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

			<!-- Every region wears its name, lettered straight onto the map like a place
			     name in an atlas: quiet until the region is hovered, and never boxed in.
			     It comes before the markers, so it is never drawn over one, and it never
			     takes the pointer, so the outline beneath it still does. -->
			{#each orderedRegions as region (region.id)}
				{@const [x, y] = labelSpot(pointsOf(region))}
				{@const lit = litRegionId === region.id}
				<div
					class="pointer-events-none absolute w-max max-w-[300px] -translate-1/2 scale-(--inv) text-center text-shadow-map"
					style:left="{x * W}px"
					style:top="{y * H}px"
				>
					<strong
						class={[
							'block font-serif text-[17px] leading-[1.2] font-semibold tracking-[0.02em] wrap-anywhere transition-[opacity,color] duration-150',
							lit ? 'text-white' : 'text-[#fff8e4] opacity-55'
						]}>{region.name}</strong
					>
					{#if lit || region.hidden}
						<!-- How to get in, and for the GM whether players can. Out of the flow,
						     so the name does not jump when it appears. -->
						<span
							class="absolute top-[calc(100%+2px)] left-1/2 -translate-x-1/2 text-xs whitespace-nowrap text-[#e4dcc6]"
						>
							{#if region.hidden}
								<span class="font-semibold text-[#f2c14e]">Hidden{lit ? ' ·' : ' from players'}</span>
							{/if}
							{#if lit}
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
			     from its neighbours. -->
			{#if battle}
				{#each tokens as token (token.id)}
					{@const [x, y] = spotOf(token)}
					{@const mine = canGrabToken(token)}
					{@const inHand = !!carry?.held && token.id in carry.origins}
					{@const selected = selecting && selectedIds.includes(token.id)}
					{@const across = sizeOf(token) * cell}
					{@const turn = turnOf(token)}
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
						<button
							class={[
								'absolute grid -translate-1/2 place-items-center overflow-hidden rounded-full border-(--o) bg-(--c) leading-none font-semibold text-[#12151c] [-webkit-tap-highlight-color:transparent]',
								inHand ? 'cursor-grabbing' : mine ? 'cursor-grab' : 'cursor-pointer',
								selected ? 'token-selected' : inHand ? 'token-lifted' : 'token-shadow',
								// Only the GM ever has a hidden one to draw.
								token.hidden && 'border-dashed opacity-55',
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
							title="{token.name}{token.locked ? ' · locked' : ''}"
							aria-label="Token: {token.name}{token.hidden ? ' (hidden from players)' : ''}{mine
								? '. Arrow keys move it.'
								: ''}"
							aria-pressed={selected}
							tabindex={tool === 'pan' ? 0 : -1}
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
						{#if across * view.k >= 26 || selected}
							<span
								class="pointer-events-none absolute left-0 w-max max-w-[160px] origin-top -translate-x-1/2 scale-(--inv) truncate pt-0.5 text-xs font-semibold text-[#fff8e4] text-shadow-map"
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

			<!-- Pins live in the scaled layer, so they follow the map for free. World
			     markers are teardrops in their type's colour (--c). Table notes look
			     like paper tags, so the two can be told apart at a glance. -->
			{#each orderedMarkers as marker (marker.id)}
				{@const type = markerType(marker.type)}
				{@const selected = selectedMarkerId === marker.id}
				{@const raised = active?.id === marker.id}
				{@const shape = [
					'block',
					selected ? 'pin-selected' : 'pin-shadow group-focus-visible:pin-focused',
					marker.hidden && 'opacity-55'
				]}
				<button
					class={[
						'group absolute origin-bottom -translate-x-1/2 -translate-y-full scale-(--inv) cursor-pointer text-[#12151c] [-webkit-tap-highlight-color:transparent] focus-visible:outline-none',
						(selected || raised) && 'z-1',
						tool !== 'pan' && 'pointer-events-none opacity-60'
					]}
					data-marker-id={marker.id}
					style:left="{marker.x * W}px"
					style:top="{marker.y * H}px"
					style:--c={type.color}
					aria-label="{type.label}: {marker.title}{marker.hidden ? ' (hidden from players)' : ''}"
					aria-pressed={selectedMarkerId === marker.id}
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

			<!-- Everyone else's mouse, each in its own colour (--c). On top of the map,
			     and never in the way of your own. Only the position glides from one
			     report to the next, not the size in a zoom. -->
			{#each cursors as other (other.id)}
				<div
					class="pointer-events-none absolute top-0 left-0 z-3 flex origin-top-left scale-(--inv) items-start transition-[translate] duration-80 ease-linear motion-reduce:transition-none"
					style:translate="{other.x * W}px {other.y * H}px"
					style:--c={tintOf(other)}
					aria-hidden="true"
				>
					<!-- The negative margins put the tip of the arrow exactly on the spot. -->
					<svg
						class="-mt-[1.5px] -ml-0.5 shrink-0 drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
						viewBox="0 0 18 22"
						width="18"
						height="22"
					>
						<path
							class="fill-(--c) stroke-[#12151c] stroke-[1.5] [stroke-linejoin:round]"
							d="M2 1.5v16l4.4-4 2.9 6.6 2.7-1.2-2.9-6.5h6Z"
						/>
					</svg>
					<span
						class="mt-[17px] -ml-[3px] max-w-[150px] truncate rounded-[3px_9px_9px_9px] bg-(--c) px-[7px] text-xs leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]"
						>{other.name}</span
					>
				</div>
			{/each}

			<!-- How long each ruler is, written at the end it is being pulled to. -->
			{#each rulers as ruler (ruler.key)}
				{#if ruler.from[0] !== ruler.to[0] || ruler.from[1] !== ruler.to[1]}
					<div
						class="pointer-events-none absolute top-0 left-0 z-3 size-0 origin-top-left scale-(--inv)"
						style:translate="{ruler.to[0] * W}px {ruler.to[1] * H}px"
						style:--c={ruler.tint}
					>
						<span
							class="absolute bottom-3 left-0 -translate-x-1/2 rounded-full border border-(--c) bg-night/90 px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
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
			{@const pinned = active.id === selectedMarkerId}
			<!-- Kept out of sight until its size is known, so it never flashes in the wrong place. -->
			<div
				class={['absolute', cardW === 0 && 'invisible', pinned && 'pointer-events-auto']}
				style:left="{cardPosition.left}px"
				style:top="{cardPosition.top}px"
				bind:clientWidth={cardW}
				bind:clientHeight={cardH}
			>
				<MarkerCard
					marker={active}
					{role}
					{userId}
					{pinned}
					onclose={() => (selectedMarkerId = null)}
					{onedit}
					{onmove}
					{ondelete}
					{onhide}
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
				/>
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
				Drag across the map to measure.
				<span class={keys}>Alt measures off the grid · Esc puts the ruler away</span>
			</p>
		{:else if tool === 'select'}
			<p class={hint}>
				Drag a box around what you want to select.
				<span class={keys}>Shift adds to the selection · Esc cancels</span>
			</p>
		{:else if tool === 'sketch'}
			<p class={hint}>
				Drag across the map to draw.
				<span class={keys}>Esc puts the pen away</span>
			</p>
		{:else if tool === 'text' && !writing}
			<p class={hint}>
				<span class="touch:hidden">Click the map where the text goes.</span>
				<span class="hidden touch:inline">Tap the map where the text goes.</span>
				<span class={keys}>Esc cancels</span>
			</p>
		{/if}

		<!-- In the bottom corner, beside the tools. A narrow screen gives the
		     whole bottom edge to the tools, so there it sits in the top corner:
		     the right one, or on a battle map, where the tools are docked in
		     that one, the left. Fingers zoom by pinching, which leaves only Fit
		     to offer them. -->
		<div
			class={[
				'pointer-events-auto absolute right-3.5 bottom-3.5 grid overflow-hidden rounded-[10px] border bg-panel max-[720px]:top-3.5 max-[720px]:bottom-auto',
				battle && 'max-[720px]:right-auto max-[720px]:left-3.5'
			]}
		>
			<button
				class="{zoomButton} border-b text-[19px] touch:hidden"
				aria-label="Zoom in"
				onclick={() => zoomBy(1.6)}
			>
				+
			</button>
			<button
				class="{zoomButton} border-b text-[19px] touch:hidden"
				aria-label="Zoom out"
				onclick={() => zoomBy(1 / 1.6)}
			>
				−
			</button>
			<button class="{zoomButton} text-xs" aria-label="Fit the whole map" onclick={fit}>Fit</button>
		</div>
	</div>
</div>
