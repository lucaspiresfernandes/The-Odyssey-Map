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
	aria-label={title}
	oncancel={(e) => (e.preventDefault(), onclose())}
	onclick={(e) => e.target === dialog && onclose()}
>
	<div class="content">
		<h2>{title}</h2>
		{@render children()}
	</div>
</dialog>

<style>
	dialog {
		width: min(440px, calc(100vw - 24px));
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow);
	}

	dialog::backdrop {
		background: rgb(6 8 12 / 0.6);
	}

	.content {
		padding: 20px;
		display: grid;
		gap: 16px;
	}

	h2 {
		font-size: 20px;
	}
</style>
