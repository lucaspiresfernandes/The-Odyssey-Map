<script lang="ts">
	// A text being typed onto a battle map, right where it will stand and as
	// big: a new one, or one that is being reworded. Enter keeps it, and so
	// does leaving the box. Esc drops it.

	import type { View } from '#lib/client/mapview.ts';
	import type { Pen } from '#lib/client/tools/pen.svelte.ts';
	import { LIMITS } from '#lib/shared/types.ts';

	interface Props {
		/** The pen that is writing: it has the text, and what has been typed of it. */
		pen: Pen;
		W: number;
		H: number;
		view: View;
	}

	let { pen, W, H, view }: Props = $props();

	/**
	 * Puts the caret in the box the moment it is on the page. The map itself
	 * has the focus by then, from the click that asked for the box, and the
	 * browser only focuses a new field by itself when nothing else has it.
	 */
	function takeFocus(box: HTMLInputElement) {
		box.focus();
	}
</script>

{#if pen.writing}
	{@const [x, y] = pen.writing.at}
	<input
		class="pointer-events-auto absolute -ml-[calc(0.2em+1px)] -translate-y-1/2 rounded-[0.15em] border border-accent bg-night/75 px-[0.2em] py-[0.1em] leading-none font-semibold outline-none"
		style:left="{x * W * view.k + view.x}px"
		style:top="{y * H * view.k + view.y}px"
		style:font-size="{Math.max(13, pen.writingSize)}px"
		style:color={pen.writing.color}
		bind:value={pen.words}
		size={Math.max(8, pen.words.length + 2)}
		maxlength={LIMITS.drawingText}
		aria-label="Text to write on the map"
		use:takeFocus
		onblur={(e) => pen.leftBox(e.currentTarget)}
		onkeydown={(e) => {
			if (e.key === 'Enter') pen.doneWriting(true);
			if (e.key !== 'Escape') return;
			// Only the text is dropped. What Escape does next is for the next press.
			e.stopPropagation();
			pen.doneWriting(false);
		}}
	/>
{/if}
