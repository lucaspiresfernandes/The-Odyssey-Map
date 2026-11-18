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
	import MarkerGlyph from '#lib/components/MarkerGlyph.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import TokenDock from '#lib/components/TokenDock.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import ToolButton, { type ToolIcon } from '#lib/components/ToolButton.svelte';
	import { freeCell, snapToGrid } from '#lib/shared/grid.ts';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import {
		INK_COLORS,
		LIMITS,
		MARKER_TYPES,
		TOKEN_COLORS,
		type Command,
		type GalleryItem,
		type MapKind,
		type Marker,
		type MarkerInput,
		type MarkerKind,
		type MarkerType,
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

	type Placing = { create: MarkerKind } | { move: Marker };
	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
	/**
	 * What is in hand on a battle map. `pan` is the hand itself: it selects
	 * and moves things. The others are picked from the palette in the corner.
	 */
	type BattleTool = 'pan' | 'select' | 'measure' | 'sketch' | 'text';
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
	let battleTool = $state<BattleTool>('pan');
	/** The colour the pen draws in and text is written in. */
	let ink = $state<string>(INK_COLORS[0]);
	let form = $state<Form | null>(null);
	/** The token whose picture, colour and outline are being changed. */
	let tokenForm = $state<Token | null>(null);
	/** Goes up whenever the gallery may have changed, so the dock reads it again. */
	let galleryStamp = $state(0);
	// The two palettes of a battle map fold away, and stay as they were left.
	let dockFolded = $state(false);
	let toolsFolded = $state(false);
	/** The GM is setting up the grid of this battle map. */
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
	/** The tokens and drawings selected on a battle map. */
	let selectedIds = $state<string[]>([]);
	/**
	 * The types of marker this person has filtered out of the world maps. It
	 * is their own view and nobody else's, and it is kept from map to map.
	 */
	let hiddenTypes = $state<MarkerType[]>([]);
	/** The pills that choose them are out, over the bar under the map. */
	let filterOpen = $state(false);
	let inviteOpen = $state(false);
	// Raw, because a notice's step is looked up in the undo stack by identity,
	// and deep state would hand out a proxy of it instead.
	let notice = $state.raw<Notice | null>(null);

	/**
	 * A battle map is a table to play on: tokens, a ruler, a pen, and none of
	 * what a world map is built from. No markers, no notes, no regions
	 * further in.
	 */
	const battle = $derived(world.map.kind === 'battle');
	const tool = $derived(battle ? battleTool : placing ? 'place' : drawing ? 'draw' : 'pan');

	/** The markers of this map that are of a type this person wants to see. */
	const shownMarkers = $derived(
		hiddenTypes.length
			? world.markers.filter((marker) => !hiddenTypes.includes(marker.type))
			: world.markers
	);
	/** How many markers of each type this map holds, shown or not. */
	const typeCounts = $derived.by(() => {
		const counts: Partial<Record<MarkerType, number>> = {};
		for (const marker of world.markers) counts[marker.type] = (counts[marker.type] ?? 0) + 1;
		return counts;
	});

	// How the palettes were left is this browser's to remember: read once the
	// page is in it, and written whenever one is folded or unfolded.
	let recalled = false;
	$effect(() => {
		const folded = { dock: dockFolded, tools: toolsFolded };
		untrack(() => {
			try {
				if (recalled) {
					localStorage.setItem('odyssey:dock', folded.dock ? '1' : '0');
					localStorage.setItem('odyssey:tools', folded.tools ? '1' : '0');
				} else {
					dockFolded = localStorage.getItem('odyssey:dock') === '1';
					toolsFolded = localStorage.getItem('odyssey:tools') === '1';
				}
			} catch {
				// A private window may refuse. The palettes then start unfolded.
			}
			recalled = true;
		});
	});
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

	// Stepping into another map starts from a clean slate. That is also the
	// only way from one kind of map to the other, each with its own tools: a
	// map stays the kind it was made as.
	$effect(() => {
		void data.snapshot.map.id;
		untrack(() => {
			placing = null;
			drawing = false;
			battleTool = 'pan';
			form = null;
			tokenForm = null;
			filterOpen = false;
			setup = false;
			gallery = null;
			prompt = null;
			deleting = null;
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedIds = [];
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

	async function saveMarker(values: Pick<MarkerInput, 'type' | 'title' | 'description' | 'hidden'>) {
		if (!form) return false;
		let command: Command;
		if (form.mode === 'create') {
			command = {
				t: 'marker.create',
				mapId: world.map.id,
				kind: form.kind,
				x: form.x,
				y: form.y,
				...values
			};
		} else {
			// Table notes have no hidden state to send.
			const { hidden, ...shared } = values;
			const changes = form.marker.kind === 'world' ? values : shared;
			command = { t: 'marker.update', id: form.marker.id, changes };
		}
		const saved = await run(command);
		// A marker just made or changed shouldn't vanish from under its maker:
		// its type is shown again if it was filtered out.
		if (saved) hiddenTypes = hiddenTypes.filter((type) => type !== values.type);
		return saved;
	}

	/** Filters the markers down to all types but these. */
	function hideTypes(types: MarkerType[]) {
		hiddenTypes = types;
		// A pinned card goes with its marker.
		const pinned = world.markers.find((marker) => marker.id === selectedMarkerId);
		if (pinned && types.includes(pinned.type)) selectedMarkerId = null;
	}

	function toggleType(type: MarkerType) {
		hideTypes(
			hiddenTypes.includes(type) ? hiddenTypes.filter((t) => t !== type) : [...hiddenTypes, type]
		);
	}

	async function deleteMarker(marker: Marker) {
		selectedMarkerId = null;
		const { ok, step } = await attempt({ t: 'marker.delete', id: marker.id });
		if (ok) say(`Deleted “${marker.title}”.`, step);
	}

	// -------------------------------------------------------------- tokens

	/**
	 * Carries out what was done to the tokens and drawings of a battle map:
	 * one command, or several as one, which then undo as one too. `note` is
	 * said once it is done, with a button to undo it.
	 */
	async function send(commands: Command[], note?: string): Promise<boolean> {
		if (commands.length === 0) return true;
		const command = commands.length === 1 ? commands[0] : { t: 'batch' as const, cmds: commands };
		const { ok, step } = await attempt(command);
		if (ok && note) say(note, step);
		return ok;
	}

	/** A new token is the GM's red, or a player's blue: mostly foes from one, themself from the other. */
	const tokenColor = $derived(isGm ? TOKEN_COLORS[0] : TOKEN_COLORS[5]);

	/**
	 * A token out of the dock: of that picture, or a plain one. It goes down
	 * where it was dropped, or for a click, in the free cell nearest the
	 * middle of the view. Either way squarely on the grid, and selected.
	 */
	async function addToken(item: GalleryItem | null, drop: { x: number; y: number } | null) {
		if (!canvas) return;
		const here = world.tokens.map((token): Point => [token.x, token.y]);
		const dropped = drop && canvas.spotAt(drop.x, drop.y);
		// Let go anywhere but over the map, it goes back in the dock.
		if (drop && !dropped) return;
		const [x, y] = dropped
			? snapToGrid(world.map, dropped)
			: freeCell(world.map, canvas.middle(), here);
		// A token is called what its picture is. A plain one a player adds is
		// most likely themself.
		const name = (item?.name ?? (isGm ? 'Token' : data.me.name)).slice(0, LIMITS.tokenName);
		const had = new Set(world.tokens.map((token) => token.id));
		const made = await run({
			t: 'token.create',
			mapId: world.map.id,
			name: name.trim() || 'Token',
			image: item?.file ?? null,
			color: tokenColor,
			x,
			y
		});
		if (!made) return;
		battleTool = 'pan';
		selectedIds = world.tokens.filter((token) => !had.has(token.id)).map((token) => token.id);
	}

	function saveToken(values: Pick<TokenInput, 'color' | 'outline' | 'image'>) {
		if (!tokenForm) return Promise.resolve(false);
		return run({ t: 'token.update', id: tokenForm.id, changes: values });
	}

	/** Takes a tool of the battle map in hand. */
	function take(next: BattleTool) {
		battleTool = next;
		// A box to select with keeps what is selected: Shift adds to it.
		if (next !== 'pan' && next !== 'select') selectedIds = [];
	}

	/** A click on a tool picks it up, or with that one in hand, puts it down again. */
	function pick(next: BattleTool) {
		take(battleTool === next ? 'pan' : next);
	}

	/** Each with the key that takes it in hand: the top row of the keyboard, left to right. */
	const BATTLE_TOOLS: { tool: BattleTool; icon: ToolIcon; label: string; key: string }[] = [
		{ tool: 'pan', icon: 'pointer', label: 'Select and move', key: 'q' },
		{ tool: 'select', icon: 'marquee', label: 'Select several', key: 'w' },
		{ tool: 'measure', icon: 'ruler', label: 'Measure a distance', key: 'e' },
		{ tool: 'sketch', icon: 'draw', label: 'Draw', key: 'r' },
		{ tool: 'text', icon: 'text', label: 'Write text', key: 't' }
	];

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
		// In a text field, a letter is a letter and Ctrl+Z belongs to the text.
		const typing =
			e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]');

		if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
			if (typing) return;
			e.preventDefault();
			// One step per press: holding the keys down doesn't run through the lot.
			if (e.repeat) return;
			if (e.shiftKey) redo();
			else undo();
			return;
		}

		// Each tool of a battle map has a key of its own.
		if (battle && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const hit = BATTLE_TOOLS.find((each) => each.key === e.key.toLowerCase());
			if (hit) {
				e.preventDefault();
				if (!e.repeat) take(hit.tool);
				return;
			}
		}

		if (e.key !== 'Escape') return;
		if (placing || drawing || battleTool !== 'pan') {
			putAway();
		} else if (filterOpen) {
			filterOpen = false;
		} else if (inviteOpen) {
			inviteOpen = false;
		} else {
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedIds = [];
		}
	}

	/** Back to the hand: whichever tool was waiting for the map is put away. */
	function putAway() {
		placing = null;
		drawing = false;
		battleTool = 'pan';
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
				markers={shownMarkers}
				tokens={world.tokens}
				drawings={world.drawings}
				{cursors}
				role={data.role}
				userId={data.me.id}
				{tool}
				{ink}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				bind:selectedIds
				{send}
				ondone={() => (battleTool = 'pan')}
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
				onedittoken={(token) => (tokenForm = token)}
				oncursor={(at) => live.point(at && { mapId: world.map.id, ...at })}
			/>

			{#if empty && isGm && tool === 'pan'}
				<p
					class="absolute top-4.5 left-1/2 w-max max-w-[calc(100%-28px)] -translate-x-1/2 rounded-full border bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl"
				>
					{battle
						? 'This battle map is empty. Choose a map image in the corner, and add tokens from below.'
						: 'This map is empty. Add a map image, markers and regions from the bar below.'}
				</p>
			{/if}

			{#if battle}
				<!-- The tools of a battle map, docked in the upper right corner: what is
				     in hand, and for the GM, what the map itself is. Folded away it is
				     one button, which still shows the tool in hand. -->
				{@const inHand = BATTLE_TOOLS.find((each) => each.tool === battleTool) ?? BATTLE_TOOLS[0]}
				<div class="absolute top-3.5 right-3.5 z-1 flex items-start gap-1.5">
					{#if !toolsFolded && (battleTool === 'sketch' || battleTool === 'text')}
						<!-- The inks, out while there is something to draw or write with. -->
						<div
							class="grid gap-1.5 p-1.5 {floating}"
							role="radiogroup"
							aria-label={battleTool === 'text' ? 'Colour of the text' : 'Colour of the pen'}
						>
							{#each INK_COLORS as option (option)}
								<!-- Each ink is a disc of itself, which arrives as --c. -->
								<button
									class={[
										'size-6 cursor-pointer rounded-full border-2 border-[#55607a] bg-(--c) touch:size-8',
										ink === option && 'token-selected'
									]}
									style:--c={option}
									role="radio"
									aria-checked={ink === option}
									aria-label="Colour {option}"
									onclick={() => (ink = option)}
								></button>
							{/each}
						</div>
					{/if}
					<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Map tools">
						{#if toolsFolded}
							<ToolButton
								tip="left"
								icon={inHand.icon}
								label="Show the tools"
								hint="In hand: {inHand.label.toLowerCase()}"
								active={battleTool !== 'pan'}
								onclick={() => (toolsFolded = false)}
							/>
						{:else}
							<ToolButton
								tip="left"
								icon="up"
								label="Fold the tools away"
								onclick={() => (toolsFolded = true)}
							/>
							<span class="h-px bg-line"></span>
							{#each BATTLE_TOOLS as each (each.tool)}
								<ToolButton
									tip="left"
									icon={each.icon}
									label={each.label}
									shortcut={each.key}
									active={battleTool === each.tool}
									onclick={() => pick(each.tool)}
								/>
							{/each}
							{#if isGm}
								<span class="h-px bg-line"></span>
								<ToolButton
									tip="left"
									icon="image"
									label={world.map.imageFile ? 'Change the map image' : 'Choose a map image'}
									onclick={() => (gallery = 'pick')}
								/>
								<ToolButton
									tip="left"
									icon="rename"
									label="Rename this map"
									onclick={() =>
										(prompt = { kind: 'rename', mapId: world.map.id, initial: world.map.name })}
								/>
								<ToolButton
									tip="left"
									icon="grid"
									label="Set up the grid"
									onclick={() => (setup = true)}
								/>
							{/if}
						{/if}
					</div>
				</div>
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

				{#if battle}
					<!-- A battle map is played on: under it is the dock of tokens to put
					     on it, for everyone at the table. Its tools are in the corner. -->
					<TokenDock
						{campaignId}
						gm={isGm}
						color={tokenColor}
						stamp={galleryStamp}
						bind:collapsed={dockFolded}
						onadd={addToken}
						onerror={say}
					/>
				{:else}
				{#if filterOpen && tool === 'pan'}
					<!-- Which types of marker to see: a pill for each, lit while its type
					     is shown, with how many of them this map holds. -->
					<div
						class="pointer-events-auto grid w-[min(440px,calc(100%-24px))] gap-2 p-2.5 {floating}"
						role="group"
						aria-label="Types of marker to show"
					>
						<div class="flex flex-wrap justify-center gap-1.5">
							{#each MARKER_TYPES as option (option.id)}
								{@const shown = !hiddenTypes.includes(option.id)}
								<!-- Each type is a pill in its own colour, which arrives as --c. -->
								<button
									class={[
										'inline-flex cursor-pointer items-center gap-1.25 rounded-full border py-1 pr-2.5 pl-2 text-[13px] touch:py-2',
										shown
											? 'border-(--c) bg-(--c)/18 text-[color-mix(in_srgb,var(--c)_70%,white)]'
											: 'text-muted line-through decoration-muted/60'
									]}
									style:--c={option.color}
									aria-pressed={shown}
									onclick={() => toggleType(option.id)}
								>
									<MarkerGlyph type={option.id} size={15} />
									{option.label}
									{#if typeCounts[option.id]}
										<span class="text-[11px] tabular-nums opacity-70">{typeCounts[option.id]}</span>
									{/if}
								</button>
							{/each}
						</div>
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-muted">Only changes what you see.</span>
							<span class="flex gap-1.5">
								<button
									class="btn btn-sm btn-ghost"
									disabled={hiddenTypes.length === 0}
									onclick={() => hideTypes([])}>Show all</button
								>
								<button
									class="btn btn-sm btn-ghost"
									disabled={hiddenTypes.length === MARKER_TYPES.length}
									onclick={() => hideTypes(MARKER_TYPES.map((each) => each.id))}>Hide all</button
								>
							</span>
						</div>
					</div>
				{/if}
				<div
					class="pointer-events-auto flex max-w-[calc(100%-120px)] flex-wrap items-center justify-center gap-1.5 p-1.5 max-[720px]:max-w-[calc(100%-24px)] max-[720px]:flex-col {floating}"
					role="toolbar"
					aria-label="Map tools"
				>
					{#if tool !== 'pan'}
						<button class="btn" onclick={putAway}>Cancel</button>
					{:else}
						<!-- The tools for the map. This wrapper only exists on a narrow
						     screen, where it makes them a row of their own. -->
						<div class="contents flex-wrap items-center justify-center gap-1.5 max-[720px]:flex">
							<!-- Icons, each with a tooltip that names it. A player has one
							     tool, so theirs keeps its words. -->
							<ToolButton
								icon="note"
								label={isGm ? 'Add a note' : 'Add note'}
								named={!isGm}
								onclick={() => startPlacing({ create: 'player' })}
							/>
							<!-- Lit while some type is filtered out, so markers that don't
							     show are never a mystery. -->
							<ToolButton
								icon="filter"
								label="Filter markers by type"
								hint={hiddenTypes.length
									? `${hiddenTypes.length} of ${MARKER_TYPES.length} types hidden`
									: undefined}
								active={hiddenTypes.length > 0}
								expanded={filterOpen}
								onclick={() => (filterOpen = !filterOpen)}
							/>
							{#if isGm}
								<span class="w-px self-stretch bg-line"></span>
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
										drawing = true;
									}}
								/>
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
							{/if}
						</div>
						{#if isGm}
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
				{/if}
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
		gm={isGm}
		{campaignId}
		token={tokenForm}
		onsubmit={saveToken}
		onclose={() => {
			tokenForm = null;
			// The form's own gallery may have been added to or tidied.
			galleryStamp++;
		}}
	/>
{/if}

{#if setup && battle}
	<MapSetup
		map={world.map}
		onsubmit={(grid, cellFeet) => run({ t: 'map.update', id: world.map.id, grid, cellFeet })}
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
	<Gallery
		{campaignId}
		onclose={() => {
			gallery = null;
			// What was added, revealed or taken out shows in the dock of tokens.
			galleryStamp++;
		}}
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
