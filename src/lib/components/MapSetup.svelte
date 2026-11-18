<script lang="ts">
	import { cellsAcross } from '#lib/shared/grid.ts';
	import { LIMITS, type Grid, type MapInfo, type MapKind } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		map: MapInfo;
		/** The map has markers, notes or regions on it. A battle map can hold none of them. */
		occupied: boolean;
		/** Resolves to true when the change went through and the dialog can close. */
		onsubmit: (kind: MapKind, grid: Grid) => Promise<boolean>;
		onclose: () => void;
	}

	let { map, occupied, onsubmit, onclose }: Props = $props();

	const KINDS: { id: MapKind; label: string; about: string }[] = [
		{ id: 'world', label: 'World map', about: 'Markers, notes and regions to step into.' },
		{ id: 'battle', label: 'Battle map', about: 'A table to play on: a grid, tokens to move and a ruler.' }
	];

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let kind = $state(map.kind);
	// svelte-ignore state_referenced_locally
	let size = $state(map.grid.size);
	// svelte-ignore state_referenced_locally
	let x = $state(map.grid.x);
	// svelte-ignore state_referenced_locally
	let y = $state(map.grid.y);
	// svelte-ignore state_referenced_locally
	let shown = $state(map.grid.shown);
	let saving = $state(false);

	/** A world map with things on it has to be cleared before it can become a battle map. */
	const blocked = $derived(map.kind === 'world' && occupied);

	/** How many cells that makes, to check against the squares counted on the image. */
	const cells = $derived(
		size >= LIMITS.gridMin && size <= LIMITS.gridMax ? cellsAcross(map, { size }) : null
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		// An emptied number field reads as null. The grid keeps what it had.
		const done = await onsubmit(kind, {
			size: size ?? map.grid.size,
			x: x ?? 0,
			y: y ?? 0,
			shown
		});
		saving = false;
		if (done) onclose();
	}
</script>

<Modal title="Set up this map" {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<fieldset class="grid gap-2">
			<legend class="text-[13px] text-muted">Kind of map</legend>
			{#each KINDS as option (option.id)}
				{@const off = blocked && option.id === 'battle'}
				<label
					class={[
						'mt-1 flex items-start gap-2.5 rounded-lg border px-3 py-2',
						off ? 'opacity-60' : 'cursor-pointer',
						kind === option.id && 'border-accent bg-accent/8'
					]}
				>
					<input
						class="mt-1 accent-accent"
						type="radio"
						name="kind"
						value={option.id}
						disabled={off}
						bind:group={kind}
					/>
					<span>
						{option.label}
						<small class="block text-muted">{option.about}</small>
					</span>
				</label>
			{/each}
		</fieldset>

		{#if kind === 'battle'}
			<label class="field">
				<span>Size of one cell, in pixels of the map image</span>
				<input
					class="input"
					type="number"
					bind:value={size}
					min={LIMITS.gridMin}
					max={LIMITS.gridMax}
					step="any"
					required
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				This map is {map.width} × {map.height} pixels{#if cells}, so that is about {cells[0]} × {cells[1]}
					cells{/if}.
			</p>

			<div class="grid grid-cols-2 gap-2.5">
				<label class="field">
					<span>Shift the grid right, in pixels</span>
					<input class="input" type="number" bind:value={x} step="any" />
				</label>
				<label class="field">
					<span>Shift it down</span>
					<input class="input" type="number" bind:value={y} step="any" />
				</label>
			</div>

			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-0.75 accent-accent" type="checkbox" bind:checked={shown} />
				<span>
					Draw the grid lines
					<small class="block text-muted">
						Turn this off for an image with a grid of its own. Tokens still snap to the cells.
					</small>
				</span>
			</label>
		{:else if blocked}
			<p class="text-[13px] text-muted">
				A battle map holds no markers, notes or regions. Delete the ones on this map first, or
				draw a region and pick Battle map for what is inside it.
			</p>
		{:else if map.kind === 'battle'}
			<p class="text-[13px] text-muted">
				The tokens on this map are put away, not deleted. They come back with the battle map.
			</p>
		{/if}

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>Save</button>
		</div>
	</form>
</Modal>
