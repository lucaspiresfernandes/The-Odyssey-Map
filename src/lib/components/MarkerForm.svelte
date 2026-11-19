<script lang="ts">
	import {
		LIMITS,
		MARKER_TYPES,
		imageUrl,
		type GalleryItem,
		type MarkerInput,
		type MarkerKind,
		type MarkerType
	} from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<MarkerInput, 'type' | 'title' | 'description' | 'hidden' | 'image'>;

	interface Props {
		mode: 'create' | 'edit';
		kind: MarkerKind;
		campaignId: string;
		initial?: Partial<Values>;
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { mode, kind, campaignId, initial = {}, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let type = $state<MarkerType>(initial.type ?? (kind === 'world' ? 'location' : 'note'));
	// svelte-ignore state_referenced_locally
	let title = $state(initial.title ?? '');
	// svelte-ignore state_referenced_locally
	let description = $state(initial.description ?? '');
	// svelte-ignore state_referenced_locally
	let hidden = $state(initial.hidden ?? false);
	/** The picture its card shows, by file name. A world marker's only. */
	// svelte-ignore state_referenced_locally
	let image = $state(initial.image ?? null);
	/** The gallery is open, to choose that picture from. */
	let picking = $state(false);
	let saving = $state(false);

	const heading = $derived(
		`${mode === 'create' ? 'New' : 'Edit'} ${kind === 'world' ? 'world marker' : 'table note'}`
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit({ type, title, description, hidden, image });
		saving = false;
		if (done) onclose();
	}

	function show(item: GalleryItem) {
		picking = false;
		image = item.file;
	}
</script>

<Modal title={heading} {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<fieldset class="grid gap-[0.3em]">
			<legend class="text-[13px] text-muted">Type</legend>
			<div class="mt-1 flex flex-wrap gap-1.5">
				{#each MARKER_TYPES as option (option.id)}
					<!-- Each type is a pill in its own colour, which arrives as --c. -->
					<label
						class={[
							'inline-flex cursor-pointer items-center gap-1.25 rounded-full border py-1 pr-2.5 pl-2 text-[13px] touch:py-2',
							'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
							type === option.id
								? 'border-(--c) bg-(--c)/18 text-[color-mix(in_srgb,var(--c)_70%,white)]'
								: 'text-muted'
						]}
						style:--c={option.color}
					>
						<input
							class="pointer-events-none absolute opacity-0"
							type="radio"
							name="type"
							value={option.id}
							bind:group={type}
						/>
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
			<!-- What its card shows above the words: the face of whoever stands
			     there, the thing to be found. -->
			<div class="grid gap-[0.3em]">
				<span class="text-[13px] text-muted">Picture</span>
				<div class="flex flex-wrap items-center gap-2">
					{#if image}
						<img
							class="h-14 w-20 rounded-md border bg-night object-contain"
							src={imageUrl(campaignId, image, 'thumb')}
							alt=""
						/>
					{/if}
					<button type="button" class="btn btn-sm" onclick={() => (picking = true)}>
						{image ? 'Change…' : 'Choose from the gallery…'}
					</button>
					{#if image}
						<button type="button" class="btn btn-sm btn-ghost" onclick={() => (image = null)}>
							Remove
						</button>
					{/if}
				</div>
			</div>

			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-0.75 accent-accent" type="checkbox" bind:checked={hidden} />
				<span>
					Hidden from players
					<small class="block text-muted">Only you see it until you reveal it.</small>
				</span>
			</label>
		{:else}
			<p class="text-[13px] text-muted">Everyone at the table can see and edit this note.</p>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>
				{mode === 'create' ? 'Place marker' : 'Save'}
			</button>
		</div>
	</form>
</Modal>

{#if picking}
	<Gallery {campaignId} current={image} onpick={show} onclose={() => (picking = false)} />
{/if}
