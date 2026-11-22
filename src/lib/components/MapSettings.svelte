<script lang="ts" module>
	import type { Diagonal, Units } from '#lib/shared/types.ts';

	/** What the dialog may change about a map. Only what was changed is in it. */
	export interface MapChanges {
		name?: string;
		image?: string;
		miles?: number | null;
		dayMiles?: number | null;
		cellFeet?: number;
		units?: Units | null;
		diagonal?: Diagonal | null;
		sight?: number | null;
	}
</script>

<script lang="ts">
	// What a map is, in one place: its name, the image under it, its scale,
	// what distances are told in, and on a battle map, whether the fog
	// follows the tokens. The GM opens it from the menu at the top of the
	// map. Nothing changes until it is saved, and then it is all one change,
	// which one undo takes back. The ruler of a world map opens it too, on
	// the scale, when it has none to go by.

	import {
		UNIT_NAMES,
		longFrom,
		longIn,
		milesCount,
		shortFrom,
		shortIn
	} from '#lib/shared/grid.ts';
	import {
		DEFAULT_SIGHT,
		imageUrl,
		LIMITS,
		type GalleryItem,
		type MapInfo
	} from '#lib/shared/types.ts';
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
		/** What the maps further out say distances are told in, and how a diagonal is counted. */
		outer: { units: Units; diagonal: Diagonal };
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
		outer,
		onsubmit,
		onclose
	}: Props = $props();

	// Deliberately one-time copies: the form owns its fields once it is open.
	// svelte-ignore state_referenced_locally
	const world = map.kind === 'world';
	/** The first map of a campaign has no map outside it to go by. */
	// svelte-ignore state_referenced_locally
	const outermost = map.parentId === null;
	// svelte-ignore state_referenced_locally
	let name = $state(map.name);
	/** The image picked out of the gallery, to lay under the map when this is saved. */
	let picked = $state<GalleryItem | null>(null);

	/**
	 * What this map says distances are told in, and how a diagonal is counted:
	 * empty for as the map outside has it. The first map of a campaign always
	 * says, since nothing else does.
	 */
	// svelte-ignore state_referenced_locally
	let ownUnits = $state<Units | ''>(map.units ?? (outermost ? outer.units : ''));
	// svelte-ignore state_referenced_locally
	let ownDiagonal = $state<Diagonal | ''>(map.diagonal ?? (outermost ? outer.diagonal : ''));
	/** What the numbers below are typed in. */
	const units = $derived(ownUnits || outer.units);
	const called = $derived(UNIT_NAMES[units]);

	// The numbers are typed in the map's units, and kept in feet and miles.
	// svelte-ignore state_referenced_locally
	const told = map.units ?? outer.units;
	/** The map's own scale. Empty, it is worked out from the maps further out. */
	// svelte-ignore state_referenced_locally
	let across = $state<number | null>(map.miles === null ? null : longIn(map.miles, told));
	/** The map's own pace. Empty, it goes by the maps further out. */
	// svelte-ignore state_referenced_locally
	let pace = $state<number | null>(map.dayMiles === null ? null : longIn(map.dayMiles, told));
	// svelte-ignore state_referenced_locally
	let feet = $state<number | null>(shortIn(map.cellFeet, told));
	/** The fog follows the tokens, and how far each of the players' tokens sees. */
	// svelte-ignore state_referenced_locally
	let following = $state(map.sight !== null);
	// svelte-ignore state_referenced_locally
	let far = $state<number | null>(shortIn(map.sight ?? DEFAULT_SIGHT, told));
	let picking = $state(false);
	let saving = $state(false);

	/** An emptied number field reads as null, or on some browsers as nothing at all. */
	const typed = (value: number | null | undefined) => (typeof value === 'number' ? value : null);

	/**
	 * The units were changed: what is typed below is the same distances,
	 * told the new way.
	 */
	let typedIn: Units = told;
	function retell() {
		const from = typedIn;
		const to = units;
		typedIn = to;
		if (from === to) return;
		const long = (value: number | null) =>
			typed(value) === null ? null : longIn(longFrom(value!, from), to);
		const short = (value: number | null) =>
			typed(value) === null ? null : shortIn(shortFrom(value!, from), to);
		across = long(across);
		pace = long(pace);
		feet = short(feet);
		far = short(far);
	}

	/** What an empty scale comes to: what this map works out from the maps further out, if they have one. */
	const workedOut = $derived(
		map.miles === null && miles !== null ? +longIn(miles, units).toPrecision(3) : null
	);
	/** What an empty pace comes to: what this map would go by without one of its own. */
	const inherited = $derived(map.dayMiles === null ? dayMiles : null);

	const file = $derived(picked?.file ?? map.imageFile);

	const UNIT_CHOICES: { value: Units; label: string }[] = [
		{ value: 'imperial', label: 'Feet and miles' },
		{ value: 'metric', label: 'Metres and kilometres' }
	];
	const DIAGONAL_CHOICES: { value: Diagonal; label: string }[] = [
		{ value: 'one', label: 'One cell, like any other step' },
		{ value: 'alternate', label: 'One cell, then two, turn about' },
		{ value: 'true', label: 'Its true length, as the crow flies' }
	];
	const labelOf = <T,>(choices: { value: T; label: string }[], value: T) =>
		choices.find((choice) => choice.value === value)?.label.toLowerCase() ?? '';

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		const changes: MapChanges = {};
		if (name.trim() !== map.name) changes.name = name;
		if (picked && picked.file !== map.imageFile) changes.image = picked.file;
		// The first map of a campaign that says what every map starts out
		// with has said nothing new.
		const saysUnits = ownUnits || null;
		const hadUnits = map.units ?? (outermost ? outer.units : null);
		if (saysUnits !== hadUnits) changes.units = saysUnits;
		const saysDiagonal = ownDiagonal || null;
		const hadDiagonal = map.diagonal ?? (outermost ? outer.diagonal : null);
		if (saysDiagonal !== hadDiagonal) changes.diagonal = saysDiagonal;
		if (world) {
			const scale = typed(across) === null ? null : longFrom(across!, units);
			if (scale !== map.miles) changes.miles = scale;
			const days = typed(pace) === null ? null : longFrom(pace!, units);
			if (days !== map.dayMiles) changes.dayMiles = days;
		} else {
			const cell = typed(feet) === null ? null : shortFrom(feet!, units);
			if (cell !== null && cell !== map.cellFeet) changes.cellFeet = cell;
			const sight = following && typed(far) !== null ? shortFrom(far!, units) : null;
			if (sight !== map.sight) changes.sight = sight;
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

		<!-- What distances are told in, and how a diagonal step is counted. Said
		     once, on the first map of a campaign: every map inside goes by it,
		     until one says otherwise for itself and the maps inside it. -->
		<div class="grid grid-cols-2 gap-2.5 max-[520px]:grid-cols-1">
			<label class="field">
				<span>Distances are told in</span>
				<select class="input" bind:value={ownUnits} onchange={retell}>
					{#if !outermost}
						<option value="">As on the map outside: {labelOf(UNIT_CHOICES, outer.units)}</option>
					{/if}
					{#each UNIT_CHOICES as choice (choice.value)}
						<option value={choice.value}>{choice.label}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>{world ? 'On battle maps in here, a diagonal step is' : 'A diagonal step is'}</span>
				<select class="input" bind:value={ownDiagonal}>
					{#if !outermost}
						<option value="">As on the map outside: {labelOf(DIAGONAL_CHOICES, outer.diagonal)}</option>
					{/if}
					{#each DIAGONAL_CHOICES as choice (choice.value)}
						<option value={choice.value}>{choice.label}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if outermost}
			<p class="-mt-2 text-[13px] text-muted">
				Every map inside this one goes by these, until one says otherwise.
			</p>
		{/if}

		{#if world}
			<label class="field">
				<span>Map scale: how far it is from the left edge to the right, in {called.long}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input"
					type="number"
					autofocus={first === 'scale'}
					bind:value={across}
					min={longIn(LIMITS.milesMin, units)}
					max={longIn(LIMITS.milesMax, units)}
					step="any"
					placeholder={workedOut === null ? undefined : String(workedOut)}
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				{#if map.miles !== null}
					This map has a scale of its own. Emptied, it works one out from the maps further out again.
				{:else if miles !== null}
					Left empty, it is worked out from a map further out: about {milesCount(miles, units)}.
				{:else}
					No map on the way here has a scale yet, and the ruler needs one. The maps inside this one
					work theirs out from it.
				{/if}
			</p>

			<label class="field">
				<span>How far a day's travel goes, in {called.long}</span>
				<input
					class="input"
					type="number"
					bind:value={pace}
					min={longIn(LIMITS.dayMilesMin, units)}
					max={longIn(LIMITS.dayMilesMax, units)}
					step="any"
					placeholder={inherited === null ? undefined : String(longIn(inherited, units))}
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				The ruler tells how long the way takes by it.
				{#if inherited !== null}
					Left empty, it is {milesCount(inherited, units)} a day here.
				{:else}
					Emptied, this map goes by the maps further out again.
				{/if}
			</p>
		{:else}
			<label class="field">
				<span>Map scale: how far one cell of the grid is, in {called.short}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input"
					type="number"
					autofocus={first === 'scale'}
					bind:value={feet}
					min={shortIn(LIMITS.cellFeetMin, units)}
					max={shortIn(LIMITS.cellFeetMax, units)}
					step="any"
					required
				/>
			</label>
			<p class="-mt-2 text-[13px] text-muted">
				The ruler and a token's size are told in {called.short}. How big a cell is on the image is
				set with the grid button, among the map's tools.
			</p>

			<!-- Fog that follows the tokens: the map is covered, but for what the
			     players' tokens see around themselves as they stand. -->
			<label class="flex cursor-pointer items-start gap-2.5">
				<input class="mt-0.75 accent-accent" type="checkbox" bind:checked={following} />
				<span>
					The fog follows the tokens
					<small class="block text-muted">
						The players see only around the tokens that are theirs, all of them together. Where a
						token has been is under the fog again once it has moved on. You see through it.
					</small>
				</span>
			</label>
			{#if following}
				<label class="field">
					<span>How far a player's token sees, in {called.short}</span>
					<input
						class="input"
						type="number"
						bind:value={far}
						min={shortIn(LIMITS.sightMin, units)}
						max={shortIn(LIMITS.sightMax, units)}
						step="any"
						required
					/>
				</label>
				<p class="-mt-2 text-[13px] text-muted">
					A token is a player's once they put it down, or once you hand it to them in its picture,
					colour and outline. The fog you paint by hand still covers what it covers.
				</p>
			{/if}
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
