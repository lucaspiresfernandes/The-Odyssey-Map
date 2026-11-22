<script lang="ts">
	// The dice the table has just rolled, lettered over the top of the map:
	// who rolled, which die, and what it came to. Each is there for a few
	// seconds and then gone: nothing is kept of it. The same on every map of
	// the campaign, and on a table display, where it is lettered larger.
	//
	// The page has it twice, and a screen shows one of the two. A wide screen
	// has the rolls over the middle of the top of the map. A narrow one has
	// the dice themselves across most of its width, in the upper left corner,
	// so there the rolls go under that corner's boxes instead of over them.

	import { fade, fly } from 'svelte/transition';
	import { getLive } from '#lib/client/live.svelte.ts';
	import Avatar from './Avatar.svelte';

	interface Props {
		meId: string;
		/** A table display: nobody of its own, and letters to be read from across a room. */
		display: boolean;
		/** The one for a narrow screen: in the column of the upper left corner, under its boxes. */
		docked?: boolean;
	}

	let { meId, display, docked = false }: Props = $props();

	const live = getLive();
</script>

<!-- Nothing here takes the pointer: the map under it still does. Over the
     map it starts a line down from the top, under the hint of the tool in
     hand and under what a table display letters there. A table display has
     that one whatever its width: it has no dice in its corner. -->
<div
	class={[
		'pointer-events-none flex flex-col gap-1.5',
		docked
			? 'max-w-[calc(100vw-28px)] shrink-0 items-start min-[721px]:hidden'
			: 'absolute top-14 left-1/2 z-2 w-max max-w-[calc(100%-136px)] -translate-x-1/2 items-center',
		!docked && !display && 'max-[720px]:hidden'
	]}
	role="log"
	aria-label="Dice rolled"
>
	{#each live.rolls as roll (roll.key)}
		<div
			class={[
				'flex max-w-full items-center rounded-full border bg-night/90 shadow-pop',
				display ? 'gap-3 py-1.5 pr-5 pl-1.5 text-xl' : 'gap-2 py-1 pr-3.5 pl-1 text-sm'
			]}
			in:fly={{ y: -8, duration: 150 }}
			out:fade={{ duration: 300 }}
		>
			<Avatar
				id={roll.userId}
				name={roll.name}
				gm={roll.role === 'gm'}
				class={display ? 'size-9' : 'size-6.5'}
			/>
			<span class="truncate">{!display && roll.userId === meId ? 'You' : roll.name}</span>
			<span class="text-muted">d{roll.sides}</span>
			<strong class={['font-serif tabular-nums', display ? 'text-3xl' : 'text-xl']}>
				{roll.result}
			</strong>
		</div>
	{/each}
</div>
