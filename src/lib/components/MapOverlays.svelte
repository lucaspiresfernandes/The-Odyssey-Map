<script lang="ts">
	// What floats over a map, in screen space: the card of a marker, the
	// buttons beside whatever is selected, a text being typed, what the tool
	// in hand is waiting for, and the zoom buttons. Only the parts that ask
	// for the pointer get it.
	//
	// It works out where each goes from how the map lies on the screen, and
	// hands the keys of the selection on to the buttons they belong to.

	import type { Snippet } from 'svelte';
	import type { View } from '#lib/client/mapview.ts';
	import {
		barSpot,
		cardSpot,
		extentOf,
		regionBarSpot,
		type Frame
	} from '#lib/client/placement.ts';
	import type { Stage } from '#lib/client/stage.svelte.ts';
	import { DOUBLE_TAP_MS } from '#lib/client/tools/board.ts';
	import type { Carry } from '#lib/client/tools/carry.svelte.ts';
	import type { FogBrush } from '#lib/client/tools/fog-brush.svelte.ts';
	import { PIN_HEIGHT } from '#lib/client/tools/marquee.ts';
	import type { Pen } from '#lib/client/tools/pen.svelte.ts';
	import type { RegionShaper } from '#lib/client/tools/regions.svelte.ts';
	import type { RulerTool } from '#lib/client/tools/ruler.svelte.ts';
	import type { Shaper } from '#lib/client/tools/shaper.svelte.ts';
	import { boxOf } from '#lib/shared/drawing.ts';
	import type {
		Command,
		Drawing,
		MapInfo,
		Marker,
		Player,
		Point,
		Region,
		Role,
		TemplateKind,
		Token
	} from '#lib/shared/types.ts';
	import MarkerCard from './MarkerCard.svelte';
	import MarkerSelectionBar from './MarkerSelectionBar.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import TextBox from './TextBox.svelte';
	import ToolHints from './ToolHints.svelte';
	import ZoomButtons from './ZoomButtons.svelte';

	interface Props {
		map: MapInfo;
		role: Role;
		userId: string;
		players: Player[];
		canShape: boolean;
		passive: boolean;
		tool: string;
		battle: boolean;
		/** Which template the pen lays down. */
		shape: TemplateKind;
		/** The map as it lies on the screen. */
		frame: Frame;
		view: View;
		W: number;
		H: number;
		/** The side of one grid cell, in map pixels. */
		cell: number;
		/** The marker whose card is showing. */
		active: Marker | null;
		selectedMarkerId: string | null;
		selectedIds: string[];
		tokens: Token[];
		selectedTokens: Token[];
		selectedDrawings: Drawing[];
		/** The tokens standing inside the shapes selected. */
		insideSelected: Token[];
		selectedMarkers: Marker[];
		/** The world markers among them. */
		selectedPins: Marker[];
		selectedRegion: Region | null;
		/** The token that wears handles. */
		handled: Token | null;
		/** A handle of a shape is being dragged: its buttons keep out of the way. */
		reshaping: boolean;
		markerSpot: (marker: Marker) => Point;
		spotOf: (token: Token) => Point;
		shiftOf: (drawing: Drawing) => Point;
		/** The box being dragged around things to select them. */
		marquee: [Point, Point] | null;
		/** How much bigger what a finger has to catch is than what a mouse does. */
		grip: number;
		/** How far beyond a token's rim the handle that turns it stands, on screen. */
		turnReach: number;
		/** How tall each region's name stands on screen, by the region's id. */
		nameHeights: Record<string, number>;
		// The tools of the map, for what each is in the middle of.
		stage: Stage;
		hand: Carry;
		shaper: Shaper;
		pen: Pen;
		outlines: RegionShaper;
		ruler: RulerTool;
		brush: FogBrush;
		send: (commands: Command[], note?: string) => Promise<boolean>;
		onedit: (marker: Marker) => void;
		onmove: (marker: Marker) => void;
		ondelete: (marker: Marker) => void;
		onhide: (marker: Marker, hidden: boolean) => void;
		onmarkervisibility: (markers: Marker[]) => void;
		onedittoken: (token: Token) => void;
		onpiecevisibility: (things: (Token | Drawing)[]) => void;
		/** The buttons for the region that is selected. */
		regionBar?: Snippet<[region: Region, tip: 'top' | 'bottom']>;
	}

	let {
		map,
		role,
		userId,
		players,
		canShape,
		passive,
		tool,
		battle,
		shape,
		frame,
		view,
		W,
		H,
		cell,
		active,
		selectedMarkerId = $bindable(),
		selectedIds = $bindable(),
		tokens,
		selectedTokens,
		selectedDrawings,
		insideSelected,
		selectedMarkers,
		selectedPins,
		selectedRegion,
		handled,
		reshaping,
		markerSpot,
		spotOf,
		shiftOf,
		marquee,
		grip,
		turnReach,
		nameHeights,
		stage,
		hand,
		shaper,
		pen,
		outlines,
		ruler,
		brush,
		send,
		onedit,
		onmove,
		ondelete,
		onhide,
		onmarkervisibility,
		onedittoken,
		onpiecevisibility,
		regionBar
	}: Props = $props();

	// What the tools hold, under the names the markup below reads them by.
	const carry = $derived(hand.now);
	const shaping = $derived(shaper.now);
	const writing = $derived(pen.writing);
	const draft = $derived(outlines.draft);
	const routing = $derived(ruler.routing);
	const fogNow = $derived(brush.now);
	// svelte-ignore state_referenced_locally
	const { sizeOf } = shaper;

	// How big each of them is on screen, once it is known: they are placed by it.
	let cardW = $state(0);
	let cardH = $state(0);
	let barW = $state(0);
	let barH = $state(0);
	let regionBarW = $state(0);
	let regionBarH = $state(0);
	let bar = $state<ReturnType<typeof SelectionBar>>();
	let markerBar = $state<ReturnType<typeof MarkerSelectionBar>>();
	let card = $state<ReturnType<typeof MarkerCard>>();

	const cardPosition = $derived(
		active && cardSpot(frame, [active.x, active.y], PIN_HEIGHT + 12, 12, cardW, cardH)
	);

	/**
	 * Where the buttons for those markers float: under the lowest of them,
	 * or over the top of them all when that is too low on the screen.
	 */
	const markerBarPosition = $derived.by(() => {
		if (carry?.held || marquee || tool !== 'pan' || selectedMarkers.length === 0) return null;
		return barSpot(
			frame,
			boxOf(selectedMarkers.map(markerSpot)),
			{ w: barW, h: barH },
			{ raise: PIN_HEIGHT, drop: 8, lift: 8 }
		);
	});

	/**
	 * Where the buttons for the selected region float: over its name. They
	 * are out of the way while a corner is in hand.
	 */
	const regionBarPosition = $derived.by(() => {
		if (!selectedRegion || tool !== 'pan' || outlines.reshape || selectedMarkers.length > 0) {
			return null;
		}
		return regionBarSpot(frame, selectedRegion.points, nameHeights[selectedRegion.id] ?? 20, {
			w: regionBarW,
			h: regionBarH
		});
	});

	/**
	 * The region whose buttons have been up long enough to be meant. They can
	 * come up right under the mouse, and the click that selected the region
	 * may be the first of two: until a second one would no longer make a
	 * double click, it goes through them to the region.
	 */
	let settledRegionId = $state<string | null>(null);
	const selectedRegionId = $derived(selectedRegion?.id ?? null);
	$effect(() => {
		const id = selectedRegionId;
		if (id === null) return;
		const timer = setTimeout(() => (settledRegionId = id), DOUBLE_TAP_MS);
		return () => {
			clearTimeout(timer);
			settledRegionId = null;
		};
	});

	/**
	 * Where the buttons for the selection float: just under it, in the middle,
	 * or over the top of it when it is too low on the screen for that.
	 */
	const barPosition = $derived.by(() => {
		if (carry?.held || shaping?.held || reshaping || marquee || writing) return null;
		if (selectedTokens.length + selectedDrawings.length === 0) return null;
		const box = extentOf(selectedTokens, selectedDrawings, { W, H, cell, spotOf, sizeOf, shiftOf });
		// A token's name is written under it, so the buttons go under that. With
		// no room left down there they go over the top, clear of the handle
		// that turns a token.
		const clear = handled ? turnReach + 18 * grip : 0;
		return barSpot(
			frame,
			box,
			{ w: barW, h: barH },
			{ drop: 6 + (selectedTokens.length ? 18 : 0), lift: 12 + clear }
		);
	});

	/** Copies of tokens were asked for. Once they are made, they are what is selected. */
	async function copy(commands: Command[]) {
		const had = new Set(tokens.map((t) => t.id));
		if (await send(commands)) {
			selectedIds = tokens.filter((t) => !had.has(t.id)).map((t) => t.id);
		}
	}

	// The keys of what is selected are the map's to hear. It hands them on
	// through these.

	/**
	 * Puts away whatever box is out beside what is selected: a label being
	 * typed, the marks, the number. True if one was.
	 */
	export function shut(): boolean {
		return !!bar?.shut();
	}

	/** Takes off the map whatever is selected on a battle map. */
	export function removeSelection() {
		bar?.remove();
	}

	/** Takes off the map the markers selected together on a world map. */
	export function removeMarkers() {
		markerBar?.remove();
	}

	/** Hides those markers from the players, or shows them again. */
	export function hideMarkers() {
		markerBar?.hide();
	}

	/** A key for the buttons under the selection of a battle map. True if it was one of theirs. */
	export function barKey(key: string, held: boolean): boolean {
		return !!bar?.key(key, held);
	}

	/** A key for the buttons on the card of a pinned marker. True if it was one of theirs. */
	export function cardKey(key: string, held: boolean): boolean {
		return !!card?.key(key, held);
	}
</script>

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
					pen.write(drawing);
				}}
				onclear={() => (selectedIds = [])}
				onpick={(picked) => (selectedIds = picked.map((token) => token.id))}
				onvisibility={onpiecevisibility}
			/>
		</div>
	{/if}

	<!-- The buttons for the markers selected together on a world map,
	     floating under them the same way. -->
	<MarkerSelectionBar
		bind:this={markerBar}
		{selectedMarkers}
		{selectedPins}
		{role}
		{userId}
		{canShape}
		{markerBarPosition}
		bind:barW
		bind:barH
		{send}
		onclear={() => (selectedIds = [])}
		{onmarkervisibility}
	/>

	<!-- The buttons for the region selected on a world map, floating over its
	     name. Out of sight until their size is known, and while the
	     region is off screen or a corner of it is in hand. For a moment after
	     the region is selected they let the pointer through, so the second
	     click of a double click reaches the region under them. -->
	{#if regionBar && canShape && selectedRegion && tool === 'pan'}
		<div
			class={[
				'absolute',
				!(regionBarPosition && regionBarW > 0) && 'invisible',
				settledRegionId === selectedRegion.id && 'pointer-events-auto'
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
	<TextBox {pen} {W} {H} {view} />

	<ToolHints
		{tool}
		corners={draft.length}
		{routing}
		{battle}
		{shape}
		fogOn={fogNow.on}
		writing={!!writing}
	/>

	<ZoomButtons {passive} onzoom={(factor) => stage.zoomBy(factor)} onfit={() => stage.fit()} />
</div>
