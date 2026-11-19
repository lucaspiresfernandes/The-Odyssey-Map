<script lang="ts">
	// The scale of a world map: how many miles it is from its left edge to
	// its right. With that, the ruler can tell distances on it. The maps
	// further in work theirs out from it, so it is set once, on the biggest
	// map, and only again on a map whose own image is to a scale of its own.

	import { milesCount } from '#lib/shared/grid.ts';
	import { LIMITS, type MapInfo } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		map: MapInfo;
		/** How many miles across the map is taken to be now, its own scale or one worked out. */
		miles: number | null;
		/** Null takes the map's own scale away. Resolves to true when the change went through. */
		onsubmit: (miles: number | null) => Promise<boolean>;
		onclose: () => void;
	}

	let { map, miles, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its field once it is open.
	// svelte-ignore state_referenced_locally
	let across = $state<number | null>(map.miles ?? (miles === null ? null : +miles.toPrecision(3)));
	let saving = $state(false);

	async function save(value: number | null) {
		if (saving) return;
		saving = true;
		const done = await onsubmit(value);
		saving = false;
		if (done) onclose();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (across) save(across);
	}
</script>

<Modal title="Scale of {map.name}" {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<label class="field">
			<span>How far it is from the left edge of this map to the right, in miles</span>
			<input
				class="input"
				type="number"
				bind:value={across}
				min={LIMITS.milesMin}
				max={LIMITS.milesMax}
				step="any"
				required
			/>
		</label>
		<p class="-mt-2 text-[13px] text-muted">
			{#if map.miles !== null}
				This map has a scale of its own.
			{:else if miles !== null}
				Worked out from a map further out: about {milesCount(miles)}. Save to give this map a scale
				of its own instead.
			{:else}
				No map on the way here has a scale yet. The maps inside this one will work theirs out from
				it.
			{/if}
		</p>

		<div class="flex justify-end gap-2">
			{#if map.miles !== null}
				<button
					type="button"
					class="btn btn-ghost mr-auto"
					disabled={saving}
					onclick={() => save(null)}>Remove the scale</button
				>
			{/if}
			<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" disabled={saving}>Save</button>
		</div>
	</form>
</Modal>
