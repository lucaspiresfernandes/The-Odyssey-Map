<script lang="ts">
	// The scale of a world map: how many miles it is from its left edge to
	// its right. With that, the ruler can tell distances on it. The maps
	// further in work theirs out from it, so it is set once, on the biggest
	// map, and only again on a map whose own image is to a scale of its own.
	//
	// And how far a day's travel goes, which is what the ruler tells time by:
	// said once as well, and again only where the going is different.

	import { milesCount } from '#lib/shared/grid.ts';
	import { LIMITS, type MapInfo } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		map: MapInfo;
		/** How many miles across the map is taken to be now, its own scale or one worked out. */
		miles: number | null;
		/** How many miles a day's travel covers here now: its own pace, or the one it goes by. */
		dayMiles: number;
		/**
		 * Null for the miles takes the map's own scale away, and null for the
		 * pace its own pace. A pace left out is left as it is. Resolves to true
		 * when the change went through.
		 */
		onsubmit: (miles: number | null, dayMiles?: number | null) => Promise<boolean>;
		onclose: () => void;
	}

	let { map, miles, dayMiles, onsubmit, onclose }: Props = $props();

	// Deliberately a one-time copy: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	let across = $state<number | null>(map.miles ?? (miles === null ? null : +miles.toPrecision(3)));
	/** The map's own pace. Empty, it goes by the maps further out. */
	// svelte-ignore state_referenced_locally
	let pace = $state<number | null>(map.dayMiles);
	/** What an empty pace comes to: what this map would go by without one of its own. */
	// svelte-ignore state_referenced_locally
	const inherited = map.dayMiles === null ? dayMiles : null;
	let saving = $state(false);

	async function save(value: number | null, day?: number | null) {
		if (saving) return;
		saving = true;
		const done = await onsubmit(value, day);
		saving = false;
		if (done) onclose();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		// An emptied number field reads as null, or on some browsers as nothing at all.
		if (across) save(across, typeof pace === 'number' ? pace : null);
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

		<label class="field">
			<span>How far a day's travel goes, in miles</span>
			<input
				class="input"
				type="number"
				bind:value={pace}
				min={LIMITS.dayMilesMin}
				max={LIMITS.dayMilesMax}
				step="any"
				placeholder={inherited === null ? undefined : String(inherited)}
			/>
		</label>
		<p class="-mt-2 text-[13px] text-muted">
			The ruler tells how long the way takes by it.
			{#if inherited !== null}
				Left empty, it is {milesCount(inherited)} a day here: what a map further out says, or a day
				on foot.
			{:else}
				Emptied, this map goes by the maps further out again. The maps inside it go by this one.
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
