<script lang="ts">
	// The pins of a world map: its world markers, and the table's notes.

	import { markerType, type Marker, type Point } from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';

	interface Props {
		/** The markers, the ones further down the map last, so they are drawn over the rest. */
		orderedMarkers: Marker[];
		/** The markers selected together. */
		pickedMarkerIds: Set<string>;
		/** The marker whose card is pinned open. */
		selectedMarkerId: string | null;
		hoveredMarkerId: string | null;
		/** The marker whose card is showing. */
		active: Marker | null;
		/** Where a marker is drawn: in a hand, or where it stands. */
		markerSpot: (marker: Marker) => Point;
		tool: string;
		/** Something is being carried across the map. */
		carrying: boolean;
		W: number;
		H: number;
		canShape: boolean;
		/** The markers that are new to whoever is looking. */
		fresh: string[];
	}

	let {
		orderedMarkers,
		pickedMarkerIds,
		selectedMarkerId = $bindable(),
		hoveredMarkerId = $bindable(),
		active,
		markerSpot,
		tool,
		carrying,
		W,
		H,
		canShape,
		fresh
	}: Props = $props();

	function toggleMarker(e: KeyboardEvent, marker: Marker) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		selectedMarkerId = selectedMarkerId === marker.id ? null : marker.id;
	}
</script>

<!-- Pins live in the scaled layer, so they follow the map for free. World
     markers are teardrops in their type's colour (--c). Table notes look
     like paper tags, so the two can be told apart at a glance. -->
{#each orderedMarkers as marker (marker.id)}
	{@const type = markerType(marker.type)}
	{@const picked = pickedMarkerIds.has(marker.id)}
	{@const selected = selectedMarkerId === marker.id || picked}
	{@const raised = active?.id === marker.id}
	{@const [mx, my] = markerSpot(marker)}
	{@const shape = [
		'block',
		selected ? 'pin-selected' : 'pin-shadow group-focus-visible:pin-focused',
		marker.hidden && 'opacity-55'
	]}
	<button
		class={[
			'group absolute origin-bottom -translate-x-1/2 -translate-y-full scale-(--inv) cursor-pointer text-[#12151c] [-webkit-tap-highlight-color:transparent] focus-visible:outline-none',
			(selected || raised) && 'z-1',
			// With another tool in hand they are part of the picture. The
			// box that selects them shows them as they are.
			tool !== 'pan' && 'pointer-events-none',
			tool !== 'pan' && tool !== 'select' && 'opacity-60',
			picked && tool === 'pan' && (carrying ? 'cursor-grabbing' : 'cursor-grab')
		]}
		data-marker-id={marker.id}
		data-picked={picked ? '' : undefined}
		style:left="{mx * W}px"
		style:top="{my * H}px"
		style:--c={type.color}
		aria-label="{type.label}: {marker.title}{marker.hidden
			? canShape
				? ' (hidden from players)'
				: ' (a secret)'
			: ''}{fresh.includes(marker.id) ? ' (new)' : ''}"
		aria-pressed={selected}
		tabindex={tool === 'pan' ? 0 : -1}
		onfocus={() => (hoveredMarkerId = marker.id)}
		onblur={() => hoveredMarkerId === marker.id && (hoveredMarkerId = null)}
		onkeydown={(e) => toggleMarker(e, marker)}
	>
		<span
			class={[
				'relative block origin-bottom transition-transform duration-120 group-hover:scale-115',
				raised && 'scale-115'
			]}
		>
			{#if fresh.includes(marker.id)}
				<!-- New to whoever is looking: a ring of gold breathing around
				     its head, until its card has been read. -->
				<span
					class="pointer-events-none absolute top-[15px] left-1/2 size-13 -translate-1/2 animate-glint rounded-full border-[3px] border-accent shadow-[0_0_10px_2px_var(--color-accent),inset_0_0_6px_var(--color-accent)] motion-reduce:animate-none"
					data-fresh={marker.id}
					aria-hidden="true"
				></span>
			{/if}
			{#if marker.kind === 'world'}
				<svg class={shape} viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
					<path
						class={['fill-(--c) stroke-[#12151c] stroke-[1.5]', marker.hidden && '[stroke-dasharray:3_2.5]']}
						d="M16 41C16 41 3 26.5 3 15.5a13 13 0 0 1 26 0C29 26.5 16 41 16 41Z"
					/>
				</svg>
			{:else}
				<svg class={shape} viewBox="0 0 34 38" width="34" height="38" aria-hidden="true">
					<path
						class="fill-[#f4e7c3] stroke-(color:--c) stroke-[2.5]"
						d="M7 2h20a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5h-5.5L17 37l-4.5-8H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
					/>
				</svg>
			{/if}
			<span
				class={[
					'absolute top-[7.5px] left-1/2 flex -translate-x-1/2',
					marker.kind === 'player' && 'text-[#4a3b18]'
				]}
			>
				<MarkerGlyph type={marker.type} size={16} />
			</span>
		</span>
	</button>
{/each}
