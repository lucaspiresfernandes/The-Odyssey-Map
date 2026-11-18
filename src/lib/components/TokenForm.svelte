<script lang="ts">
	// The rest of what a token is, beyond what the buttons beside it on the
	// map change: its picture, its colour, and for the GM, whose it is.

	import {
		TOKEN_COLORS,
		imageUrl,
		type GalleryItem,
		type Member,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<TokenInput, 'color' | 'image' | 'ownerId'>;

	interface Props {
		/** The GM also decides who moves the token. */
		gm: boolean;
		campaignId: string;
		/** The people the GM can hand it to. */
		members: Member[];
		token: Token;
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { gm, campaignId, members, token, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let color = $state(token.color);
	// svelte-ignore state_referenced_locally
	let image = $state(token.image);
	/** The gallery is open, to choose the picture from. */
	let picking = $state(false);
	// A select holds strings, so "nobody" is the empty one.
	// svelte-ignore state_referenced_locally
	let ownerId = $state(token.ownerId ?? '');
	let saving = $state(false);

	const players = $derived(members.filter((member) => member.role === 'player'));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit({ color, image, ownerId: ownerId || null });
		saving = false;
		if (done) onclose();
	}

	function wear(item: GalleryItem) {
		picking = false;
		image = item.file;
	}
</script>

<Modal title={token.name} {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<div class="grid gap-[0.3em]">
			<span class="text-[13px] text-muted">Picture</span>
			<div class="flex flex-wrap items-center gap-2">
				{#if image}
					<!-- As it will look on the map: ringed in the token's colour (--c). -->
					<img
						class="size-11 rounded-full border-2 border-(--c) object-cover"
						style:--c={color}
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

		<fieldset class="grid gap-[0.3em]">
			<legend class="text-[13px] text-muted">Colour</legend>
			<div class="mt-1 flex flex-wrap gap-2">
				{#each TOKEN_COLORS as option (option)}
					<!-- Each colour is a disc of itself, which arrives as --c. -->
					<label
						class={[
							'size-7 cursor-pointer rounded-full border-2 border-[#12151c] bg-(--c) touch:size-9',
							'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
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

		{#if gm}
			<label class="field">
				<span>Moved by</span>
				<select class="input" bind:value={ownerId}>
					<option value="">Only you, the GM</option>
					{#each players as player (player.id)}
						<option value={player.id}>{player.name}, and you</option>
					{/each}
				</select>
			</label>
		{:else}
			<p class="text-[13px] text-muted">This token is yours: you and the GM can move it.</p>
		{/if}

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
