<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import HistoryPanel from '#lib/components/HistoryPanel.svelte';
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
	$effect(() => live.subscribe((event) => world.apply(event)));

	const campaignId = $derived(data.campaign.id);
	const isGm = $derived(canEditWorld(data.role));

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
		undo?: Command;
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
	let historyOpen = $state(false);
	let inviteOpen = $state(false);
	let copied = $state(false);
	let uploading = $state(false);
	let notice = $state<Notice | null>(null);

	const tool = $derived(placing ? 'place' : drawing ? 'draw' : 'pan');
	const selectedRegion = $derived(world.regions.find((r) => r.id === selectedRegionId) ?? null);
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
		});
	});

	function say(text: string, undo?: Command) {
		const id = Date.now();
		notice = { id, text, undo };
		setTimeout(() => {
			if (notice?.id === id) notice = null;
		}, 7000);
	}

	/** Sends a command, reporting a refusal to the user. True when it went through. */
	async function run(command: Command): Promise<boolean> {
		try {
			await live.send(command);
			return true;
		} catch (err) {
			say((err as Error).message);
			return false;
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
		if (await run({ t: 'marker.delete', id: marker.id })) {
			say(`Deleted “${marker.title}”.`, { t: 'marker.restore', id: marker.id });
		}
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

	function saveName(name: string) {
		if (!prompt) return Promise.resolve(false);
		if (prompt.kind === 'rename') return run({ t: 'map.update', id: prompt.mapId, name });
		return run({ t: 'region.create', mapId: world.map.id, name, points: prompt.points });
	}

	async function deleteRegion(region: Region) {
		selectedRegionId = null;
		if (await run({ t: 'region.delete', id: region.id })) {
			say(`Deleted the region “${region.name}”. Its map is kept.`, {
				t: 'region.restore',
				id: region.id
			});
		}
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
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			say('Copy the link from the box.');
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || form || prompt) return;
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

<div class="app">
	<header class="bar">
		<nav class="trail" aria-label="Breadcrumb">
			<a class="home" href="/" aria-label="All campaigns" title="All campaigns">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
					<path d="M12 5.5 14 12l-2 6.5L10 12Z" fill="currentColor" />
				</svg>
			</a>
			{#each world.trail as crumb, i (crumb.id)}
				<span class="sep" aria-hidden="true">›</span>
				{#if i < world.trail.length - 1}
					<a href="/c/{campaignId}/m/{crumb.id}">{crumb.name}</a>
				{:else}
					<span class="here" aria-current="page">{crumb.name}</span>
				{/if}
			{/each}
			{#if world.regions.length}
				<!-- The same doorways as on the map, for keyboards and screen readers. -->
				<select
					class="places"
					aria-label="Step into a region of this map"
					onchange={(e) => {
						const region = world.regions.find((r) => r.id === e.currentTarget.value);
						e.currentTarget.value = '';
						if (region) enter(region);
					}}
				>
					<option value="">Step into…</option>
					{#each world.regions as region (region.id)}
						<option value={region.id}>{region.name}</option>
					{/each}
				</select>
			{/if}
		</nav>

		<div class="tools">
			{#if live.status === 'offline'}
				<span class="status" role="status">Reconnecting…</span>
			{/if}
			<ul class="online" aria-label="At the table now">
				{#each live.online as person (person.id)}
					<li
						class:gm={person.role === 'gm'}
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
					class="btn small"
					class:active={editing}
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
				<div class="invite">
					<button
						class="btn small"
						aria-expanded={inviteOpen}
						onclick={() => (inviteOpen = !inviteOpen)}>Invite</button
					>
					{#if inviteOpen}
						<div class="popover">
							<p>Share this link. Anyone who opens it joins as a player.</p>
							<div class="copy">
								<input
									class="input"
									readonly
									value={inviteUrl}
									aria-label="Invite link"
									onfocus={(e) => e.currentTarget.select()}
								/>
								<button class="btn small primary" onclick={copyInvite}>
									{copied ? 'Copied' : 'Copy'}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
			<button
				class="btn small"
				class:active={historyOpen}
				aria-pressed={historyOpen}
				onclick={() => (historyOpen = !historyOpen)}>History</button
			>
		</div>
	</header>

	<div class="stage">
		<main class="canvas">
			<MapCanvas
				bind:this={canvas}
				map={world.map}
				regions={world.regions}
				markers={world.markers}
				role={data.role}
				{editing}
				{tool}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				onplace={placed}
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
			/>

			{#if selectedRegion && editing && tool === 'pan'}
				<div class="region-bar">
					<span>Region <strong>{selectedRegion.name}</strong></span>
					<button class="btn small" onclick={() => enter(selectedRegion)}>Enter</button>
					<button
						class="btn small"
						onclick={() =>
							(prompt = {
								kind: 'rename',
								mapId: selectedRegion.targetMapId,
								initial: selectedRegion.name
							})}>Rename</button
					>
					<button class="btn small danger" onclick={() => deleteRegion(selectedRegion)}>
						Delete
					</button>
					<small>Drag a corner to reshape</small>
				</div>
			{/if}

			{#if empty && isGm && !editing}
				<p class="coach">
					This map is empty. Turn on <strong>Edit world</strong> to add a map image, markers and
					regions.
				</p>
			{/if}

			<div class="toolbar" role="toolbar" aria-label="Map tools">
				{#if tool !== 'pan'}
					<button class="btn" onclick={() => ((placing = null), (drawing = false))}>Cancel</button>
				{:else}
					<button class="btn" onclick={() => startPlacing({ create: 'player' })}>
						<span aria-hidden="true">＋</span> Add note
					</button>
					{#if isGm && editing}
						<span class="divider"></span>
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
				<div class="notice" role="status">
					<span>{notice.text}</span>
					{#if notice.undo}
						{@const undo = notice.undo}
						<button
							class="btn small"
							onclick={() => {
								notice = null;
								run(undo);
							}}>Undo</button
						>
					{/if}
					<button class="btn small ghost" aria-label="Dismiss" onclick={() => (notice = null)}>
						×
					</button>
				</div>
			{/if}
		</main>

		{#if historyOpen}
			<div class="side">
				<HistoryPanel
					{campaignId}
					mapId={world.map.id}
					role={data.role}
					onclose={() => (historyOpen = false)}
					onerror={say}
				/>
			</div>
		{/if}
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
		onsubmit={saveName}
		onclose={() => (prompt = null)}
	/>
{/if}

<style>
	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 48px;
		padding: 6px 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}

	.trail {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-family: var(--serif);
		font-size: 17px;
		scrollbar-width: none;
	}

	.trail a {
		color: var(--muted);
		text-decoration: none;
	}

	.trail a:hover {
		color: var(--accent);
	}

	.home {
		display: flex;
		padding: 4px;
	}

	.sep {
		color: #5c667a;
	}

	.here {
		font-weight: 600;
	}

	.places {
		margin-left: 6px;
		padding: 3px 6px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel-2);
		color: var(--muted);
		font-family: var(--sans);
		font-size: 13px;
		cursor: pointer;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.status {
		font-size: 12px;
		color: #e8b85a;
	}

	.online {
		display: flex;
		list-style: none;
		margin: 0 4px 0 0;
		padding: 0;
	}

	.online li {
		width: 26px;
		height: 26px;
		margin-left: -6px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 2px solid var(--panel);
		background: #3a465c;
		font-size: 11px;
		font-weight: 600;
		cursor: default;
	}

	.online li.gm {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.invite {
		position: relative;
	}

	.popover {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 5;
		width: min(340px, calc(100vw - 24px));
		padding: 14px;
		display: grid;
		gap: 10px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
		font-size: 13px;
	}

	.copy {
		display: flex;
		gap: 6px;
	}

	.copy .input {
		min-height: 28px;
		font-size: 13px;
	}

	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.side {
		flex-shrink: 0;
	}

	.toolbar {
		position: absolute;
		left: 50%;
		bottom: 14px;
		transform: translateX(-50%);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: max-content;
		max-width: calc(100% - 120px);
		padding: 6px;
		background: rgb(26 31 41 / 0.94);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
	}

	.divider {
		width: 1px;
		align-self: stretch;
		background: var(--line);
	}

	.region-bar {
		position: absolute;
		left: 14px;
		top: 14px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		max-width: calc(100% - 28px);
		padding: 8px 10px;
		background: rgb(26 31 41 / 0.94);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow);
		font-size: 14px;
	}

	.region-bar strong {
		font-family: var(--serif);
	}

	.region-bar small {
		color: var(--muted);
	}

	.coach {
		position: absolute;
		left: 50%;
		top: 18px;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100% - 28px);
		padding: 8px 14px;
		border-radius: 999px;
		background: rgb(16 19 26 / 0.9);
		border: 1px solid var(--line);
		font-size: 14px;
		text-align: center;
	}

	.notice {
		position: absolute;
		left: 50%;
		bottom: 74px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		width: max-content;
		max-width: calc(100% - 28px);
		padding: 8px 8px 8px 14px;
		background: #2a3142;
		border: 1px solid #4a5670;
		border-radius: 10px;
		box-shadow: var(--shadow);
		font-size: 14px;
	}

	@media (max-width: 720px) {
		.bar {
			flex-wrap: wrap;
		}

		.side {
			position: absolute;
			inset: 0;
			z-index: 4;
		}

		.stage {
			position: relative;
		}

		.toolbar {
			max-width: calc(100% - 24px);
			bottom: 64px;
		}

		.notice {
			bottom: 124px;
		}
	}
</style>
