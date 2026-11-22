<script lang="ts">
	// Which types of marker a world map shows, and whether it shows its
	// regions. It only changes what this person sees.

	import { MARKER_TYPES, type MarkerType } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';

	interface Props {
		/** The types of marker filtered out. */
		hiddenTypes: MarkerType[];
		/** How many markers of each type this map holds, shown or not. */
		typeCounts: Partial<Record<MarkerType, number>>;
		regionsHidden: boolean;
		regionCount: number;
		toggleType: (type: MarkerType) => void;
		hideRegions: (hidden: boolean) => void;
		/** Filters the markers down to all types but these. */
		hideTypes: (types: MarkerType[]) => void;
	}

	let {
		hiddenTypes,
		typeCounts,
		regionsHidden,
		regionCount,
		toggleType,
		hideRegions,
		hideTypes
	}: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';
</script>

<!-- Which types of marker to see: a pill for each, lit while its type
     is shown, with how many of them this map holds. Under them, a
     switch for the regions. -->
<div
	class="pointer-events-auto grid w-[min(440px,calc(100%-24px))] gap-2 p-2.5 {floating}"
	role="group"
	aria-label="What the map shows"
>
	<div class="flex flex-wrap justify-center gap-1.5">
		{#each MARKER_TYPES as option (option.id)}
			{@const shown = !hiddenTypes.includes(option.id)}
			<!-- Each type is a pill in its own colour, which arrives as --c. -->
			<button
				class={[
					'inline-flex cursor-pointer items-center gap-1.25 rounded-full border py-1 pr-2.5 pl-2 text-[13px] touch:py-2',
					shown
						? 'border-(--c) bg-(--c)/18 text-[color-mix(in_srgb,var(--c)_70%,white)]'
						: 'text-muted line-through decoration-muted/60'
				]}
				style:--c={option.color}
				aria-pressed={shown}
				onclick={() => toggleType(option.id)}
			>
				<MarkerGlyph type={option.id} size={15} />
				{option.label}
				{#if typeCounts[option.id]}
					<span class="text-[11px] tabular-nums opacity-70">{typeCounts[option.id]}</span>
				{/if}
			</button>
		{/each}
	</div>
	<!-- The whole row is the switch, so there is plenty to aim at. -->
	<button
		class="group flex cursor-pointer items-center justify-between gap-2 border-t pt-2 text-[13px] touch:py-2"
		role="switch"
		aria-checked={!regionsHidden}
		onclick={() => hideRegions(!regionsHidden)}
	>
		<span class={regionsHidden ? 'text-muted' : ''}>
			Regions
			{#if regionCount}
				<span class="text-[11px] tabular-nums opacity-70">{regionCount}</span>
			{/if}
		</span>
		<span
			class={[
				'flex h-4.5 w-8 items-center rounded-full border p-0.5 transition-colors duration-120',
				regionsHidden ? 'bg-panel-2 group-hover:border-[#465166]' : 'border-accent bg-accent'
			]}
		>
			<span
				class={[
					'size-3 rounded-full transition-transform duration-120',
					regionsHidden ? 'bg-muted' : 'translate-x-3.5 bg-accent-ink'
				]}
			></span>
		</span>
	</button>
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs text-muted">Only changes what you see.</span>
		<span class="flex gap-1.5">
			<button
				class="btn btn-sm btn-ghost"
				disabled={hiddenTypes.length === 0 && !regionsHidden}
				onclick={() => {
					hideTypes([]);
					hideRegions(false);
				}}>Show all</button
			>
			<button
				class="btn btn-sm btn-ghost"
				disabled={hiddenTypes.length === MARKER_TYPES.length && regionsHidden}
				onclick={() => {
					hideTypes(MARKER_TYPES.map((each) => each.id));
					hideRegions(true);
				}}>Hide all</button
			>
		</span>
	</div>
</div>
