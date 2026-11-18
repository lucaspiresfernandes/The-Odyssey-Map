<script lang="ts">
	import { LIMITS, type MapKind } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		title: string;
		label: string;
		initial?: string;
		confirm: string;
		hint?: string;
		/** Offers to keep what is being named hidden from players. */
		canHide?: boolean;
		/** Asks what kind of map is being named: one to explore, or one to fight on. */
		canPickKind?: boolean;
		/** Resolves to true when the change went through and the prompt can close. */
		onsubmit: (name: string, hidden: boolean, kind: MapKind) => Promise<boolean>;
		onclose: () => void;
	}

	let {
		title,
		label,
		initial = '',
		confirm,
		hint,
		canHide = false,
		canPickKind = false,
		onsubmit,
		onclose
	}: Props = $props();

	const KINDS: { id: MapKind; label: string }[] = [
		{ id: 'world', label: 'World map' },
		{ id: 'battle', label: 'Battle map' }
	];

	// svelte-ignore state_referenced_locally
	let name = $state(initial);
	let hidden = $state(false);
	let kind = $state<MapKind>('world');
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit(name, canHide && hidden, canPickKind ? kind : 'world');
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
		{#if canPickKind}
			<fieldset class="grid gap-[0.3em]">
				<legend class="text-[13px] text-muted">What is inside</legend>
				<div class="mt-1 flex flex-wrap gap-1.5">
					{#each KINDS as option (option.id)}
						<label
							class={[
								'inline-flex cursor-pointer items-center rounded-full border px-3 py-1 text-[13px] touch:py-2',
								'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
								kind === option.id ? 'border-accent bg-accent/18 text-accent' : 'text-muted'
							]}
						>
							<input
								class="pointer-events-none absolute opacity-0"
								type="radio"
								name="kind"
								value={option.id}
								bind:group={kind}
							/>
							{option.label}
						</label>
					{/each}
				</div>
				<small class="text-muted">
					{kind === 'battle'
						? 'A table to play on: a grid, tokens to move and a ruler. Nothing leads further in.'
						: 'A place to explore: markers, notes and regions of its own.'}
				</small>
			</fieldset>
		{/if}
		{#if hint}<p class="text-[13px] text-muted">{hint}</p>{/if}
		{#if canHide}
			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-0.75 accent-accent" type="checkbox" bind:checked={hidden} />
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
