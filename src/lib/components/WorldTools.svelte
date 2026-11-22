<script lang="ts">
	// The corner of a world map, for what is used on the map rather than
	// built into it: the box that selects several markers, the ruler, the
	// pointing tool, and for the GM the fog. Each is lit while it is in hand,
	// and a second click puts it down. What goes with the one in hand comes
	// out beside it.

	import type { Snippet } from 'svelte';
	import { KEY } from '#lib/client/keys.ts';
	import ToolButton, { type ToolIcon } from './ToolButton.svelte';

	interface Props {
		isGm: boolean;
		/** Which of the fog's two tools the GM has in hand. */
		fogTool: 'reveal' | 'cover' | null;
		/** The tools, each with the key that takes it in hand. */
		tools: {
			icon: ToolIcon;
			label: string;
			key: string;
			hint: () => string | undefined;
			shown: () => boolean;
			held: () => boolean;
			take: () => void;
		}[];
		/** There is fog on this map. */
		fogOn: boolean;
		pickWorldFog: () => void;
		/** The fog's own tools, for while the GM is at it. */
		fogTools: Snippet;
	}

	let { isGm, fogTool, tools, fogOn, pickWorldFog, fogTools }: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';
</script>

<!-- A world map has the same corner for what is used on the map
     rather than built into it: the box that selects several
     markers, the ruler, the pointing tool, and for the GM the fog.
     Each is lit while it is in hand, and a second click puts it
     down. The first three have the keys a battle map gives them.
     What goes with the one in hand comes out beside it. -->
<div class="absolute top-3.5 right-3.5 z-1 flex items-start gap-1.5">
	{#if isGm && fogTool}
		<!-- The fog's own tools, out while the GM is at it: the ones a
		     battle map has. -->
		<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Fog">
			{@render fogTools()}
		</div>
	{/if}
	<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Tools in hand">
		{#each tools as each (each.key)}
			{#if each.shown()}
				<ToolButton
					tip="left"
					icon={each.icon}
					label={each.label}
					hint={each.hint()}
					shortcut={each.key}
					active={each.held()}
					onclick={each.take}
				/>
			{/if}
		{/each}
		{#if isGm}
			<span class="h-px bg-line"></span>
			<!-- Each world map has its own: under it, players see only
			     what the GM has cleared. -->
			<ToolButton
				tip="left"
				icon="fog"
				label="Fog"
				hint={fogOn
					? 'On: players see only what you clear'
					: 'Off: cover this map, or a part of it'}
				shortcut={KEY.fog}
				active={fogTool !== null}
				expanded={fogTool !== null}
				onclick={pickWorldFog}
			/>
		{/if}
	</div>
</div>
