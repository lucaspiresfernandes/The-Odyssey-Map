// The GM's two ways with the outline of a region: drawing a new one, a
// corner at a click, and reshaping the one that is selected by its corners.

import { clamped, inside } from '#lib/client/stage.svelte.ts';
import type { Point, Region } from '#lib/shared/types.ts';
import type { Board, GestureOf } from './board.ts';

interface Hooks {
	/** A region was drawn: these are its corners. */
	ondrawn(points: Point[]): void;
	/** A region was reshaped. Resolves to whether the server took it. */
	onreshape(region: Region, points: Point[]): Promise<boolean>;
}

export class RegionShaper {
	/** The corners of the region being drawn, in the order they were clicked. */
	draft = $state<Point[]>([]);
	/** A region's corners while they are being changed, before the server confirms. */
	reshape = $state<{ id: string; points: Point[] } | null>(null);

	/** The last corner that was clicked without being dragged. A second click removes it. */
	#lastCorner = { at: 0, regionId: '', index: -1 };
	#board: Board;
	#hooks: Hooks;

	constructor(board: Board, hooks: Hooks) {
		this.#board = board;
		this.#hooks = hooks;
	}

	/** A region's corners: as they are being reshaped, or as they are. */
	pointsOf = (region: Region): Point[] =>
		this.reshape && this.reshape.id === region.id ? this.reshape.points : region.points;

	// ----------------------------------------------------- drawing a region

	/**
	 * Whether the pointer is on a corner of the draft. The first one is drawn
	 * larger than the rest, so the others are given a smaller reach.
	 */
	#nearCorner(e: PointerEvent, [x, y]: Point, reach = 1): boolean {
		const { stage, W, H } = this.#board;
		const rect = stage.viewport!.getBoundingClientRect();
		const sx = x * W * stage.view.k + stage.view.x + rect.left;
		const sy = y * H * stage.view.k + stage.view.y + rect.top;
		const within = (e.pointerType === 'mouse' ? 14 : 24) * reach;
		return Math.hypot(e.clientX - sx, e.clientY - sy) < within;
	}

	/** A click with the region tool in hand: another corner, or on the first one, the end of it. */
	tap(e: PointerEvent, point: Point) {
		const draft = this.draft;
		// Only the first corner closes the region. A click on the corner just
		// laid, a double click included, does nothing: it would only stack a
		// second corner on top of it.
		if (draft.length >= 3 && this.#nearCorner(e, draft[0])) return this.finish();
		const last = draft.at(-1);
		if (last && this.#nearCorner(e, last, 0.5)) return;
		if (inside(point)) draft.push(point);
	}

	/** The outline is closed: its corners go to whoever names the region. */
	finish() {
		const points = this.draft.map(([x, y]) => [x, y] as Point);
		this.draft = [];
		this.#hooks.ondrawn(points);
	}

	/** Takes the last corner back. */
	back() {
		this.draft.pop();
	}

	/** The outline being drawn is given up. */
	clear() {
		this.draft = [];
	}

	// --------------------------------------------------- reshaping a region

	/**
	 * A corner of the selected region was pressed, or the dot in the middle
	 * of one of its edges. Null when the press was on neither.
	 */
	press(region: Region, target: Element, e: PointerEvent): GestureOf<'vertex'> | null {
		const corner = target.closest<SVGElement>('[data-vertex]');
		const edge = corner ? null : target.closest<SVGElement>('[data-edge]');
		if (!corner && !edge) return null;
		const points = this.pointsOf(region).map(([x, y]) => [x, y] as Point);
		let index = Number(corner?.dataset.vertex);
		if (edge) {
			// The dot in the middle of an edge: a new corner goes in there, and
			// is dragged from there like any other.
			const from = Number(edge.dataset.edge);
			const [ax, ay] = points[from];
			const [bx, by] = points[(from + 1) % points.length];
			index = from + 1;
			points.splice(index, 0, [(ax + bx) / 2, (ay + by) / 2]);
		}
		this.reshape = { id: region.id, points };
		this.#board.stage.capture(e.pointerId);
		return {
			type: 'vertex',
			region,
			index,
			added: !!edge,
			sx: e.clientX,
			sy: e.clientY,
			moved: false
		};
	}

	drag(g: GestureOf<'vertex'>, e: PointerEvent) {
		if (!this.reshape) return;
		// A press that barely moves is a click, not a drag. It leaves the
		// corner where it is, so that two of them can remove it.
		const slack = e.pointerType === 'mouse' ? 3 : 8;
		if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > slack) g.moved = true;
		if (g.moved) {
			this.reshape.points[g.index] = clamped(this.#board.stage.toMap(e.clientX, e.clientY));
		}
	}

	lift(g: GestureOf<'vertex'>, completed: boolean) {
		const pending = this.reshape;
		const now = performance.now();
		const clicked = completed && !g.moved && !g.added;
		const last = this.#lastCorner;
		const twice =
			clicked && last.regionId === g.region.id && last.index === g.index && now - last.at < 400;
		this.#lastCorner =
			clicked && !twice
				? { at: now, regionId: g.region.id, index: g.index }
				: { at: 0, regionId: '', index: -1 };
		// A corner clicked twice goes, as long as the region keeps three.
		let removed = false;
		if (pending && twice && pending.points.length > 3) {
			pending.points.splice(g.index, 1);
			removed = true;
		}

		if (pending && completed && (g.moved || removed)) {
			const points = pending.points.map(([x, y]) => [x, y] as Point);
			this.#hooks.onreshape(g.region, points).then((ok) => {
				if (!ok && this.reshape === pending) this.reshape = null;
			});
		} else {
			this.reshape = null;
		}
	}
}
