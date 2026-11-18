<script lang="ts">
	import { cellsAcross, cellsToFeet, feetCount } from '#lib/shared/grid.ts';
	import { LIMITS, type Grid, type MapInfo } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	// The grid of a battle map. What kind of map this is isn't asked here: that
	// was chosen when its region was drawn, and a map stays what it was made as.

	interface Props {
		map: MapInfo;
		/** Resolves to true when the change went through and the dialog can close. */
		onsubmit: (grid: Grid, cellFeet: number) => Promise<boolean>;
		onclose: () => void;
	}

	let { map, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let size = $state(map.grid.size);
	// svelte-ignore state_referenced_locally
	let x = $state(map.grid.x);
	// svelte-ignore state_referenced_locally
	let y = $state(map.grid.y);
	// svelte-ignore state_referenced_locally
	let shown = $state(map.grid.shown);
	// svelte-ignore state_referenced_locally
	let feet = $state(map.cellFeet);
	let saving = $state(false);

	/** How many cells that makes, to check against the squares counted on the image. */
	const cells = $derived(
		size >= LIMITS.gridMin && size <= LIMITS.gridMax ? cellsAcross(map, { size }) : null
	);

	/** How far that is from edge to edge, at the scale typed in. */
	const span = $derived(
		cells && feet >= LIMITS.cellFeetMin && feet <= LIMITS.cellFeetMax
			? cells.map((count) => feetCount(cellsToFeet({ cellFeet: feet }, count)))
			: null
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		// An emptied number field reads as null. The map keeps what it had.
		const done = await onsubmit(
			{
				size: size ?? map.grid.size,
				x: x ?? 0,
				y: y ?? 0,
				shown
			},
			feet ?? map.cellFeet
		);
		saving = false;
		if (done) onclose();
	}
</script>

<Modal title="Set up the grid" {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
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

		<label class="field">
			<span>How far one cell is, in feet</span>
			<input
				class="input"
				type="number"
				bind:value={feet}
				min={LIMITS.cellFeetMin}
				max={LIMITS.cellFeetMax}
				step="any"
				required
			/>
		</label>
		<p class="-mt-2 text-[13px] text-muted">
			The ruler and a token's size are told in feet{#if span}. The whole map is about {span[0]} × {span[1]}{/if}.
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

		<div class="flex justify-end gap-2">
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>Save</button>
		</div>
	</form>
</Modal>
