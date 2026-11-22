<script lang="ts">
	// The picture under a map: its own image, or the part of one from further
	// out that it borrows, or plain paper. A big image is a small preview
	// with tiles laid over it, at the size the zoom calls for.

	import { devicePixelRatio } from 'svelte/reactivity/window';
	import type { View } from '#lib/client/mapview.ts';
	import type { frameOf } from '#lib/shared/backdrop.ts';
	import { tileLevelFor, tileLevels, tilesIn, type Tile } from '#lib/shared/tiles.ts';
	import { imageUrl, type Backdrop, type MapInfo } from '#lib/shared/types.ts';

	interface Props {
		map: MapInfo;
		/** The picture, and the part of it that shows. Null for plain paper. */
		source: Backdrop | null;
		/** The size of a map with a borrowed picture, or null for one with its own. */
		borrowed: ReturnType<typeof frameOf> | null;
		/** How many pixels of the map one pixel of the picture covers. */
		blownUp: number;
		/** Where the picture is loaded from. */
		image: string | null;
		battle: boolean;
		view: View;
		/** The size of the screen the map is on. */
		cw: number;
		ch: number;
	}

	let { map, source, borrowed, blownUp, image, battle, view, cw, ch }: Props = $props();

	const within = (value: number, low: number, high: number) =>
		Math.min(high, Math.max(low, value));

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
</script>

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
