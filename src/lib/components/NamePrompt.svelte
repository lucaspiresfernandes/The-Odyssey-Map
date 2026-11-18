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
	<form onsubmit={submit}>
		<label class="field">
			<span>{label}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" bind:value={name} maxlength={LIMITS.name} required autofocus />
		</label>
		{#if hint}<p class="muted hint">{hint}</p>{/if}
		<div class="actions">
			<button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={saving}>{confirm}</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: grid;
		gap: 14px;
	}

	.hint {
		font-size: 13px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
