<script lang="ts">
	// The dice, four to a row: one button to a die. A click rolls that one die
	// for the whole table to see, and a second click rolls it again. They sit
	// in whatever box holds them: the dock of a battle map, or the corner of a
	// world map.

	import { DICE, type Die } from '#lib/shared/dice.ts';

	interface Props {
		roll: (sides: Die) => void;
	}

	let { roll }: Props = $props();
</script>

<div class="grid grid-cols-4 gap-1.5" role="group" aria-label="Dice">
	{#each DICE as sides (sides)}
		<button
			class="btn min-w-9 px-0 text-xs font-semibold touch:min-w-11"
			aria-label="Roll a die of {sides} sides"
			title="Roll a d{sides}: everyone at the table sees it"
			onclick={() => roll(sides)}>d{sides}</button
		>
	{/each}
</div>
