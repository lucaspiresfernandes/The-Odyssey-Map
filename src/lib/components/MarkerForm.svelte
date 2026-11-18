<script lang="ts">
	import {
		LIMITS,
		MARKER_TYPES,
		type MarkerInput,
		type MarkerKind,
		type MarkerType
	} from '#lib/shared/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<MarkerInput, 'type' | 'title' | 'description' | 'hidden'>;

	interface Props {
		mode: 'create' | 'edit';
		kind: MarkerKind;
		initial?: Partial<Values>;
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { mode, kind, initial = {}, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let type = $state<MarkerType>(initial.type ?? (kind === 'world' ? 'location' : 'note'));
	// svelte-ignore state_referenced_locally
	let title = $state(initial.title ?? '');
	// svelte-ignore state_referenced_locally
	let description = $state(initial.description ?? '');
	// svelte-ignore state_referenced_locally
	let hidden = $state(initial.hidden ?? false);
	let saving = $state(false);

	const heading = $derived(
		`${mode === 'create' ? 'New' : 'Edit'} ${kind === 'world' ? 'world marker' : 'table note'}`
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit({ type, title, description, hidden });
		saving = false;
		if (done) onclose();
	}
</script>

<Modal title={heading} {onclose}>
	<form onsubmit={submit}>
		<fieldset>
			<legend>Type</legend>
			<div class="types">
				{#each MARKER_TYPES as option (option.id)}
					<label class:on={type === option.id} style:--c={option.color}>
						<input type="radio" name="type" value={option.id} bind:group={type} />
						<MarkerGlyph type={option.id} size={15} />
						{option.label}
					</label>
				{/each}
			</div>
		</fieldset>

		<label class="field">
			<span>Title</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" bind:value={title} maxlength={LIMITS.title} required autofocus />
		</label>

		<label class="field">
			<span>Description</span>
			<textarea class="input" bind:value={description} maxlength={LIMITS.description} rows="5"
			></textarea>
		</label>

		{#if kind === 'world'}
			<label class="check">
				<input type="checkbox" bind:checked={hidden} />
				<span>
					Hidden from players
					<small>Only you see it until you reveal it.</small>
				</span>
			</label>
		{:else}
			<p class="muted small">Everyone at the table can see and edit this note.</p>
		{/if}

		<div class="actions">
			<button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={saving}>
				{mode === 'create' ? 'Place marker' : 'Save'}
			</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: grid;
		gap: 14px;
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3em;
	}

	legend {
		padding: 0;
		font-size: 13px;
		color: var(--muted);
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}

	.types label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px 4px 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 13px;
		cursor: pointer;
		color: var(--muted);
	}

	.types label.on {
		border-color: var(--c);
		background: color-mix(in srgb, var(--c) 18%, transparent);
		color: color-mix(in srgb, var(--c) 70%, white);
	}

	.types label:has(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.types input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.check {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		cursor: pointer;
	}

	.check input {
		margin-top: 3px;
		accent-color: var(--accent);
	}

	.check small {
		display: block;
		color: var(--muted);
	}

	.small {
		font-size: 13px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
