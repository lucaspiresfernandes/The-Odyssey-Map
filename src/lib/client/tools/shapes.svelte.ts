// The shapes laid on a battle map to mark out the area of a spell, and the
// tokens each of them catches. Which tokens a shape catches is worked out
// here, from the tokens this browser has: nothing about it is sent or kept.

import type { LaidTemplate } from '#lib/client/mapview.ts';
import { templateHolds, templateSpan } from '#lib/shared/drawing.ts';
import { feetCount, pixelsToFeet } from '#lib/shared/grid.ts';
import {
	isTemplate,
	type Drawing,
	type Point,
	type TemplateKind,
	type Token,
	type Units
} from '#lib/shared/types.ts';
import type { Board } from './board.ts';

interface Looks {
	/** The hand is out: what is on the map can be selected. */
	selecting(): boolean;
	/** Where a token is drawn: in a hand if it is in one, or where it stands. */
	spotOf(token: Token): Point;
	/** How far from where it is kept a drawing is drawn, while it is in hand. */
	shiftOf(drawing: Drawing): Point;
	/** The template being dragged out, as it will be kept. */
	casted(): [Point, Point] | null;
	/** Which template the pen lays down. */
	shape(): TemplateKind;
	/** How many tokens are selected. */
	tokensSelected(): number;
	units(): Units;
}

export class Shapes {
	#board: Board;
	#looks: Looks;

	constructor(board: Board, looks: Looks) {
		this.#board = board;
		this.#looks = looks;
	}

	/** The templates laid on the map, each with the two points it is kept as, in the map's pixels. */
	readonly laid = $derived.by((): LaidTemplate[] => {
		const { battle, drawings, W, H } = this.#board;
		if (!battle) return [];
		return drawings.flatMap((drawing) => {
			const { kind, points } = drawing;
			if (!isTemplate(kind) || points.length !== 2) return [];
			const [a, b] = points.map(([x, y]): Point => [x * W, y * H]);
			return [{ drawing, kind, a, b }];
		});
	});

	/**
	 * The tokens a template catches: the ones whose middle is inside it,
	 * wherever each is drawn right now. `a` and `b` are in the map's pixels.
	 * A hair of slack takes in a middle that sits right on the line.
	 */
	#tokensIn(kind: TemplateKind, a: Point, b: Point): Token[] {
		const { tokens, W, H, cell } = this.#board;
		return tokens.filter((token) => {
			const [x, y] = this.#looks.spotOf(token);
			return templateHolds(kind, a, b, [x * W, y * H], cell * 0.02);
		});
	}

	/** The tokens inside the templates that are selected, wherever those are being carried. */
	readonly inside = $derived.by((): Token[] => {
		if (!this.#looks.selecting()) return [];
		const { selectedIds, W, H } = this.#board;
		const found = new Map<string, Token>();
		for (const { drawing, kind, a, b } of this.laid) {
			if (!selectedIds.includes(drawing.id)) continue;
			const [sx, sy] = this.#looks.shiftOf(drawing);
			const carried = ([x, y]: Point): Point => [x + sx * W, y + sy * H];
			for (const token of this.#tokensIn(kind, carried(a), carried(b))) found.set(token.id, token);
		}
		return [...found.values()];
	});

	/**
	 * The tokens that light up as caught: inside the template being dragged
	 * out, or inside the ones selected while no token is. Only on this
	 * person's own screen.
	 */
	readonly caughtIds = $derived.by(() => {
		const { W, H } = this.#board;
		const ids = new Set<string>();
		if (this.#looks.tokensSelected() === 0) for (const token of this.inside) ids.add(token.id);
		const casted = this.#looks.casted();
		if (casted) {
			const [a, b] = casted.map(([x, y]): Point => [x * W, y * H]);
			for (const token of this.#tokensIn(this.#looks.shape(), a, b)) ids.add(token.id);
		}
		return ids;
	});

	/** How big a template is, in words: "20 ft radius", "30 ft cone", "10 × 20 ft". In metres on a metric map. */
	size = (kind: TemplateKind, a: Point, b: Point): string => {
		const { map } = this.#board;
		const [first, second] = templateSpan(kind, a, b).map((pixels) =>
			feetCount(pixelsToFeet(map, pixels), this.#looks.units())
		);
		// The two sides of a box are told with the unit said once.
		if (kind === 'rect') return `${first.replace(/ \S+$/, '')} × ${second}`;
		return `${first} ${kind === 'circle' ? 'radius' : 'cone'}`;
	};
}
