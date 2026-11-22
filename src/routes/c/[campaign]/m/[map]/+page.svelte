<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import { inviteAddress, rememberedHost } from '#lib/client/invite.ts';
	import { KEY, PEN_KEYS, chord, isTyping, usesEnter } from '#lib/client/keys.ts';
	import { untrack } from 'svelte';
	import { DISPLAY_GLINT, Discoveries } from '#lib/client/discoveries.svelte.ts';
	import { getLive } from '#lib/client/live.svelte.ts';
	import { MapState } from '#lib/client/mapstate.svelte.ts';
	import { Notices } from '#lib/client/notices.svelte.ts';
	import { Toolbelt } from '#lib/client/toolbelt.svelte.ts';
	import { encounterFromDock, tokenFromDock } from '#lib/client/tools/dock.ts';
	import { UndoStack, type Step } from '#lib/client/undo.ts';
	import AlignBar from '#lib/components/AlignBar.svelte';
	import BattleTools, {
		BATTLE_TOOLS,
		PENS,
		type Pen
	} from '#lib/components/BattleTools.svelte';
	import DisplayLettering from '#lib/components/DisplayLettering.svelte';
	import Finder from '#lib/components/Finder.svelte';
	import FogTools from '#lib/components/FogTools.svelte';
	import Gallery from '#lib/components/Gallery.svelte';
	import InviteDialog from '#lib/components/InviteDialog.svelte';
	import KnockBanner from '#lib/components/KnockBanner.svelte';
	import KeySheet from '#lib/components/KeySheet.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MapHeader from '#lib/components/MapHeader.svelte';
	import MapSettings from '#lib/components/MapSettings.svelte';
	import MapSetup from '#lib/components/MapSetup.svelte';
	import MarkerFilter from '#lib/components/MarkerFilter.svelte';
	import MarkerForm from '#lib/components/MarkerForm.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import NamePrompt from '#lib/components/NamePrompt.svelte';
	import NoticeToast from '#lib/components/NoticeToast.svelte';
	import RegionBar from '#lib/components/RegionBar.svelte';
	import SeatsDialog from '#lib/components/SeatsDialog.svelte';
	import TokenDock from '#lib/components/TokenDock.svelte';
	import TokenForm from '#lib/components/TokenForm.svelte';
	import type { ToolIcon } from '#lib/components/ToolButton.svelte';
	import TableCorner from '#lib/components/TableCorner.svelte';
	import TableDock from '#lib/components/TableDock.svelte';
	import WorldBar from '#lib/components/WorldBar.svelte';
	import WorldTools from '#lib/components/WorldTools.svelte';
	import VisibilityDialog from '#lib/components/VisibilityDialog.svelte';
	import { gridFromBox, milesCount } from '#lib/shared/grid.ts';
	import { canEditWorld } from '#lib/shared/rules.ts';
	import {
		INK_COLORS,
		FOG_BRUSH,
		LIMITS,
		MARKER_TYPES,
		TOKEN_COLORS,
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
		type Region,
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
	/** What distances are told in here, and how a diagonal step is counted: as this map says, or the maps further out. */
	const units = $derived(world.map.units ?? world.units);
	const diagonal = $derived(world.map.diagonal ?? world.diagonal);
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
		belt.battleTool = 'pan';
		selectedIds = [token.id];
		canvas?.centreOn([token.x, token.y]);
	}

	/** The address of a map of this campaign. A display stays a display from map to map. */
	const mapUrl = (mapId: string) => `/c/${campaignId}/m/${mapId}${display ? '?display' : ''}`;

	type Form =
		| { mode: 'create'; kind: MarkerKind; x: number; y: number }
		| { mode: 'edit'; marker: Marker };
	type Prompt =
		| { kind: 'region'; points: Point[] }
		| { kind: 'rename'; mapId: string; initial: string };

	let canvas = $state<ReturnType<typeof MapCanvas>>();
	/**
	 * What the fog is cleared and covered with, on either kind of map: a
	 * brush swept over it, round or square. The GM's choice stays from map
	 * to map, and so does the size of the brush: its radius, or half the
	 * side of a square one, as a part of the map's longer side.
	 */
	let fogShape = $state<'round' | 'square'>('round');
	let fogSize = $state(FOG_BRUSH.start);
	/** The colour the pen draws in, text is written in and templates are laid down in. */
	let ink = $state<string>(INK_COLORS[0]);
	/** Which template the template tool lays down. */
	let pen = $state<Pen>('line');
	let form = $state<Form | null>(null);
	/** The token whose picture, colour and outline are being changed. */
	let tokenForm = $state<Token | null>(null);
	/**
	 * What the GM is saying who sees, by id: the pieces of a battle map, which
	 * are its tokens and drawings, world markers, or a region.
	 */
	let visibilityOf = $state<{ kind: 'piece' | 'marker' | 'region'; ids: string[] } | null>(null);
	/** What a drawing is called, where it needs a name. */
	const drawingName = (drawing: { kind: string; text: string }) =>
		drawing.kind === 'text' ? drawing.text : drawing.kind === 'line' ? 'the drawing' : 'the shape';
	/** Those as they are now, the ones still on the map, each with the name it goes by. */
	const visibilityThings = $derived.by(() => {
		const of = visibilityOf;
		if (!of) return [];
		const all =
			of.kind === 'piece'
				? [
						...world.tokens,
						...world.drawings.map((drawing) => ({ ...drawing, name: drawingName(drawing) }))
					]
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
					if (kind === 'piece') {
						return world.tokens.some((token) => token.id === id)
							? { t: 'token.update', id, changes }
							: { t: 'drawing.update', id, changes };
					}
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
	/** The GM is looking after the seats: the players of the campaign. */
	let seating = $state(false);
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
	/** What is in hand on the map: the hand, or one of its tools. */
	const belt = new Toolbelt({
		battle: () => battle,
		fogOn: () => world.map.fog.on,
		pen: () => pen,
		hasScale: () => miles !== null,
		askScale: () => {
			if (isGm) settings = 'scale';
		},
		letGo: () => letGo(),
		unpin: () => {
			selectedMarkerId = null;
			selectedRegionId = null;
		},
		deselect: () => (selectedIds = []),
		showRegions: () => (regionsHidden = false)
	});
	// What the belt holds, under the names the rest of this page reads them by.
	const placing = $derived(belt.placing);
	const drawing = $derived(belt.drawing);
	const measuring = $derived(belt.measuring);
	const pointing = $derived(belt.pointing);
	const boxing = $derived(belt.boxing);
	const fogTool = $derived(belt.fogTool);
	const battleTool = $derived(belt.battleTool);
	const alignBox = $derived(belt.alignBox);
	const tool = $derived(belt.tool);
	const fogging = $derived(belt.fogging);
	const fogHand = $derived(belt.fogHand);
	const {
		startPlacing,
		startMeasuring,
		startPointing,
		startBoxing,
		startRegion,
		take,
		pick,
		pickFog,
		pickWorldFog,
		takeFog,
		swapFog,
		putAway
	} = belt;

	/** The one line of news over the bottom of the map. */
	const notices = new Notices();
	const notice = $derived(notices.now);
	const { say } = notices;

	/**
	 * A battle map is a table to play on: tokens, a ruler, a pen, and none of
	 * what a world map is built from. No markers, no notes, no regions
	 * further in.
	 */
	const battle = $derived(world.map.kind === 'battle');
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
			belt.putAway();
			form = null;
			tokenForm = null;
			visibilityOf = null;
			filterOpen = false;
			setup = false;
			settings = null;
			finding = false;
			inviting = false;
			seating = false;
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
		if (notice?.undo) notices.dismiss();
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

	function placed(x: number, y: number) {
		const target = placing;
		belt.placing = null;
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

	/** The GM answers someone asking for a seat: one nobody sat in yet, or the one they sat in before. */
	async function answerKnock(knock: Knock, grant: boolean) {
		try {
			await live.answer(knock, grant);
			const said = !grant
				? `Turned away whoever asked for ${knock.name}’s seat.`
				: knock.taken
					? `${knock.name} is back in their seat.`
					: `${knock.name} has sat down at the table.`;
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
		const dropped = drop && canvas.spotAt(drop.x, drop.y);
		// Let go anywhere but over the map, it goes back in the dock.
		if (drop && !dropped) return;
		// A plain one a player adds is most likely themself.
		const look = { plain: isGm ? 'Token' : data.me.name, color: tokenColor };
		const command = tokenFromDock(world.map, world.tokens, item, dropped || null, canvas.middle(), look);
		const had = new Set(world.tokens.map((token) => token.id));
		if (!(await run(command))) return;
		belt.battleTool = 'pan';
		selectedIds = world.tokens.filter((token) => !had.has(token.id)).map((token) => token.id);
	}

	/**
	 * An encounter out of the dock: every token of it, as it was made in the
	 * gallery, around where it was dropped, or for a click, the middle of the
	 * view. Hidden from the players, selected, and undone as one.
	 */
	async function addEncounter(encounter: Encounter, drop: { x: number; y: number } | null) {
		if (!canvas || encounter.tokens.length === 0) return;
		const dropped = drop && canvas.spotAt(drop.x, drop.y);
		// Let go anywhere but over the map, it goes back in the dock.
		if (drop && !dropped) return;
		const commands = encounterFromDock(world.map, encounter, dropped || canvas.middle());
		const had = new Set(world.tokens.map((token) => token.id));
		const note = `Put down “${encounter.name}”, hidden from the players.`;
		if (!(await send(commands, note))) return;
		belt.battleTool = 'pan';
		selectedIds = world.tokens.filter((token) => !had.has(token.id)).map((token) => token.id);
	}

	function saveToken(
		values: Pick<TokenInput, 'color' | 'outline' | 'image'> & { ownerId?: string | null }
	) {
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

	/**
	 * Goes back to the turn before: the GM's, for a turn ended by mistake.
	 * The turn it goes back from goes along, as it does when one is ended.
	 */
	function backTurn() {
		const from = world.map.turns.current;
		if (from !== null) run({ t: 'turn.back', mapId: world.map.id, from });
	}

	// ------------------------------------------------------------- the grid

	/** The GM would sooner drag the grid onto the map than type it in. */
	function startAligning() {
		setup = false;
		belt.alignBox = null;
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

	// ----------------------------------------------------------------- fog

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
					: `This map is about ${milesCount(miles, units)} across`,
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

	/** Dips the pen in the next ink along, or with `by` at -1, the one before. */
	function nextInk(by: 1 | -1) {
		const inks: readonly string[] = INK_COLORS;
		ink = inks[(inks.indexOf(ink) + by + inks.length) % inks.length];
	}

	// ------------------------------------------------------ maps & regions

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
		if (form || tokenForm || setup || settings || finding || inviting || seating || gallery) return;
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
			case KEY.seats:
				return () => (seating = true);
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
			// Shift+N takes the GM back a turn, for one ended by mistake.
			case KEY.prevTurn:
				return isGm && fighting ? () => turnOrder?.back() : null;
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
	<RegionBar
		{region}
		{tip}
		onenter={enterSelected}
		ontoggle={closeRegion}
		onshare={shareRegion}
		onrename={renameRegion}
		ondelete={(region) => (deleting = region)}
	/>
{/snippet}

{#snippet fogTools()}
	<FogTools
		fogOn={world.map.fog.on}
		{fogHand}
		bind:fogShape
		{BRUSH_STEPS}
		{brushStep}
		{sizeBrush}
		{takeFog}
		{fogAll}
	/>
{/snippet}

<div class="flex h-dvh flex-col">
	<!-- A table display is the map and nothing around it. -->
	<MapHeader
		{display}
		{isGm}
		trail={world.trail}
		regions={world.regions}
		mapId={world.map.id}
		{mapUrl}
		{enter}
		offline={live.status === 'offline'}
		onsettings={() => (settings = 'name')}
		onseats={() => (seating = true)}
		onexit={() => (exiting = true)}
		onfind={() => (finding = true)}
		onhelp={() => (helping = true)}
		ongallery={() => (gallery = 'map')}
		oninvite={() => (inviting = true)}
	/>

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
				{units}
				{diagonal}
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
					belt.battleTool = 'pan';
					// On a world map, the box has caught its markers.
					belt.boxing = false;
				}}
				onplace={placed}
				onnote={(x, y) => {
					if (!display) form = { mode: 'create', kind: 'player', x, y };
				}}
				ondrawn={(points) => {
					belt.drawing = false;
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
				onalign={(box) => (belt.alignBox = box)}
				onedittoken={(token) => (tokenForm = token)}
				onpiecevisibility={(things) =>
					(visibilityOf = { kind: 'piece', ids: things.map((thing) => thing.id) })}
				onhand={(at) => {
					// A display is nobody at the table: it holds nothing.
					if (!display) live.hold(at && { mapId: world.map.id, ...at });
				}}
				onping={(x, y) => live.ping({ mapId: world.map.id, x, y })}
			/>

			<DisplayLettering {display} trail={world.trail} {mapUrl} {date} {displayInvite} />

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
					<TableCorner
						{isGm}
						{date}
						online={live.online}
						{battle}
						meId={data.me.id}
						{saveDate}
					/>
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
								belt.battleTool = 'pan';
								selectedIds = [id];
							}}
							onchange={setTurns}
							onnext={passTurn}
							onback={backTurn}
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
				<BattleTools
					{battleTool}
					{fogging}
					bind:toolsFolded
					{isGm}
					bind:pen
					bind:ink
					{pick}
					{myTokens}
					{myTurn}
					{goToMine}
					onsetup={() => (setup = true)}
					fogOn={world.map.fog.on}
					{pickFog}
					{fogTools}
				/>
			{:else if !display}
				<WorldTools
					{isGm}
					{fogTool}
					tools={WORLD_TOOLS}
					fogOn={world.map.fog.on}
					{pickWorldFog}
					{fogTools}
				/>
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
				<KnockBanner {isGm} knocks={live.knocks} {answerKnock} />

				<NoticeToast {notice} onundo={undo} ondismiss={notices.dismiss} />

				{#if battle && battleTool === 'align'}
					<!-- The grid is being lined up: once a box has been dragged over the
					     squares of the map's picture, how many of them it covers, and
					     the grid that makes, which is on the map to be looked at. -->
					<AlignBar {alignGrid} bind:alignCount {keepAlignment} {putAway} />
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
					<MarkerFilter
						{hiddenTypes}
						{typeCounts}
						{regionsHidden}
						regionCount={world.regions.length}
						{toggleType}
						{hideRegions}
						{hideTypes}
					/>
				{/if}
				<WorldBar
					busy={!!placing || drawing}
					{putAway}
					{isGm}
					onnote={() => startPlacing({ create: 'player' })}
					onmarker={() => startPlacing({ create: 'world' })}
					{filterHint}
					filtered={hiddenTypes.length > 0 || regionsHidden}
					bind:filterOpen
					{startRegion}
				/>
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
		{players}
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
			: `Visibility of ${visibilityThings.length} ${visibilityOf.kind === 'piece' ? 'thing' : visibilityOf.kind}s`}
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
		{units}
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
		outer={{ units: world.units, diagonal: world.diagonal }}
		onsubmit={async (changes) => {
			const saved = await run({ t: 'map.update', id: world.map.id, ...changes });
			// With no scale left to go by, the ruler goes back in the drawer.
			if (saved && changes.miles === null) belt.measuring = false;
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
		{campaignId}
		campaignName={data.campaign.name}
		displayUrl="/c/{campaignId}/m/{world.map.id}?display"
		oncopied={(ok) =>
			ok
				? say('Invite link copied to the clipboard.', 'success')
				: say('Copy the link from the box.', 'warning')}
		onseats={() => {
			inviting = false;
			seating = true;
		}}
		onclose={() => (inviting = false)}
	/>
{/if}

{#if seating && isGm}
	<!-- A seat made, renamed or taken away changes who the GM can hand a token
	     to or let in on a secret: the page asks for its players again. -->
	<SeatsDialog
		{campaignId}
		online={live.online}
		onchange={() => refreshAll()}
		oninvite={() => {
			seating = false;
			inviting = true;
		}}
		onclose={() => (seating = false)}
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
