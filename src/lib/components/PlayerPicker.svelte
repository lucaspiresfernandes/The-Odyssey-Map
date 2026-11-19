<script lang="ts">
	// Which players something is for: a pill for each player of the campaign,
	// lit while they are among the chosen. The GM's, for whatever is a secret
	// between them and a few at the table.

	import type { Player } from '#lib/shared/types.ts';

	interface Props {
		players: Player[];
		/** The players chosen, by id. */
		value: string[];
		/** What the pills are choosing, for screen readers. */
		label: string;
		onchange: (ids: string[]) => void;
	}

	let { players, value, label, onchange }: Props = $props();

	function toggle(id: string) {
		onchange(value.includes(id) ? value.filter((each) => each !== id) : [...value, id]);
	}
</script>

{#if players.length}
	<div class="flex flex-wrap gap-1.5" role="group" aria-label={label}>
		{#each players as player (player.id)}
			{@const on = value.includes(player.id)}
			<button
				type="button"
				class={[
					'max-w-40 cursor-pointer truncate rounded-full border px-2.5 py-0.5 text-[13px] touch:py-1.5',
					on ? 'border-accent bg-accent/18 text-accent' : 'text-muted hover:text-cream'
				]}
				aria-pressed={on}
				onclick={() => toggle(player.id)}
			>
				{player.name}
			</button>
		{/each}
	</div>
{:else}
	<p class="text-xs text-muted">No player has joined yet. Send them the invite link first.</p>
{/if}
