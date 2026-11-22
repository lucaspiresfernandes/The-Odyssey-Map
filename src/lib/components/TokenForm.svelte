<script lang="ts">
	// The rest of what a token is, beyond what the buttons and handles beside
	// it on the map change: its picture, or the colour of its disc while it
	// has none, and the ring around it. Any token can wear a ring, to tell it
	// from others that look the same or to mark which belong together. The GM
	// also says whose token it is: the player whose turn it is when its turn
	// comes, and where the fog follows the tokens, whose eyes it is.

	import {
		TOKEN_COLORS,
		imageUrl,
		type GalleryItem,
		type GalleryResponse,
		type Player,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<TokenInput, 'color' | 'outline' | 'image'> & { ownerId?: string | null };

	interface Props {
		/** The GM picks from the whole gallery, and adds to it. A player from what is revealed. */
		gm: boolean;
		campaignId: string;
		token: Token;
		/** The players of the campaign, for the GM to hand the token to one of them. */
		players?: Player[];
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { gm, campaignId, token, players = [], onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let color = $state(token.color);
	// A group of radio buttons holds strings, so "no outline" is the empty one.
	// svelte-ignore state_referenced_locally
	let outline = $state(token.outline ?? '');
	// svelte-ignore state_referenced_locally
	let image = $state(token.image);
	/** Whose token it is, by the player's id: empty for nobody's. */
	// svelte-ignore state_referenced_locally
	let owner = $state(token.ownerId ?? '');
	/** The gallery is open, to choose the picture from. */
	let picking = $state(false);
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const values: Values = { color, outline: outline || null, image };
		// Whose it is, is the GM's to say, and only said when it has changed.
		if (gm && owner !== (token.ownerId ?? '')) values.ownerId = owner || null;
		const done = await onsubmit(values);
		saving = false;
		if (done) onclose();
	}

	function wear(item: GalleryItem) {
		picking = false;
		image = item.file;
		remembered = false;
	}

	/** The picture in the gallery has been told what its tokens start out as. */
	let remembered = $state(false);
	let remembering = $state(false);
	let rememberError = $state('');

	/**
	 * Tells the gallery that tokens made from this picture start out like
	 * this one: as many cells across, with the outline picked in this form.
	 */
	async function remember() {
		remembering = true;
		rememberError = '';
		try {
			const listed = (await (await fetch(`/c/${campaignId}/gallery`)).json()) as GalleryResponse;
			const item = listed.items?.find((each) => each.file === image);
			if (!item) throw new Error('That picture is no longer in the gallery.');
			const response = await fetch(`/c/${campaignId}/gallery/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ preset: { size: token.size, outline: outline || null } })
			});
			const result = (await response.json()) as GalleryResponse;
			if (!result.ok) throw new Error(result.error);
			remembered = true;
		} catch (err) {
			rememberError = (err as Error).message || "That couldn't be saved.";
		}
		remembering = false;
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
			{#if gm && image}
				<!-- So the next ogre out of the dock is as big as this one. -->
				<p class="text-[13px] text-muted">
					{#if remembered}
						New tokens with this picture now start out this size, with this outline.
					{:else}
						<button
							type="button"
							class="cursor-pointer text-accent underline disabled:cursor-default disabled:opacity-60"
							disabled={remembering}
							onclick={remember}>Start new tokens with this picture like this one</button
						>: its size, and the outline picked below.
					{/if}
					{#if rememberError}<span class="text-danger">{rememberError}</span>{/if}
				</p>
			{/if}
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

		{#if gm}
			<label class="field">
				<span>Whose token it is</span>
				<select class="input" bind:value={owner}>
					<option value="">Nobody’s</option>
					{#each players as player (player.id)}
						<option value={player.id}>{player.name}</option>
					{/each}
					{#if token.ownerId && !players.some((player) => player.id === token.ownerId)}
						<!-- Someone who is no longer among the players the page knows of. -->
						<option value={token.ownerId}>{token.ownerName ?? 'A player'}</option>
					{/if}
				</select>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				Anyone still moves it. Its turn is that player’s to end, and where the fog follows the
				tokens, the table sees around it.
			</p>
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
