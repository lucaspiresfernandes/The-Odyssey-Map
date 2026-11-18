<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } =
		$props();

	let dialog: HTMLDialogElement;

	// The native dialog brings the focus trap, the backdrop and Escape.
	$effect(() => {
		dialog.showModal();
		return () => dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="m-auto max-h-[calc(100dvh-24px)] w-[min(440px,calc(100vw-24px))] overflow-y-auto rounded-[14px] border bg-panel text-cream shadow-pop backdrop:bg-[rgb(6_8_12/0.6)]"
	aria-label={title}
	oncancel={(e) => (e.preventDefault(), onclose())}
	onclick={(e) => e.target === dialog && onclose()}
>
	<div class="grid gap-4 p-5">
		<h2 class="text-xl/tight">{title}</h2>
		{@render children()}
	</div>
</dialog>
