<script lang="ts">
	// The grid is being lined up: once a box has been dragged over the squares
	// of the map's picture, how many of them it covers, and the grid that
	// makes, which is on the map to be looked at before it is kept.

	import type { Grid } from '#lib/shared/types.ts';

	interface Props {
		/** The grid that the box dragged over the map's squares makes, or null until there is a box. */
		alignGrid: Pick<Grid, 'size' | 'x' | 'y'> | null;
		/** How many squares the box covers, from its left edge to its right. */
		alignCount: number;
		keepAlignment: () => void;
		putAway: () => void;
	}

	let { alignGrid, alignCount = $bindable(), keepAlignment, putAway }: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';
</script>

{#if alignGrid}
	<div
		class="pointer-events-auto flex max-w-[calc(100%-24px)] flex-wrap items-center justify-center gap-2 p-2 {floating}"
		role="group"
		aria-label="Line up the grid"
	>
		<label class="flex items-center gap-2 text-sm">
			Squares across the box
			<input
				class="input min-h-8 w-16 py-0 text-center tabular-nums"
				type="number"
				min="1"
				max="500"
				step="1"
				bind:value={alignCount}
				onkeydown={(e) => {
					if (e.key === 'Enter') keepAlignment();
				}}
			/>
		</label>
		<span class="text-xs text-muted tabular-nums">
			One cell is {alignGrid.size} pixels
		</span>
		<button
			class="btn btn-sm btn-primary"
			aria-keyshortcuts="Enter"
			title="Enter"
			onclick={keepAlignment}>Use this grid</button
		>
		<button class="btn btn-sm btn-ghost" onclick={putAway}>Cancel</button>
	</div>
{/if}
