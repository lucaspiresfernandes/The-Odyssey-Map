<script lang="ts">
	import { LIMITS } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		title: string;
		label: string;
		initial?: string;
		confirm: string;
		hint?: string;
		/** Resolves to true when the change went through and the prompt can close. */
		onsubmit: (name: string) => Promise<boolean>;
		onclose: () => void;
	}

	let { title, label, initial = '', confirm, hint, onsubmit, onclose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(initial);
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit(name);
		saving = false;
		if (done) onclose();
	}
</script>

<Modal {title} {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<label class="field">
			<span>{label}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" bind:value={name} maxlength={LIMITS.name} required autofocus />
		</label>
		{#if hint}<p class="text-[13px] text-muted">{hint}</p>{/if}
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>{confirm}</button>
		</div>
	</form>
</Modal>
