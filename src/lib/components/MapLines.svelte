<script lang="ts">
	// The lines drawn over a map: the outlines of its regions, the one being
	// drawn, the corners the selected one is reshaped by, the rulers, and the
	// boxes dragged to line the grid up or to select with.

	import type { Ruler, View } from '#lib/client/mapview.ts';
	import { boxOf } from '#lib/shared/drawing.ts';
	import { LIMITS, type Point, type Rect, type Region } from '#lib/shared/types.ts';

	interface Props {
		/** The regions, the smallest last, so a district inside a larger outline stays reachable. */
		orderedRegions: Region[];
		/** A region's corners, as they are being reshaped or as they are. */
		pointsOf: (region: Region) => Point[];
		tool: string;
		/** The regions that are new to whoever is looking. */
		fresh: string[];
		/** The corners of the region being drawn. */
		draft: Point[];
		/** Where the mouse is, for the edge of that region that is still to be laid. */
		cursor: Point | null;
		view: View;
		W: number;
		H: number;
		canShape: boolean;
		selectedRegion: Region | null;
		selectedRegionId: string | null;
		hoveredRegionId: string | null;
		/** How much bigger what a finger has to catch is than what a mouse does. */
		grip: number;
		rulers: Ruler[];
		/** The box the grid is being lined up by. */
		alignBox: Rect | null;
		/** The box being dragged around things to select them. */
		marquee: [Point, Point] | null;
	}

	let {
		orderedRegions,
		pointsOf,
		tool,
		fresh,
		draft,
		cursor,
		view,
		W,
		H,
		canShape,
		selectedRegion,
		selectedRegionId,
		hoveredRegionId,
		grip,
		rulers,
		alignBox,
		marquee
	}: Props = $props();

	function svgPoints(points: Point[]): string {
		return points.map(([x, y]) => `${x * W},${y * H}`).join(' ');
	}

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
</script>

<svg
	class="pointer-events-none absolute inset-0 overflow-visible"
	viewBox="0 0 {W} {H}"
	width={W}
	height={H}
	aria-hidden="true"
>
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
