<script lang="ts" module>
	/** What the dialog may change about a map. Only what was changed is in it. */
	export interface MapChanges {
		name?: string;
		image?: string;
		miles?: number | null;
		dayMiles?: number | null;
		cellFeet?: number;
	}
</script>

<script lang="ts">
	// What a map is, in one place: its name, the image under it, and its
	// scale. The GM opens it from the menu at the top of the map. Nothing
	// changes until it is saved, and then it is all one change, which one
	// undo takes back. The ruler of a world map opens it too, on the scale,
	// when it has none to go by.

	import { milesCount } from '#lib/shared/grid.ts';
	import { imageUrl, LIMITS, type GalleryItem, type MapInfo } from '#lib/shared/types.ts';
	import Gallery from './Gallery.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		map: MapInfo;
		campaignId: string;
		/** The field it opens on: the scale, when it is the ruler that asked for one. */
		first?: 'name' | 'scale';
		/** A world map with no image of its own is showing part of one from further out. */
		borrowed?: boolean;
		/** How many miles across a world map is taken to be now, its own scale or one worked out. */
		miles: number | null;
		/** How many miles a day's travel covers there now: its own pace, or the one it goes by. */
		dayMiles: number;
		/** Resolves to true when the changes went through and the dialog can close. */
		onsubmit: (changes: MapChanges) => Promise<boolean>;
		onclose: () => void;
	}

	let {
		map,
		campaignId,
		first = 'name',
		borrowed = false,
		miles,
		dayMiles,
		onsubmit,
		onclose
	}: Props = $props();

	// Deliberately one-time copies: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	const world = map.kind === 'world';
	// svelte-ignore state_referenced_locally
	let name = $state(map.name);
	/** The image picked out of the gallery, to lay under the map when this is saved. */
	let picked = $state<GalleryItem | null>(null);
	/** The map's own scale. Empty, it is worked out from the maps further out. */
	// svelte-ignore state_referenced_locally
	let across = $state<number | null>(map.miles);
	/** The map's own pace. Empty, it goes by the maps further out. */
	// svelte-ignore state_referenced_locally
	let pace = $state<number | null>(map.dayMiles);
	// svelte-ignore state_referenced_locally
	let feet = $state<number | null>(map.cellFeet);
	let picking = $state(false);
	let saving = $state(false);

	/** What an empty scale comes to: what this map works out from the maps further out, if they have one. */
	// svelte-ignore state_referenced_locally
	const workedOut = map.miles === null && miles !== null ? +miles.toPrecision(3) : null;
	/** What an empty pace comes to: what this map would go by without one of its own. */
	// svelte-ignore state_referenced_locally
	const inherited = map.dayMiles === null ? dayMiles : null;

	const file = $derived(picked?.file ?? map.imageFile);

	/** An emptied number field reads as null, or on some browsers as nothing at all. */
	const typed = (value: number | null | undefined) => (typeof value === 'number' ? value : null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		const changes: MapChanges = {};
		if (name.trim() !== map.name) changes.name = name;
		if (picked && picked.file !== map.imageFile) changes.image = picked.file;
		if (world) {
			if (typed(across) !== map.miles) changes.miles = typed(across);
			if (typed(pace) !== map.dayMiles) changes.dayMiles = typed(pace);
		} else if (typed(feet) !== null && feet !== map.cellFeet) {
			changes.cellFeet = feet!;
		}
		// Saved as it was: there is nothing to tell the table.
		if (Object.keys(changes).length === 0) return onclose();
		saving = true;
		const done = await onsubmit(changes);
		saving = false;
		if (done) onclose();
	}
</script>

<Modal title="Map Settings" {onclose}>
	<form class="grid gap-3.5" onsubmit={submit}>
		<label class="field">
			<span>Name</span>
			<input class="input" bind:value={name} maxlength={LIMITS.name} required />
		</label>

		<div class="field">
			<span>Map image</span>
			<div class="flex items-center gap-3">
				{#if file}
					<img
						class="aspect-4/3 w-28 shrink-0 rounded-lg border-2 border-line bg-night object-cover"
						src={imageUrl(campaignId, file, 'thumb')}
						alt=""
						draggable="false"
					/>
				{:else}
					<div
						class="grid aspect-4/3 w-28 shrink-0 place-items-center rounded-lg border-2 border-dashed border-line text-xs text-muted"
					>
						None yet
					</div>
				{/if}
				<div class="grid min-w-0 justify-items-start gap-1.5">
					<p class="max-w-full text-[13px] wrap-anywhere text-muted">
						{#if picked && picked.file !== map.imageFile}
							“{picked.name}”, {picked.width} × {picked.height} pixels. It is laid under the map when
							you save, and everything on the map keeps its place.
						{:else if map.imageFile}
							{map.width} × {map.height} pixels.
						{:else if borrowed}
							Until it has one of its own, this map shows its part of the map further out.
						{:else}
							This map has no image yet.
						{/if}
					</p>
					<button type="button" class="btn btn-sm" onclick={() => (picking = true)}>
						{file ? 'Change the image…' : 'Choose an image…'}
					</button>
				</div>
			</div>
		</div>

		{#if world}
			<label class="field">
				<span>Map scale: how far it is from the left edge to the right, in miles</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input"
					type="number"
					autofocus={first === 'scale'}
					bind:value={across}
					min={LIMITS.milesMin}
					max={LIMITS.milesMax}
					step="any"
					placeholder={workedOut === null ? undefined : String(workedOut)}
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				{#if map.miles !== null}
					This map has a scale of its own. Emptied, it works one out from the maps further out again.
				{:else if miles !== null}
					Left empty, it is worked out from a map further out: about {milesCount(miles)}.
				{:else}
					No map on the way here has a scale yet, and the ruler needs one. The maps inside this one
					work theirs out from it.
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
					Left empty, it is {milesCount(inherited)} a day here.
				{:else}
					Emptied, this map goes by the maps further out again.
				{/if}
			</p>
		{:else}
			<label class="field">
				<span>Map scale: how far one cell of the grid is, in feet</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input"
					type="number"
					autofocus={first === 'scale'}
					bind:value={feet}
					min={LIMITS.cellFeetMin}
					max={LIMITS.cellFeetMax}
					step="any"
					required
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				The ruler and a token's size are told in feet. How big a cell is on the image is set with
				the grid button, among the map's tools.
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
		kind="map"
		current={file}
		onpick={(item) => {
			picking = false;
			picked = item;
		}}
		onclose={() => (picking = false)}
	/>
{/if}
