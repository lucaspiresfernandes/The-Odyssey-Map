<script lang="ts">
	import {
		LIMITS,
		TOKEN_COLORS,
		imageUrl,
		type GalleryItem,
		type Member,
		type TokenInput
	} from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import Modal from './Modal.svelte';

	type Values = Pick<TokenInput, 'name' | 'color' | 'image' | 'size' | 'ownerId' | 'hidden'>;

	interface Props {
		mode: 'create' | 'edit';
		/** The GM also decides who moves the token and whether players see it. */
		gm: boolean;
		campaignId: string;
		/** The people the GM can hand it to. */
		members: Member[];
		initial?: Partial<Values>;
		/** Resolves to true when the change went through and the form can close. */
		onsubmit: (values: Values) => Promise<boolean>;
		onclose: () => void;
	}

	let { mode, gm, campaignId, members, initial = {}, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let name = $state(initial.name ?? '');
	// The GM mostly adds foes, a player adds themself: red for one, blue for the other.
	// svelte-ignore state_referenced_locally
	let color = $state(initial.color ?? (gm ? TOKEN_COLORS[0] : TOKEN_COLORS[5]));
	// svelte-ignore state_referenced_locally
	let image = $state(initial.image ?? null);
	/** The gallery is open, to choose the picture from. */
	let picking = $state(false);
	// svelte-ignore state_referenced_locally
	let size = $state(initial.size ?? 1);
	// A select holds strings, so "nobody" is the empty one.
	// svelte-ignore state_referenced_locally
	let ownerId = $state(initial.ownerId ?? '');
	// svelte-ignore state_referenced_locally
	let hidden = $state(initial.hidden ?? false);
	let saving = $state(false);

	const sizes = Array.from({ length: LIMITS.tokenSize }, (_, i) => i + 1);
	const players = $derived(members.filter((member) => member.role === 'player'));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const done = await onsubmit({ name, color, image, size, ownerId: ownerId || null, hidden });
		saving = false;
		if (done) onclose();
	}

	function wear(item: GalleryItem) {
		picking = false;
		image = item.file;
		// A token yet to be named takes the name of its picture: a goblin is a goblin.
		if (!name.trim()) name = item.name.slice(0, LIMITS.tokenName);
	}
</script>

<Modal title={mode === 'create' ? 'New token' : 'Edit token'} {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<label class="field">
			<span>Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" bind:value={name} maxlength={LIMITS.tokenName} required autofocus />
		</label>

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

		<label class="field">
			<span>Size</span>
			<select class="input" bind:value={size}>
				{#each sizes as cells (cells)}
					<option value={cells}>{cells} × {cells} {cells === 1 ? 'cell' : 'cells'}</option>
				{/each}
			</select>
		</label>

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

			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-0.75 accent-accent" type="checkbox" bind:checked={hidden} />
				<span>
					Hidden from players
					<small class="block text-muted">Only you see it until you reveal it.</small>
				</span>
			</label>
		{:else}
			<p class="text-[13px] text-muted">This token is yours: you and the GM can move it.</p>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>
				{mode === 'create' ? 'Place token' : 'Save'}
			</button>
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
