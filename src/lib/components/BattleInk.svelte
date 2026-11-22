<script lang="ts">
	// What is drawn on a battle map under its pieces: the grid, the shapes
	// that mark out the area of a spell, the lines the table drew, and what
	// it wrote. And what this person is drawing right now, or has just drawn
	// and the server has yet to send back.

	import type { LaidTemplate, View, Writing } from '#lib/client/mapview.ts';
	import { linePath, templatePath } from '#lib/shared/drawing.ts';
	import { DRAWING_SIZE, type Drawing, type Point, type TemplateKind } from '#lib/shared/types.ts';

	interface Props {
		W: number;
		H: number;
		/** The side of one grid cell, in map pixels. */
		cell: number;
		view: View;
		/** Every line of the grid as one path. Empty when there is no grid to draw. */
		gridLines: string;
		templates: LaidTemplate[];
		lines: Drawing[];
		texts: Drawing[];
		/** The templates let go that the server hasn't answered for yet. */
		cast: { kind: TemplateKind; points: [Point, Point]; color: string }[];
		/** The template being dragged out, as it will be kept. */
		casted: [Point, Point] | null;
		/** The lines let go that the server hasn't answered for yet. */
		inked: { points: Point[]; color: string }[];
		/** The line being drawn. */
		stroke: Point[] | null;
		ink: string;
		shape: TemplateKind;
		/** The hand is out: what is on the map can be selected and dragged. */
		selecting: boolean;
		selectedIds: string[];
		/** How much bigger what a finger has to catch is than what a mouse does. */
		grip: number;
		/** The text being typed: it is out of sight while its words are in the box. */
		writing: Writing | null;
		/** Something is being carried across the map. */
		carrying: boolean;
		/** How far from where it is kept a drawing is drawn, while it is in hand. */
		shiftOf: (drawing: Drawing) => Point;
		canGrabDrawing: (drawing: Drawing) => boolean;
		/** How big a template is, in words. */
		templateSize: (kind: TemplateKind, a: Point, b: Point) => string;
	}

	let {
		W,
		H,
		cell,
		view,
		gridLines,
		templates,
		lines,
		texts,
		cast,
		casted,
		inked,
		stroke,
		ink,
		shape,
		selecting,
		selectedIds,
		grip,
		writing,
		carrying,
		shiftOf,
		canGrabDrawing,
		templateSize
	}: Props = $props();

	/** Map space to the map's own pixels, where a line is drawn. */
	const inPixels = (points: Point[]): Point[] => points.map(([x, y]) => [x * W, y * H]);

	/** What goes around letters so they read on any map: dark around light ink, light around dark. */
	const haloOf = (color: string) => (color === '#12151c' ? '#fff8e4' : '#0c0e14');

	/** Where the size of a template is written: its middle, or for a cone, half way along it. */
	function templateMiddle(kind: TemplateKind, a: Point, b: Point): Point {
		return kind === 'circle' ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	}
</script>

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
			<!-- One the GM keeps out of the players' sight is drawn faint, for whoever sees it. -->
			<g transform="translate({sx * W} {sy * H})" opacity={drawing.hidden ? 0.45 : undefined}>
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
			<g transform="translate({sx * W} {sy * H})" opacity={drawing.hidden ? 0.45 : undefined}>
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
					'outline-[0.06em] outline-offset-[0.14em] outline-accent',
				// Kept out of the players' sight: faint, for whoever sees it.
				drawing.hidden && 'opacity-45'
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
	{#if selecting && selectedIds.includes(drawing.id) && !carrying}
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
