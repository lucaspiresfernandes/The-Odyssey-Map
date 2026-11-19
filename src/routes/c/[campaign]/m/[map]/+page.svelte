<script lang="ts">
	import { goto, preloadData, refreshAll } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import { UndoStack, type Step } from '#lib/client/undo.ts';
	import Finder from '#lib/components/Finder.svelte';
	import Gallery from '#lib/components/Gallery.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MapSetup from '#lib/components/MapSetup.svelte';
	import MarkerForm from '#lib/components/MarkerForm.svelte';
	import MarkerGlyph from '#lib/components/MarkerGlyph.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import PlayerPicker from '#lib/components/PlayerPicker.svelte';
	import ScalePrompt from '#lib/components/ScalePrompt.svelte';
	import TokenDock from '#lib/components/TokenDock.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import ToolButton, { type ToolIcon } from '#lib/components/ToolButton.svelte';
	import TurnOrder from '#lib/components/TurnOrder.svelte';
	import { freeCell, gridFromBox, milesCount, snapToGrid } from '#lib/shared/grid.ts';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import { tileLevels } from '#lib/shared/tiles.ts';
	import {
		INK_COLORS,
		LIMITS,
		MARKER_TYPES,
		TOKEN_COLORS,
		imageUrl,
		type Command,
		type FindEntry,
		type GalleryItem,
		type Gather,
		type MapKind,
		type Marker,
		type MarkerInput,
		type MarkerKind,
		type MarkerType,
		type Patch,
		type Player,
		type Point,
		type Rect,
		type Region,
		type TemplateKind,
		type Token,
		type TokenInput,
		type Turns
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
			const scale = world.map.miles;
			// Read before the event is applied: it may be what takes the way here off the map.
			const way = world.trail.map((crumb) => crumb.id);
			world.apply(event);
			leaveIfShut(event.patch, way);
			refreshIfBorrowed(event.patch);
			// With a scale of its own given or taken away, how far across this
			// map is has to be worked out again, which only the server does.
			if (world.map.miles !== scale) refreshAll();
		})
	);

	// What this person has done on this map, for Ctrl+Z and Ctrl+Shift+Z.
	const undos = new UndoStack(live);

	const campaignId = $derived(data.campaign.id);
	const isGm = $derived(canEditWorld(data.role));
	/**
	 * The players of the campaign, for the GM to choose who is let in on a
	 * secret: the ones who had joined when this page loaded, and whoever has
	 * come to the table since.
	 */
	const players = $derived.by((): Player[] => {
		if (!isGm) return [];
		const known = new Set(data.players.map((player) => player.id));
		const arrived = live.online.filter((each) => each.role === 'player' && !known.has(each.id));
		return [...data.players, ...arrived.map(({ id, name }) => ({ id, name }))];
	});
	/**
	 * This window is a table display: the players' view of the map and
	 * nothing else, for a screen the whole table looks at. It shows, and
	 * follows when the GM brings everyone somewhere, and changes nothing.
	 */
	const display = $derived(data.display);
	/** What everyone else looking at this map has in hand: a token, a ruler. */
	const hands = $derived(live.hands.filter((hand) => hand.mapId === world.map.id));
	/** The spots of this map being pointed out right now. */
	const pings = $derived(live.pings.filter((ping) => ping.mapId === world.map.id));
	/**
	 * How many miles across this world map is: its own scale, or the one
	 * worked out from a map further out. Null when nothing says.
	 */
	const miles = $derived(world.map.miles ?? world.miles);

	/** The address of a map of this campaign. A display stays a display from map to map. */
	const mapUrl = (mapId: string) => `/c/${campaignId}/m/${mapId}${display ? '?display' : ''}`;

	type Placing = { create: MarkerKind } | { move: Marker } | { party: true };
	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
	/**
	 * What is in hand on a battle map. `pan` is the hand itself: it selects
	 * and moves things. The others are picked from the palette in the corner.
	 * `sketch` is the pen, which draws a line freehand or one of the shapes:
	 * see `pen`. `reveal` and `cover` are the GM's two ways with the fog
	 * of war, and `align` is theirs too: it lines the grid up with the squares
	 * of the map's own picture.
	 */
	type BattleTool = 'pan' | 'select' | 'measure' | 'sketch' | 'reveal' | 'cover' | 'align';
	/** What the pen draws: a line freehand, or a shape dragged out. */
	type Pen = 'line' | TemplateKind | 'text';
	type Prompt =
		| { kind: 'region'; points: Point[] }
		| { kind: 'rename'; mapId: string; initial: string };
	/** What kind of news a notice is. Each kind has its own colours. */
	type NoticeType = 'success' | 'failure' | 'info' | 'warning';
	interface Notice {
		id: number;
		type: NoticeType;
		text: string;
		/** What the Undo button on the notice takes back. */
		undo?: Step | null;
	}

	let canvas = $state<ReturnType<typeof MapCanvas>>();
	let placing = $state<Placing | null>(null);
	let drawing = $state(false);
	/** The ruler is out on a world map. */
	let measuring = $state(false);
	let battleTool = $state<BattleTool>('pan');
	/** The colour the pen draws in, text is written in and templates are laid down in. */
	let ink = $state<string>(INK_COLORS[0]);
	/** Which template the template tool lays down. */
	let pen = $state<Pen>('line');
	let form = $state<Form | null>(null);
	/** The token whose picture, colour and outline are being changed. */
	let tokenForm = $state<Token | null>(null);
	/** Goes up whenever the gallery may have changed, so the dock reads it again. */
	let galleryStamp = $state(0);
	// The palettes of a battle map fold away, and stay as they were left.
	let dockFolded = $state(false);
	let toolsFolded = $state(false);
	let turnsFolded = $state(false);
	let turnOrder = $state<ReturnType<typeof TurnOrder>>();
	/** The GM is setting up the grid of this battle map. */
	let setup = $state(false);
	/** The box the GM dragged over the squares of the map's picture, to line the grid up by. */
	let alignBox = $state.raw<Rect | null>(null);
	/** How many of those squares the box covers, from its left edge to its right. */
	let alignCount = $state(1);
	/** The GM is choosing which players see the selected region. */
	let sharingRegion = $state(false);
	/** The GM is saying how many miles across this world map is. */
	let scaling = $state(false);
	/** The finder is open. */
	let finding = $state(false);
	/** A marker the finder is taking this person to, on a map they are on their way to. */
	let wanted: string | null = null;
	/** The picture held up for the table that this person has closed, by its file. */
	let closedPicture = $state<string | null>(null);
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
	/** The GM has clicked the party's banner, which brings out the button that removes it. */
	let selectedParty = $state(false);
	/**
	 * The types of marker this person has filtered out of the world maps. It
	 * is their own view and nobody else's, and it is kept from map to map.
	 */
	let hiddenTypes = $state<MarkerType[]>([]);
	/** The pills that choose them are out, over the bar under the map. */
	let filterOpen = $state(false);
	// Raw, because a notice's step is looked up in the undo stack by identity,
	// and deep state would hand out a proxy of it instead.
	let notice = $state.raw<Notice | null>(null);

	/**
	 * A battle map is a table to play on: tokens, a ruler, a pen, and none of
	 * what a world map is built from. No markers, no notes, no regions
	 * further in.
	 */
	const battle = $derived(world.map.kind === 'battle');
	const tool = $derived(
		battle
			? // To the map, the pen is three tools: one that follows the pointer,
				// one that drags a shape out, and one that waits for a click to
				// start writing at.
				battleTool !== 'sketch'
				? battleTool
				: pen === 'line'
					? 'sketch'
					: pen === 'text'
						? 'text'
						: 'template'
			: placing
				? 'place'
				: drawing
					? 'draw'
					: measuring
						? 'measure'
						: 'pan'
	);
	/** The GM has one of the two fog tools in hand. */
	const fogging = $derived(battleTool === 'reveal' || battleTool === 'cover');
	/** The grid that the box dragged over the map's squares makes, to try on before keeping it. */
	const alignGrid = $derived(
		battleTool === 'align' && alignBox
			? gridFromBox(world.map, alignBox, Math.max(1, Math.round(alignCount || 1)), {
					min: LIMITS.gridMin,
					max: LIMITS.gridMax
				})
			: null
	);

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
		const folded = { dock: dockFolded, tools: toolsFolded, turns: turnsFolded };
		untrack(() => {
			try {
				if (recalled) {
					localStorage.setItem('odyssey:dock', folded.dock ? '1' : '0');
					localStorage.setItem('odyssey:tools', folded.tools ? '1' : '0');
					localStorage.setItem('odyssey:turns', folded.turns ? '1' : '0');
				} else {
					dockFolded = localStorage.getItem('odyssey:dock') === '1';
					toolsFolded = localStorage.getItem('odyssey:tools') === '1';
					turnsFolded = localStorage.getItem('odyssey:turns') === '1';
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
			!world.backdrop &&
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
			measuring = false;
			battleTool = 'pan';
			form = null;
			tokenForm = null;
			filterOpen = false;
			setup = false;
			alignBox = null;
			sharingRegion = false;
			scaling = false;
			finding = false;
			gallery = null;
			prompt = null;
			deleting = null;
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedIds = [];
			selectedParty = false;
			// Undo is for the map in front of you, not one you have left.
			undos.clear();
			// The finder may have brought this person here for one marker.
			const marker = wanted;
			wanted = null;
			if (marker) pinMarker(marker);
		});
	});

	// A picture that was closed stays closed until another is held up.
	$effect(() => {
		if (!live.shown) closedPicture = null;
	});

	/** The border and background of a notice of each type. */
	const NOTICE_COLORS: Record<NoticeType, string> = {
		success: 'border-[#3f7d58] bg-[#1e3329]',
		failure: 'border-[#9a4a44] bg-[#3b2224]',
		info: 'border-[#4a5670] bg-[#2a3142]',
		warning: 'border-[#96721f] bg-[#3a3018]'
	};

	function say(text: string, type: NoticeType, undo?: Step | null) {
		const id = Date.now();
		notice = { id, type, text, undo };
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
			say((err as Error).message, 'failure');
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
			if (!(await undos.undo(step))) say('Nothing to undo.', 'info');
		} catch (err) {
			say((err as Error).message, 'failure');
		}
	}

	async function redo() {
		try {
			if (!(await undos.redo())) say('Nothing to redo.', 'info');
		} catch (err) {
			say((err as Error).message, 'failure');
		}
	}

	// ------------------------------------------------------------- markers

	function startPlacing(next: Placing) {
		drawing = false;
		measuring = false;
		selectedMarkerId = null;
		selectedRegionId = null;
		placing = next;
	}

	function placed(x: number, y: number) {
		const target = placing;
		placing = null;
		if (!target) return;
		if ('party' in target) run({ t: 'party.move', mapId: world.map.id, x, y });
		else if ('move' in target) run({ t: 'marker.update', id: target.move.id, changes: { x, y } });
		else form = { mode: 'create', kind: target.create, x, y };
	}

	/** Takes the party's banner off the maps. Undo plants it back where it stood. */
	async function removeParty() {
		selectedParty = false;
		const { ok, step } = await attempt({ t: 'party.remove' });
		if (ok) say('Took the party off the map.', 'success', step);
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

	/** Pins the card of a marker of this map open, showing its type if that was filtered out. */
	function pinMarker(id: string) {
		const marker = world.markers.find((each) => each.id === id);
		if (!marker) return;
		hiddenTypes = hiddenTypes.filter((type) => type !== marker.type);
		selectedRegionId = null;
		selectedMarkerId = id;
	}

	/** The finder found what was looked for: off to its map, and to the marker if it is one. */
	async function go(entry: FindEntry) {
		finding = false;
		const marker = entry.kind === 'marker' ? entry.id : null;
		if (entry.mapId === world.map.id) {
			if (marker) pinMarker(marker);
			return;
		}
		wanted = marker;
		try {
			await goto(mapUrl(entry.mapId));
		} catch {
			wanted = null;
		}
	}

	// ------------------------------------------------- the scale and the ruler

	/** Takes the ruler out on a world map. One with no scale has nothing to tell: the GM is asked for it. */
	function startMeasuring() {
		if (miles === null) {
			if (isGm) scaling = true;
			return;
		}
		placing = null;
		drawing = false;
		selectedMarkerId = null;
		selectedRegionId = null;
		measuring = true;
	}

	// ------------------------------------------------ a picture for the table

	/**
	 * Holds a picture of the gallery up, or with null puts it away: for the
	 * players in `to`, or with none, for the whole table.
	 */
	async function showPicture(item: GalleryItem | null, to: string[] = []) {
		try {
			await live.show(item?.id ?? null, to);
			if (!item) return;
			const names = players.filter((player) => to.includes(player.id)).map((player) => player.name);
			say(
				names.length
					? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} looking at “${item.name}”.`
					: `The table is looking at “${item.name}”.`,
				'success'
			);
		} catch (err) {
			say((err as Error).message, 'failure');
		}
	}

	async function deleteMarker(marker: Marker) {
		selectedMarkerId = null;
		const { ok, step } = await attempt({ t: 'marker.delete', id: marker.id });
		if (ok) say(`Deleted “${marker.title}”.`, 'success', step);
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
		if (ok && note) say(note, 'success', step);
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
		// A picture may say what its tokens start out as: how big, and ringed in what.
		const size = item?.tokenSize ?? 1;
		const [x, y] = snapToGrid(
			world.map,
			dropped || freeCell(world.map, canvas.middle(), here),
			size
		);
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
			outline: item?.tokenOutline ?? null,
			size,
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

	/** The GM changed who takes turns, in what order, or whose turn it is. */
	function setTurns(turns: Partial<Turns>) {
		return run({ t: 'map.update', id: world.map.id, turns });
	}

	/**
	 * Ends the turn it is and moves on to the next: anyone's to do, for a
	 * token they can see. Whose turn is being ended goes along, so that two
	 * people pressing at once don't skip one.
	 */
	function passTurn() {
		return run({ t: 'turn.next', mapId: world.map.id, from: world.map.turns.current });
	}

	// ------------------------------------------------------------- the grid

	/** The GM would sooner drag the grid onto the map than type it in. */
	function startAligning() {
		setup = false;
		alignBox = null;
		alignCount = 1;
		take('align');
	}

	/** Keeps the grid that was tried on. Undo puts the old one back. */
	async function keepAlignment() {
		const grid = alignGrid;
		if (!grid) return;
		const { ok, step } = await attempt({ t: 'map.update', id: world.map.id, grid });
		if (!ok) return;
		putAway();
		say('The grid is lined up.', 'success', step);
	}

	/** Takes a tool of the battle map in hand. */
	function take(next: BattleTool) {
		battleTool = next;
		if (next !== 'align') alignBox = null;
		// A box to select with keeps what is selected: Shift adds to it.
		if (next !== 'pan' && next !== 'select') selectedIds = [];
	}

	/** A click on a tool picks it up, or with that one in hand, puts it down again. */
	function pick(next: BattleTool) {
		take(battleTool === next ? 'pan' : next);
	}

	// ----------------------------------------------------------------- fog

	/**
	 * The fog button takes up whichever of its two tools has something to
	 * do: clearing where there is fog, covering where there is none yet.
	 */
	function pickFog() {
		take(fogging ? 'pan' : world.map.fog.on ? 'reveal' : 'cover');
	}

	/**
	 * Covers a world map with fog that lifts wherever the party goes, or
	 * takes that fog off again. Each map has its own.
	 */
	async function fogWorld() {
		const on = !world.map.fog.on;
		const { ok, step } = await attempt({
			t: 'map.update',
			id: world.map.id,
			fog: { on, clear: [], spots: [] }
		});
		if (!ok) return;
		say(
			on
				? 'This map is under fog. It lifts wherever the party goes.'
				: 'Lifted the fog from this map.',
			'success',
			step
		);
	}

	/** Covers the whole map with fog, or where there is some, lifts all of it. */
	async function fogAll() {
		const on = !world.map.fog.on;
		if (await run({ t: 'map.update', id: world.map.id, fog: { on, clear: [] } })) {
			// What is left to do: clear some of the new fog, or with none, cover some.
			battleTool = on ? 'reveal' : 'cover';
		}
	}

	// -------------------------------------------------------------- gather

	/** Brings everyone else, and every table display, to what the GM has on screen. */
	async function gather() {
		if (!canvas) return;
		try {
			const players = await live.gather(world.map.id, canvas.sight());
			if (players) say('Everyone is brought here.', 'success');
			else {
				say(
					"The table can't come in here while a region on the way is hidden or closed. Your other screens follow, and any player who is let in.",
					'warning'
				);
			}
		} catch (err) {
			say((err as Error).message, 'failure');
		}
	}

	/**
	 * The GM has brought everyone somewhere: this window goes there, and looks
	 * at the same part. `late` says the call was made before this window
	 * connected. The map may have been closed to players since, so the way
	 * there is tried first, and a call that leads nowhere is left alone.
	 */
	async function follow(call: Gather, late: boolean) {
		if (call.mapId !== world.map.id) {
			try {
				if (late) {
					const there = await preloadData(mapUrl(call.mapId));
					if (there.type !== 'loaded' || there.status !== 200) return;
				}
				await goto(mapUrl(call.mapId));
			} catch {
				return;
			}
			await tick();
		}
		if (world.map.id !== call.mapId) return;
		canvas?.lookAt(call.view);
		say(`${call.by} brought everyone here.`, 'info');
	}

	$effect(() => live.onGather(follow));

	// A display is left alone for hours: the screen is asked to stay awake.
	// Browsers allow that on https and on this machine itself, and it is no
	// loss where they don't.
	$effect(() => {
		if (!display || !('wakeLock' in navigator)) return;
		let lock: WakeLockSentinel | null = null;
		let over = false;
		const keep = async () => {
			if (over || document.visibilityState !== 'visible') return;
			try {
				lock = await navigator.wakeLock.request('screen');
				if (over) lock.release();
			} catch {
				// Refused: the screen sleeps when the system says so.
			}
		};
		keep();
		// The lock is let go whenever the window is hidden, and asked for again.
		document.addEventListener('visibilitychange', keep);
		return () => {
			over = true;
			document.removeEventListener('visibilitychange', keep);
			lock?.release();
		};
	});

	/** Each with the key that takes it in hand: the top row of the keyboard, left to right. */
	const BATTLE_TOOLS: { tool: BattleTool; icon: ToolIcon; label: string; key: string }[] = [
		{ tool: 'pan', icon: 'pointer', label: 'Select and move', key: 'q' },
		{ tool: 'select', icon: 'marquee', label: 'Select multiple', key: 'w' },
		{ tool: 'measure', icon: 'ruler', label: 'Measure a distance', key: 'e' },
		{ tool: 'sketch', icon: 'draw', label: 'Draw', key: 'r' }
	];

	/**
	 * What the pen draws: a line, one of the shapes, for the area of a spell,
	 * a breath, a wall, or a line of text.
	 */
	const PENS: { pen: Pen; icon: ToolIcon; label: string; hint: string }[] = [
		{ pen: 'line', icon: 'draw', label: 'Draw a line', hint: 'Freehand' },
		{ pen: 'circle', icon: 'circle', label: 'Draw a circle', hint: 'A burst around a spot' },
		{ pen: 'cone', icon: 'cone', label: 'Draw a cone', hint: 'As wide at its end as it is long' },
		{ pen: 'rect', icon: 'box', label: 'Draw a box', hint: 'A square or a wall' },
		{ pen: 'text', icon: 'text', label: 'Draw text', hint: 'Click the map and type' }
	];

	// ------------------------------------------------------ maps & regions

	async function enter(region: Region) {
		// A closed region is there to be seen, and wondered about.
		if (region.closed && !isGm) {
			say(`“${region.name}” is not open to you yet.`, 'info');
			return;
		}
		await canvas?.flyTo(region);
		try {
			await goto(mapUrl(region.targetMapId));
		} catch {
			canvas?.reset();
		}
	}

	function saveName(name: string, hidden: boolean, kind: MapKind, closed: boolean) {
		if (!prompt) return Promise.resolve(false);
		if (prompt.kind === 'rename') return run({ t: 'map.update', id: prompt.mapId, name });
		return run({
			t: 'region.create',
			mapId: world.map.id,
			name,
			points: prompt.points,
			hidden,
			closed,
			kind
		});
	}

	/**
	 * A region has gone from some map: deleted, or to a player, hidden,
	 * closed, or under fog that has come down on the map it is drawn on.
	 * Whoever is standing in the map it led to, or deeper, is walked back out
	 * to the map the region was on. The GM is only ever told of a deletion,
	 * and then the map they are in no longer exists. `way` is the maps on the
	 * way here, as they were before this news.
	 */
	function leaveIfShut(patch: Patch, way: string[]) {
		let outside: string | null = null;
		if (patch.t === 'region.remove' && way.includes(patch.targetMapId)) outside = patch.mapId;
		if (!isGm && patch.t === 'region.upsert' && patch.region.closed) {
			if (way.includes(patch.region.targetMapId)) outside = patch.region.mapId;
		}
		// Fog that moved comes with the regions a player can still see there.
		if (!isGm && patch.t === 'map.upsert' && patch.regions) {
			const next = way[way.indexOf(patch.map.id) + 1];
			const open = patch.regions.some((region) => region.targetMapId === next && !region.closed);
			if (way.includes(patch.map.id) && next && !open) outside = patch.map.id;
		}
		if (outside) goto(mapUrl(outside));
	}

	/**
	 * A world map with no image of its own shows part of one from further
	 * out: see src/lib/shared/backdrop.ts. Which part hangs on the regions on
	 * the way here and on the images of the maps they are drawn on, and only
	 * the server works that out. So when one of those changes, it is asked
	 * for the map again.
	 */
	function refreshIfBorrowed(patch: Patch) {
		if (world.map.kind !== 'world') return;
		const onTheWay = (mapId: string) => world.trail.some((crumb) => crumb.id === mapId);
		const reshaped = patch.t === 'region.upsert' && onTheWay(patch.region.targetMapId);
		const repainted =
			patch.t === 'map.upsert' && patch.map.id !== world.map.id && onTheWay(patch.map.id);
		if (reshaped || repainted) refreshAll();
	}

	/** Runs once the GM has confirmed. There is no undo for this one. */
	async function deleteRegion(region: Region) {
		deleting = null;
		selectedRegionId = null;
		if (await run({ t: 'region.delete', id: region.id })) {
			say(`Deleted “${region.name}” and everything inside it.`, 'success');
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
			say('Invite link copied to the clipboard.', 'success');
		} catch {
			// The popup stays open, so the link can be copied by hand.
			say('Copy the link from the box.', 'warning');
		}
	}

	function onkeydown(e: KeyboardEvent) {
		// A display has nothing to undo and no tools to take up. It has one
		// key: Backspace steps back out of the map it is on, to the one the
		// region that led here is drawn on.
		if (display) {
			const outside = world.trail.at(-2);
			if (e.key === 'Backspace' && outside) {
				e.preventDefault();
				if (!e.repeat) goto(mapUrl(outside.id));
			}
			return;
		}
		if (form || tokenForm || setup || scaling || finding || gallery || prompt || deleting) return;
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

		// Ctrl+K opens the finder, from anywhere on the page.
		if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			finding = true;
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
			// And N moves the fight on to the next turn, for whoever may end this one.
			if (e.key.toLowerCase() === 'n' && world.map.turns.order.length) {
				e.preventDefault();
				if (!e.repeat) turnOrder?.next();
				return;
			}
		}

		if (e.key !== 'Escape') return;
		if (placing || drawing || measuring || battleTool !== 'pan') {
			putAway();
		} else if (filterOpen || sharingRegion) {
			filterOpen = false;
			sharingRegion = false;
		} else {
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedIds = [];
			selectedParty = false;
		}
	}

	/** Back to the hand: whichever tool was waiting for the map is put away. */
	function putAway() {
		placing = null;
		drawing = false;
		measuring = false;
		battleTool = 'pan';
		alignBox = null;
	}

	// The choosing of who sees a region is for the region it was started on.
	$effect(() => {
		void selectedRegionId;
		sharingRegion = false;
	});

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
	<!-- A table display is the map and nothing around it. -->
	<header
		hidden={display}
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
					<a class={crumbLink} href={mapUrl(crumb.id)}>{crumb.name}</a>
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
						{#if isGm || !region.closed}
							<option value={region.id}>
								{region.name}{region.hidden ? (isGm ? ' (hidden)' : ' (a secret)') : ''}{region.closed
									? ' (closed)'
									: ''}
							</option>
						{/if}
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

			<!-- Nothing of the finder is on screen but this, until it is asked for. -->
			<ToolButton
				small
				tip="bottom"
				icon="search"
				label="Find a place or a marker"
				hint="Ctrl+K"
				onclick={() => (finding = true)}
			/>

			{#if isGm}
				{#if live.shown}
					<!-- A picture is up for the whole table. This is how it comes down. -->
					<button
						class="btn btn-sm btn-active max-w-56"
						title="{live.shown.to?.length
							? 'Some of the players are'
							: 'The table is'} looking at this picture. Click to put it away."
						onclick={() => showPicture(null)}
					>
						<span class="truncate">
							Showing “{live.shown.name}”{live.shown.to?.length
								? ` to ${live.shown.to.length} ${live.shown.to.length > 1 ? 'players' : 'player'}`
								: ''}
						</span>
						<span aria-hidden="true">×</span>
					</button>
				{/if}
				<!-- The players' view of this map in a window of its own, to put on a
				     screen the table can see. It opens in the one window however
				     often it is asked for. -->
				<a
					class="btn btn-sm no-underline"
					href="{mapUrl(world.map.id)}?display"
					target="odyssey-display"
					title="Opens what the players see in a window of its own, for a TV or a second screen"
					>Display</a
				>
				<!-- The campaign's pictures, to stock ahead of the maps and tokens that will use them. -->
				<button
					class="btn btn-sm"
					onclick={() => {
						gallery = 'browse';
					}}>Gallery</button
				>
				<button
					class="btn btn-sm"
					onclick={() => {
						copyInvite();
					}}>Invite</button
				>
			{/if}
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		<main class="relative min-w-0 flex-1">
			<MapCanvas
				bind:this={canvas}
				map={world.map}
				backdrop={world.backdrop}
				regions={world.regions}
				markers={shownMarkers}
				tokens={world.tokens}
				drawings={world.drawings}
				party={world.party}
				{miles}
				{hands}
				{pings}
				role={data.role}
				userId={data.me.id}
				{players}
				gridPreview={alignGrid}
				aligned={alignBox}
				passive={display}
				{tool}
				{ink}
				shape={pen === 'line' || pen === 'text' ? 'circle' : pen}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				bind:selectedIds
				bind:selectedParty
				{send}
				ondone={() => {
					// A shape that was drawn, a text that was written: back to the
					// hand, to move it or get on with the fight. The pen stays in
					// hand after a line, which is seldom the only one. Either way
					// it remembers what it last drew for the next time it is taken up.
					battleTool = 'pan';
				}}
				onplace={placed}
				onnote={(x, y) => {
					if (!display) form = { mode: 'create', kind: 'player', x, y };
				}}
				ondrawn={(points) => {
					drawing = false;
					prompt = { kind: 'region', points };
				}}
				onenter={enter}
				onreshape={(region, points) => run({ t: 'region.update', id: region.id, points })}
				onparty={(x, y) => run({ t: 'party.move', mapId: world.map.id, x, y, along: true })}
				onpartyremove={removeParty}
				onedit={(marker) => (form = { mode: 'edit', marker })}
				onmove={(marker) => startPlacing({ move: marker })}
				ondelete={deleteMarker}
				onhide={(marker, hidden) => run({ t: 'marker.update', id: marker.id, changes: { hidden } })}
				onshare={(marker, seenBy) =>
					run({ t: 'marker.update', id: marker.id, changes: { hidden: true, seenBy } })}
				onalign={(box) => (alignBox = box)}
				onedittoken={(token) => (tokenForm = token)}
				onhand={(at) => {
					// A display is nobody at the table: it holds nothing.
					if (!display) live.hold(at && { mapId: world.map.id, ...at });
				}}
				onping={(x, y) => live.ping({ mapId: world.map.id, x, y })}
			/>

			{#if display}
				<!-- Where the table is, lettered on the corner of the screen like a
				     place name: no bar, no box. The maps on the way here are lettered
				     before it, fainter, and each is the way back out to itself. Only
				     the names take the pointer, so the map under the rest of the line
				     still does. -->
				<nav
					class="pointer-events-none absolute top-4 left-5 flex max-w-[calc(100%-40px)] items-baseline gap-2 overflow-hidden font-serif text-xl font-semibold tracking-[0.02em] whitespace-nowrap text-[#fff8e4] text-shadow-map"
					aria-label="Breadcrumb"
				>
					{#each world.trail as crumb, i (crumb.id)}
						{#if i < world.trail.length - 1}
							<a
								class="pointer-events-auto shrink-0 text-[#fff8e4] no-underline opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100 touch:py-2"
								href={mapUrl(crumb.id)}
								title="Back out to {crumb.name}">{crumb.name}</a
							>
							<span class="opacity-45" aria-hidden="true">›</span>
						{:else}
							<span class="truncate opacity-70" aria-current="page">{crumb.name}</span>
						{/if}
					{/each}
				</nav>
			{/if}

			{#if battle}
				<!-- Whose turn it is, down the left side of a battle map. It is there
				     once a token has been put in the order, for everyone, and on a
				     table display under the name of the map. A narrow screen keeps
				     its Fit button in that corner, so there it starts lower. -->
				<div class={['absolute left-3.5 z-1', display ? 'top-14' : 'top-3.5 max-[720px]:top-16']}>
					<TurnOrder
						bind:this={turnOrder}
						{campaignId}
						tokens={world.tokens}
						turns={world.map.turns}
						gm={isGm}
						passive={display}
						bind:collapsed={turnsFolded}
						selectedId={selectedIds.length === 1 ? selectedIds[0] : null}
						onpick={(id) => {
							battleTool = 'pan';
							selectedIds = [id];
						}}
						onchange={setTurns}
						onnext={passTurn}
					/>
				</div>
			{/if}

			{#if empty && isGm && tool === 'pan'}
				<p
					class="absolute top-4.5 left-1/2 w-max max-w-[calc(100%-28px)] -translate-x-1/2 rounded-full border bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl"
				>
					{battle
						? 'This battle map is empty. Choose a map image in the corner, and add tokens from below.'
						: 'This map is empty. Add a map image, markers and regions from the bar below.'}
				</p>
			{/if}

			{#if battle && !display}
				<!-- The tools of a battle map, docked in the upper right corner: what is
				     in hand, and for the GM, what the map itself is. Folded away it is
				     one button, which still shows the tool in hand. -->
				{@const inHand = fogging
					? { icon: 'fog' as const, label: 'Fog of war' }
					: (BATTLE_TOOLS.find((each) => each.tool === battleTool) ?? BATTLE_TOOLS[0])}
				<div class="absolute top-3.5 right-3.5 z-1 flex items-start gap-1.5">
					{#if !toolsFolded && isGm && fogging}
						<!-- The fog's own tools, out while the GM is at it: clear some of
						     it, cover some again, or do the whole map at once. -->
						<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Fog of war">
							<ToolButton
								tip="left"
								icon="reveal"
								label="Clear the fog from an area"
								hint={world.map.fog.on ? undefined : 'There is no fog on this map yet'}
								disabled={!world.map.fog.on}
								active={battleTool === 'reveal'}
								onclick={() => take('reveal')}
							/>
							<ToolButton
								tip="left"
								icon="hide"
								label="Cover an area with fog"
								active={battleTool === 'cover'}
								onclick={() => take('cover')}
							/>
							<span class="h-px bg-line"></span>
							<ToolButton
								tip="left"
								icon="fog"
								label={world.map.fog.on ? 'Lift all the fog' : 'Cover the whole map'}
								hint={world.map.fog.on ? 'Ctrl+Z brings it back' : undefined}
								onclick={fogAll}
							/>
						</div>
					{/if}
					{#if !toolsFolded && battleTool === 'sketch'}
						<!-- What the pen draws, out while it is in hand: a line, a shape, or text. -->
						<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="What to draw">
							{#each PENS as each (each.pen)}
								<ToolButton
									tip="left"
									icon={each.icon}
									label={each.label}
									hint={each.hint}
									active={pen === each.pen}
									onclick={() => (pen = each.pen)}
								/>
							{/each}
						</div>
					{/if}
					{#if !toolsFolded && battleTool === 'sketch'}
						<!-- The inks, out with the pen. -->
						<div
							class="grid gap-1.5 p-1.5 {floating}"
							role="radiogroup"
							aria-label={pen === 'text' ? 'Colour of the text' : 'Colour of the pen'}
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
									active={battleTool === 'align'}
									onclick={() => (setup = true)}
								/>
								<ToolButton
									tip="left"
									icon="fog"
									label="Fog of war"
									hint={world.map.fog.on ? 'On: players see only what you clear' : 'Off'}
									active={fogging}
									expanded={fogging}
									onclick={pickFog}
								/>
								<span class="h-px bg-line"></span>
								<ToolButton
									tip="left"
									icon="gather"
									label="Bring everyone here"
									hint="Shows the table what you see"
									onclick={gather}
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
				class={[
					'pointer-events-none absolute inset-x-0 bottom-3.5 z-1 flex flex-col items-center gap-3',
					// A table display has no tools, and nobody to read a notice.
					display && 'hidden'
				]}
			>
				{#if notice}
					<div
						class={[
							'pointer-events-auto flex max-w-[calc(100%-28px)] items-center gap-2 rounded-[10px] border py-2 pr-2 pl-3.5 text-sm shadow-pop',
							NOTICE_COLORS[notice.type]
						]}
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

				{#if battle && battleTool === 'align'}
					<!-- The grid is being lined up: once a box has been dragged over the
					     squares of the map's picture, how many of them it covers, and
					     the grid that makes, which is on the map to be looked at. -->
					{#if alignGrid}
						<div
							class="pointer-events-auto flex max-w-[calc(100%-24px)] flex-wrap items-center justify-center gap-2 p-2 {floating}"
							role="group"
							aria-label="Line up the grid"
						>
							<label class="flex items-center gap-2 text-sm">
								Squares across the box
								<input
									class="input min-h-8 w-16 py-0 text-center tabular-nums"
									type="number"
									min="1"
									max="500"
									step="1"
									bind:value={alignCount}
								/>
							</label>
							<span class="text-xs text-muted tabular-nums">
								One cell is {alignGrid.size} pixels
							</span>
							<button class="btn btn-sm btn-primary" onclick={keepAlignment}>Use this grid</button>
							<button class="btn btn-sm btn-ghost" onclick={putAway}>Cancel</button>
						</div>
					{/if}
				{:else if battle}
					<!-- A battle map is played on: under it is the dock of tokens to put
					     on it, for everyone at the table. Its tools are in the corner. -->
					<TokenDock
						{campaignId}
						gm={isGm}
						color={tokenColor}
						stamp={galleryStamp}
						bind:collapsed={dockFolded}
						onadd={addToken}
						onerror={(text) => say(text, 'failure')}
					/>
				{:else}
				{#if sharingRegion && selectedRegion && tool === 'pan'}
					<!-- Who a hidden region is there for all the same: they see it, and
					     can step inside. Choosing someone hides it from the rest. -->
					<div
						class="pointer-events-auto grid w-[min(440px,calc(100%-24px))] gap-2 p-2.5 {floating}"
						role="group"
						aria-label="Players who see {selectedRegion.name}"
					>
						<span class="text-xs text-muted">
							Only these players see “{selectedRegion.name}”, and can step inside:
						</span>
						<PlayerPicker
							{players}
							value={selectedRegion.seenBy}
							label="Players who see {selectedRegion.name}"
							onchange={(seenBy) =>
								selectedRegion &&
								run({ t: 'region.update', id: selectedRegion.id, hidden: true, seenBy })}
						/>
					</div>
				{/if}
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
						<button class="btn" onclick={putAway}>{measuring ? 'Put the ruler away' : 'Cancel'}</button>
						{#if measuring && isGm}
							<!-- What the ruler goes by, and the way to change it. -->
							<button class="btn" onclick={() => (scaling = true)}>
								Scale: {miles === null ? 'none' : `${milesCount(miles)} across`}
							</button>
						{/if}
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
							<!-- A ruler needs a scale to go by. Where no map on the way here
							     has one, the GM is asked for it, and players have no ruler. -->
							{#if isGm || miles !== null}
								<ToolButton
									icon="ruler"
									label="Measure a distance"
									hint={miles === null
										? 'Asks how far across this map is first'
										: `This map is about ${milesCount(miles)} across`}
									onclick={startMeasuring}
								/>
							{/if}
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
								<span class="w-px self-stretch bg-line"></span>
								<!-- Where the story has taken everyone: click, then click the
								     spot. Once it stands on this map it can be dragged as well,
								     and clicked, for the button that takes it off again. -->
								<ToolButton
									icon="party"
									label={world.party?.mapId === world.map.id
										? 'Move the party'
										: 'Put the party on this map'}
									hint="Shows the table where it is"
									onclick={() => startPlacing({ party: true })}
								/>
								<!-- Each world map has its own: under it, players see only
								     where the party has been. -->
								<ToolButton
									icon="fog"
									label={world.map.fog.on ? 'Lift the fog from this map' : 'Cover this map with fog'}
									hint={world.map.fog.on
										? 'On: players see only where the party has been'
										: 'It lifts wherever the party goes'}
									active={world.map.fog.on}
									onclick={fogWorld}
								/>
								<ToolButton
									icon="gather"
									label="Bring everyone here"
									hint="Shows the table what you see"
									onclick={gather}
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
									icon={selectedRegion?.closed ? 'unlock' : 'lock'}
									label={selectedRegion?.closed
										? 'Open the region to players'
										: 'Close the region to players'}
									hint={regionHint ?? (selectedRegion?.closed
										? 'They can step inside again'
										: "They still see it, and can't step inside")}
									disabled={!selectedRegion}
									active={selectedRegion?.closed}
									onclick={() =>
										selectedRegion &&
										run({ t: 'region.update', id: selectedRegion.id, closed: !selectedRegion.closed })}
								/>
								<ToolButton
									icon={selectedRegion?.hidden ? 'reveal' : 'hide'}
									label={selectedRegion?.hidden
										? 'Reveal the region to all players'
										: 'Hide the region from players'}
									hint={regionHint}
									disabled={!selectedRegion}
									active={selectedRegion?.hidden}
									onclick={() =>
										selectedRegion &&
										run({ t: 'region.update', id: selectedRegion.id, hidden: !selectedRegion.hidden })}
								/>
								<ToolButton
									icon="people"
									label="Show the region to some players only"
									hint={regionHint ?? 'A secret between them and you'}
									disabled={!selectedRegion}
									active={!!selectedRegion?.seenBy.length}
									expanded={sharingRegion}
									onclick={() => {
										filterOpen = false;
										sharingRegion = !sharingRegion;
									}}
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
		onalign={startAligning}
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
		onshow={showPicture}
		shownFile={live.shown?.file ?? null}
		{players}
		onclose={() => {
			gallery = null;
			// What was added, revealed or taken out shows in the dock of tokens.
			galleryStamp++;
		}}
	/>
{/if}

{#if scaling && !battle}
	<ScalePrompt
		map={world.map}
		{miles}
		onsubmit={async (across) => {
			const saved = await run({ t: 'map.update', id: world.map.id, miles: across });
			// With no scale left to go by, the ruler goes back in the drawer.
			if (saved && across === null) measuring = false;
			return saved;
		}}
		onclose={() => (scaling = false)}
	/>
{/if}

{#if finding}
	<Finder {campaignId} here={world.map.id} onpick={go} onclose={() => (finding = false)} />
{/if}

{#if live.shown && !isGm && closedPicture !== live.shown.file}
	<!-- A picture the GM is holding up for the table: over everything, for as
	     long as it is up. Each person may close their own. A table display
	     has nobody to close it, and shows it until the GM puts it away. A
	     big map image is shown by its preview, which is plenty for a screen. -->
	{@const shown = live.shown}
	<div
		class="fixed inset-0 z-20 grid place-items-center bg-[rgb(6_8_12/0.9)] p-5"
		role="dialog"
		aria-label="A picture from the GM: {shown.name}"
	>
		{#if !display}
			<button
				class="absolute inset-0 cursor-zoom-out"
				aria-label="Close the picture"
				onclick={() => (closedPicture = shown.file)}
			></button>
		{/if}
		<figure class="pointer-events-none relative grid max-h-full justify-items-center gap-3">
			<img
				class="max-h-[calc(100dvh-110px)] max-w-full rounded-md object-contain shadow-pop"
				src={imageUrl(
					campaignId,
					shown.file,
					tileLevels(shown.width, shown.height) > 0 ? 'preview' : undefined
				)}
				alt={shown.name}
			/>
			<figcaption class="font-serif text-xl font-semibold text-[#fff8e4] text-shadow-map">
				{shown.name}
				{#if !display}
					<span class="ml-2 font-sans text-xs font-normal text-muted">Click anywhere to close</span>
				{/if}
			</figcaption>
		</figure>
	</div>
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
