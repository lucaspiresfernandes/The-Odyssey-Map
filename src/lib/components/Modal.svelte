<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** For a dialog that shows a lot at once, like the gallery. */
		wide?: boolean;
		onclose: () => void;
		children: Snippet;
	}

	let { title, wide = false, onclose, children }: Props = $props();

	let dialog: HTMLDialogElement;

	// The native dialog brings the focus trap, the backdrop and Escape.
	$effect(() => {
		dialog.showModal();
		return () => dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class={[
		'm-auto max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[14px] border bg-panel text-cream shadow-pop backdrop:bg-[rgb(6_8_12/0.6)]',
		wide ? 'w-[min(760px,calc(100vw-24px))]' : 'w-[min(440px,calc(100vw-24px))]'
	]}
	aria-label={title}
	oncancel={(e) => (e.preventDefault(), onclose())}
	onclick={(e) => e.target === dialog && onclose()}
>
	<div class="grid gap-4 p-5">
		<h2 class="text-xl/tight">{title}</h2>
		{@render children()}
	</div>
</dialog>
