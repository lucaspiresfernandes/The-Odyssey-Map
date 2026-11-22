<script lang="ts">
	// What floats in the upper left corner of a map: the date it is in the
	// world, and on a world map, who is at the table.

	import { LIMITS, type Presence } from '#lib/shared/types.ts';

	interface Props {
		isGm: boolean;
		/** The date it is in the world, in the GM's own words. Empty for none. */
		date: string;
		online: Presence[];
		/** A battle map has its own dock for who is at the table. */
		battle: boolean;
		meId: string;
		/** The GM has written a date in the field, or cleared it. */
		saveDate: (field: HTMLInputElement) => void;
	}

	let { isGm, date, online, battle, meId, saveDate }: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';


	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
	}
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
{#if online.length && !battle}
	<ul class="pointer-events-auto flex shrink-0 p-1.5 {floating}" aria-label="At the table now">
		{#each online as person (person.id)}
			<li
				class={[
					'grid size-6.5 cursor-default place-items-center rounded-full border-2 border-panel text-[11px] font-semibold not-first:-ml-1.5',
					person.role === 'gm' ? 'bg-accent text-accent-ink' : 'bg-[#3a465c]'
				]}
				title="{person.name}{person.role === 'gm' ? ' (GM)' : ''}{person.id === meId
					? ' (you)'
					: ''}"
			>
				{initials(person.name)}
			</li>
		{/each}
	</ul>
{/if}
