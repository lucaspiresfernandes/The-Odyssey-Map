<script lang="ts">
	// What a table display letters on its own screen: where the table is, the
	// date in the world, and when the GM asks for it, the code to scan to
	// join.

	import type { Crumb } from '#lib/shared/types.ts';
	import QrCode from './QrCode.svelte';

	interface Props {
		display: boolean;
		/** The maps on the way here, the first map of the campaign first. */
		trail: Crumb[];
		mapUrl: (mapId: string) => string;
		date: string;
		/** The invite as a phone can open it, when the display is to show it. */
		displayInvite: { url: string } | null;
	}

	let { display, trail, mapUrl, date, displayInvite }: Props = $props();
</script>

{#if display}
	<!-- Where the table is, lettered on the corner of the screen like a
	     place name: no bar, no box. The maps on the way here are lettered
	     before it, fainter, and each is the way back out to itself. Only
	     the names take the pointer, so the map under the rest of the line
	     still does. The date it is in the world is lettered the same
	     way in the corner across from it. -->
	<div
		class="pointer-events-none absolute inset-x-5 top-4 flex items-baseline justify-between gap-8 font-serif text-xl font-semibold tracking-[0.02em] whitespace-nowrap text-[#fff8e4] text-shadow-map"
	>
		<nav class="flex min-w-0 items-baseline gap-2 overflow-hidden" aria-label="Breadcrumb">
			{#each trail as crumb, i (crumb.id)}
				{#if i < trail.length - 1}
					<a
						class="pointer-events-auto shrink-0 text-[#fff8e4] no-underline opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100 touch:py-2"
						href={mapUrl(crumb.id)}
						title="Back out to {crumb.name}">{crumb.name}</a
					>
					<span class="opacity-45" aria-hidden="true">›</span>
				{:else}
					<span class="truncate opacity-70" aria-current="page">{crumb.name}</span>
				{/if}
			{/each}
		</nav>
		{#if date}
			<span class="max-w-[45%] shrink-0 truncate opacity-70" aria-label="The date in the world">
				{date}
			</span>
		{/if}
	</div>
{/if}

{#if displayInvite}
	<!-- The way to the table, in a corner of the screen the table looks
	     at: a code to scan, and the address under it for whoever types. -->
	<aside
		class="pointer-events-none absolute right-5 bottom-5 z-2 grid justify-items-center gap-2 rounded-2xl border bg-panel/94 p-4 shadow-pop"
		aria-label="Join the table"
	>
		<QrCode text={displayInvite.url} size={260} label="A code to scan to join the table" />
		<strong class="font-serif text-xl">Scan to join</strong>
		<span class="max-w-65 text-center text-xs wrap-anywhere text-muted">
			{displayInvite.url}
		</span>
	</aside>
{/if}
