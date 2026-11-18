<script lang="ts">
	// The map itself: pan, zoom, regions you can step into, and markers that
	// explain themselves. No map library, just one transformed layer.
	//
	// Markers and regions live in map space (0..1 across the image). The
	// `view` turns map space into screen pixels: screen = map * size * k + offset.

	import { untrack } from 'svelte';
	import {
		mapImageUrl,
		markerType,
		type Cursor,
		type MapInfo,
		type Marker,
		type Point,
		type Region,
		type Role
	} from '#lib/shared/types.ts';
	import MarkerCard from './MarkerCard.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';

	interface Props {
		map: MapInfo;
		regions: Region[];
		markers: Marker[];
		/** Where the other people looking at this map are pointing. */
		cursors: Cursor[];
		role: Role;
		userId: string;
		/** GM edit mode: regions can be selected and reshaped. */
		editing: boolean;
		/** `place` waits for a click that positions a marker, `draw` outlines a region. */
		tool: 'pan' | 'place' | 'draw';
		/** How many maps deep this one is. Decides which way the arrival animation zooms. */
		depth: number;
		selectedMarkerId: string | null;
		selectedRegionId: string | null;
		onplace: (x: number, y: number) => void;
		ondrawn: (points: Point[]) => void;
		onenter: (region: Region) => void;
		onreshape: (region: Region, points: Point[]) => Promise<boolean>;
		onedit: (marker: Marker) => void;
		onmove: (marker: Marker) => void;
		ondelete: (marker: Marker) => void;
		onhide: (marker: Marker, hidden: boolean) => void;
		/** Where this browser's mouse is on the map, or null when it is not over it. */
		oncursor: (at: Point | null) => void;
	}

	let {
		map,
		regions,
		markers,
		cursors,
		role,
		userId,
		editing,
		tool,
		depth,
		selectedMarkerId = $bindable(),
		selectedRegionId = $bindable(),
		onplace,
		ondrawn,
		onenter,
		onreshape,
		onedit,
		onmove,
		ondelete,
		onhide,
		oncursor
	}: Props = $props();

	interface View {
		x: number;
		y: number;
		k: number;
	}

	const PIN_HEIGHT = 44;

	let viewport = $state<HTMLDivElement>();
	let surface = $state<HTMLDivElement>();
	let world = $state<HTMLDivElement>();
	let cw = $state(0);
	let ch = $state(0);
	let view = $state.raw<View>({ x: 0, y: 0, k: 1 });
	let ready = $state(false);
	let dragging = $state(false);
	let hoveredMarkerId = $state<string | null>(null);
	let hoveredRegionId = $state<string | null>(null);
	let draft = $state<Point[]>([]);
	let cursor = $state<Point | null>(null);
	/** A region's corners while one of them is being dragged, before the server confirms. */
	let reshape = $state<{ id: string; points: Point[] } | null>(null);
	let cardW = $state(0);
	let cardH = $state(0);

	const W = $derived(map.width);
	const H = $derived(map.height);
	const image = $derived(mapImageUrl(map));
	const fitK = $derived(cw > 0 && ch > 0 ? Math.min(cw / W, ch / H) * 0.94 : 1);
	const minK = $derived(fitK * 0.5);
	const maxK = $derived(Math.max(fitK * 16, 4));

	// Small regions go on top, so a district inside a larger outline stays reachable.
	const orderedRegions = $derived(
		[...regions].sort((a, b) => boundsOf(b.points).area - boundsOf(a.points).area)
	);
	const orderedMarkers = $derived([...markers].sort((a, b) => a.y - b.y));
	const selectedRegion = $derived(regions.find((r) => r.id === selectedRegionId) ?? null);
	/** The region whose name is lit, because the mouse is over it. */
	const litRegionId = $derived(tool === 'pan' ? hoveredRegionId : null);

	// Markers take priority over the region beneath them: they sit above the
	// regions and get the pointer first, so hovering one shows its card.
	const active = $derived.by(() => {
		if (tool !== 'pan') return null;
		const id = hoveredMarkerId ?? selectedMarkerId;
		return markers.find((m) => m.id === id) ?? null;
	});

	const cardPosition = $derived.by(() => {
		if (!active) return null;
		const sx = active.x * W * view.k + view.x;
		const sy = active.y * H * view.k + view.y;
		if (sx < -30 || sx > cw + 30 || sy < -30 || sy > ch + PIN_HEIGHT + 30) return null;
		const above = sy - PIN_HEIGHT - 12 - cardH >= 6;
		return {
			left: Math.min(Math.max(sx - cardW / 2, 8), Math.max(8, cw - cardW - 8)),
			top: above ? sy - PIN_HEIGHT - 12 - cardH : Math.min(sy + 12, Math.max(6, ch - cardH - 6))
		};
	});

	function boundsOf(points: Point[]) {
		const xs = points.map((p) => p[0]);
		const ys = points.map((p) => p[1]);
		const x0 = Math.min(...xs);
		const x1 = Math.max(...xs);
		const y0 = Math.min(...ys);
		const y1 = Math.max(...ys);
		return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, area: (x1 - x0) * (y1 - y0) };
	}

	function pointsOf(region: Region): Point[] {
		return reshape && reshape.id === region.id ? reshape.points : region.points;
	}

	const within = (value: number, low: number, high: number) =>
		Math.min(high, Math.max(low, value));

	/**
	 * Where a region's name goes: the middle of its outline. When that is off
	 * screen the name slides to the nearest spot that is still on screen and
	 * still over the region, so a region you have zoomed into keeps its name.
	 */
	function labelSpot(points: Point[]): Point {
		const b = boundsOf(points);
		const sx = view.k * W;
		const sy = view.k * H;
		// Room for the name itself, and for the toolbars that float over the
		// top and bottom of the map.
		const mx = Math.min(170, cw / 2);
		const my = Math.min(80, ch / 2);
		return [
			within(within(b.cx, (mx - view.x) / sx, (cw - mx - view.x) / sx), b.x0, b.x1),
			within(within(b.cy, (my - view.y) / sy, (ch - my - view.y) / sy), b.y0, b.y1)
		];
	}

	function svgPoints(points: Point[]): string {
		return points.map(([x, y]) => `${x * W},${y * H}`).join(' ');
	}

	// -------------------------------------------------------------- the view

	function fitted(): View {
		return { k: fitK, x: (cw - W * fitK) / 2, y: (ch - H * fitK) / 2 };
	}

	/** Keeps at least a strip of the map on screen, so it can't be lost. */
	function bounded(next: View): View {
		const margin = 80;
		return {
			k: next.k,
			x: Math.min(cw - margin, Math.max(margin - W * next.k, next.x)),
			y: Math.min(ch - margin, Math.max(margin - H * next.k, next.y))
		};
	}

	function zoomedAt(cx: number, cy: number, k: number): View {
		k = Math.min(maxK, Math.max(minK, k));
		const wx = (cx - view.x) / view.k;
		const wy = (cy - view.y) / view.k;
		return bounded({ k, x: cx - wx * k, y: cy - wy * k });
	}

	/** True while the view is the automatic fit, false once the user has moved it. */
	let fitting = true;
	let frame = 0;
	let settle: (() => void) | null = null;
	let fade: Animation | null = null;

	function stopAnimation() {
		cancelAnimationFrame(frame);
		settle?.();
		settle = null;
	}

	function calm(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function animateTo(target: View, ms: number): Promise<void> {
		stopAnimation();
		if (calm()) {
			view = target;
			return Promise.resolve();
		}
		const from = view;
		const start = performance.now();
		return new Promise((resolve) => {
			settle = resolve;
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / ms);
				const e = 1 - (1 - t) ** 3;
				view = {
					x: from.x + (target.x - from.x) * e,
					y: from.y + (target.y - from.y) * e,
					k: from.k + (target.k - from.k) * e
				};
				if (t < 1) {
					frame = requestAnimationFrame(step);
				} else {
					settle = null;
					resolve();
				}
			};
			frame = requestAnimationFrame(step);
		});
	}

	function fadeWorld(from: number, to: number, ms: number) {
		fade?.cancel();
		fade = calm()
			? null
			: (world?.animate([{ opacity: from }, { opacity: to }], {
					duration: ms,
					easing: 'ease-in-out',
					fill: 'forwards'
				}) ?? null);
	}

	/** Zooms into a region until it fills the screen. Used just before stepping inside. */
	export async function flyTo(region: Region) {
		const b = boundsOf(region.points);
		const k = Math.min(cw / Math.max(1, (b.x1 - b.x0) * W), ch / Math.max(1, (b.y1 - b.y0) * H));
		fadeWorld(1, 0, 400);
		await animateTo({ k, x: cw / 2 - b.cx * W * k, y: ch / 2 - b.cy * H * k }, 400);
	}

	/** Back to the whole map, for when a transition was started but didn't complete. */
	export function reset() {
		fade?.cancel();
		fit();
	}

	function zoomBy(factor: number) {
		fitting = false;
		animateTo(zoomedAt(cw / 2, ch / 2, view.k * factor), 180);
	}

	function fit() {
		fitting = true;
		animateTo(fitted(), 250);
	}

	// Fit the map when it first appears, and play an arrival when it changes:
	// going deeper zooms in out of the region you entered, going back up
	// pulls away.
	let shown = { key: '', id: '', depth: 0 };
	$effect(() => {
		const key = `${map.id}:${W}x${H}`;
		if (cw === 0 || ch === 0) return;
		untrack(() => {
			if (key === shown.key) {
				// Same map, new space around it (a panel opened, the window
				// resized). Follow along unless the user has their own view.
				if (fitting && !settle) view = fitted();
				return;
			}
			fitting = true;
			const target = fitted();
			if (shown.id === '' || shown.id === map.id) {
				stopAnimation();
				view = target;
			} else {
				const scale = depth >= shown.depth ? 0.6 : 1.5;
				view = {
					k: target.k * scale,
					x: cw / 2 - (cw / 2 - target.x) * scale,
					y: ch / 2 - (ch / 2 - target.y) * scale
				};
				fadeWorld(0, 1, 350);
				animateTo(target, 450);
			}
			if (shown.id !== map.id) clearHover();
			shown = { key, id: map.id, depth };
			ready = true;
		});
	});

	// ------------------------------------------------------------- gestures

	type Gesture =
		| {
				type: 'pan';
				sx: number;
				sy: number;
				vx: number;
				vy: number;
				moved: boolean;
				target: Element;
		  }
		| { type: 'pinch'; distance: number; k: number; wx: number; wy: number }
		| { type: 'vertex'; region: Region; index: number; moved: boolean };

	const pointers = new Map<number, { x: number; y: number }>();
	let gesture: Gesture | null = null;
	let lastTap = { at: 0, x: 0, y: 0, regionId: null as string | null };

	function toMap(clientX: number, clientY: number): Point {
		const rect = viewport!.getBoundingClientRect();
		return [
			(clientX - rect.left - view.x) / (view.k * W),
			(clientY - rect.top - view.y) / (view.k * H)
		];
	}

	const inside = ([x, y]: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
	const clamped = ([x, y]: Point): Point => [
		Math.min(1, Math.max(0, x)),
		Math.min(1, Math.max(0, y))
	];

	/** Keeps a drag alive when the pointer leaves the map. Losing capture only costs that. */
	function capture(pointerId: number) {
		try {
			surface!.setPointerCapture(pointerId);
		} catch {
			// the pointer is already gone
		}
	}

	function midpoint() {
		const [a, b] = [...pointers.values()];
		const rect = viewport!.getBoundingClientRect();
		return {
			x: (a.x + b.x) / 2 - rect.left,
			y: (a.y + b.y) / 2 - rect.top,
			distance: Math.hypot(a.x - b.x, a.y - b.y) || 1
		};
	}

	/**
	 * Hover follows whatever is under the mouse right now. A marker sits
	 * above the region it stands in, so hovering one never lights the region.
	 */
	function trackHover(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		const target = e.target as Element;
		const markerId = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId ?? null;
		hoveredMarkerId = markerId;
		hoveredRegionId = markerId
			? null
			: (target.closest<SVGElement>('[data-region-id]')?.dataset.regionId ?? null);
	}

	function clearHover() {
		cursor = null;
		hoveredMarkerId = null;
		hoveredRegionId = null;
	}

	// ------------------------------------------------------------- pointers

	/** Where this browser's mouse is over the map, in client pixels. */
	let mouse: { x: number; y: number } | null = null;

	function followMouse(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		mouse = { x: e.clientX, y: e.clientY };
		reportCursor();
	}

	function reportCursor() {
		oncursor(mouse && viewport && ready ? toMap(mouse.x, mouse.y) : null);
	}

	// The map can move under a mouse that is holding still: a zoom, an
	// arrival, stepping into another map. The mouse is then over a different
	// spot, and the table should see that too.
	$effect(() => {
		void [view, W, H, map.id, ready];
		untrack(reportCursor);
	});

	$effect(() => () => oncursor(null));

	// Each person keeps one colour for as long as this page is open. The GM's
	// is the gold of everything else that is the GM's.
	const TINTS = [
		'#ff7a90',
		'#5cc8ff',
		'#7be495',
		'#c79bff',
		'#4fe0d0',
		'#ff8ad8',
		'#c3e24f',
		'#8fa2ff'
	];
	const tints = new Map<string, string>();

	function tintOf(other: Cursor): string {
		if (other.role === 'gm') return 'var(--color-accent)';
		let tint = tints.get(other.userId);
		if (!tint) tints.set(other.userId, (tint = TINTS[tints.size % TINTS.length]));
		return tint;
	}

	function onpointerdown(e: PointerEvent) {
		trackHover(e);
		followMouse(e);
		if (e.pointerType === 'mouse') {
			if (e.button !== 0) return;
			pointers.clear();
		}
		stopAnimation();
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 2) {
			const mid = midpoint();
			gesture = {
				type: 'pinch',
				distance: mid.distance,
				k: view.k,
				wx: (mid.x - view.x) / view.k,
				wy: (mid.y - view.y) / view.k
			};
			return;
		}
		if (pointers.size > 2) return;

		const target = e.target as Element;
		const handle = target.closest<SVGElement>('[data-vertex]');
		if (handle && selectedRegion) {
			reshape = {
				id: selectedRegion.id,
				points: pointsOf(selectedRegion).map(([x, y]) => [x, y] as Point)
			};
			gesture = {
				type: 'vertex',
				region: selectedRegion,
				index: Number(handle.dataset.vertex),
				moved: false
			};
			capture(e.pointerId);
			return;
		}
		gesture = {
			type: 'pan',
			sx: e.clientX,
			sy: e.clientY,
			vx: view.x,
			vy: view.y,
			moved: false,
			target
		};
	}

	function onpointermove(e: PointerEvent) {
		if (tool === 'draw' && e.pointerType === 'mouse') cursor = toMap(e.clientX, e.clientY);
		trackHover(e);
		followMouse(e);

		const pointer = pointers.get(e.pointerId);
		if (!pointer) return;
		// The button came up somewhere this element never heard about.
		if (e.pointerType === 'mouse' && e.buttons === 0) return release(e, false);
		pointer.x = e.clientX;
		pointer.y = e.clientY;

		const g = gesture;
		if (g?.type === 'pinch' && pointers.size >= 2) {
			const mid = midpoint();
			fitting = false;
			const k = Math.min(maxK, Math.max(minK, (g.k * mid.distance) / g.distance));
			view = bounded({ k, x: mid.x - g.wx * k, y: mid.y - g.wy * k });
		} else if (g?.type === 'pan') {
			const dx = e.clientX - g.sx;
			const dy = e.clientY - g.sy;
			if (!g.moved && Math.hypot(dx, dy) > (e.pointerType === 'mouse' ? 4 : 10)) {
				// Capture only once a drag is certain. Capturing on press
				// would swallow the hover state of whatever was pressed.
				g.moved = true;
				fitting = false;
				dragging = true;
				capture(e.pointerId);
			}
			if (g.moved) view = bounded({ k: view.k, x: g.vx + dx, y: g.vy + dy });
		} else if (g?.type === 'vertex' && reshape) {
			g.moved = true;
			reshape.points[g.index] = clamped(toMap(e.clientX, e.clientY));
		}
	}

	function release(e: PointerEvent, completed: boolean) {
		if (!pointers.delete(e.pointerId)) return;
		const g = gesture;

		if (g?.type === 'pinch') {
			// One finger is still down: carry on as a pan from where it is.
			const rest = [...pointers.values()][0];
			gesture = rest
				? {
						type: 'pan',
						sx: rest.x,
						sy: rest.y,
						vx: view.x,
						vy: view.y,
						moved: true,
						target: surface!
					}
				: null;
			return;
		}

		gesture = null;
		dragging = false;
		if (g?.type === 'pan' && !g.moved && completed) tap(e, g.target);
		if (g?.type === 'vertex') {
			const pending = reshape;
			if (g.moved && completed && pending) {
				const points = pending.points.map(([x, y]) => [x, y] as Point);
				onreshape(g.region, points).then((ok) => {
					if (!ok && reshape === pending) reshape = null;
				});
			} else {
				reshape = null;
			}
		}
	}

	// Once the server's version of a reshaped region arrives, drop the local one.
	$effect(() => {
		void selectedRegion?.points;
		untrack(() => {
			if (gesture?.type !== 'vertex') reshape = null;
		});
	});

	function tap(e: PointerEvent, target: Element) {
		const point = toMap(e.clientX, e.clientY);
		const now = performance.now();
		const double =
			now - lastTap.at < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28;

		if (tool === 'place') {
			if (inside(point)) onplace(point[0], point[1]);
			return;
		}

		if (tool === 'draw') {
			if (draft.length >= 3 && (double || nearFirstCorner(e))) return finishDraft();
			if (!double && inside(point)) draft.push(point);
			lastTap = { at: now, x: e.clientX, y: e.clientY, regionId: null };
			return;
		}

		const markerId = target.closest<HTMLElement>('[data-marker-id]')?.dataset.markerId;
		if (markerId) {
			selectedMarkerId = selectedMarkerId === markerId ? null : markerId;
			selectedRegionId = null;
			lastTap.at = 0;
			return;
		}

		const regionId = target.closest<SVGElement>('[data-region-id]')?.dataset.regionId ?? null;
		const region = regions.find((r) => r.id === regionId);
		selectedMarkerId = null;

		if (region && double && lastTap.regionId === region.id) {
			lastTap.at = 0;
			hoveredRegionId = null;
			onenter(region);
			return;
		}
		selectedRegionId = region && editing ? region.id : null;
		// Touch has no hover, so the first tap is what names the region.
		if (e.pointerType !== 'mouse') hoveredRegionId = region?.id ?? null;
		lastTap = { at: now, x: e.clientX, y: e.clientY, regionId: region?.id ?? null };
	}

	// ------------------------------------------------------ drawing regions

	function nearFirstCorner(e: PointerEvent): boolean {
		const rect = viewport!.getBoundingClientRect();
		const [x, y] = draft[0];
		const sx = x * W * view.k + view.x + rect.left;
		const sy = y * H * view.k + view.y + rect.top;
		return Math.hypot(e.clientX - sx, e.clientY - sy) < 14;
	}

	function finishDraft() {
		const points = draft.map(([x, y]) => [x, y] as Point);
		draft = [];
		cursor = null;
		ondrawn(points);
	}

	$effect(() => {
		if (tool !== 'draw') {
			draft = [];
			cursor = null;
		}
	});

	function onkeydown(e: KeyboardEvent) {
		if (tool !== 'draw') return;
		if (e.target instanceof Element && e.target.closest('input, textarea, select, dialog')) return;
		if (e.key === 'Enter' && draft.length >= 3) {
			e.preventDefault();
			finishDraft();
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			draft.pop();
		}
	}

	// Wheel listeners added through the template can be passive, and a
	// passive listener can't stop the page from scrolling.
	$effect(() => {
		const element = surface;
		if (!element) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			stopAnimation();
			fitting = false;
			const rect = viewport!.getBoundingClientRect();
			const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			// Trackpad pinches arrive as small ctrl+wheel deltas.
			const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0016));
			view = zoomedAt(e.clientX - rect.left, e.clientY - rect.top, view.k * factor);
		};
		element.addEventListener('wheel', onwheel, { passive: false });
		return () => element.removeEventListener('wheel', onwheel);
	});

	/** Keyboard control of the view, for when the map itself has focus. */
	function onsurfacekeydown(e: KeyboardEvent) {
		if (e.target !== surface) return;
		const step = 80;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const move = moves[e.key];
		if (move) {
			fitting = false;
			stopAnimation();
			view = bounded({ k: view.k, x: view.x + move[0], y: view.y + move[1] });
		} else if (e.key === '+' || e.key === '=') {
			zoomBy(1.6);
		} else if (e.key === '-') {
			zoomBy(1 / 1.6);
		} else if (e.key === '0') {
			fit();
		} else {
			return;
		}
		e.preventDefault();
	}

	function toggleMarker(e: KeyboardEvent, marker: Marker) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		selectedMarkerId = selectedMarkerId === marker.id ? null : marker.id;
	}

	// ---------------------------------------------------------------- looks

	// How a region's outline is drawn. One of these at a time: selected beats
	// hovered, hovered beats the rest.
	const OUTLINE = {
		idle: 'fill-transparent stroke-[#fff8e4]/90 stroke-[1.5] [stroke-dasharray:7_6]',
		editing: 'fill-transparent stroke-[#f2c14e] stroke-[1.5] [stroke-dasharray:7_6]',
		hover: 'fill-accent/22 stroke-accent stroke-[2.5]',
		selected: 'fill-accent/14 stroke-white stroke-[2.5]'
	};

	function outlineOf(region: Region): string {
		if (selectedRegionId === region.id) return OUTLINE.selected;
		if (hoveredRegionId === region.id) return OUTLINE.hover;
		return editing ? OUTLINE.editing : OUTLINE.idle;
	}

	/** The instruction shown at the top while a tool is waiting for a click. */
	const hint =
		'absolute top-3.5 left-1/2 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-full border border-accent bg-night/90 px-3.5 py-2 text-center text-sm';
	const zoomButton = 'h-9 w-9.5 cursor-pointer hover:bg-panel-2';
</script>

<svelte:window {onkeydown} />

<div
	class="relative h-full w-full overflow-hidden bg-[#0b0d12] bg-[radial-gradient(ellipse_at_center,#1a2030_0%,#0b0d12_75%)]"
	bind:this={viewport}
	bind:clientWidth={cw}
	bind:clientHeight={ch}
>
	<!-- The map is a custom widget: it takes focus so it can be panned and zoomed from the keyboard. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class={[
			'absolute inset-0 touch-none select-none focus-visible:-outline-offset-2',
			tool !== 'pan' ? 'cursor-crosshair' : dragging ? 'cursor-grabbing' : 'cursor-grab'
		]}
		data-tool={tool}
		bind:this={surface}
		role="application"
		aria-label="Map of {map.name}. Arrow keys pan, plus and minus zoom, zero fits the map."
		tabindex="0"
		onkeydown={onsurfacekeydown}
		{onpointerdown}
		{onpointermove}
		onpointerup={(e) => release(e, true)}
		onpointercancel={(e) => release(e, false)}
		onpointerleave={() => {
			clearHover();
			mouse = null;
			reportCursor();
		}}
	>
		<!-- Everything inside scales with the map. --inv undoes that scale, for
		     the things that should stay the same size on screen: scale-(--inv). -->
		<div
			class={['absolute top-0 left-0 origin-top-left', !ready && 'invisible']}
			bind:this={world}
			style:width="{W}px"
			style:height="{H}px"
			style:transform="translate({view.x}px, {view.y}px) scale({view.k})"
			style:--inv={1 / view.k}
		>
			{#if image}
				<img
					class="block h-full w-full rounded-[3px] shadow-map [-webkit-user-drag:none]"
					src={image}
					alt=""
					width={W}
					height={H}
					draggable="false"
				/>
			{:else}
				<div
					class="grid h-full w-full place-content-center gap-2.5 rounded-[3px] bg-parchment text-center text-[#6d5f43] shadow-map"
				>
					<strong class="font-serif text-[64px] font-semibold text-[#4d4129]">{map.name}</strong>
					<span class="text-[22px]">No map image yet</span>
				</div>
			{/if}

			<svg
				class="pointer-events-none absolute inset-0 overflow-visible"
				viewBox="0 0 {W} {H}"
				width={W}
				height={H}
				aria-hidden="true"
			>
				{#each orderedRegions as region (region.id)}
					<!-- A dark line under the outline, so it reads on a pale map too. -->
					<polygon
						class="fill-none stroke-[#0c0e14]/50 stroke-[4] stroke-steady"
						points={svgPoints(pointsOf(region))}
					/>
					<polygon
						data-region-id={region.id}
						points={svgPoints(pointsOf(region))}
						class={[
							'stroke-steady transition-[fill,stroke] duration-150',
							tool === 'pan' ? 'cursor-pointer [pointer-events:visible]' : 'pointer-events-none',
							outlineOf(region)
						]}
					/>
				{/each}

				{#if draft.length}
					<polyline
						class="fill-accent/15 stroke-accent stroke-2 stroke-steady"
						points={svgPoints(cursor ? [...draft, cursor] : draft)}
					/>
					{#each draft as [x, y], i (i)}
						<circle
							class={[
								'stroke-accent-ink stroke-[1.5] stroke-steady',
								i === 0 && draft.length >= 3 ? 'fill-white' : 'fill-accent'
							]}
							cx={x * W}
							cy={y * H}
							r={(i === 0 ? 7 : 4) / view.k}
						/>
					{/each}
				{/if}

				{#if editing && selectedRegion && tool === 'pan'}
					{#each pointsOf(selectedRegion) as [x, y], i (i)}
						<circle
							class="cursor-move fill-white stroke-accent-ink stroke-[1.5] stroke-steady [pointer-events:visible]"
							data-vertex={i}
							cx={x * W}
							cy={y * H}
							r={7 / view.k}
						/>
					{/each}
				{/if}
			</svg>

			<!-- Every region wears its name, lettered straight onto the map like a place
			     name in an atlas: quiet until the region is hovered, and never boxed in.
			     It comes before the markers, so it is never drawn over one, and it never
			     takes the pointer, so the outline beneath it still does. -->
			{#each orderedRegions as region (region.id)}
				{@const [x, y] = labelSpot(pointsOf(region))}
				{@const lit = litRegionId === region.id}
				<div
					class="pointer-events-none absolute w-max max-w-[300px] -translate-1/2 scale-(--inv) text-center text-shadow-map"
					style:left="{x * W}px"
					style:top="{y * H}px"
				>
					<strong
						class={[
							'block font-serif text-[17px] leading-[1.2] font-semibold tracking-[0.02em] wrap-anywhere transition-[opacity,color] duration-150',
							lit ? 'text-white' : 'text-[#fff8e4] opacity-55'
						]}>{region.name}</strong
					>
					{#if lit}
						<!-- How to get in. Out of the flow, so the name does not jump when it appears. -->
						<span
							class="absolute top-[calc(100%+2px)] left-1/2 -translate-x-1/2 text-xs whitespace-nowrap text-[#e4dcc6]"
						>
							<span class="touch:hidden">Double-click to enter</span>
							<span class="hidden touch:inline">Double-tap to enter</span>
						</span>
					{/if}
				</div>
			{/each}

			<!-- Pins live in the scaled layer, so they follow the map for free. World
			     markers are teardrops in their type's colour (--c). Table notes look
			     like paper tags, so the two can be told apart at a glance. -->
			{#each orderedMarkers as marker (marker.id)}
				{@const type = markerType(marker.type)}
				{@const selected = selectedMarkerId === marker.id}
				{@const raised = active?.id === marker.id}
				{@const shape = [
					'block',
					selected ? 'pin-selected' : 'pin-shadow group-focus-visible:pin-focused',
					marker.hidden && 'opacity-55'
				]}
				<button
					class={[
						'group absolute origin-bottom -translate-x-1/2 -translate-y-full scale-(--inv) cursor-pointer text-[#12151c] [-webkit-tap-highlight-color:transparent] focus-visible:outline-none',
						(selected || raised) && 'z-1',
						tool !== 'pan' && 'pointer-events-none opacity-60'
					]}
					data-marker-id={marker.id}
					style:left="{marker.x * W}px"
					style:top="{marker.y * H}px"
					style:--c={type.color}
					aria-label="{type.label}: {marker.title}{marker.hidden ? ' (hidden from players)' : ''}"
					aria-pressed={selectedMarkerId === marker.id}
					tabindex={tool === 'pan' ? 0 : -1}
					onfocus={() => (hoveredMarkerId = marker.id)}
					onblur={() => hoveredMarkerId === marker.id && (hoveredMarkerId = null)}
					onkeydown={(e) => toggleMarker(e, marker)}
				>
					<span
						class={[
							'relative block origin-bottom transition-transform duration-120 group-hover:scale-115',
							raised && 'scale-115'
						]}
					>
						{#if marker.kind === 'world'}
							<svg class={shape} viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
								<path
									class={['fill-(--c) stroke-[#12151c] stroke-[1.5]', marker.hidden && '[stroke-dasharray:3_2.5]']}
									d="M16 41C16 41 3 26.5 3 15.5a13 13 0 0 1 26 0C29 26.5 16 41 16 41Z"
								/>
							</svg>
						{:else}
							<svg class={shape} viewBox="0 0 34 38" width="34" height="38" aria-hidden="true">
								<path
									class="fill-[#f4e7c3] stroke-(color:--c) stroke-[2.5]"
									d="M7 2h20a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5h-5.5L17 37l-4.5-8H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z"
								/>
							</svg>
						{/if}
						<span
							class={[
								'absolute top-[7.5px] left-1/2 flex -translate-x-1/2',
								marker.kind === 'player' && 'text-[#4a3b18]'
							]}
						>
							<MarkerGlyph type={marker.type} size={16} />
						</span>
					</span>
				</button>
			{/each}

			<!-- Everyone else's mouse, each in its own colour (--c). On top of the map,
			     and never in the way of your own. Only the position glides from one
			     report to the next, not the size in a zoom. -->
			{#each cursors as other (other.id)}
				<div
					class="pointer-events-none absolute top-0 left-0 z-3 flex origin-top-left scale-(--inv) items-start transition-[translate] duration-80 ease-linear motion-reduce:transition-none"
					style:translate="{other.x * W}px {other.y * H}px"
					style:--c={tintOf(other)}
					aria-hidden="true"
				>
					<!-- The negative margins put the tip of the arrow exactly on the spot. -->
					<svg
						class="-mt-[1.5px] -ml-0.5 shrink-0 drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
						viewBox="0 0 18 22"
						width="18"
						height="22"
					>
						<path
							class="fill-(--c) stroke-[#12151c] stroke-[1.5] [stroke-linejoin:round]"
							d="M2 1.5v16l4.4-4 2.9 6.6 2.7-1.2-2.9-6.5h6Z"
						/>
					</svg>
					<span
						class="mt-[17px] -ml-[3px] max-w-[150px] truncate rounded-[3px_9px_9px_9px] bg-(--c) px-[7px] text-xs leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]"
						>{other.name}</span
					>
				</div>
			{/each}
		</div>
	</div>

	<!-- What floats over the map. Only the parts that ask for the pointer get it. -->
	<div class="pointer-events-none absolute inset-0">
		{#if active && cardPosition}
			{@const pinned = active.id === selectedMarkerId}
			<!-- Kept out of sight until its size is known, so it never flashes in the wrong place. -->
			<div
				class={['absolute', cardW === 0 && 'invisible', pinned && 'pointer-events-auto']}
				style:left="{cardPosition.left}px"
				style:top="{cardPosition.top}px"
				bind:clientWidth={cardW}
				bind:clientHeight={cardH}
			>
				<MarkerCard
					marker={active}
					{role}
					{userId}
					{pinned}
					onclose={() => (selectedMarkerId = null)}
					{onedit}
					{onmove}
					{ondelete}
					{onhide}
				/>
			</div>
		{/if}

		{#if tool === 'draw'}
			<p class={hint}>
				{#if draft.length < 3}
					Click to mark the corners of the region.
				{:else}
					Click the first corner or press Enter to finish.
				{/if}
				<span class="ml-1.5 text-muted">Backspace removes a corner · Esc cancels</span>
			</p>
		{:else if tool === 'place'}
			<p class={hint}>
				Click the map where it belongs. <span class="ml-1.5 text-muted">Esc cancels</span>
			</p>
		{/if}

		<div
			class="pointer-events-auto absolute right-3.5 bottom-3.5 grid overflow-hidden rounded-[10px] border bg-panel"
		>
			<button class="{zoomButton} border-b text-[19px]" aria-label="Zoom in" onclick={() => zoomBy(1.6)}>
				+
			</button>
			<button
				class="{zoomButton} border-b text-[19px]"
				aria-label="Zoom out"
				onclick={() => zoomBy(1 / 1.6)}
			>
				−
			</button>
			<button class="{zoomButton} text-xs" aria-label="Fit the whole map" onclick={fit}>Fit</button>
		</div>
	</div>
</div>
