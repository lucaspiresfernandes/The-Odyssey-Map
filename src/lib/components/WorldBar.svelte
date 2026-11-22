<script lang="ts">
	// The bar under a world map: a note, the filter, and for the GM, a world
	// marker and a region. While a marker is being put down or a region drawn,
	// all there is to do here is to give it up.

	import { KEY } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		/** A marker is being put down, or a region drawn. */
		busy: boolean;
		putAway: () => void;
		isGm: boolean;
		onnote: () => void;
		onmarker: () => void;
		/** What the filter is keeping off the map, in a few words. */
		filterHint: string | undefined;
		/** Something is filtered out. */
		filtered: boolean;
		filterOpen: boolean;
		startRegion: () => void;
	}

	let {
		busy,
		putAway,
		isGm,
		onnote,
		onmarker,
		filterHint,
		filtered,
		filterOpen = $bindable(),
		startRegion
	}: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';
</script>

<div
	class="pointer-events-auto flex max-w-[calc(100%-120px)] flex-wrap items-center justify-center gap-1.5 p-1.5 max-[720px]:max-w-[calc(100%-24px)] {floating}"
	role="toolbar"
	aria-label="Map tools"
>
	{#if busy}
		<!-- A marker being put down or a region being drawn: all there
		     is to do here is to give it up. The ruler, the pointing tool
		     and the fog are in the corner, and leave the bar as it is. -->
		<button class="btn" onclick={putAway}>Cancel</button>
	{:else}
		<!-- The tools for the map: icons, each with a tooltip that names
		     it. A player has one tool, so theirs keeps its words. What is
		     done with a region floats over the one selected, not here. -->
		<ToolButton
			icon="note"
			label={isGm ? 'Add a note' : 'Add note'}
			shortcut={KEY.note}
			named={!isGm}
			onclick={onnote}
		/>
		<!-- Lit while some type is filtered out, so markers that don't
		     show are never a mystery. -->
		<ToolButton
			icon="filter"
			label="Filter markers and regions"
			hint={filterHint}
			shortcut={KEY.filter}
			active={filtered}
			expanded={filterOpen}
			onclick={() => (filterOpen = !filterOpen)}
		/>
		{#if isGm}
			<span class="w-px self-stretch bg-line"></span>
			<ToolButton
				icon="marker"
				label="Add a world marker"
				shortcut={KEY.marker}
				onclick={onmarker}
			/>
			<ToolButton
				icon="region"
				label="Draw a region"
				shortcut={KEY.region}
				onclick={startRegion}
			/>
		{/if}
	{/if}
</div>
