<script lang="ts">
	// The names of the regions, lettered on the map.

	import type { Player, Point, Region } from '#lib/shared/types.ts';

	interface Props {
		/** The regions, the smallest last. */
		orderedRegions: Region[];
		/** Where a region's name goes: the middle of its outline, kept on screen. */
		labelSpot: (points: Point[]) => Point;
		/** A region's corners, as they are being reshaped or as they are. */
		pointsOf: (region: Region) => Point[];
		/** The region whose name is lit, because the mouse is over it. */
		litRegionId: string | null;
		canShape: boolean;
		passive: boolean;
		W: number;
		H: number;
		/** The players of the campaign, to say who a hidden region is a secret with. */
		players: Player[];
		/** How tall a region's name stands on screen. */
		onheight: (regionId: string, tall: number) => void;
	}

	let {
		orderedRegions,
		labelSpot,
		pointsOf,
		litRegionId,
		canShape,
		passive,
		W,
		H,
		players,
		onheight
	}: Props = $props();

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
</script>

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
		bind:clientHeight={null, (tall) => onheight(region.id, tall ?? 0)}
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
