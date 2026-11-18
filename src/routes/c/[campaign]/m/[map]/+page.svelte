<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import { UndoStack, type Step } from '#lib/client/undo.ts';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MarkerForm from '#lib/components/MarkerForm.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import {
		LIMITS,
		type Command,
		type CommandResponse,
		type Marker,
		type MarkerInput,
		type MarkerKind,
		type Patch,
		type Point,
		type Region
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

	type Placing = { create: MarkerKind } | { move: Marker };
	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
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
	let fileInput = $state<HTMLInputElement>();
	let editing = $state(false);
	let placing = $state<Placing | null>(null);
	let drawing = $state(false);
	let form = $state<Form | null>(null);
	let prompt = $state<Prompt | null>(null);
	let selectedMarkerId = $state<string | null>(null);
	let selectedRegionId = $state<string | null>(null);
	let inviteOpen = $state(false);
	let uploading = $state(false);
	// Raw, because a notice's step is looked up in the undo stack by identity,
	// and deep state would hand out a proxy of it instead.
	let notice = $state.raw<Notice | null>(null);

	const tool = $derived(placing ? 'place' : drawing ? 'draw' : 'pan');
	const inviteUrl = $derived(
		data.invitePath && typeof location !== 'undefined' ? location.origin + data.invitePath : ''
	);
	const empty = $derived(
		!world.map.imageFile && world.markers.length === 0 && world.regions.length === 0
	);

	// Stepping into another map starts from a clean slate.
	$effect(() => {
		void data.snapshot.map.id;
		untrack(() => {
			placing = null;
			drawing = false;
			form = null;
			prompt = null;
			selectedMarkerId = null;
			selectedRegionId = null;
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
		selectedMarkerId = null;
		selectedRegionId = null;
		placing = next;
	}

	function placed(x: number, y: number) {
		const target = placing;
		placing = null;
		if (!target) return;
		if ('move' in target) run({ t: 'marker.update', id: target.move.id, changes: { x, y } });
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

	// ------------------------------------------------------ maps & regions

	async function enter(region: Region) {
		await canvas?.flyTo(region);
		try {
			await goto(`/c/${campaignId}/m/${region.targetMapId}`);
		} catch {
			canvas?.reset();
		}
	}

	function saveName(name: string, hidden: boolean) {
		if (!prompt) return Promise.resolve(false);
		if (prompt.kind === 'rename') return run({ t: 'map.update', id: prompt.mapId, name });
		return run({ t: 'region.create', mapId: world.map.id, name, points: prompt.points, hidden });
	}

	/**
	 * A region a player could see has gone from some map: hidden, or deleted.
	 * A player standing in the map it led to, or deeper, is walked back out
	 * to the map the region was on.
	 */
	function leaveIfShut(patch: Patch) {
		if (isGm || patch.t !== 'region.remove') return;
		if (world.trail.some((crumb) => crumb.id === patch.targetMapId)) {
			goto(`/c/${campaignId}/m/${patch.mapId}`);
		}
	}

	async function deleteRegion(region: Region) {
		selectedRegionId = null;
		const { ok, step } = await attempt({ t: 'region.delete', id: region.id });
		if (ok) say(`Deleted the region “${region.name}”. Its map is kept.`, step);
	}

	async function upload(file: File | undefined) {
		if (!file) return;
		uploading = true;
		try {
			if (file.size > LIMITS.imageBytes) {
				throw new Error(`Map images can be up to ${LIMITS.imageBytes / 1024 / 1024} MB.`);
			}
			let bitmap: ImageBitmap;
			try {
				bitmap = await createImageBitmap(file);
			} catch {
				throw new Error("That file doesn't look like an image this browser can read.");
			}
			const body = new FormData();
			body.set('file', file);
			body.set('width', String(bitmap.width));
			body.set('height', String(bitmap.height));
			bitmap.close();

			const response = await fetch(`/c/${campaignId}/m/${world.map.id}/image`, {
				method: 'POST',
				body
			});
			const result = (await response.json().catch(() => null)) as CommandResponse | null;
			if (!result?.ok) throw new Error(result?.error ?? "The image couldn't be uploaded.");
			live.receive(result.events ?? []);
			undos.did(result.undo ?? []);
		} catch (err) {
			say((err as Error).message);
		} finally {
			uploading = false;
			if (fileInput) fileInput.value = '';
		}
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
		if (form || prompt) return;

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
		if (placing || drawing) {
			placing = null;
			drawing = false;
		} else if (inviteOpen) {
			inviteOpen = false;
		} else {
			selectedMarkerId = null;
			selectedRegionId = null;
		}
	}

	// Looks shared by more than one element below.
	const crumbLink = 'text-muted no-underline hover:text-accent';
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
					class="ml-1.5 cursor-pointer rounded-lg border bg-panel-2 px-1.5 py-0.75 font-sans text-[13px] text-muted"
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

		<div class="flex shrink-0 items-center gap-2">
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
				<button
					class={['btn btn-sm', editing && 'btn-active']}
					aria-pressed={editing}
					onclick={() => {
						editing = !editing;
						if (!editing) {
							drawing = false;
							selectedRegionId = null;
							if (placing && 'create' in placing && placing.create === 'world') placing = null;
						}
					}}
				>
					{editing ? 'Editing world' : 'Edit world'}
				</button>
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
									class="input min-h-7 text-[13px]"
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
				{cursors}
				role={data.role}
				userId={data.me.id}
				{editing}
				{tool}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				onplace={placed}
				onnote={(x, y) => (form = { mode: 'create', kind: 'player', x, y })}
				ondrawn={(points) => {
					drawing = false;
					prompt = { kind: 'region', points };
				}}
				onenter={enter}
				onreshape={(region, points) => run({ t: 'region.update', id: region.id, points })}
				onregionhide={(region, hidden) => run({ t: 'region.update', id: region.id, hidden })}
				onregionrename={(region) =>
					(prompt = { kind: 'rename', mapId: region.targetMapId, initial: region.name })}
				onregiondelete={deleteRegion}
				onedit={(marker) => (form = { mode: 'edit', marker })}
				onmove={(marker) => startPlacing({ move: marker })}
				ondelete={deleteMarker}
				onhide={(marker, hidden) => run({ t: 'marker.update', id: marker.id, changes: { hidden } })}
				oncursor={(at) => live.point(at && { mapId: world.map.id, x: at[0], y: at[1] })}
			/>

			{#if empty && isGm && !editing}
				<p
					class="absolute top-4.5 left-1/2 w-max max-w-[calc(100%-28px)] -translate-x-1/2 rounded-full border bg-night/90 px-3.5 py-2 text-center text-sm"
				>
					This map is empty. Turn on <strong>Edit world</strong> to add a map image, markers and
					regions.
				</p>
			{/if}

			<div
				class="absolute bottom-3.5 left-1/2 flex w-max max-w-[calc(100%-120px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 p-1.5 max-[720px]:bottom-16 max-[720px]:max-w-[calc(100%-24px)] {floating}"
				role="toolbar"
				aria-label="Map tools"
			>
				{#if tool !== 'pan'}
					<button class="btn" onclick={() => ((placing = null), (drawing = false))}>Cancel</button>
				{:else}
					<button class="btn" onclick={() => startPlacing({ create: 'player' })}>
						<span aria-hidden="true">＋</span> Add note
					</button>
					{#if isGm && editing}
						<span class="w-px self-stretch bg-line"></span>
						<button class="btn" onclick={() => startPlacing({ create: 'world' })}>
							<span aria-hidden="true">＋</span> World marker
						</button>
						<button
							class="btn"
							onclick={() => {
								selectedMarkerId = null;
								selectedRegionId = null;
								drawing = true;
							}}>Draw region</button
						>
						<button class="btn" disabled={uploading} onclick={() => fileInput?.click()}>
							{uploading ? 'Uploading…' : world.map.imageFile ? 'Replace image' : 'Add map image'}
						</button>
						<button
							class="btn"
							onclick={() =>
								(prompt = { kind: 'rename', mapId: world.map.id, initial: world.map.name })}
							>Rename map</button
						>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
							hidden
							onchange={(e) => upload(e.currentTarget.files?.[0])}
						/>
					{/if}
				{/if}
			</div>

			{#if notice}
				<div
					class="absolute bottom-18.5 left-1/2 flex w-max max-w-[calc(100%-28px)] -translate-x-1/2 items-center gap-2 rounded-[10px] border border-[#4a5670] bg-[#2a3142] py-2 pr-2 pl-3.5 text-sm shadow-pop max-[720px]:bottom-31"
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
		onsubmit={saveName}
		onclose={() => (prompt = null)}
	/>
{/if}
