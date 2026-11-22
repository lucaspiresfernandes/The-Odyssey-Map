// How a map lies on the screen, and how it is moved about: the view, what
// fits, how far it zooms, and the animations that take it from one view to
// another. The map canvas has one of these, and so does everything that
// needs to know where on the map a spot of the screen is.

import type { Point } from '#lib/shared/types.ts';
import type { View } from './mapview.ts';

/** What the stage needs to know of the map on it. */
export interface Sheet {
	/** The size of the map, in its own pixels. */
	W: number;
	H: number;
	/**
	 * How many pixels of the map one pixel of its picture covers, or null for
	 * a map with no picture, which is drawn fresh at any size.
	 */
	blownUp: number | null;
}

export const inside = ([x, y]: Point) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

export const clamped = ([x, y]: Point): Point => [
	Math.min(1, Math.max(0, x)),
	Math.min(1, Math.max(0, y))
];

export const within = (value: number, low: number, high: number) =>
	Math.min(high, Math.max(low, value));

function calm(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class Stage {
	/** The box the map is shown in. */
	viewport = $state<HTMLDivElement>();
	/** What takes the pointer. */
	surface = $state<HTMLDivElement>();
	/** The layer that scales with the map. */
	world = $state<HTMLDivElement>();
	/** The size of the viewport, in screen pixels. */
	cw = $state(0);
	ch = $state(0);
	view = $state.raw<View>({ x: 0, y: 0, k: 1 });
	/** True while the view is the automatic fit, false once the user has moved it. */
	fitting = true;

	#sheet: () => Sheet;
	#frame = 0;
	#settle: (() => void) | null = null;
	#fade: Animation | null = null;

	constructor(sheet: () => Sheet) {
		this.#sheet = sheet;
	}

	/** The zoom at which the whole map fits, with a little air around it. */
	readonly fitK = $derived.by(() => {
		const { W, H } = this.#sheet();
		return this.cw > 0 && this.ch > 0 ? Math.min(this.cw / W, this.ch / H) * 0.94 : 1;
	});
	readonly minK = $derived(this.fitK * 0.5);
	// A picture is only so sharp, so the zoom stops at twice its own pixels.
	// A map without one is drawn fresh at any size.
	readonly maxK = $derived.by(() => {
		const { blownUp } = this.#sheet();
		return blownUp !== null
			? Math.max(this.fitK * 2, 2 / blownUp)
			: Math.max(this.fitK * 16, 4);
	});

	/** An animation of the view is under way. */
	get moving(): boolean {
		return this.#settle !== null;
	}

	/** Where on the map a spot of the screen is, in map space. */
	toMap(clientX: number, clientY: number): Point {
		const { W, H } = this.#sheet();
		const rect = this.viewport!.getBoundingClientRect();
		return [
			(clientX - rect.left - this.view.x) / (this.view.k * W),
			(clientY - rect.top - this.view.y) / (this.view.k * H)
		];
	}

	/** Keeps a drag alive when the pointer leaves the map. Losing capture only costs that. */
	capture(pointerId: number) {
		try {
			this.surface!.setPointerCapture(pointerId);
		} catch {
			// the pointer is already gone
		}
	}

	/** The spot between two fingers, in the viewport, and how far apart they are. */
	midpoint(pointers: Map<number, { x: number; y: number }>) {
		const [a, b] = [...pointers.values()];
		const rect = this.viewport!.getBoundingClientRect();
		return {
			x: (a.x + b.x) / 2 - rect.left,
			y: (a.y + b.y) / 2 - rect.top,
			distance: Math.hypot(a.x - b.x, a.y - b.y) || 1
		};
	}

	fitted(): View {
		const { W, H } = this.#sheet();
		return {
			k: this.fitK,
			x: (this.cw - W * this.fitK) / 2,
			y: (this.ch - H * this.fitK) / 2
		};
	}

	/** Keeps at least a strip of the map on screen, so it can't be lost. */
	bounded(next: View): View {
		const { W, H } = this.#sheet();
		const margin = 80;
		return {
			k: next.k,
			x: Math.min(this.cw - margin, Math.max(margin - W * next.k, next.x)),
			y: Math.min(this.ch - margin, Math.max(margin - H * next.k, next.y))
		};
	}

	zoomedAt(cx: number, cy: number, k: number): View {
		const { view } = this;
		k = Math.min(this.maxK, Math.max(this.minK, k));
		const wx = (cx - view.x) / view.k;
		const wy = (cy - view.y) / view.k;
		return this.bounded({ k, x: cx - wx * k, y: cy - wy * k });
	}

	stopAnimation() {
		cancelAnimationFrame(this.#frame);
		this.#settle?.();
		this.#settle = null;
	}

	animateTo(target: View, ms: number): Promise<void> {
		this.stopAnimation();
		if (calm()) {
			this.view = target;
			return Promise.resolve();
		}
		const from = this.view;
		const start = performance.now();
		return new Promise((resolve) => {
			this.#settle = resolve;
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / ms);
				const e = 1 - (1 - t) ** 3;
				this.view = {
					x: from.x + (target.x - from.x) * e,
					y: from.y + (target.y - from.y) * e,
					k: from.k + (target.k - from.k) * e
				};
				if (t < 1) {
					this.#frame = requestAnimationFrame(step);
				} else {
					this.#settle = null;
					resolve();
				}
			};
			this.#frame = requestAnimationFrame(step);
		});
	}

	fadeWorld(from: number, to: number, ms: number) {
		this.#fade?.cancel();
		this.#fade = calm()
			? null
			: (this.world?.animate([{ opacity: from }, { opacity: to }], {
					duration: ms,
					easing: 'ease-in-out',
					fill: 'forwards'
				}) ?? null);
	}

	/** Zooms into the box around some corners until it fills the screen, fading out. */
	async flyInto(points: Point[]) {
		const { W, H } = this.#sheet();
		const xs = points.map((p) => p[0]);
		const ys = points.map((p) => p[1]);
		const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		const k = Math.min(
			this.cw / Math.max(1, (x1 - x0) * W),
			this.ch / Math.max(1, (y1 - y0) * H)
		);
		this.fadeWorld(1, 0, 400);
		await this.animateTo(
			{
				k,
				x: this.cw / 2 - ((x0 + x1) / 2) * W * k,
				y: this.ch / 2 - ((y0 + y1) / 2) * H * k
			},
			400
		);
	}

	/** Back to the whole map, for when a transition was started but didn't complete. */
	reset() {
		this.#fade?.cancel();
		this.fit();
	}

	/** Brings a spot of the map to the middle of the screen, as close up as it is now. */
	centreOn([x, y]: Point) {
		const { W, H } = this.#sheet();
		if (this.cw === 0 || this.ch === 0) return;
		this.fitting = false;
		const k = this.view.k;
		this.animateTo(
			this.bounded({ k, x: this.cw / 2 - x * W * k, y: this.ch / 2 - y * H * k }),
			400
		);
	}

	zoomBy(factor: number) {
		this.fitting = false;
		this.animateTo(this.zoomedAt(this.cw / 2, this.ch / 2, this.view.k * factor), 180);
	}

	fit() {
		this.fitting = true;
		this.animateTo(this.fitted(), 250);
	}
}
