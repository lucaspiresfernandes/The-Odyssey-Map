<script lang="ts">
	// The menu at the start of the bar over a map: one button, and under it
	// what there is to open. It is put away by choosing from it, by a click
	// anywhere else, and by Esc.

	import { ariaKey, keyLabel } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		/** What the button is called: its tooltip, and the name of the list under it. */
		label: string;
		/** `shortcut` is the key that does the same, shown beside it. Whoever owns the menu listens for it. */
		items: { label: string; shortcut?: string; onclick: () => void }[];
	}

	let { label, items }: Props = $props();

	let open = $state(false);
	let root: HTMLElement;
	let list = $state<HTMLElement>();

	const rows = () => [...(list?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

	// Opened, the first thing in it has the focus, for the arrow keys to go on from.
	$effect(() => {
		if (open) rows()[0]?.focus();
	});

	function close() {
		open = false;
		root.querySelector('button')?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			// The key is the menu's own: it puts no tool away on the map.
			e.stopPropagation();
			close();
			return;
		}
		const all = rows();
		const at = all.indexOf(document.activeElement as HTMLElement);
		const to = {
			ArrowDown: (at + 1) % all.length,
			ArrowUp: (at - 1 + all.length) % all.length,
			Home: 0,
			End: all.length - 1
		}[e.key];
		if (to === undefined) return;
		e.preventDefault();
		all[to]?.focus();
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (open && !root.contains(e.target as Node)) open = false;
	}}
/>

<div
	bind:this={root}
	class="relative flex shrink-0"
	role="presentation"
	{onkeydown}
	onfocusout={(e) => {
		// The focus has gone somewhere else on the page: by Tab, for one.
		if (e.relatedTarget && !root.contains(e.relatedTarget as Node)) open = false;
	}}
>
	<ToolButton
		small
		tip="bottom-start"
		icon="menu"
		{label}
		popup="menu"
		expanded={open}
		onclick={() => (open = !open)}
	/>
	{#if open}
		<div
			bind:this={list}
			class="absolute top-[calc(100%+8px)] left-0 z-10 grid min-w-48 gap-0.5 rounded-xl border bg-panel p-1 shadow-pop"
			role="menu"
			aria-label={label}
		>
			{#each items as item (item.label)}
				<button
					class="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap hover:bg-panel-2 focus-visible:bg-panel-2 touch:min-h-11"
					role="menuitem"
					aria-keyshortcuts={item.shortcut ? ariaKey(item.shortcut) : undefined}
					onclick={() => {
						open = false;
						item.onclick();
					}}
				>
					{item.label}
					{#if item.shortcut}
						<kbd
							class="rounded border border-[#4a5670] bg-panel-2 px-1 font-sans text-[11px] text-muted touch:hidden"
							>{keyLabel(item.shortcut)}</kbd
						>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
