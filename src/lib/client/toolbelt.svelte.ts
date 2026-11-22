// What someone has in hand on a map: the hand itself, or one of the tools.
// A world map and a battle map each have their own, and taking one up puts
// the last one away.

import type { Marker, MarkerKind, Rect, TemplateKind } from '#lib/shared/types.ts';

/**
 * What is in hand on a battle map. `pan` is the hand itself: it selects
 * and moves things. The others are picked from the palette in the corner.
 * `sketch` is the pen, which draws a line freehand or one of the shapes:
 * see `PenKind`. `reveal` and `cover` are the GM's two ways with the fog
 * of war, and `align` is theirs too: it lines the grid up with the squares
 * of the map's own picture. With `point` in hand, the table is shown
 * where the pointer is for as long as its button is held down.
 */
export type BattleTool =
	| 'pan'
	| 'select'
	| 'measure'
	| 'sketch'
	| 'point'
	| 'reveal'
	| 'cover'
	| 'align';

/** What the pen draws: a line freehand, a shape dragged out, or text. */
export type PenKind = 'line' | TemplateKind | 'text';

/** A marker waiting for a click on the map: a new one to put down, or one to move. */
export type Placing = { create: MarkerKind } | { move: Marker };

/** The tool as the map canvas knows it. To the map, the pen is three tools. */
export type MapTool =
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

/** What the belt needs to know of the map it is worn on, and what it asks of the page. */
interface Table {
	battle(): boolean;
	/** There is fog on the map. */
	fogOn(): boolean;
	/** What the pen draws. */
	pen(): PenKind;
	/** The world map has a scale for the ruler to go by. */
	hasScale(): boolean;
	/** The ruler was asked for on a map with no scale: the GM is asked for one. */
	askScale(): void;
	/** Nothing on the map is selected any more. */
	letGo(): void;
	/** The pinned marker and the selected region are let go of. What is selected together stays. */
	unpin(): void;
	/** What is selected together is let go of. */
	deselect(): void;
	/** The regions are shown again, if they were filtered out. */
	showRegions(): void;
}

export class Toolbelt {
	/** A marker is waiting for the click that puts it on a world map. */
	placing = $state<Placing | null>(null);
	/** The outline of a region is being drawn. */
	drawing = $state(false);
	/** The ruler is out on a world map. */
	measuring = $state(false);
	/** The pointing tool is in hand on a world map: held down, the pointer shows to the table. */
	pointing = $state(false);
	/** The box that selects several markers together is in hand on a world map. */
	boxing = $state(false);
	/**
	 * The GM is at the fog of a world map by hand: clearing some of it, or
	 * covering the map again.
	 */
	fogTool = $state<'reveal' | 'cover' | null>(null);
	battleTool = $state<BattleTool>('pan');
	/** The box the GM dragged over the squares of the map's picture, to line the grid up by. */
	alignBox = $state.raw<Rect | null>(null);

	#table: Table;

	constructor(table: Table) {
		this.#table = table;
	}

	/** What is in hand, as the map canvas is told it. */
	readonly tool = $derived.by((): MapTool => {
		if (this.#table.battle()) {
			// To the map, the pen is three tools: one that follows the pointer,
			// one that drags a shape out, and one that waits for a click to
			// start writing at.
			if (this.battleTool !== 'sketch') return this.battleTool;
			const pen = this.#table.pen();
			return pen === 'line' ? 'sketch' : pen === 'text' ? 'text' : 'template';
		}
		if (this.placing) return 'place';
		if (this.drawing) return 'draw';
		if (this.measuring) return 'measure';
		if (this.pointing) return 'point';
		if (this.boxing) return 'select';
		return this.fogTool ?? 'pan';
	});
	/** The GM has one of the two fog tools in hand on a battle map. */
	readonly fogging = $derived(this.battleTool === 'reveal' || this.battleTool === 'cover');
	/** Which of the two the GM has in hand, on either kind of map. */
	readonly fogHand = $derived.by(() =>
		this.#table.battle()
			? this.battleTool === 'reveal' || this.battleTool === 'cover'
				? this.battleTool
				: null
			: this.fogTool
	);

	/** Something other than the hand is out. */
	get busy(): boolean {
		return !!(
			this.placing ||
			this.drawing ||
			this.measuring ||
			this.pointing ||
			this.boxing ||
			this.fogTool ||
			this.battleTool !== 'pan'
		);
	}

	/** Back to the hand: whichever tool was waiting for the map is put away. */
	putAway = () => {
		this.placing = null;
		this.drawing = false;
		this.measuring = false;
		this.pointing = false;
		this.boxing = false;
		this.fogTool = null;
		this.battleTool = 'pan';
		this.alignBox = null;
	};

	// ------------------------------------------------------------ world maps

	/** A marker is to be put down, or moved: the next click on the map says where. */
	startPlacing = (next: Placing) => {
		this.putAway();
		this.#table.letGo();
		this.placing = next;
	};

	/**
	 * Takes the ruler out on a world map, or with it out already, puts it
	 * away. One with no scale has nothing to tell: the GM is asked for it,
	 * in the map's settings.
	 */
	startMeasuring = () => {
		if (!this.#table.hasScale()) return this.#table.askScale();
		const out = this.measuring;
		this.putAway();
		if (out) return;
		this.#table.letGo();
		this.measuring = true;
	};

	/**
	 * Takes up the pointing tool on a world map: from then on the table is
	 * shown where the pointer is whenever its button is held down, until the
	 * tool is put away again, which a second click on it does.
	 */
	startPointing = () => {
		const out = this.pointing;
		this.putAway();
		if (out) return;
		this.#table.letGo();
		this.pointing = true;
	};

	/**
	 * Takes up the box that selects several markers of a world map, or with
	 * it in hand already, puts it away. What it catches is moved by dragging
	 * one of them, and has its buttons under it. What was selected together
	 * before stays so: with Shift held, the box adds to it.
	 */
	startBoxing = () => {
		const out = this.boxing;
		this.putAway();
		if (out) return;
		this.#table.unpin();
		this.boxing = true;
	};

	/** Starts the outline of a new region. */
	startRegion = () => {
		this.putAway();
		this.#table.letGo();
		// A region about to be drawn shouldn't vanish once it is
		// done, nor be laid blind over the ones already there.
		this.#table.showRegions();
		this.drawing = true;
	};

	// ----------------------------------------------------------- battle maps

	/** Takes a tool of the battle map in hand. */
	take = (next: BattleTool) => {
		this.battleTool = next;
		if (next !== 'align') this.alignBox = null;
		// A box to select with keeps what is selected: Shift adds to it.
		if (next !== 'pan' && next !== 'select') this.#table.deselect();
	};

	/** A click on a tool picks it up, or with that one in hand, puts it down again. */
	pick = (next: BattleTool) => {
		this.take(this.battleTool === next ? 'pan' : next);
	};

	// ------------------------------------------------------------------- fog

	/**
	 * The fog button of a battle map takes up whichever of its two tools has
	 * something to do: clearing where there is fog, covering where there is
	 * none yet.
	 */
	pickFog = () => {
		this.take(this.fogging ? 'pan' : this.#table.fogOn() ? 'reveal' : 'cover');
	};

	/**
	 * Takes up the fog of a world map: whichever of its two tools has
	 * something to do, clearing where there is fog, covering where there is
	 * none yet. They come out beside the button while one is in hand, the
	 * same ones a battle map has, and a second click puts them away.
	 */
	pickWorldFog = () => {
		const out = this.fogTool !== null;
		this.putAway();
		if (out) return;
		this.#table.letGo();
		this.fogTool = this.#table.fogOn() ? 'reveal' : 'cover';
	};

	/** Takes one of the fog's two tools in hand, on either kind of map. */
	takeFog = (next: 'reveal' | 'cover') => {
		if (this.#table.battle()) this.take(next);
		else this.fogTool = next;
	};

	/** With one of the fog's two tools in hand, takes up the other. */
	swapFog = () => {
		// Where there is no fog yet there is none to clear.
		if (this.fogHand === 'cover' && !this.#table.fogOn()) return;
		if (this.fogHand) this.takeFog(this.fogHand === 'reveal' ? 'cover' : 'reveal');
	};
}
