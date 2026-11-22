<script lang="ts">
	// Who sees something on the map, a token, a world marker or a region, or
	// several of one kind at once: the whole table, or only the players the
	// GM picks, which with nobody picked is the GM alone. The GM's. Each
	// change is made as it is clicked, and Ctrl+Z takes it back.

	import type { Player } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';
	import PlayerPicker from './PlayerPicker.svelte';

	interface Props {
		/** What the dialog is called: whose visibility it is. */
		title: string;
		/** What it is about, as it is now. */
		things: { hidden: boolean; seenBy: string[] }[];
		/** The players of the campaign. */
		players: Player[];
		/** What being picked gets a player beyond seeing it, when it gets them anything. */
		note?: string;
		/** All of it is to be shown to everyone, or hidden from all but these players. */
		onchange: (hidden: boolean, seenBy: string[]) => void;
		onclose: () => void;
	}

	let { title, things, players, note, onchange, onclose }: Props = $props();

	const several = $derived(things.length > 1);
	const allHidden = $derived(things.every((thing) => thing.hidden));
	const noneHidden = $derived(things.every((thing) => !thing.hidden));
	/** The players every one of them is shown to. */
	const sharedWith = $derived(
		allHidden
			? things[0].seenBy.filter((id) => things.every((thing) => thing.seenBy.includes(id)))
			: []
	);

	/** One of the two choices: lit while it is how things stand. */
	const choice = 'btn h-auto flex-col items-start gap-0.5 py-2 text-left whitespace-normal';
</script>

<Modal {title} {onclose}>
	<div class="grid grid-cols-2 gap-2" role="group" aria-label="Who sees {several ? 'them' : 'it'}">
		<button
			class={[choice, noneHidden && 'btn-active']}
			aria-pressed={noneHidden}
			onclick={() => onchange(false, [])}
		>
			<span class="font-semibold">Everyone</span>
			<span class="text-xs text-muted">The whole table</span>
		</button>
		<button
			class={[choice, allHidden && 'btn-active']}
			aria-pressed={allHidden}
			onclick={() => onchange(true, sharedWith)}
		>
			<span class="font-semibold">Only some players</span>
			<span class="text-xs text-muted">Hidden from the rest</span>
		</button>
	</div>

	{#if allHidden}
		<div class="grid gap-1.5">
			<PlayerPicker
				{players}
				value={sharedWith}
				label="Players who see {several ? 'them' : 'it'}"
				onchange={(seenBy) => onchange(true, seenBy)}
			/>
			{#if players.length}
				<p class="text-xs text-muted">
					{sharedWith.length
						? `Only you and the players picked see ${several ? 'them' : 'it'}.`
						: `Nobody is picked: only you see ${several ? 'them' : 'it'}.`}
					{note}
				</p>
			{/if}
		</div>
	{:else if !noneHidden}
		<p class="text-xs text-muted">Some of these are hidden and some are not. Pick one for all of them.</p>
	{/if}

	<div class="flex justify-end">
		<button class="btn btn-primary" onclick={onclose}>Done</button>
	</div>
</Modal>
