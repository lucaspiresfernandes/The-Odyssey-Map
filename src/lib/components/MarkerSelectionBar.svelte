<script lang="ts">
	// The buttons for the markers selected together on a world map, floating
	// under them: who sees them, which is the GM's, and taking them off the
	// map. Each has a key, which the map hands on to `hide` and `remove`.

	import { KEY } from '#lib/client/keys.ts';
	import { canRemoveMarker } from '#lib/shared/rules.ts';
	import type { Command, Marker, Role } from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		selectedMarkers: Marker[];
		/** The world markers among them: what the GM hides, and says who sees. */
		selectedPins: Marker[];
		role: Role;
		userId: string;
		canShape: boolean;
		/** Where the buttons float, or null while they are out of sight. */
		markerBarPosition: { left: number; top: number; under: boolean } | null;
		/** How big the buttons are on screen, for whoever places them. */
		barW: number;
		barH: number;
		send: (commands: Command[], note?: string) => Promise<boolean>;
		/** What was selected is on its way out. */
		onclear: () => void;
		onmarkervisibility: (markers: Marker[]) => void;
	}

	let {
		selectedMarkers,
		selectedPins,
		role,
		userId,
		canShape,
		markerBarPosition,
		barW = $bindable(),
		barH = $bindable(),
		send,
		onclear,
		onmarkervisibility
	}: Props = $props();

	/** Hides the selected world markers from the players, or with all of them hidden, shows them again. */
	export function hide() {
		const pins = selectedMarkers.filter((m) => m.kind === 'world');
		const hidden = !pins.every((m) => m.hidden);
		send(
			pins
				.filter((m) => m.hidden !== hidden)
				.map((m) => ({ t: 'marker.update', id: m.id, changes: { hidden } }))
		);
	}

	/** Takes the selected markers off the map: all of them the GM's to take, a player's own notes theirs. */
	export function remove() {
		const gone = selectedMarkers.filter((m) => canRemoveMarker(role, userId, m));
		if (!gone.length) return;
		onclear();
		send(
			gone.map((m) => ({ t: 'marker.delete', id: m.id })),
			gone.length === 1 ? `Deleted “${gone[0].title}”.` : `Deleted ${gone.length} markers.`
		);
	}
</script>

{#if selectedMarkers.length > 0}
	{@const pins = selectedPins}
	{@const hidden = pins.filter((m) => m.hidden).length}
	{@const mine = selectedMarkers.filter((m) => canRemoveMarker(role, userId, m))}
	{@const tip = markerBarPosition?.under === false ? 'top' : 'bottom'}
	<div
		class={['absolute', markerBarPosition && barW > 0 ? 'pointer-events-auto' : 'invisible']}
		style:left="{markerBarPosition?.left ?? 0}px"
		style:top="{markerBarPosition?.top ?? 0}px"
		bind:clientWidth={barW}
		bind:clientHeight={barH}
	>
		<div
			class="flex items-center gap-1 rounded-xl border border-[#55607a] bg-panel/94 p-1 shadow-pop"
			role="toolbar"
			aria-label="Selected markers"
		>
			<span class="px-1.5 text-xs whitespace-nowrap text-muted tabular-nums">
				{selectedMarkers.length} selected
			</span>
			{#if canShape && pins.length}
				<ToolButton
					small
					{tip}
					icon={hidden ? 'hide' : 'reveal'}
					label="Visibility"
					hint={pins.length < selectedMarkers.length
						? 'Of the world markers among them'
						: !hidden
							? 'Everyone sees them'
							: hidden < pins.length
								? 'Some of them are hidden'
								: 'They are hidden'}
					shortcut={KEY.share}
					active={hidden > 0}
					onclick={() => onmarkervisibility(pins)}
				/>
			{/if}
			<ToolButton
				small
				{tip}
				icon="delete"
				label="Delete"
				hint={mine.length === 0
					? 'None of these are yours to delete'
					: mine.length < selectedMarkers.length
						? `The ${mine.length} that are yours to delete`
						: 'Ctrl+Z brings them back'}
				shortcut={KEY.remove}
				danger
				disabled={mine.length === 0}
				onclick={remove}
			/>
		</div>
	</div>
{/if}
