<script lang="ts">
	// What floats in the upper left corner of a world map: the date it is in
	// the world, and under it one box with who is at the table and the dice.
	// A battle map has none of it: its dock has the same, each in a tab.

	import { KEY } from '#lib/client/keys.ts';
	import type { Die } from '#lib/shared/dice.ts';
	import { LIMITS, type Presence } from '#lib/shared/types.ts';
	import Avatar from './Avatar.svelte';
	import Dice from './Dice.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		isGm: boolean;
		/** The date it is in the world, in the GM's own words. Empty for none. */
		date: string;
		online: Presence[];
		meId: string;
		/** The GM has written a date in the field, or cleared it. */
		saveDate: (field: HTMLInputElement) => void;
		/** The dice are out, under who is at the table. */
		dicing: boolean;
		/** Rolls one die for the table to see. */
		roll: (sides: Die) => void;
	}

	let { isGm, date, online, meId, saveDate, dicing = $bindable(), roll }: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';
</script>

<!-- The date it is in the world. It is whatever the GM writes, since
     the calendar is the setting's own: the GM has it as a field that
     reads as text until it is clicked, and saves when it is left, in
     a box of its own. The players have the words, once there are some. -->
{#if isGm}
	<div class="pointer-events-auto flex shrink-0 p-1 {floating}">
		<input
			class="max-w-56 min-w-20 field-sizing-content truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-serif text-[15px] placeholder:font-sans placeholder:text-[13px] placeholder:text-muted hover:border-line focus:border-line focus:bg-[#12161e] touch:min-h-9 touch:text-base"
			value={date}
			size={Math.max(10, date.length)}
			maxlength={LIMITS.date}
			placeholder="Set the date…"
			aria-label="The date in the world"
			title="The date in the world, as the whole table sees it"
			autocomplete="off"
			spellcheck="false"
			onchange={(e) => saveDate(e.currentTarget)}
			onkeydown={(e) => {
				if (e.key === 'Enter') e.currentTarget.blur();
				if (e.key === 'Escape') {
					// Unwritten: back to what it was. And the key is the
					// field's own: it puts no tool away on the map.
					e.stopPropagation();
					e.currentTarget.value = date;
					e.currentTarget.blur();
				}
			}}
		/>
	</div>
{:else if date}
	<!-- Lettered on the map itself, the way a table display has it: no
	     box, and the map under it still takes the pointer. -->
	<span
		class="max-w-72 shrink-0 truncate px-1 font-serif text-xl font-semibold tracking-[0.02em] text-[#fff8e4] opacity-70 text-shadow-map"
		aria-label="The date in the world"
	>
		{date}
	</span>
{/if}
<!-- Who is at the table, a face each, and after them the button of the
     dice, which come out underneath in the same box: a click on one rolls
     it for the whole table to see. -->
<div class="pointer-events-auto flex shrink-0 flex-col gap-1.5 p-1.5 {floating}">
	<div class="flex items-center gap-1.5">
		{#if online.length}
			<ul class="flex" aria-label="At the table now">
				{#each online as person (person.id)}
					<li
						class="cursor-default not-first:-ml-2"
						title="{person.name}{person.role === 'gm' ? ' (GM)' : ''}{person.id === meId
							? ' (you)'
							: ''}"
					>
						<Avatar
							id={person.id}
							name={person.name}
							gm={person.role === 'gm'}
							class="size-8 border-2 border-panel"
						/>
					</li>
				{/each}
			</ul>
			<span class="w-px self-stretch bg-line"></span>
		{/if}
		<ToolButton
			tip="bottom-start"
			icon="d20"
			label="Dice"
			hint="Roll one for the table to see"
			shortcut={KEY.dice}
			active={dicing}
			expanded={dicing}
			onclick={() => (dicing = !dicing)}
		/>
	</div>
	{#if dicing}
		<div class="border-t pt-1.5">
			<Dice {roll} />
		</div>
	{/if}
</div>
