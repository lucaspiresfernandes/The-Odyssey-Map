<script lang="ts">
	// The fog over a map, as it is drawn: the fog the GM lays by hand, the
	// outline of the brush it is painted with, and on a battle map where the
	// fog follows the tokens, the sheet that opens around the players' own.

	import { stampPath, sweepPath } from '#lib/shared/fog.ts';
	import type { Fog, Point } from '#lib/shared/types.ts';

	interface Props {
		/** The fog laid by hand, with the sweep being made. */
		fog: Fog;
		/** Where the outline of the brush is, while the GM has it in hand. */
		brushAt: Point | null;
		battle: boolean;
		W: number;
		H: number;
		/** The GM sees through the fog, dimly. To anyone else it is solid. */
		canShape: boolean;
		/** How far the brush reaches across the map and down it, in map space. */
		reach: [number, number];
		tool: string;
		fogShape: 'round' | 'square';
		/** How far each of the players' tokens sees, in the map's pixels. Null where the fog doesn't follow them. */
		sightReach: number | null;
		/** Where those tokens are drawn right now. */
		eyes: Point[];
	}

	let { fog, brushAt, battle, W, H, canShape, reach, tool, fogShape, sightReach, eyes }: Props =
		$props();
</script>

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

<!-- Fog that follows the tokens: a second dark sheet, cut open around
     each of the players' tokens as far as it sees, with a soft edge.
     It lies over the fog laid by hand, which still covers what it
     covers. Like that fog, the players can't see through it and the
     GM can. -->
{#if sightReach !== null}
	<svg
		class="pointer-events-none absolute inset-0 z-2 overflow-visible"
		viewBox="0 0 {W} {H}"
		width={W}
		height={H}
		data-sight={eyes.length}
		aria-hidden="true"
	>
		<defs>
			<radialGradient id="sight-eye">
				<stop offset="0.8" stop-color="black" />
				<stop offset="1" stop-color="black" stop-opacity="0" />
			</radialGradient>
			<mask id="sight-eyes" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
				<rect width={W} height={H} fill="white" />
				{#each eyes as [x, y], i (i)}
					<circle cx={x * W} cy={y * H} r={sightReach} fill="url(#sight-eye)" />
				{/each}
			</mask>
		</defs>
		<rect
			class={canShape ? 'fill-[#0b0d12]/45' : 'fill-[#0d1017]'}
			width={W}
			height={H}
			mask="url(#sight-eyes)"
		/>
	</svg>
{/if}
