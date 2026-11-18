<script lang="ts">
	// The rest of what a token is, beyond what the buttons and handles beside
	// it on the map change: its picture, or the colour of its disc while it
	// has none, and the ring around it. Any token can wear a ring, to tell it
	// from others that look the same or to mark which belong together.

	import {
		TOKEN_COLORS,
		imageUrl,
		type GalleryItem,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<TokenInput, 'color' | 'outline' | 'image'>;

	interface Props {
		/** The GM picks from the whole gallery, and adds to it. A player from what is revealed. */
		gm: boolean;
		campaignId: string;
		token: Token;
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { gm, campaignId, token, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let color = $state(token.color);
	// A group of radio buttons holds strings, so "no outline" is the empty one.
	// svelte-ignore state_referenced_locally
	let outline = $state(token.outline ?? '');
	// svelte-ignore state_referenced_locally
	let image = $state(token.image);
	/** The gallery is open, to choose the picture from. */
	let picking = $state(false);
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit({ color, outline: outline || null, image });
		saving = false;
		if (done) onclose();
	}

	function wear(item: GalleryItem) {
		picking = false;
		image = item.file;
	}

	/** What a colour to pick has in common with the next: a disc, and how it shows it is the one. */
	const swatch =
		'size-7 cursor-pointer rounded-full touch:size-9 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent';
</script>

<Modal title={token.name} {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<div class="grid gap-[0.3em]">
			<span class="text-[13px] text-muted">Picture</span>
			<div class="flex flex-wrap items-center gap-2">
				{#if image}
					<!-- As it will look on the map: ringed in its outline (--o), if it has one. -->
					<img
						class="size-11 rounded-full border-[3px] border-(--o) object-cover"
						style:--o={outline || '#12151c'}
						src={imageUrl(campaignId, image)}
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

		<!-- A picture covers the disc, so only a plain token has a colour to pick.
		     The one it had is kept for when the picture comes off. -->
		{#if !image}
			<fieldset class="grid gap-[0.3em]">
				<legend class="text-[13px] text-muted">Colour</legend>
				<div class="mt-1 flex flex-wrap gap-2">
					{#each TOKEN_COLORS as option (option)}
						<!-- Each colour is a disc of itself, which arrives as --c. -->
						<label
							class={[
								swatch,
								'border-2 border-[#12151c] bg-(--c)',
								color === option && 'token-selected'
							]}
							style:--c={option}
						>
							<input
								class="pointer-events-none absolute opacity-0"
								type="radio"
								name="color"
								value={option}
								aria-label="Colour {option}"
								bind:group={color}
							/>
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}

		<fieldset class="grid gap-[0.3em]">
			<legend class="text-[13px] text-muted">Outline</legend>
			<div class="mt-1 flex flex-wrap gap-2">
				<!-- None comes first: a dashed ring with a stroke through it. -->
				<label
					class={[
						swatch,
						'grid place-items-center border-2 border-dashed border-[#55607a] text-muted',
						outline === '' && 'token-selected'
					]}
					title="No outline"
				>
					<input
						class="pointer-events-none absolute opacity-0"
						type="radio"
						name="outline"
						value=""
						aria-label="No outline"
						bind:group={outline}
					/>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<path d="M5 19 19 5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
					</svg>
				</label>
				{#each TOKEN_COLORS as option (option)}
					<!-- Each outline is a ring of itself, which arrives as --c. -->
					<label
						class={[swatch, 'border-4 border-(--c)', outline === option && 'token-selected']}
						style:--c={option}
					>
						<input
							class="pointer-events-none absolute opacity-0"
							type="radio"
							name="outline"
							value={option}
							aria-label="Outline {option}"
							bind:group={outline}
						/>
					</label>
				{/each}
			</div>
		</fieldset>

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>Save</button>
		</div>
	</form>
</Modal>

{#if picking}
	<Gallery
		{campaignId}
		kind="token"
		readonly={!gm}
		current={image}
		onpick={wear}
		onclose={() => (picking = false)}
	/>
{/if}
