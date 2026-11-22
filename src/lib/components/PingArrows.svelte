<script lang="ts">
	// A spot pointed out where this screen is not looking: an arrow at the
	// edge of the map, in the colour of whoever is pointing, with their name
	// beside it. It points the way there, and a click on it goes there. A
	// ping is gone from the map in a moment, so its arrow stays a little
	// longer: long enough to be clicked.

	import { untrack } from 'svelte';
	import type { View } from '#lib/client/mapview.ts';
	import type { Ping, Point, Role } from '#lib/shared/types.ts';

	interface Props {
		pings: (Ping & { key: number })[];
		/** Every spot being pointed at right now. One with no name is this person's own. */
		pointed: { key: string; at: Point; tint: string; name: string | null }[];
		/** The colour someone is shown in. */
		tintOf: (other: { role: Role; userId: string }) => string;
		/** This person: where they point themself needs no arrow. */
		userId: string;
		view: View;
		W: number;
		H: number;
		/** The size of the screen the map lies on. */
		cw: number;
		ch: number;
		/** A table display: names are lettered larger. */
		passive: boolean;
		/** An arrow was clicked: the map is to go to that spot. */
		ongo: (spot: Point) => void;
	}

	let { pings, pointed, tintOf, userId, view, W, H, cw, ch, passive, ongo }: Props = $props();

	/** How long the arrow for a ping stays, in milliseconds. */
	const ARROW_LASTS = 6000;
	/** How far in from the edge of the map an arrow stands, on screen. */
	const INSET = 30;

	interface Spot {
		key: string;
		at: Point;
		tint: string;
		name: string;
	}

	/** The pings that still have an arrow coming to them, gone from the map or not. */
	let lingering = $state.raw<Spot[]>([]);
	const known = new Set<number>();

	// Each ping of someone else's is kept from when it comes until its arrow is done.
	$effect(() => {
		const fresh = pings.filter((ping) => ping.userId !== userId && !known.has(ping.key));
		if (fresh.length === 0) return;
		untrack(() => {
			for (const ping of fresh) {
				known.add(ping.key);
				const key = `ping:${ping.key}`;
				lingering = [
					...lingering,
					{ key, at: [ping.x, ping.y], tint: tintOf(ping), name: ping.name }
				];
				setTimeout(() => {
					lingering = lingering.filter((each) => each.key !== key);
					known.delete(ping.key);
				}, ARROW_LASTS);
			}
		});
	});

	/** Everything that may want an arrow: those pings, and where the others are pointing now. */
	const spots = $derived<Spot[]>([
		...lingering,
		...pointed.flatMap((each) =>
			each.name === null ? [] : [{ key: `point:${each.key}`, at: each.at, tint: each.tint, name: each.name }]
		)
	]);

	/**
	 * The ones off this screen, each with where its arrow stands and which
	 * way it points: on the line from the middle of the screen to the spot,
	 * a little in from the edge.
	 */
	const arrows = $derived.by(() => {
		if (cw === 0 || ch === 0) return [];
		return spots.flatMap((spot) => {
			const x = spot.at[0] * W * view.k + view.x;
			const y = spot.at[1] * H * view.k + view.y;
			if (x >= 0 && x <= cw && y >= 0 && y <= ch) return [];
			const dx = x - cw / 2;
			const dy = y - ch / 2;
			const reach = Math.min(
				dx === 0 ? Infinity : (cw / 2 - INSET) / Math.abs(dx),
				dy === 0 ? Infinity : (ch / 2 - INSET) / Math.abs(dy)
			);
			return [
				{
					...spot,
					left: cw / 2 + dx * reach,
					top: ch / 2 + dy * reach,
					turn: (Math.atan2(dy, dx) * 180) / Math.PI,
					// The name goes on the side of the arrow that has room for it.
					before: dx > 0
				}
			];
		});
	});
</script>

<div class="pointer-events-none absolute inset-0 z-1 overflow-hidden">
	{#each arrows as arrow (arrow.key)}
		<button
			class="pointer-events-auto absolute grid size-8 -translate-1/2 cursor-pointer place-items-center rounded-full border-2 border-[#12151c] bg-(--c) text-[#12151c] shadow-[0_1px_4px_rgb(0_0_0/0.6)] motion-safe:animate-pulse touch:size-10"
			style:left="{arrow.left}px"
			style:top="{arrow.top}px"
			style:--c={arrow.tint}
			data-ping-arrow={arrow.key}
			title="Go to where {arrow.name} is pointing"
			aria-label="{arrow.name} is pointing at a spot off the screen. Go there."
			onclick={() => ongo(arrow.at)}
		>
			<svg
				class="pointer-events-none size-4.5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
				style:rotate="{arrow.turn}deg"
				aria-hidden="true"
			>
				<path d="M5 12h14 M13 6l6 6-6 6" />
			</svg>
		</button>
		<span
			class={[
				'absolute w-max -translate-y-1/2 truncate rounded-full bg-(--c) px-2 leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
				passive ? 'max-w-[240px] text-base' : 'max-w-[150px] text-xs',
				arrow.before ? '-translate-x-full' : ''
			]}
			style:left="{arrow.left + (arrow.before ? -22 : 22)}px"
			style:top="{arrow.top}px"
			style:--c={arrow.tint}>{arrow.name}</span
		>
	{/each}
</div>
