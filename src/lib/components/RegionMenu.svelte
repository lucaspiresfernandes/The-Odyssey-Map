<script lang="ts">
	// What the GM can do with a region, offered where they clicked it.

	import type { Region } from '#lib/shared/types.ts';

	interface Props {
		region: Region;
		/** In edit mode the region's corners can be dragged too, which the menu mentions. */
		editing: boolean;
		onenter: (region: Region) => void;
		onhide: (region: Region, hidden: boolean) => void;
		onrename: (region: Region) => void;
		ondelete: (region: Region) => void;
	}

	let { region, editing, onenter, onhide, onrename, ondelete }: Props = $props();

	const item = 'cursor-pointer rounded-md px-2.5 py-1.5 text-left hover:bg-panel-2';
</script>

<div
	class="grid w-max min-w-[170px] rounded-xl border border-[#55607a] bg-[#171b24f2] p-1 text-sm shadow-pop backdrop-blur-[6px]"
	role="menu"
	aria-label="Region {region.name}"
>
	<button class={item} role="menuitem" onclick={() => onenter(region)}>Enter</button>
	<button class={item} role="menuitem" onclick={() => onhide(region, !region.hidden)}>
		{region.hidden ? 'Reveal to players' : 'Hide from players'}
	</button>
	<button class={item} role="menuitem" onclick={() => onrename(region)}>Rename</button>
	<button class="{item} text-danger" role="menuitem" onclick={() => ondelete(region)}>Delete</button>
	{#if editing}
		<p class="mt-1 border-t px-2.5 pt-1.5 pb-1 text-xs text-muted">Drag a corner to reshape</p>
	{/if}
</div>
