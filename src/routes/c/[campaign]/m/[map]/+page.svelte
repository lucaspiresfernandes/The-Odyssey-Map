<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import { UndoStack, type Step } from '#lib/client/undo.ts';
	import Gallery from '#lib/components/Gallery.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MapSetup from '#lib/components/MapSetup.svelte';
	import MarkerForm from '#lib/components/MarkerForm.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import ToolButton from '#lib/components/ToolButton.svelte';
	import { snapToGrid } from '#lib/shared/grid.ts';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import {
		type Command,
		type GalleryItem,
		type MapKind,
		type Marker,
		type MarkerInput,
		type MarkerKind,
		type Patch,
		type Point,
		type Region,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const live = getLive();

	// A fresh copy of the map for every snapshot the server sends, brought up
	// to date with any events that arrived while it was loading.
	const world = $derived.by(() => {
		const state = new MapState(data.snapshot);
		for (const event of live.recent) state.apply(event);
		return state;
	});
	$effect(() =>
		live.subscribe((event) => {
			world.apply(event);
			leaveIfShut(event.patch);
		})
	);

	// What this person has done on this map, for Ctrl+Z and Ctrl+Shift+Z.
	const undos = new UndoStack(live);

	const campaignId = $derived(data.campaign.id);
	const isGm = $derived(canEditWorld(data.role));
	/** Everyone else's mouse, for those looking at the same map. */
	const cursors = $derived(live.cursors.filter((c) => c.mapId === world.map.id));

	type Placing = { create: MarkerKind } | { move: Marker } | { token: true };
	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
	type TokenEdit = { mode: 'create'; x: number; y: number } | { mode: 'edit'; token: Token };
	type Prompt =
		| { kind: 'region'; points: Point[] }
		| { kind: 'rename'; mapId: string; initial: string };
	interface Notice {
		id: number;
		text: string;
		/** What the Undo button on the notice takes back. */
		undo?: Step | null;
	}

	let canvas = $state<ReturnType<typeof MapCanvas>>();
	let placing = $state<Placing | null>(null);
	let drawing = $state(false);
	/** The ruler is out, on a battle map. */
	let measuring = $state(false);
	let form = $state<Form | null>(null);
	let tokenForm = $state<TokenEdit | null>(null);
	/** The GM is choosing what kind of map this is, and setting up its grid. */
	let setup = $state(false);
	/**
	 * The GM is in the gallery: to choose an image to lay under this map, or
	 * to look after the whole of it, with nothing to pick.
	 */
	let gallery = $state<'pick' | 'browse' | null>(null);
	let prompt = $state<Prompt | null>(null);
	/** The region the GM has asked to delete, while they are being asked if they mean it. */
	let deleting = $state<Region | null>(null);
	let selectedMarkerId = $state<string | null>(null);
	let selectedRegionId = $state<string | null>(null);
	let selectedTokenId = $state<string | null>(null);
	let inviteOpen = $state(false);
	// Raw, because a notice's step is looked up in the undo stack by identity,
	// and deep state would hand out a proxy of it instead.
	let notice = $state.raw<Notice | null>(null);

	const tool = $derived(placing ? 'place' : drawing ? 'draw' : measuring ? 'measure' : 'pan');
	/**
	 * A battle map is a table to play on: tokens and a ruler, and none of what
	 * a world map is built from. No markers, no notes, no regions further in.
	 */
	const battle = $derived(world.map.kind === 'battle');
	/** The region the GM has clicked. The region buttons under the map act on it. */
	const selectedRegion = $derived(world.regions.find((r) => r.id === selectedRegionId) ?? null);
	/** Why the region buttons are off, for their tooltips. */
	const regionHint = $derived(selectedRegion ? undefined : 'Click a region first');
	const inviteUrl = $derived(
		data.invitePath && typeof location !== 'undefined' ? location.origin + data.invitePath : ''
	);
	const empty = $derived(
		!world.map.imageFile &&
			world.markers.length === 0 &&
			world.regions.length === 0 &&
			world.tokens.length === 0
	);

	// Each kind of map has its own tools. Whichever is out when the GM turns
	// this map into the other kind is put away.
	$effect(() => {
		void battle;
		untrack(() => {
			putAway();
			form = null;
			tokenForm = null;
			prompt = null;
		});
	});

	// Stepping into another map starts from a clean slate.
	$effect(() => {
		void data.snapshot.map.id;
		untrack(() => {
			placing = null;
			drawing = false;
			measuring = false;
			form = null;
			tokenForm = null;
			setup = false;
			gallery = null;
			prompt = null;
			deleting = null;
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedTokenId = null;
			// Undo is for the map in front of you, not one you have left.
			undos.clear();
		});
	});

	function say(text: string, undo?: Step | null) {
		const id = Date.now();
		notice = { id, text, undo };
		setTimeout(() => {
			if (notice?.id === id) notice = null;
		}, 7000);
	}

	/**
	 * Sends a command and remembers it for undo. A refusal is reported to the
	 * user. `step` is what there is to undo about it, if anything.
	 */
	async function attempt(command: Command): Promise<{ ok: boolean; step: Step | null }> {
		try {
			return { ok: true, step: undos.did(await live.send(command)) };
		} catch (err) {
			say((err as Error).message);
			return { ok: false, step: null };
		}
	}

	/** The same, for when all that matters is whether it went through. */
	async function run(command: Command): Promise<boolean> {
		return (await attempt(command)).ok;
	}

	// ----------------------------------------------------------- undo, redo

	/** Takes back the last thing this person did here, or `step` in particular. */
	async function undo(step?: Step) {
		// A notice offering to undo something would now be offering the past.
		if (notice?.undo) notice = null;
		try {
			if (!(await undos.undo(step))) say('Nothing to undo.');
		} catch (err) {
			say((err as Error).message);
		}
	}

	async function redo() {
		try {
			if (!(await undos.redo())) say('Nothing to redo.');
		} catch (err) {
			say((err as Error).message);
		}
	}

	// ------------------------------------------------------------- markers

	function startPlacing(next: Placing) {
		drawing = false;
		measuring = false;
		selectedMarkerId = null;
		selectedRegionId = null;
		selectedTokenId = null;
		placing = next;
	}

	function placed(x: number, y: number) {
		const target = placing;
		placing = null;
		if (!target) return;
		if ('token' in target) tokenForm = { mode: 'create', x, y };
		else if ('move' in target) run({ t: 'marker.update', id: target.move.id, changes: { x, y } });
		else form = { mode: 'create', kind: target.create, x, y };
	}

	function saveMarker(values: Pick<MarkerInput, 'type' | 'title' | 'description' | 'hidden'>) {
		if (!form) return Promise.resolve(false);
		if (form.mode === 'create') {
			return run({
				t: 'marker.create',
				mapId: world.map.id,
				kind: form.kind,
				x: form.x,
				y: form.y,
				...values
			});
		}
		// Table notes have no hidden state to send.
		const { hidden, ...shared } = values;
		const changes = form.marker.kind === 'world' ? values : shared;
		return run({ t: 'marker.update', id: form.marker.id, changes });
	}

	async function deleteMarker(marker: Marker) {
		selectedMarkerId = null;
		const { ok, step } = await attempt({ t: 'marker.delete', id: marker.id });
		if (ok) say(`Deleted “${marker.title}”.`, step);
	}

	// -------------------------------------------------------------- tokens

	function saveToken(
		values: Pick<TokenInput, 'name' | 'color' | 'image' | 'size' | 'ownerId' | 'hidden'>
	) {
		if (!tokenForm) return Promise.resolve(false);
		// Who moves a token and whether it is hidden are the GM's to say.
		const { ownerId, hidden, ...shared } = values;
		const fields = isGm ? values : shared;
		if (tokenForm.mode === 'edit') {
			return run({ t: 'token.update', id: tokenForm.token.id, changes: fields });
		}
		// It goes down squarely on the grid, where a click rarely lands.
		const [x, y] = snapToGrid(world.map, [tokenForm.x, tokenForm.y], values.size);
		return run({ t: 'token.create', mapId: world.map.id, x, y, ...fields });
	}

	async function deleteToken(token: Token) {
		selectedTokenId = null;
		const { ok, step } = await attempt({ t: 'token.delete', id: token.id });
		if (ok) say(`Deleted “${token.name}”.`, step);
	}

	// ------------------------------------------------------ maps & regions

	async function enter(region: Region) {
		await canvas?.flyTo(region);
		try {
			await goto(`/c/${campaignId}/m/${region.targetMapId}`);
		} catch {
			canvas?.reset();
		}
	}

	function saveName(name: string, hidden: boolean, kind: MapKind) {
		if (!prompt) return Promise.resolve(false);
		if (prompt.kind === 'rename') return run({ t: 'map.update', id: prompt.mapId, name });
		return run({
			t: 'region.create',
			mapId: world.map.id,
			name,
			points: prompt.points,
			hidden,
			kind
		});
	}

	/**
	 * A region has gone from some map: deleted, or to a player, hidden.
	 * Whoever is standing in the map it led to, or deeper, is walked back out
	 * to the map the region was on. The GM is only ever told of a deletion,
	 * and then the map they are in no longer exists.
	 */
	function leaveIfShut(patch: Patch) {
		if (patch.t !== 'region.remove') return;
		if (world.trail.some((crumb) => crumb.id === patch.targetMapId)) {
			goto(`/c/${campaignId}/m/${patch.mapId}`);
		}
	}

	/** Runs once the GM has confirmed. There is no undo for this one. */
	async function deleteRegion(region: Region) {
		deleting = null;
		selectedRegionId = null;
		if (await run({ t: 'region.delete', id: region.id })) {
			say(`Deleted “${region.name}” and everything inside it.`);
		}
	}

	/** Lays an image out of the gallery under this map. Undo takes it back off. */
	function layImage(item: GalleryItem) {
		gallery = null;
		run({ t: 'map.update', id: world.map.id, image: item.file });
	}

	// ---------------------------------------------------------------- misc

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			inviteOpen = false;
			say('Invite link copied to the clipboard.');
		} catch {
			// The popup stays open, so the link can be copied by hand.
			say('Copy the link from the box.');
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (form || tokenForm || setup || gallery || prompt || deleting) return;

		if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
			// In a text field, Ctrl+Z belongs to the text.
			const field = 'input, textarea, select, [contenteditable]';
			if (e.target instanceof Element && e.target.closest(field)) return;
			e.preventDefault();
			// One step per press: holding the keys down doesn't run through the lot.
			if (e.repeat) return;
			if (e.shiftKey) redo();
			else undo();
			return;
		}

		if (e.key !== 'Escape') return;
		if (placing || drawing || measuring) {
			putAway();
		} else if (inviteOpen) {
			inviteOpen = false;
		} else {
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedTokenId = null;
		}
	}

	/** Back to the hand: whichever tool was waiting for the map is put away. */
	function putAway() {
		placing = null;
		drawing = false;
		measuring = false;
	}

	// Looks shared by more than one element below.
	const crumbLink = 'text-muted no-underline hover:text-accent touch:py-2';
	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';

	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
	}
</script>

<svelte:window {onkeydown} />

<svelte:head>
	<title>
		{world.map.name === data.campaign.name
			? world.map.name
			: `${world.map.name} · ${data.campaign.name}`} · The Odyssey Map
	</title>
</svelte:head>

<div class="flex h-dvh flex-col">
	<header
		class="flex min-h-12 items-center justify-between gap-3 border-b bg-panel px-3 py-1.5 max-[720px]:flex-wrap"
	>
		<nav
			class="flex min-w-0 items-center gap-2 overflow-x-auto font-serif text-[17px] whitespace-nowrap scrollbar-none"
			aria-label="Breadcrumb"
		>
			<a class="flex p-1 {crumbLink}" href="/" aria-label="All campaigns" title="All campaigns">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
					<path d="M12 5.5 14 12l-2 6.5L10 12Z" fill="currentColor" />
				</svg>
			</a>
			{#each world.trail as crumb, i (crumb.id)}
				<span class="text-[#5c667a]" aria-hidden="true">›</span>
				{#if i < world.trail.length - 1}
					<a class={crumbLink} href="/c/{campaignId}/m/{crumb.id}">{crumb.name}</a>
				{:else}
					<span class="font-semibold" aria-current="page">{crumb.name}</span>
				{/if}
			{/each}
			{#if world.regions.length}
				<!-- The same doorways as on the map, for keyboards and screen readers. -->
				<select
					class="ml-1.5 cursor-pointer rounded-lg border bg-panel-2 px-1.5 py-0.75 font-sans text-[13px] text-muted touch:min-h-9 touch:min-w-28 touch:text-base"
					aria-label="Step into a region of this map"
					onchange={(e) => {
						const region = world.regions.find((r) => r.id === e.currentTarget.value);
						e.currentTarget.value = '';
						if (region) enter(region);
					}}
				>
					<option value="">Step into…</option>
					{#each world.regions as region (region.id)}
						<option value={region.id}>{region.name}{region.hidden ? ' (hidden)' : ''}</option>
					{/each}
				</select>
			{/if}
		</nav>

		<!-- ml-auto keeps these on the right when a narrow screen wraps them onto a row of their own. -->
		<div class="ml-auto flex shrink-0 items-center gap-2">
			{#if live.status === 'offline'}
				<span class="text-xs text-[#e8b85a]" role="status">Reconnecting…</span>
			{/if}
			<ul class="mr-1 flex" aria-label="At the table now">
				{#each live.online as person (person.id)}
					<li
						class={[
							'-ml-1.5 grid size-6.5 cursor-default place-items-center rounded-full border-2 border-panel text-[11px] font-semibold',
							person.role === 'gm' ? 'bg-accent text-accent-ink' : 'bg-[#3a465c]'
						]}
						title="{person.name}{person.role === 'gm' ? ' (GM)' : ''}{person.id === data.me.id
							? ' (you)'
							: ''}"
					>
						{initials(person.name)}
					</li>
				{/each}
			</ul>

			{#if isGm}
				<!-- The campaign's pictures, to stock ahead of the maps and tokens that will use them. -->
				<button
					class="btn btn-sm"
					onclick={() => {
						inviteOpen = false;
						gallery = 'browse';
					}}>Gallery</button
				>
				<div class="relative">
					<button
						class="btn btn-sm"
						aria-expanded={inviteOpen}
						onclick={() => (inviteOpen = !inviteOpen)}>Invite</button
					>
					{#if inviteOpen}
						<div
							class="absolute top-[calc(100%+8px)] right-0 z-5 grid w-[min(340px,calc(100vw-24px))] gap-2.5 rounded-xl border bg-panel p-3.5 text-[13px] shadow-pop"
						>
							<p>Share this link. Anyone who opens it joins as a player.</p>
							<div class="flex gap-1.5">
								<input
									class="input min-h-7 text-[13px] touch:min-h-9 touch:text-base"
									readonly
									value={inviteUrl}
									aria-label="Invite link"
									onfocus={(e) => e.currentTarget.select()}
								/>
								<button class="btn btn-sm btn-primary" onclick={copyInvite}>Copy</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		<main class="relative min-w-0 flex-1">
			<MapCanvas
				bind:this={canvas}
				map={world.map}
				regions={world.regions}
				markers={world.markers}
				tokens={world.tokens}
				{cursors}
				role={data.role}
				userId={data.me.id}
				{tool}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				bind:selectedTokenId
				onplace={placed}
				onnote={(x, y) => (form = { mode: 'create', kind: 'player', x, y })}
				ondrawn={(points) => {
					drawing = false;
					prompt = { kind: 'region', points };
				}}
				onenter={enter}
				onreshape={(region, points) => run({ t: 'region.update', id: region.id, points })}
				onedit={(marker) => (form = { mode: 'edit', marker })}
				onmove={(marker) => startPlacing({ move: marker })}
				ondelete={deleteMarker}
				onhide={(marker, hidden) => run({ t: 'marker.update', id: marker.id, changes: { hidden } })}
				onmovetoken={(token, x, y) => run({ t: 'token.update', id: token.id, changes: { x, y } })}
				onedittoken={(token) => (tokenForm = { mode: 'edit', token })}
				ondeletetoken={deleteToken}
				onhidetoken={(token, hidden) => run({ t: 'token.update', id: token.id, changes: { hidden } })}
				oncursor={(at) => live.point(at && { mapId: world.map.id, ...at })}
			/>

			{#if empty && isGm && tool === 'pan'}
				<p
					class="absolute top-4.5 left-1/2 w-max max-w-[calc(100%-28px)] -translate-x-1/2 rounded-full border bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl"
				>
					{battle
						? 'This battle map is empty. Add a map image and tokens from the bar below.'
						: 'This map is empty. Add a map image, markers and regions from the bar below.'}
				</p>
			{/if}

			<!-- What floats over the bottom of the map: a notice when there is one,
			     stacked on the tools. Only the two of them take the pointer. On a
			     wide screen the bar keeps clear of the zoom buttons in the corner;
			     on a narrow one those move to the top and it takes the full width. -->
			<div
				class="pointer-events-none absolute inset-x-0 bottom-3.5 z-1 flex flex-col items-center gap-3"
			>
				{#if notice}
					<div
						class="pointer-events-auto flex max-w-[calc(100%-28px)] items-center gap-2 rounded-[10px] border border-[#4a5670] bg-[#2a3142] py-2 pr-2 pl-3.5 text-sm shadow-pop"
						role="status"
					>
						<span>{notice.text}</span>
						{#if notice.undo}
							{@const step = notice.undo}
							<button class="btn btn-sm" onclick={() => undo(step)}>Undo</button>
						{/if}
						<button class="btn btn-sm btn-ghost" aria-label="Dismiss" onclick={() => (notice = null)}>
							×
						</button>
					</div>
				{/if}

				<div
					class="pointer-events-auto flex max-w-[calc(100%-120px)] flex-wrap items-center justify-center gap-1.5 p-1.5 max-[720px]:max-w-[calc(100%-24px)] max-[720px]:flex-col {floating}"
					role="toolbar"
					aria-label="Map tools"
				>
					{#if tool !== 'pan'}
						<button class="btn" onclick={putAway}>{measuring ? 'Done measuring' : 'Cancel'}</button>
					{:else}
						<!-- The tools for the map. This wrapper only exists on a narrow
						     screen, where it makes them a row of their own. -->
						<div class="contents flex-wrap items-center justify-center gap-1.5 max-[720px]:flex">
							<!-- Icons, each with a tooltip that names it. A player has a tool
							     or two, so theirs keep their words. -->
							{#if battle}
								<!-- A battle map is played on, not written on: pieces and a
								     ruler, for everyone at the table. -->
								<ToolButton
									icon="token"
									label={isGm ? 'Add a token' : 'Add your token'}
									named={!isGm}
									onclick={() => startPlacing({ token: true })}
								/>
								<ToolButton
									icon="ruler"
									label={isGm ? 'Measure a distance' : 'Measure'}
									named={!isGm}
									onclick={() => {
										selectedTokenId = null;
										measuring = true;
									}}
								/>
							{:else}
								<ToolButton
									icon="note"
									label={isGm ? 'Add a note' : 'Add note'}
									named={!isGm}
									onclick={() => startPlacing({ create: 'player' })}
								/>
							{/if}
							{#if isGm}
								<span class="w-px self-stretch bg-line"></span>
								{#if !battle}
									<ToolButton
										icon="marker"
										label="Add a world marker"
										onclick={() => startPlacing({ create: 'world' })}
									/>
									<ToolButton
										icon="region"
										label="Draw a region"
										onclick={() => {
											selectedMarkerId = null;
											selectedRegionId = null;
											selectedTokenId = null;
											drawing = true;
										}}
									/>
								{/if}
								<ToolButton
									icon="image"
									label={world.map.imageFile ? 'Change the map image' : 'Choose a map image'}
									onclick={() => (gallery = 'pick')}
								/>
								<ToolButton
									icon="rename"
									label="Rename this map"
									onclick={() =>
										(prompt = { kind: 'rename', mapId: world.map.id, initial: world.map.name })}
								/>
								<ToolButton
									icon="grid"
									label={battle ? 'Set up the grid' : 'Make this a battle map'}
									onclick={() => (setup = true)}
								/>
							{/if}
						</div>
						{#if isGm && !battle}
							<!-- What can be done with a region. Always here on a world map, so
							     the bar keeps its shape, and live once a region on the map has
							     been clicked. A narrow screen has no room for that: there they
							     are a second row, which shows up with the selection. A battle
							     map has no regions, and so none of these. -->
							<span class="w-px self-stretch bg-line max-[720px]:hidden"></span>
							<div
								class={['flex items-center gap-1.5', !selectedRegion && 'max-[720px]:hidden']}
								role="group"
								aria-label={selectedRegion ? `Region ${selectedRegion.name}` : 'Region'}
							>
								<ToolButton
									icon="enter"
									label="Enter the region"
									hint={regionHint}
									disabled={!selectedRegion}
									onclick={() => {
										const region = selectedRegion;
										selectedRegionId = null;
										if (region) enter(region);
									}}
								/>
								<ToolButton
									icon={selectedRegion?.hidden ? 'reveal' : 'hide'}
									label={selectedRegion?.hidden
										? 'Reveal the region to players'
										: 'Hide the region from players'}
									hint={regionHint}
									disabled={!selectedRegion}
									onclick={() =>
										selectedRegion &&
										run({ t: 'region.update', id: selectedRegion.id, hidden: !selectedRegion.hidden })}
								/>
								<ToolButton
									icon="rename"
									label="Rename the region"
									hint={regionHint}
									disabled={!selectedRegion}
									onclick={() =>
										selectedRegion &&
										(prompt = {
											kind: 'rename',
											mapId: selectedRegion.targetMapId,
											initial: selectedRegion.name
										})}
								/>
								<ToolButton
									icon="delete"
									label="Delete the region"
									hint={regionHint}
									danger
									disabled={!selectedRegion}
									onclick={() => (deleting = selectedRegion)}
								/>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</main>
	</div>
</div>

{#if form}
	<MarkerForm
		mode={form.mode}
		kind={form.mode === 'create' ? form.kind : form.marker.kind}
		initial={form.mode === 'edit' ? form.marker : {}}
		onsubmit={saveMarker}
		onclose={() => (form = null)}
	/>
{/if}

{#if tokenForm}
	<TokenForm
		mode={tokenForm.mode}
		gm={isGm}
		{campaignId}
		members={data.members}
		initial={tokenForm.mode === 'edit' ? tokenForm.token : {}}
		onsubmit={saveToken}
		onclose={() => (tokenForm = null)}
	/>
{/if}

{#if setup}
	<MapSetup
		map={world.map}
		occupied={world.markers.length > 0 || world.regions.length > 0}
		onsubmit={(kind, grid) => run({ t: 'map.update', id: world.map.id, kind, grid })}
		onclose={() => (setup = false)}
	/>
{/if}

{#if gallery === 'pick'}
	<Gallery
		{campaignId}
		kind="map"
		current={world.map.imageFile}
		onpick={layImage}
		onclose={() => (gallery = null)}
	/>
{:else if gallery === 'browse'}
	<Gallery {campaignId} onclose={() => (gallery = null)} />
{/if}

{#if prompt}
	<NamePrompt
		title={prompt.kind === 'region' ? 'Name this region' : 'Rename'}
		label="Name"
		initial={prompt.kind === 'rename' ? prompt.initial : ''}
		confirm={prompt.kind === 'region' ? 'Create region' : 'Rename'}
		hint={prompt.kind === 'region'
			? 'The region gets a map of its own. Double-click it to step inside and add the image.'
			: undefined}
		canHide={prompt.kind === 'region'}
		canPickKind={prompt.kind === 'region'}
		onsubmit={saveName}
		onclose={() => (prompt = null)}
	/>
{/if}

{#if deleting}
	{@const region = deleting}
	<Modal title="Delete “{region.name}”?" onclose={() => (deleting = null)}>
		<p>
			This deletes the region and the map behind it, with everything on that map: its markers,
			notes and tokens, and every region and map further inside.
		</p>
		<p class="text-[13px] text-muted">It can't be undone. The images stay in the gallery.</p>
		<!-- Cancel comes first, so that is where the dialog puts the focus. -->
		<div class="flex justify-end gap-2">
			<button class="btn btn-ghost" onclick={() => (deleting = null)}>Cancel</button>
			<button class="btn btn-danger" onclick={() => deleteRegion(region)}>Delete</button>
		</div>
	</Modal>
{/if}
