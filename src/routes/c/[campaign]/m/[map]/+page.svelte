<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { inviteAddress, rememberedHost } from '#lib/client/invite.ts';
	import {
		KEY,
		PEN_KEYS,
		ariaKey,
		chord,
		isTyping,
		keyLabel,
		usesEnter
	} from '#lib/client/keys.ts';
	import { untrack } from 'svelte';
	import { DISPLAY_GLINT, Discoveries } from '#lib/client/discoveries.svelte.ts';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import { UndoStack, type Step } from '#lib/client/undo.ts';
	import Finder from '#lib/components/Finder.svelte';
	import Gallery from '#lib/components/Gallery.svelte';
	import InviteDialog from '#lib/components/InviteDialog.svelte';
	import KeySheet from '#lib/components/KeySheet.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MapSettings from '#lib/components/MapSettings.svelte';
	import MapSetup from '#lib/components/MapSetup.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import MarkerForm from '#lib/components/MarkerForm.svelte';
	import MarkerGlyph from '#lib/components/MarkerGlyph.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import QrCode from '#lib/components/QrCode.svelte';
	import TokenDock from '#lib/components/TokenDock.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import ToolButton, { type ToolIcon } from '#lib/components/ToolButton.svelte';
	import TableDock from '#lib/components/TableDock.svelte';
	import VisibilityDialog from '#lib/components/VisibilityDialog.svelte';
	import { freeCell, gridFromBox, milesCount, snapToGrid } from '#lib/shared/grid.ts';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import { tileLevels } from '#lib/shared/tiles.ts';
	import {
		INK_COLORS,
		FOG_BRUSH,
		LIMITS,
		MARKER_TYPES,
		TOKEN_COLORS,
		imageUrl,
		type Command,
		type Encounter,
		type FindEntry,
		type GalleryItem,
		type Knock,
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
	import { brushSize } from '#lib/shared/fog.ts';
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
			const pace = world.map.dayMiles;
			// Read before the event is applied: it may be what takes the way here off the map.
			const way = world.trail.map((crumb) => crumb.id);
			world.apply(event);
			leaveIfShut(event.patch, way);
			refreshIfBorrowed(event.patch);
			// With a scale of its own given or taken away, how far across this
			// map is has to be worked out again, which only the server does.
			// The same goes for how far a day's travel goes on it.
			if (world.map.miles !== scale || world.map.dayMiles !== pace) refreshAll();
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
	 * changes nothing.
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
	/** How many miles a day's travel covers here: this map's own pace, or the one it goes by. */
	const dayMiles = $derived(world.map.dayMiles ?? world.dayMiles);
	/**
	 * The date it is in the world, in the GM's own words: what the server
	 * last said, or until it has, what this page was loaded with.
	 */
	const date = $derived(live.date ?? data.campaign.date);

	// ------------------------------------------------------------ discoveries

	/**
	 * What on this map could be new to a player: the world markers the GM has
	 * let them see, and the regions. Their own table's notes are no news to
	 * the table, and nothing is news to the GM.
	 */
	const discoverable = $derived(
		isGm
			? []
			: [
					...world.markers.filter((marker) => marker.kind === 'world').map((marker) => marker.id),
					...world.regions.map((region) => region.id)
				]
	);
	/** Which of those this person has yet to look at: they glint on the map until they have. */
	let discoveries = $state.raw<Discoveries | null>(null);
	// What was seen of a map is this browser's to remember, so it is read
	// once the page is in it, and again for every map stepped into.
	$effect(() => {
		const mapId = world.map.id;
		untrack(() => {
			discoveries = isGm
				? null
				: new Discoveries(campaignId, display ? 'display' : data.me.id, mapId, discoverable);
		});
	});
	$effect(() => {
		const ids = discoverable;
		const mapId = world.map.id;
		untrack(() => discoveries?.update(mapId, ids));
	});
	// A table display has nobody in front of it to look: what is new there
	// glints for a while, and then has been seen.
	$effect(() => {
		const found = discoveries;
		if (!display || !found || found.fresh.length === 0) return;
		const ids = found.fresh;
		const timer = setTimeout(() => ids.forEach((id) => found.seen(id)), DISPLAY_GLINT);
		return () => clearTimeout(timer);
	});

	// ---------------------------------------------------------- whose token

	/** The tokens on this map that are this person's own. */
	const myTokens = $derived(
		display ? [] : world.tokens.filter((token) => token.ownerId === data.me.id)
	);
	/** The one of them whose turn it is, if it is the turn of one. */
	const myTurn = $derived(
		myTokens.find((token) => token.id === world.map.turns.current) ?? null
	);
	/** The turn this person was last told is theirs, so that each is told once. */
	let toldTurn: string | null = null;
	// Their own token's turn has come: their screen says so, and a phone
	// in a pocket or face down on the table shakes.
	$effect(() => {
		const token = myTurn;
		const turn = token ? `${token.mapId}:${token.id}:${world.map.turns.round}` : null;
		untrack(() => {
			if (token && turn !== toldTurn) {
				say(`It is your turn: ${token.name}.`, 'warning');
				try {
					navigator.vibrate?.([120, 80, 120]);
				} catch {
					// Not every browser lets a page shake the phone.
				}
			}
			toldTurn = turn;
		});
	});

	/** Which of this person's tokens the map went to last, when they have several. */
	let lastMine = -1;
	/**
	 * Brings this person's own token to the middle of the screen, selected:
	 * the one whose turn it is, or with several and none of them acting, each
	 * in turn.
	 */
	function goToMine() {
		if (myTokens.length === 0) return;
		lastMine = (lastMine + 1) % myTokens.length;
		const token = myTurn ?? myTokens[lastMine];
		battleTool = 'pan';
		selectedIds = [token.id];
		canvas?.centreOn([token.x, token.y]);
	}

	/** The address of a map of this campaign. A display stays a display from map to map. */
	const mapUrl = (mapId: string) => `/c/${campaignId}/m/${mapId}${display ? '?display' : ''}`;

	type Placing = { create: MarkerKind } | { move: Marker };
	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
	/**
	 * What is in hand on a battle map. `pan` is the hand itself: it selects
	 * and moves things. The others are picked from the palette in the corner.
	 * `sketch` is the pen, which draws a line freehand or one of the shapes:
	 * see `pen`. `reveal` and `cover` are the GM's two ways with the fog
	 * of war, and `align` is theirs too: it lines the grid up with the squares
	 * of the map's own picture. With `point` in hand, the table is shown
	 * where the pointer is for as long as its button is held down.
	 */
	type BattleTool =
		| 'pan'
		| 'select'
		| 'measure'
		| 'sketch'
		| 'point'
		| 'reveal'
		| 'cover'
		| 'align';
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
	/** The pointing tool is in hand on a world map: held down, the pointer shows to the table. */
	let pointing = $state(false);
	/** The box that selects several markers together is in hand on a world map. */
	let boxing = $state(false);
	/**
	 * The GM is at the fog of a world map by hand: clearing some of it, or
	 * covering the map again.
	 */
	let fogTool = $state<'reveal' | 'cover' | null>(null);
	/**
	 * What the fog is cleared and covered with, on either kind of map: a
	 * brush swept over it, round or square. The GM's choice stays from map
	 * to map, and so does the size of the brush: its radius, or half the
	 * side of a square one, as a part of the map's longer side.
	 */
	let fogShape = $state<'round' | 'square'>('round');
	let fogSize = $state(FOG_BRUSH.start);
	let battleTool = $state<BattleTool>('pan');
	/** The colour the pen draws in, text is written in and templates are laid down in. */
	let ink = $state<string>(INK_COLORS[0]);
	/** Which template the template tool lays down. */
	let pen = $state<Pen>('line');
	let form = $state<Form | null>(null);
	/** The token whose picture, colour and outline are being changed. */
	let tokenForm = $state<Token | null>(null);
	/** What the GM is saying who sees: tokens, world markers or a region, by id. */
	let visibilityOf = $state<{ kind: 'token' | 'marker' | 'region'; ids: string[] } | null>(null);
	/** Those as they are now, the ones still on the map, each with the name it goes by. */
	const visibilityThings = $derived.by(() => {
		const of = visibilityOf;
		if (!of) return [];
		const all =
			of.kind === 'token'
				? world.tokens
				: of.kind === 'marker'
					? world.markers.map((marker) => ({ ...marker, name: marker.title }))
					: world.regions;
		return all.filter((thing) => of.ids.includes(thing.id));
	});

	/** Shows them to the whole table, or hides them from all but these players. */
	function setVisibility(hidden: boolean, seenBy: string[]) {
		const kind = visibilityOf?.kind;
		const changes = hidden ? { hidden, seenBy } : { hidden };
		send(
			visibilityThings
				// Revealing what is not hidden changes nothing.
				.filter((thing) => hidden || thing.hidden)
				.map(({ id }): Command => {
					if (kind === 'token') return { t: 'token.update', id, changes };
					if (kind === 'marker') return { t: 'marker.update', id, changes };
					return { t: 'region.update', id, ...changes };
				})
		);
	}
	/** Goes up whenever the gallery may have changed, so the dock reads it again. */
	let galleryStamp = $state(0);
	// The palettes of a battle map fold away, and stay as they were left. The
	// dock starts out as its buttons alone: a tray opens when one is clicked.
	let dockFolded = $state(true);
	let toolsFolded = $state(false);
	let turnsFolded = $state(false);
	let turnOrder = $state<ReturnType<typeof TableDock>>();
	/** The GM is setting up the grid of this battle map. */
	let setup = $state(false);
	/** The box the GM dragged over the squares of the map's picture, to line the grid up by. */
	let alignBox = $state.raw<Rect | null>(null);
	/** How many of those squares the box covers, from its left edge to its right. */
	let alignCount = $state(1);
	/**
	 * The GM has the map's settings open: its name, its image and its scale.
	 * It says which of them the dialog opens on: the scale, when it is the
	 * ruler that asked for one.
	 */
	let settings = $state<'name' | 'scale' | null>(null);
	/** The finder is open. */
	let finding = $state(false);
	/** The GM has the invite out: a code to scan, and the link to copy. */
	let inviting = $state(false);
	/** The sheet of keyboard shortcuts is open. */
	let helping = $state(false);
	/** This person has asked for the way out of the campaign, and is being asked if they mean it. */
	let exiting = $state(false);
	/** A marker the finder is taking this person to, on a map they are on their way to. */
	let wanted: string | null = null;
	/**
	 * The GM is in the gallery, to look after the whole of it, and the shelf
	 * it opened on: the encounters, when it was opened from their tab of the
	 * dock. An image for this map is picked from the map's settings instead.
	 */
	let gallery = $state<false | 'map' | 'encounter'>(false);
	let prompt = $state<Prompt | null>(null);
	/** The region the GM has asked to delete, while they are being asked if they mean it. */
	let deleting = $state<Region | null>(null);
	let selectedMarkerId = $state<string | null>(null);
	let selectedRegionId = $state<string | null>(null);
	/** The tokens and drawings selected on a battle map. On a world map, the markers selected together. */
	let selectedIds = $state<string[]>([]);
	/**
	 * The types of marker this person has filtered out of the world maps. It
	 * is their own view and nobody else's, and it is kept from map to map.
	 */
	let hiddenTypes = $state<MarkerType[]>([]);
	/** The regions are switched off in the same filter, and as much this person's own view. */
	let regionsHidden = $state(false);
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
						: pointing
							? 'point'
							: boxing
								? 'select'
								: (fogTool ?? 'pan')
	);
	/** The GM has one of the two fog tools in hand on a battle map. */
	const fogging = $derived(battleTool === 'reveal' || battleTool === 'cover');
	/** Which of the two the GM has in hand, on either kind of map. */
	const fogHand = $derived(
		battle ? (battleTool === 'reveal' || battleTool === 'cover' ? battleTool : null) : fogTool
	);
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
	/**
	 * The regions of this map, or none while they are switched off: the map
	 * then neither draws them nor takes clicks for them. The way into each is
	 * still in the list by the map's name.
	 */
	const shownRegions = $derived(regionsHidden ? [] : world.regions);
	/** What the filter is keeping off the map, in a few words, or nothing when it is all there. */
	const filterHint = $derived(
		[
			hiddenTypes.length ? `${hiddenTypes.length} of ${MARKER_TYPES.length} types hidden` : '',
			regionsHidden ? 'regions hidden' : ''
		]
			.filter(Boolean)
			.join(', ')
			.replace(/^r/, 'R') || undefined
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
					dockFolded = localStorage.getItem('odyssey:dock') !== '0';
					toolsFolded = localStorage.getItem('odyssey:tools') === '1';
					turnsFolded = localStorage.getItem('odyssey:turns') === '1';
				}
			} catch {
				// A private window may refuse. The palettes then start as they do the first time.
			}
			recalled = true;
		});
	});
	/** The region the GM has clicked. The buttons that float over it act on it. */
	const selectedRegion = $derived(world.regions.find((r) => r.id === selectedRegionId) ?? null);
	/**
	 * A table display asked to show the invite, with `invite` in its address:
	 * the link as a phone can open it, for the code in its corner.
	 */
	const displayInvite = $derived(
		display && data.invite && page.url.searchParams.has('invite') && typeof location !== 'undefined'
			? inviteAddress(data.invite, location, rememberedHost())
			: null
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
	// map stays the kind it was made as. It goes by which map this is, and
	// not by the data: the same map asked for again, as a change of scale
	// has it, keeps its tools in hand and what there is to undo.
	const mapId = $derived(data.snapshot.map.id);
	$effect(() => {
		void mapId;
		untrack(() => {
			placing = null;
			drawing = false;
			measuring = false;
			pointing = false;
			boxing = false;
			fogTool = null;
			battleTool = 'pan';
			form = null;
			tokenForm = null;
			visibilityOf = null;
			filterOpen = false;
			setup = false;
			alignBox = null;
			settings = null;
			finding = false;
			inviting = false;
			helping = false;
			exiting = false;
			gallery = false;
			prompt = null;
			deleting = null;
			selectedMarkerId = null;
			selectedRegionId = null;
			selectedIds = [];
			// Undo is for the map in front of you, not one you have left.
			undos.clear();
			// The finder may have brought this person here for one marker.
			const marker = wanted;
			wanted = null;
			if (marker) pinMarker(marker);
		});
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
		putAway();
		letGo();
		placing = next;
	}

	function placed(x: number, y: number) {
		const target = placing;
		placing = null;
		if (!target) return;
		if ('move' in target) run({ t: 'marker.update', id: target.move.id, changes: { x, y } });
		else form = { mode: 'create', kind: target.create, x, y };
	}

	async function saveMarker(
		values: Pick<MarkerInput, 'type' | 'title' | 'description' | 'hidden' | 'image'>
	) {
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
			// Table notes have no hidden state to send, and no picture.
			const { hidden, image, ...shared } = values;
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

	/** Switches the regions off the map, or back onto it. */
	function hideRegions(hidden: boolean) {
		regionsHidden = hidden;
		// A region that is gone can't stay the one the region buttons act on.
		if (hidden) selectedRegionId = null;
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

	/**
	 * Takes the ruler out on a world map, or with it out already, puts it
	 * away. One with no scale has nothing to tell: the GM is asked for it,
	 * in the map's settings.
	 */
	function startMeasuring() {
		if (miles === null) {
			if (isGm) settings = 'scale';
			return;
		}
		const out = measuring;
		putAway();
		if (out) return;
		letGo();
		measuring = true;
	}

	/**
	 * Takes up the pointing tool on a world map: from then on the table is
	 * shown where the pointer is whenever its button is held down, until the
	 * tool is put away again, which a second click on it does.
	 */
	function startPointing() {
		const out = pointing;
		putAway();
		if (out) return;
		letGo();
		pointing = true;
	}

	/**
	 * Takes up the box that selects several markers of a world map, or with
	 * it in hand already, puts it away. What it catches is moved by dragging
	 * one of them, and has its buttons under it. What was selected together
	 * before stays so: with Shift held, the box adds to it.
	 */
	function startBoxing() {
		const out = boxing;
		putAway();
		if (out) return;
		selectedMarkerId = null;
		selectedRegionId = null;
		boxing = true;
	}

	// ------------------------------------------------------ the date in the world

	/**
	 * The GM has written a date in the field over the map, or cleared it.
	 * The field shows it as it was kept, or if it wasn't, what it was before.
	 */
	async function saveDate(field: HTMLInputElement) {
		const before = date;
		const written = field.value.replace(/\s+/g, ' ').trim();
		field.value = written;
		if (written === before) return;
		try {
			field.value = await live.setDate(written);
		} catch (err) {
			field.value = before;
			say((err as Error).message, 'failure');
		}
	}

	// ----------------------------------------------------------------- seats

	/** The GM answers someone asking for a seat: a new one, or the one they sat in before. */
	async function answerKnock(knock: Knock, grant: boolean) {
		try {
			await live.answer(knock, grant);
			const said = knock.newcomer
				? grant
					? `${knock.name} has a seat at the table.`
					: `Turned ${knock.name} away.`
				: grant
					? `${knock.name} is back in their seat.`
					: `Turned away whoever asked for ${knock.name}’s seat.`;
			say(said, grant ? 'success' : 'info');
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

	/**
	 * An encounter out of the dock: every token of it, as it was made in the
	 * gallery, around where it was dropped, or for a click, the middle of the
	 * view. Hidden from the players, selected, and undone as one. The first of
	 * them goes squarely on the grid and the rest keep their places from it,
	 * so the encounter keeps its shape.
	 */
	async function addEncounter(encounter: Encounter, drop: { x: number; y: number } | null) {
		if (!canvas || encounter.tokens.length === 0) return;
		const dropped = drop && canvas.spotAt(drop.x, drop.y);
		// Let go anywhere but over the map, it goes back in the dock.
		if (drop && !dropped) return;
		const { map } = world;
		const [cx, cy] = dropped || canvas.middle();
		const stepX = map.grid.size / map.width;
		const stepY = map.grid.size / map.height;
		const lead = encounter.tokens[0];
		const from: Point = [cx + lead.dx * stepX, cy + lead.dy * stepY];
		const onGrid = snapToGrid(map, from, lead.size);
		const within = (at: number) => Math.min(1, Math.max(0, at));
		const commands = encounter.tokens.map(
			({ dx, dy, ...token }): Command => ({
				t: 'token.create',
				mapId: map.id,
				...token,
				hidden: true,
				x: within(cx + dx * stepX + onGrid[0] - from[0]),
				y: within(cy + dy * stepY + onGrid[1] - from[1])
			})
		);
		const had = new Set(world.tokens.map((token) => token.id));
		const note = `Put down “${encounter.name}”, hidden from the players.`;
		if (!(await send(commands, note))) return;
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
	 * Takes up the fog of a world map: whichever of its two tools has
	 * something to do, clearing where there is fog, covering where there is
	 * none yet. They come out beside the button while one is in hand, the
	 * same ones a battle map has, and a second click puts them away.
	 */
	function pickWorldFog() {
		const out = fogTool !== null;
		putAway();
		if (out) return;
		letGo();
		fogTool = world.map.fog.on ? 'reveal' : 'cover';
	}

	/** Takes one of the fog's two tools in hand, on either kind of map. */
	function takeFog(next: 'reveal' | 'cover') {
		if (battle) take(next);
		else fogTool = next;
	}

	/**
	 * Covers the whole map with fog, or where there is some, lifts all of it.
	 * Each map has its own.
	 */
	async function fogAll() {
		const on = !world.map.fog.on;
		// With no marks, said so: left unsaid, the ones made by hand would stay.
		if (await run({ t: 'map.update', id: world.map.id, fog: { on, clear: [], marks: [] } })) {
			// What is left to do: clear some of the new fog, or with none, cover some.
			if (fogHand) takeFog(on ? 'reveal' : 'cover');
		}
	}

	/**
	 * The slider of the brush goes in even steps that each make it as many
	 * times bigger: a small brush is sized as finely as a big one.
	 */
	const BRUSH_STEPS = 40;
	const BRUSH_SPAN = Math.log(FOG_BRUSH.max / FOG_BRUSH.min);
	const brushStep = $derived(
		Math.round((Math.log(brushSize(fogSize) / FOG_BRUSH.min) / BRUSH_SPAN) * BRUSH_STEPS)
	);

	/** Sizes the brush to a step of its slider. */
	function sizeBrush(step: number) {
		fogSize = brushSize(FOG_BRUSH.min * Math.exp((step / BRUSH_STEPS) * BRUSH_SPAN));
	}

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

	/**
	 * Folds every palette of a battle map away, or with the dock and the
	 * tools both folded, brings them all back.
	 */
	function foldAll() {
		const fold = !(dockFolded && toolsFolded);
		dockFolded = toolsFolded = turnsFolded = fold;
	}

	/** The players' view of this map in a window of its own: the one window, however often it is asked for. */
	function openDisplay() {
		window.open(`${mapUrl(world.map.id)}?display`, 'odyssey-display');
	}

	/** Each with the key that takes it in hand: the top row of the keyboard, left to right. */
	const BATTLE_TOOLS: { tool: BattleTool; icon: ToolIcon; label: string; key: string }[] = [
		{ tool: 'pan', icon: 'pointer', label: 'Select and move', key: KEY.hand },
		{ tool: 'select', icon: 'marquee', label: 'Select multiple', key: KEY.box },
		{ tool: 'measure', icon: 'ruler', label: 'Measure a distance', key: KEY.ruler },
		{ tool: 'sketch', icon: 'draw', label: 'Draw', key: KEY.pen },
		{ tool: 'point', icon: 'ping', label: 'Point at the map', key: KEY.point }
	];

	/**
	 * The tools in the corner of a world map, with the keys a battle map
	 * gives the same ones. A ruler needs a scale to go by: where no map on
	 * the way here has one, the GM is asked for it, and players have no ruler.
	 */
	const WORLD_TOOLS: {
		icon: ToolIcon;
		label: string;
		key: string;
		hint: () => string | undefined;
		shown: () => boolean;
		held: () => boolean;
		take: () => void;
	}[] = [
		{
			icon: 'marquee',
			label: 'Select multiple',
			key: KEY.box,
			hint: () => 'Markers, to move, hide or delete together',
			shown: () => true,
			held: () => boxing,
			take: startBoxing
		},
		{
			icon: 'ruler',
			label: 'Measure a distance',
			key: KEY.ruler,
			hint: () =>
				miles === null
					? 'Asks how far across this map is first'
					: `This map is about ${milesCount(miles)} across`,
			shown: () => isGm || miles !== null,
			held: () => measuring,
			take: startMeasuring
		},
		{
			icon: 'ping',
			label: 'Point at the map',
			key: KEY.point,
			hint: () => 'Hold the button down: the table sees where you point',
			shown: () => true,
			held: () => pointing,
			take: startPointing
		}
	];

	/**
	 * What the pen draws: a line, one of the shapes, for the area of a spell,
	 * a breath, a wall, or a line of text. With the pen in hand each has a
	 * number key, in this order: see PEN_KEYS.
	 */
	const PENS: { pen: Pen; icon: ToolIcon; label: string; hint: string }[] = [
		{ pen: 'line', icon: 'draw', label: 'Draw a line', hint: 'Freehand' },
		{ pen: 'circle', icon: 'circle', label: 'Draw a circle', hint: 'A burst around a spot' },
		{ pen: 'cone', icon: 'cone', label: 'Draw a cone', hint: 'As wide at its end as it is long' },
		{ pen: 'rect', icon: 'box', label: 'Draw a box', hint: 'A square or a wall' },
		{ pen: 'text', icon: 'text', label: 'Draw text', hint: 'Click the map and type' }
	];

	/** Dips the pen in the next ink along, or with `by` at -1, the one before. */
	function nextInk(by: 1 | -1) {
		const inks: readonly string[] = INK_COLORS;
		ink = inks[(inks.indexOf(ink) + by + inks.length) % inks.length];
	}

	/** With one of the fog's two tools in hand, takes up the other. */
	function swapFog() {
		// Where there is no fog yet there is none to clear.
		if (fogHand === 'cover' && !world.map.fog.on) return;
		if (fogHand) takeFog(fogHand === 'reveal' ? 'cover' : 'reveal');
	}

	// ------------------------------------------------------ maps & regions

	/** Starts the outline of a new region. */
	function startRegion() {
		putAway();
		letGo();
		// A region about to be drawn shouldn't vanish once it is
		// done, nor be laid blind over the ones already there.
		regionsHidden = false;
		drawing = true;
	}

	/** Steps into the region that is selected. */
	function enterSelected() {
		const region = selectedRegion;
		selectedRegionId = null;
		if (region) enter(region);
	}

	/** Closes a region to the players, or opens one that is closed. */
	const closeRegion = (region: Region) =>
		run({ t: 'region.update', id: region.id, closed: !region.closed });

	/** Hides a region from the players, or reveals one that is hidden. */
	const hideRegion = (region: Region) =>
		run({ t: 'region.update', id: region.id, hidden: !region.hidden });

	/** Opens the dialog that says who sees a region. */
	function shareRegion(region: Region) {
		visibilityOf = { kind: 'region', ids: [region.id] };
	}

	function renameRegion(region: Region) {
		prompt = { kind: 'rename', mapId: region.targetMapId, initial: region.name };
	}

	async function enter(region: Region) {
		// A closed region is there to be seen, and wondered about.
		if (region.closed && !isGm) {
			say(`“${region.name}” is not open to you yet.`, 'info');
			return;
		}
		// Stepping into a region is looking at it.
		discoveries?.seen(region.id);
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

	// ---------------------------------------------------------------- misc

	// The keys of the page: the tools, what the bars and the header hold, and
	// the region that is selected. Every one of them is in the table in
	// src/lib/client/keys.ts, which the tooltips and the sheet of shortcuts
	// read too. What is selected on the map has its keys in MapCanvas, and so
	// has the view: it listens after this, for what is not taken here.
	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		const key = chord(e);
		// A display has nothing to undo and no tools to take up. Its one key
		// steps back out of the map it is on, to the one the region that led
		// here is drawn on: Backspace, or the way out every map has.
		if (display) {
			const outside = world.trail.at(-2);
			if ((key === 'Backspace' || key === KEY.out) && outside) {
				e.preventDefault();
				if (!e.repeat) goto(mapUrl(outside.id));
			}
			return;
		}
		if (form || tokenForm || setup || settings || finding || inviting || gallery) return;
		if (visibilityThings.length) return;
		if (prompt || deleting || helping || exiting) return;
		// In a text field, a letter is a letter and Ctrl+Z belongs to the text.
		const typing = isTyping(e.target);

		if (key === KEY.undo || key === KEY.redo || key === KEY.redoToo) {
			if (typing) return;
			e.preventDefault();
			// One step per press: holding the keys down doesn't run through the lot.
			if (e.repeat) return;
			if (key === KEY.undo) undo();
			else redo();
			return;
		}

		// Ctrl+K opens the finder, from anywhere on the page.
		if (key === KEY.find) {
			e.preventDefault();
			finding = true;
			return;
		}

		if (key === KEY.putAway) {
			if (placing || drawing || measuring || pointing || boxing || fogTool || battleTool !== 'pan') {
				putAway();
			} else if (canvas?.shut()) {
				// A box beside what is selected was out, its marks or its label:
				// only that is put away.
			} else if (filterOpen) {
				filterOpen = false;
			} else {
				letGo();
			}
			return;
		}

		if (typing) return;
		const act = keyed(key, e.target);
		if (!act) return;
		e.preventDefault();
		// One press does it once. Only the brush is sized for as long as its key is held.
		if (!e.repeat || key === KEY.brushSmaller || key === KEY.brushBigger) act();
	}

	/** What a key does on this map as things stand, or nothing if it has no job here. */
	function keyed(key: string, target: EventTarget | null): (() => void) | null {
		switch (key) {
			case KEY.findToo:
				return () => (finding = true);
			case KEY.help:
				return () => (helping = true);
			case KEY.out: {
				const outside = world.trail.at(-2);
				return outside ? () => goto(mapUrl(outside.id)) : null;
			}
			case KEY.exit:
				return () => (exiting = true);
		}
		return (isGm ? gmKeyed(key) : null) ?? (battle ? battleKeyed(key, target) : worldKeyed(key, target));
	}

	/** The GM's keys on either kind of map: the fog, the table, and what the header opens. */
	function gmKeyed(key: string): (() => void) | null {
		switch (key) {
			case KEY.settings:
				return () => (settings = 'name');
			case KEY.gallery:
				return () => (gallery = 'map');
			case KEY.invite:
				return data.invite ? () => (inviting = true) : null;
			case KEY.display:
				return openDisplay;
			case KEY.fog:
				// A key takes its tool up. It is Esc that puts one away.
				return fogHand ? () => {} : battle ? pickFog : pickWorldFog;
		}
		// The rest are the fog's own, for while it is in hand.
		if (!fogHand) return null;
		switch (key) {
			case KEY.fogSwap:
				return swapFog;
			case KEY.brushShape:
				return () => (fogShape = fogShape === 'round' ? 'square' : 'round');
			case KEY.brushSmaller:
				return () => sizeBrush(brushStep - 1);
			case KEY.brushBigger:
				return () => sizeBrush(brushStep + 1);
			case KEY.fogAll:
				return fogAll;
		}
		return null;
	}

	/** The keys of a battle map: its tools, the turn order, the dock, and what goes with the pen. */
	function battleKeyed(key: string, target: EventTarget | null): (() => void) | null {
		const hit = BATTLE_TOOLS.find((each) => each.key === key);
		if (hit) return () => take(hit.tool);
		const fighting = world.map.turns.order.length > 0;
		switch (key) {
			// G goes to this person's own token, if one of the tokens here is theirs.
			case KEY.mine:
				return myTokens.length ? goToMine : null;
			// N moves the fight on to the next turn, for whoever may end this one.
			case KEY.nextTurn:
				return fighting ? () => turnOrder?.next() : null;
			// I puts the tokens selected in the turn order, or takes them out.
			case KEY.turns:
				return isGm ? () => turnOrder?.join() : null;
			case KEY.rolls:
				return isGm && fighting ? () => turnOrder?.roll() : null;
			case KEY.endFight:
				return isGm && fighting ? () => turnOrder?.end() : null;
			case KEY.plainToken:
				// The dock is put away while the grid is being lined up.
				return battleTool === 'align' ? null : () => addToken(null, null);
			case KEY.grid:
				return isGm ? () => (setup = true) : null;
			case KEY.palettes:
				return foldAll;
			case 'Enter':
				// The grid that is being tried on is kept.
				return battleTool === 'align' && alignGrid && !usesEnter(target) ? keepAlignment : null;
		}
		if (battleTool !== 'sketch') return null;
		// With the pen in hand: what it draws, and in which ink.
		const drawn = PENS[PEN_KEYS.indexOf(key)];
		if (drawn) return () => (pen = drawn.pen);
		if (key === KEY.ink) return () => nextInk(1);
		if (key === KEY.inkBack) return () => nextInk(-1);
		return null;
	}

	/** The keys of a world map: its tools, what the bar under it holds, and the region selected. */
	function worldKeyed(key: string, target: EventTarget | null): (() => void) | null {
		// The tools in the corner have the keys a battle map gives the same
		// ones, and the hand has its own: the tool in hand is put away.
		if (key === KEY.hand) return putAway;
		const hit = WORLD_TOOLS.find((each) => each.key === key);
		if (hit) {
			if (!hit.shown()) return null;
			// A key takes its tool up. It is Esc that puts one away.
			return hit.held() ? () => {} : hit.take;
		}
		switch (key) {
			case KEY.note:
				return () => startPlacing({ create: 'player' });
			case KEY.filter:
				return placing || drawing ? null : () => (filterOpen = !filterOpen);
		}
		if (!isGm) return null;
		switch (key) {
			case KEY.marker:
				return () => startPlacing({ create: 'world' });
			case KEY.region:
				return startRegion;
		}
		// The region that is selected: the keys of its buttons in the bar.
		const region = tool === 'pan' && selectedIds.length === 0 ? selectedRegion : null;
		if (!region) return null;
		switch (key) {
			case KEY.enter:
				// On a button, Enter presses the button.
				return usesEnter(target) ? null : enterSelected;
			case KEY.lock:
				return () => closeRegion(region);
			case KEY.hide:
				return () => hideRegion(region);
			case KEY.share:
				return () => shareRegion(region);
			case KEY.rename:
			case KEY.renameToo:
				return () => renameRegion(region);
			case KEY.remove:
			case 'Backspace':
				// It asks first: there is no undo for this one.
				return () => (deleting = region);
		}
		return null;
	}

	/** Nothing on the map is selected any more. */
	function letGo() {
		selectedMarkerId = null;
		selectedRegionId = null;
		selectedIds = [];
	}

	/** Back to the hand: whichever tool was waiting for the map is put away. */
	function putAway() {
		placing = null;
		drawing = false;
		measuring = false;
		pointing = false;
		boxing = false;
		fogTool = null;
		battleTool = 'pan';
		alignBox = null;
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

<!-- The fog's own tools, the same on either kind of map: clear some of it
     or cover some again, with a round brush or a square one, or do the whole
     map at once. They stand in a palette docked in the corner of the map,
     so their tooltips come out to the left of it. -->
<!-- What the GM does with the region that is selected. The map floats these
     over it, and says which side their tooltips have room on. -->
{#snippet regionBar(region: Region, tip: 'top' | 'bottom')}
	<div
		class="flex items-center gap-1 rounded-xl border border-[#55607a] bg-panel/94 p-1 shadow-pop"
		role="toolbar"
		aria-label="Region {region.name}"
	>
		<ToolButton
				small
				{tip}
				icon="enter"
				label="Enter the region"
				shortcut={KEY.enter}
				onclick={enterSelected}
			/>
			<ToolButton
				small
				{tip}
				icon={region.closed ? 'unlock' : 'lock'}
				label={region.closed ? 'Open the region to players' : 'Close the region to players'}
				hint={region.closed
					? 'They can step inside again'
					: "They still see it, and can't step inside"}
				shortcut={KEY.lock}
				active={region.closed}
				onclick={() => closeRegion(region)}
			/>
			<ToolButton
				small
				{tip}
				icon={region.hidden ? 'hide' : 'reveal'}
				label="Visibility"
				hint={!region.hidden
					? 'Everyone sees the region'
					: region.seenBy.length
						? `Only you and ${region.seenBy.length} ${region.seenBy.length === 1 ? 'player' : 'players'} see the region`
						: 'Only you see the region'}
				shortcut={KEY.share}
				active={region.hidden}
				onclick={() => shareRegion(region)}
			/>
			<ToolButton
				small
				{tip}
				icon="rename"
				label="Rename the region"
				shortcut={KEY.rename}
				onclick={() => renameRegion(region)}
			/>
			<ToolButton
				small
				{tip}
				icon="delete"
				label="Delete the region"
				shortcut={KEY.remove}
				danger
				onclick={() => (deleting = region)}
			/>
	</div>
{/snippet}

{#snippet fogButtons()}
	<ToolButton
		tip="left"
		icon="reveal"
		label="Clear the fog from an area"
		hint={world.map.fog.on ? undefined : 'There is no fog on this map yet'}
		shortcut={fogHand === 'cover' && world.map.fog.on ? KEY.fogSwap : undefined}
		disabled={!world.map.fog.on}
		active={fogHand === 'reveal'}
		onclick={() => takeFog('reveal')}
	/>
	<ToolButton
		tip="left"
		icon="hide"
		label="Cover an area with fog"
		shortcut={fogHand === 'reveal' ? KEY.fogSwap : undefined}
		active={fogHand === 'cover'}
		onclick={() => takeFog('cover')}
		/>
		<span class="h-px bg-line"></span>
		<ToolButton
			tip="left"
			icon="circle"
			label="Paint with a round brush"
			hint="Shift and the wheel size it, or [ and ]"
			shortcut={fogShape === 'square' ? KEY.brushShape : undefined}
			active={fogShape === 'round'}
			onclick={() => (fogShape = 'round')}
		/>
		<ToolButton
			tip="left"
			icon="box"
			label="Paint with a square brush"
			hint="Sized the same way"
			shortcut={fogShape === 'round' ? KEY.brushShape : undefined}
			active={fogShape === 'square'}
			onclick={() => (fogShape = 'square')}
		/>
		<!-- How big the brush is. It stands on end, like the tools around
		     it, with the bigger brush at the top. -->
		<input
			class="h-24 w-4 cursor-pointer justify-self-center accent-accent [direction:rtl] [writing-mode:vertical-lr]"
			type="range"
			min="0"
			max={BRUSH_STEPS}
			step="1"
			value={brushStep}
			oninput={(e) => sizeBrush(e.currentTarget.valueAsNumber)}
			aria-label="Brush size"
			title="Brush size"
		/>
		<span class="h-px bg-line"></span>
	<ToolButton
		tip="left"
		icon="fog"
		label={world.map.fog.on ? 'Lift all the fog' : 'Cover the whole map'}
		hint={world.map.fog.on ? 'Ctrl+Z brings it back' : undefined}
		shortcut={KEY.fogAll}
		onclick={fogAll}
	/>
{/snippet}

<div class="flex h-dvh flex-col">
	<!-- A table display is the map and nothing around it. -->
	<header
		hidden={display}
		class="flex min-h-12 items-center gap-3 border-b bg-panel px-3 py-1.5 max-[720px]:flex-wrap"
	>
		<!-- The menu and the trail of maps keep to one row, on a narrow screen too. -->
		<div class="flex min-w-0 items-center gap-3">
			<!-- The menu of the bar: what there is to set about the map itself, for
			     the GM, and the way out of the campaign, for everyone. It stands
			     outside the trail of maps, which scrolls sideways and would cut off
			     what hangs under it. -->
			<Menu
				label="Menu"
				items={[
					...(isGm
						? [{ label: 'Map Settings', shortcut: KEY.settings, onclick: () => (settings = 'name') }]
						: []),
					{ label: 'Exit', shortcut: KEY.exit, onclick: () => (exiting = true) }
				]}
			/>
			<nav
				class="flex min-w-0 items-center gap-2 overflow-x-auto font-serif text-[17px] whitespace-nowrap scrollbar-none"
				aria-label="Breadcrumb"
			>
				{#each world.trail as crumb, i (crumb.id)}
					{#if i > 0}<span class="text-[#5c667a]" aria-hidden="true">›</span>{/if}
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
		</div>

		<!-- ml-auto keeps these on the right when a narrow screen wraps them onto a row of their own. -->
		<div class="ml-auto flex shrink-0 items-center gap-2">
			{#if live.status === 'offline'}
				<span class="text-xs text-[#e8b85a]" role="status">Reconnecting…</span>
			{/if}
			<!-- Nothing of the finder is on screen but this, until it is asked for. -->
			<ToolButton
				small
				tip="bottom-end"
				icon="search"
				label="Find a place or a marker"
				shortcut={KEY.find}
				onclick={() => (finding = true)}
			/>
			<!-- What every key does. Only where there are keys to press. -->
			<span class="flex touch:hidden">
				<ToolButton
					small
					tip="bottom-end"
					icon="keys"
					label="Keyboard shortcuts"
					shortcut={KEY.help}
					onclick={() => (helping = true)}
				/>
			</span>

			{#if isGm}
				<!-- The players' view of this map in a window of its own, to put on a
				     screen the table can see. It opens in the one window however
				     often it is asked for. -->
				<a
					class="btn btn-sm no-underline"
					href="{mapUrl(world.map.id)}?display"
					target="odyssey-display"
					aria-keyshortcuts={ariaKey(KEY.display)}
					title="Opens what the players see in a window of its own, for a TV or a second screen ({keyLabel(
						KEY.display
					)})"
					>Display</a
				>
				<!-- The campaign's pictures, to stock ahead of the maps and tokens that will use them. -->
				<button
					class="btn btn-sm"
					aria-keyshortcuts={ariaKey(KEY.gallery)}
					title="The campaign's pictures, for its maps and tokens ({keyLabel(KEY.gallery)})"
					onclick={() => {
						gallery = 'map';
					}}>Gallery</button
				>
				<button
					class="btn btn-sm"
					aria-keyshortcuts={ariaKey(KEY.invite)}
					title="A code for players to scan, and the link to send them ({keyLabel(KEY.invite)})"
					onclick={() => {
						inviting = true;
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
				regions={shownRegions}
				markers={shownMarkers}
				tokens={world.tokens}
				drawings={world.drawings}
				{miles}
				{dayMiles}
				{hands}
				{pings}
				role={data.role}
				userId={data.me.id}
				{players}
				gridPreview={alignGrid}
				aligned={alignBox}
				passive={display}
				{tool}
				{fogShape}
				bind:fogSize
				{ink}
				shape={pen === 'line' || pen === 'text' ? 'circle' : pen}
				depth={world.trail.length}
				bind:selectedMarkerId
				bind:selectedRegionId
				bind:selectedIds
				{send}
				ondone={() => {
					// A shape that was drawn, a text that was written: back to the
					// hand, to move it or get on with the fight. The pen stays in
					// hand after a line, which is seldom the only one. Either way
					// it remembers what it last drew for the next time it is taken up.
					battleTool = 'pan';
					// On a world map, the box has caught its markers.
					boxing = false;
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
				regionBar={isGm && !display ? regionBar : undefined}
				onedit={(marker) => (form = { mode: 'edit', marker })}
				onmove={(marker) => startPlacing({ move: marker })}
				ondelete={deleteMarker}
				onhide={(marker, hidden) => run({ t: 'marker.update', id: marker.id, changes: { hidden } })}
				onmarkervisibility={(markers) =>
					(visibilityOf = { kind: 'marker', ids: markers.map((marker) => marker.id) })}
				fresh={discoveries?.fresh ?? []}
				onseen={(id) => discoveries?.seen(id)}
				onalign={(box) => (alignBox = box)}
				onedittoken={(token) => (tokenForm = token)}
				ontokenvisibility={(tokens) =>
					(visibilityOf = { kind: 'token', ids: tokens.map((token) => token.id) })}
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
				     still does. The date it is in the world is lettered the same
				     way in the corner across from it. -->
				<div
					class="pointer-events-none absolute inset-x-5 top-4 flex items-baseline justify-between gap-8 font-serif text-xl font-semibold tracking-[0.02em] whitespace-nowrap text-[#fff8e4] text-shadow-map"
				>
					<nav class="flex min-w-0 items-baseline gap-2 overflow-hidden" aria-label="Breadcrumb">
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
					{#if date}
						<span class="max-w-[45%] shrink-0 truncate opacity-70" aria-label="The date in the world">
							{date}
						</span>
					{/if}
				</div>
			{/if}

			{#if displayInvite}
				<!-- The way to the table, in a corner of the screen the table looks
				     at: a code to scan, and the address under it for whoever types. -->
				<aside
					class="pointer-events-none absolute right-5 bottom-5 z-2 grid justify-items-center gap-2 rounded-2xl border bg-panel/94 p-4 shadow-pop"
					aria-label="Join the table"
				>
					<QrCode text={displayInvite.url} size={260} label="A code to scan to join the table" />
					<strong class="font-serif text-xl">Scan to join</strong>
					<span class="max-w-65 text-center text-xs wrap-anywhere text-muted">
						{displayInvite.url}
					</span>
				</aside>
			{/if}

			<!-- What floats in the upper left corner of the map, one under the
			     other: the date, and who is at the table. On a battle map that
			     second box is a dock of two tabs, the turn order and who is at
			     the table. Only the boxes take the pointer, so the map between
			     and under them still does. A table display has the turn order
			     alone, under the name of the map. A narrow screen keeps its Fit
			     button in that corner, so there they start lower. -->
			<div
				class={[
					'pointer-events-none absolute bottom-40 left-3.5 z-1 flex flex-col items-start gap-2',
					display ? 'top-14' : 'top-3.5 max-[720px]:top-16'
				]}
			>
				{#if !display}
					<!-- The date it is in the world. It is whatever the GM writes, since
					     the calendar is the setting's own: the GM has it as a field that
					     reads as text until it is clicked, and saves when it is left, in
					     a box of its own. The players have the words, once there are some. -->
					{#if isGm}
						<div class="pointer-events-auto flex shrink-0 p-1 {floating}">
							<input
								class="max-w-56 min-w-20 field-sizing-content truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-serif text-[15px] placeholder:font-sans placeholder:text-[13px] placeholder:text-muted hover:border-line focus:border-line focus:bg-[#12161e] touch:min-h-9 touch:text-base"
								value={date}
								size={Math.max(10, date.length)}
								maxlength={LIMITS.date}
								placeholder="Set the date…"
								aria-label="The date in the world"
								title="The date in the world, as the whole table sees it"
								autocomplete="off"
								spellcheck="false"
								onchange={(e) => saveDate(e.currentTarget)}
								onkeydown={(e) => {
									if (e.key === 'Enter') e.currentTarget.blur();
									if (e.key === 'Escape') {
										// Unwritten: back to what it was. And the key is the
										// field's own: it puts no tool away on the map.
										e.stopPropagation();
										e.currentTarget.value = date;
										e.currentTarget.blur();
									}
								}}
							/>
						</div>
					{:else if date}
						<!-- Lettered on the map itself, the way a table display has it: no
						     box, and the map under it still takes the pointer. -->
						<span
							class="max-w-72 shrink-0 truncate px-1 font-serif text-xl font-semibold tracking-[0.02em] text-[#fff8e4] opacity-70 text-shadow-map"
							aria-label="The date in the world"
						>
							{date}
						</span>
					{/if}
					{#if live.online.length && !battle}
						<ul class="pointer-events-auto flex shrink-0 p-1.5 {floating}" aria-label="At the table now">
							{#each live.online as person (person.id)}
								<li
									class={[
										'grid size-6.5 cursor-default place-items-center rounded-full border-2 border-panel text-[11px] font-semibold not-first:-ml-1.5',
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
					{/if}
				{/if}
				{#if battle}
					<!-- Whose turn it is and who is at the table, in one dock down the
					     left side of a battle map. It has what is left of the height,
					     and scrolls inside that. -->
					<div class="pointer-events-auto flex min-h-0 flex-col">
						<TableDock
							bind:this={turnOrder}
							{campaignId}
							tokens={world.tokens}
							turns={world.map.turns}
							online={live.online}
							gm={isGm}
							userId={data.me.id}
							passive={display}
							bind:collapsed={turnsFolded}
							{selectedIds}
							onpick={(id) => {
								battleTool = 'pan';
								selectedIds = [id];
							}}
							onchange={setTurns}
							onnext={passTurn}
						/>
					</div>
				{/if}
			</div>

			{#if empty && isGm && tool === 'pan'}
				<p
					class="absolute top-4.5 left-1/2 w-max max-w-[calc(100%-28px)] -translate-x-1/2 rounded-full border bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl"
				>
					{battle
						? 'This battle map is empty. Choose a map image in Map Settings, in the menu at the top, and add tokens from below.'
						: 'This map is empty. Choose a map image in Map Settings, in the menu at the top, and add markers and regions from the bar below.'}
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
						<!-- The fog's own tools, out while the GM is at it. -->
						<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Fog of war">
							{@render fogButtons()}
						</div>
					{/if}
					{#if !toolsFolded && battleTool === 'sketch'}
						<!-- What the pen draws, out while it is in hand: a line, a shape, or text. -->
						<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="What to draw">
							{#each PENS as each, i (each.pen)}
								<ToolButton
									tip="left"
									icon={each.icon}
									label={each.label}
									hint={each.hint}
									shortcut={PEN_KEYS[i]}
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
									title="{keyLabel(KEY.ink)} takes the next colour, {keyLabel(KEY.inkBack)} the one before"
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
								shortcut={KEY.palettes}
								active={battleTool !== 'pan'}
								onclick={() => (toolsFolded = false)}
							/>
						{:else}
							<ToolButton
								tip="left"
								icon="up"
								label="Fold the tools away"
								hint="{keyLabel(KEY.palettes)} folds the dock and the turn order too"
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
							{#if myTokens.length}
								<!-- Only for someone with a token of their own on this map: the
								     way back to it, lit while its turn is on. -->
								<ToolButton
									tip="left"
									icon="person"
									label={myTokens.length > 1 ? 'Go to my tokens' : 'Go to my token'}
									hint={myTurn ? 'It is your turn' : undefined}
									shortcut={KEY.mine}
									active={myTurn !== null}
									onclick={goToMine}
								/>
							{/if}
							{#if isGm}
								<span class="h-px bg-line"></span>
								<ToolButton
									tip="left"
									icon="grid"
									label="Set up the grid"
									shortcut={KEY.grid}
									active={battleTool === 'align'}
									onclick={() => (setup = true)}
								/>
								<ToolButton
									tip="left"
									icon="fog"
									label="Fog of war"
									hint={world.map.fog.on ? 'On: players see only what you clear' : 'Off'}
									shortcut={KEY.fog}
									active={fogging}
									expanded={fogging}
									onclick={pickFog}
								/>
							{/if}
						{/if}
					</div>
				</div>
			{:else if !display}
				<!-- A world map has the same corner for what is used on the map
				     rather than built into it: the box that selects several
				     markers, the ruler, the pointing tool, and for the GM the fog.
				     Each is lit while it is in hand, and a second click puts it
				     down. The first three have the keys a battle map gives them.
				     What goes with the one in hand comes out beside it. -->
				<div class="absolute top-3.5 right-3.5 z-1 flex items-start gap-1.5">
					{#if isGm && fogTool}
						<!-- The fog's own tools, out while the GM is at it: the ones a
						     battle map has. -->
						<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Fog">
							{@render fogButtons()}
						</div>
					{/if}
					<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Tools in hand">
						{#each WORLD_TOOLS as each (each.key)}
							{#if each.shown()}
								<ToolButton
									tip="left"
									icon={each.icon}
									label={each.label}
									hint={each.hint()}
									shortcut={each.key}
									active={each.held()}
									onclick={each.take}
								/>
							{/if}
						{/each}
						{#if isGm}
							<span class="h-px bg-line"></span>
							<!-- Each world map has its own: under it, players see only
							     what the GM has cleared. -->
							<ToolButton
								tip="left"
								icon="fog"
								label="Fog"
								hint={world.map.fog.on
									? 'On: players see only what you clear'
									: 'Off: cover this map, or a part of it'}
								shortcut={KEY.fog}
								active={fogTool !== null}
								expanded={fogTool !== null}
								onclick={pickWorldFog}
							/>
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
				{#if isGm && live.knocks.length}
					<!-- Someone at the door, asking for a seat, a new one or the one
					     they sat in before: the GM's to answer. It stays until it is
					     answered, or they give up. -->
					{@const knock = live.knocks[0]}
					{@const asks = knock.newcomer
						? 'is asking to join the table'
						: 'is asking for their seat back, from another browser'}
					<div
						class="pointer-events-auto flex max-w-[calc(100%-28px)] flex-wrap items-center justify-center gap-2 rounded-[10px] border border-accent bg-[#3a3018] py-2 pr-2 pl-3.5 text-sm shadow-pop"
						role="alertdialog"
						aria-label="{knock.name} {asks}"
					>
						<span>
							<strong>{knock.name}</strong>
							{asks}.
							{#if live.knocks.length > 1}
								<span class="text-muted">And {live.knocks.length - 1} more.</span>
							{/if}
						</span>
						<span class="flex gap-1.5">
							<button class="btn btn-sm btn-primary" onclick={() => answerKnock(knock, true)}>
								Let them in
							</button>
							<button class="btn btn-sm" onclick={() => answerKnock(knock, false)}>
								{knock.newcomer ? 'Not now' : 'Not them'}
							</button>
						</span>
					</div>
				{/if}

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
									onkeydown={(e) => {
										if (e.key === 'Enter') keepAlignment();
									}}
								/>
							</label>
							<span class="text-xs text-muted tabular-nums">
								One cell is {alignGrid.size} pixels
							</span>
							<button
								class="btn btn-sm btn-primary"
								aria-keyshortcuts="Enter"
								title="Enter"
								onclick={keepAlignment}>Use this grid</button
							>
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
						onencounter={addEncounter}
						onencounters={() => (gallery = 'encounter')}
						onerror={(text) => say(text, 'failure')}
					/>
				{:else}
				{#if filterOpen && !placing && !drawing}
					<!-- Which types of marker to see: a pill for each, lit while its type
					     is shown, with how many of them this map holds. Under them, a
					     switch for the regions. -->
					<div
						class="pointer-events-auto grid w-[min(440px,calc(100%-24px))] gap-2 p-2.5 {floating}"
						role="group"
						aria-label="What the map shows"
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
						<!-- The whole row is the switch, so there is plenty to aim at. -->
						<button
							class="group flex cursor-pointer items-center justify-between gap-2 border-t pt-2 text-[13px] touch:py-2"
							role="switch"
							aria-checked={!regionsHidden}
							onclick={() => hideRegions(!regionsHidden)}
						>
							<span class={regionsHidden ? 'text-muted' : ''}>
								Regions
								{#if world.regions.length}
									<span class="text-[11px] tabular-nums opacity-70">{world.regions.length}</span>
								{/if}
							</span>
							<span
								class={[
									'flex h-4.5 w-8 items-center rounded-full border p-0.5 transition-colors duration-120',
									regionsHidden ? 'bg-panel-2 group-hover:border-[#465166]' : 'border-accent bg-accent'
								]}
							>
								<span
									class={[
										'size-3 rounded-full transition-transform duration-120',
										regionsHidden ? 'bg-muted' : 'translate-x-3.5 bg-accent-ink'
									]}
								></span>
							</span>
						</button>
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-muted">Only changes what you see.</span>
							<span class="flex gap-1.5">
								<button
									class="btn btn-sm btn-ghost"
									disabled={hiddenTypes.length === 0 && !regionsHidden}
									onclick={() => {
										hideTypes([]);
										hideRegions(false);
									}}>Show all</button
								>
								<button
									class="btn btn-sm btn-ghost"
									disabled={hiddenTypes.length === MARKER_TYPES.length && regionsHidden}
									onclick={() => {
										hideTypes(MARKER_TYPES.map((each) => each.id));
										hideRegions(true);
									}}>Hide all</button
								>
							</span>
						</div>
					</div>
				{/if}
				<div
					class="pointer-events-auto flex max-w-[calc(100%-120px)] flex-wrap items-center justify-center gap-1.5 p-1.5 max-[720px]:max-w-[calc(100%-24px)] {floating}"
					role="toolbar"
					aria-label="Map tools"
				>
					{#if placing || drawing}
						<!-- A marker being put down or a region being drawn: all there
						     is to do here is to give it up. The ruler, the pointing tool
						     and the fog are in the corner, and leave the bar as it is. -->
						<button class="btn" onclick={putAway}>Cancel</button>
					{:else}
						<!-- The tools for the map: icons, each with a tooltip that names
						     it. A player has one tool, so theirs keeps its words. What is
						     done with a region floats over the one selected, not here. -->
						<ToolButton
							icon="note"
							label={isGm ? 'Add a note' : 'Add note'}
							shortcut={KEY.note}
							named={!isGm}
							onclick={() => startPlacing({ create: 'player' })}
						/>
						<!-- Lit while some type is filtered out, so markers that don't
						     show are never a mystery. -->
						<ToolButton
							icon="filter"
							label="Filter markers and regions"
							hint={filterHint}
							shortcut={KEY.filter}
							active={hiddenTypes.length > 0 || regionsHidden}
							expanded={filterOpen}
							onclick={() => (filterOpen = !filterOpen)}
						/>
						{#if isGm}
							<span class="w-px self-stretch bg-line"></span>
							<ToolButton
								icon="marker"
								label="Add a world marker"
								shortcut={KEY.marker}
								onclick={() => startPlacing({ create: 'world' })}
							/>
							<ToolButton
								icon="region"
								label="Draw a region"
								shortcut={KEY.region}
								onclick={startRegion}
							/>
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
		{campaignId}
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

{#if visibilityOf && visibilityThings.length}
	<VisibilityDialog
		title={visibilityThings.length === 1
			? `Visibility of “${visibilityThings[0].name}”`
			: `Visibility of ${visibilityThings.length} ${visibilityOf.kind}s`}
		things={visibilityThings}
		{players}
		note={visibilityOf.kind === 'region' ? 'The players picked can step inside too.' : undefined}
		onchange={setVisibility}
		onclose={() => (visibilityOf = null)}
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

{#if gallery}
	<Gallery
		{campaignId}
		start={gallery}
		onclose={() => {
			gallery = false;
			// What was added, revealed or taken out shows in the dock of tokens,
			// and so do the encounters that were made or changed.
			galleryStamp++;
		}}
	/>
{/if}

{#if settings && isGm}
	<MapSettings
		map={world.map}
		{campaignId}
		first={settings}
		borrowed={!!world.backdrop}
		{miles}
		{dayMiles}
		onsubmit={async (changes) => {
			const saved = await run({ t: 'map.update', id: world.map.id, ...changes });
			// With no scale left to go by, the ruler goes back in the drawer.
			if (saved && changes.miles === null) measuring = false;
			return saved;
		}}
		onclose={() => {
			settings = null;
			// The dialog's own gallery may have been added to or tidied.
			galleryStamp++;
		}}
	/>
{/if}

{#if inviting && data.invite}
	<InviteDialog
		invite={data.invite}
		campaignName={data.campaign.name}
		displayUrl="/c/{campaignId}/m/{world.map.id}?display"
		oncopied={(ok) =>
			ok
				? say('Invite link copied to the clipboard.', 'success')
				: say('Copy the link from the box.', 'warning')}
		onclose={() => (inviting = false)}
	/>
{/if}

{#if helping}
	<KeySheet gm={isGm} kind={world.map.kind} onclose={() => (helping = false)} />
{/if}

{#if finding}
	<Finder {campaignId} here={world.map.id} onpick={go} onclose={() => (finding = false)} />
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

{#if exiting}
	<Modal title="Exit “{data.campaign.name}”?" onclose={() => (exiting = false)}>
		<p>This takes you out of the campaign, back to the list of your campaigns.</p>
		<p class="text-[13px] text-muted">Everything on the maps is already saved.</p>
		<!-- Cancel comes first, so that is where the dialog puts the focus. -->
		<div class="flex justify-end gap-2">
			<button class="btn btn-ghost" onclick={() => (exiting = false)}>Cancel</button>
			<button class="btn btn-primary" onclick={() => goto('/')}>Exit</button>
		</div>
	</Modal>
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
