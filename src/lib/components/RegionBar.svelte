<script lang="ts">
	// What the GM does with the region that is selected: step in, close it or
	// open it, say who sees it, rename it, delete it. The map floats these
	// buttons over the region, and says which side their tooltips have room on.

	import { KEY } from '#lib/client/keys.ts';
	import type { Region } from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		region: Region;
		tip: 'top' | 'bottom';
		onenter: () => void;
		/** Closes the region to the players, or opens one that is closed. */
		ontoggle: (region: Region) => void;
		/** Opens the dialog that says who sees it. */
		onshare: (region: Region) => void;
		onrename: (region: Region) => void;
		/** Asks first: there is no undo for this one. */
		ondelete: (region: Region) => void;
	}

	let { region, tip, onenter, ontoggle, onshare, onrename, ondelete }: Props = $props();
</script>

<div
	class="flex items-center gap-1 rounded-xl border border-[#55607a] bg-panel/94 p-1 shadow-pop"
	role="toolbar"
	aria-label="Region {region.name}"
>
	<ToolButton
			small
			{tip}
			icon="enter"
			label="Enter the region"
			shortcut={KEY.enter}
			onclick={onenter}
		/>
		<ToolButton
			small
			{tip}
			icon={region.closed ? 'unlock' : 'lock'}
			label={region.closed ? 'Open the region to players' : 'Close the region to players'}
			hint={region.closed
				? 'They can step inside again'
				: "They still see it, and can't step inside"}
			shortcut={KEY.lock}
			active={region.closed}
			onclick={() => ontoggle(region)}
		/>
		<ToolButton
			small
			{tip}
			icon={region.hidden ? 'hide' : 'reveal'}
			label="Visibility"
			hint={!region.hidden
				? 'Everyone sees the region'
				: region.seenBy.length
					? `Only you and ${region.seenBy.length} ${region.seenBy.length === 1 ? 'player' : 'players'} see the region`
					: 'Only you see the region'}
			shortcut={KEY.share}
			active={region.hidden}
			onclick={() => onshare(region)}
		/>
		<ToolButton
			small
			{tip}
			icon="rename"
			label="Rename the region"
			shortcut={KEY.rename}
			onclick={() => onrename(region)}
		/>
		<ToolButton
			small
			{tip}
			icon="delete"
			label="Delete the region"
			shortcut={KEY.remove}
			danger
			onclick={() => ondelete(region)}
		/>
</div>
