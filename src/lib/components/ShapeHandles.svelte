<script lang="ts">
	// The handles of the one shape selected on a battle map, over the tokens
	// so that none of them covers one. A dot on the rim of a circle resizes
	// it. The one at the far end of a cone or a ray aims it and makes it
	// longer or shorter. A box has one at each corner.

	import type { ShapeHandle } from '#lib/client/tools/reshape.svelte.ts';
	import type { Drawing } from '#lib/shared/types.ts';

	interface Props {
		/** The shape that wears them, or null when none does. */
		drawing: Drawing | null;
		handles: ShapeHandle[];
		W: number;
		H: number;
	}

	let { drawing, handles, W, H }: Props = $props();

	const WHAT: Record<string, string> = {
		circle: 'Drag to resize',
		cone: 'Drag to aim and resize',
		ray: 'Drag to aim and resize',
		rect: 'Drag to resize'
	};
</script>

{#if drawing}
	{#each handles as handle (handle.key)}
		<button
			class="absolute top-0 left-0 z-2 size-3.5 -translate-1/2 scale-(--inv) cursor-crosshair rounded-full border-[1.5px] border-accent-ink bg-white shadow-[0_1px_3px_rgb(0_0_0/0.55)] [-webkit-tap-highlight-color:transparent] touch:size-6"
			data-shape-handle={handle.key}
			style:left="{handle.at[0] * W}px"
			style:top="{handle.at[1] * H}px"
			title="{WHAT[drawing.kind] ?? 'Drag to resize'}. Alt leaves the grid"
			aria-label={WHAT[drawing.kind] ?? 'Drag to resize'}
			tabindex="-1"
		></button>
	{/each}
{/if}
