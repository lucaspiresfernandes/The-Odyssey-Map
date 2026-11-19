<script lang="ts">
	// The icon of a mark a token can wear, in the mark's own colour. It fills
	// most of whatever it is put in, so it is as big as the pip around it. A
	// mark that is only a colour has no icon, and this draws nothing for it.

	import type { MarkLook } from '#lib/shared/types.ts';

	let { look }: { look: MarkLook } = $props();
</script>

{#if look.icon}
	<svg class="size-[70%]" viewBox="0 0 24 24" aria-hidden="true">
		<path
			d={look.icon}
			fill={look.line ? 'none' : look.color}
			fill-rule="evenodd"
			stroke={look.line ? look.color : 'none'}
			stroke-width="3"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/if}
