<script lang="ts">
	import { LIMITS } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		title: string;
		label: string;
		initial?: string;
		confirm: string;
		hint?: string;
		/** Offers to keep what is being named hidden from players. */
		canHide?: boolean;
		/** Resolves to true when the change went through and the prompt can close. */
		onsubmit: (name: string, hidden: boolean) => Promise<boolean>;
		onclose: () => void;
	}

	let { title, label, initial = '', confirm, hint, canHide = false, onsubmit, onclose }: Props =
		$props();

	// svelte-ignore state_referenced_locally
	let name = $state(initial);
	let hidden = $state(false);
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit(name, canHide && hidden);
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
		{#if canHide}
			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-[3px] accent-accent" type="checkbox" bind:checked={hidden} />
				<span>
					Hidden from players
					<small class="block text-muted">
						They can't see it or step inside until you reveal it.
					</small>
				</span>
			</label>
		{/if}
		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>{confirm}</button>
		</div>
	</form>
</Modal>
