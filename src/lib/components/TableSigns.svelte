<script lang="ts">
	// What the table shows each other on the map, over everything else: the
	// spots they ping, where they point, and how long each ruler is.

	import type { Ruler } from '#lib/client/mapview.ts';
	import type { Ping, Point, Role } from '#lib/shared/types.ts';

	interface Props {
		pings: (Ping & { key: number })[];
		/** The colour someone is shown in. */
		tintOf: (other: { role: Role; userId: string }) => string;
		passive: boolean;
		/** Every spot being pointed at right now. One with no name is this person's own. */
		pointed: { key: string; at: Point; tint: string; name: string | null }[];
		rulers: Ruler[];
		W: number;
		H: number;
	}

	let { pings, tintOf, passive, pointed, rulers, W, H }: Props = $props();
</script>

<!-- A spot someone is pointing out: rings spreading from it in their
     colour (--c), with their name under it, gone again after a moment.
     The same size on screen at any zoom, and never in the way of the
     pointer. -->
{#each pings as ping (ping.key)}
	<div
		class="pointer-events-none absolute top-0 left-0 z-3 size-0 animate-ping-fade scale-(--inv)"
		style:translate="{ping.x * W}px {ping.y * H}px"
		style:--c={tintOf(ping)}
		role="status"
		aria-label="{ping.name} is pointing here"
	>
		<span
			class="absolute size-24 -translate-1/2 animate-ping-ring rounded-full border-[3px] border-(--c) shadow-[0_0_6px_rgb(0_0_0/0.7),inset_0_0_6px_rgb(0_0_0/0.7)] motion-reduce:size-12 motion-reduce:animate-none"
		></span>
		<span
			class="absolute size-24 -translate-1/2 animate-ping-ring rounded-full border-[3px] border-(--c) shadow-[0_0_6px_rgb(0_0_0/0.7),inset_0_0_6px_rgb(0_0_0/0.7)] [animation-delay:0.35s] motion-reduce:hidden"
		></span>
		<span
			class="absolute size-3 -translate-1/2 rounded-full border-[1.5px] border-[#12151c] bg-(--c)"
		></span>
		<span
			class={[
				'absolute left-0 w-max -translate-x-1/2 truncate rounded-full bg-(--c) px-2 leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
				passive ? 'top-4 max-w-[240px] text-base' : 'top-3 max-w-[150px] text-xs'
			]}>{ping.name}</span
		>
	</div>
{/each}

<!-- Where someone is pointing, for as long as they hold the button
     down: a dot in their colour (--c) with a glow around it, and for
     everyone but themself, their name under it. The same size on
     screen at any zoom. Another person's glides from one report of
     it to the next; this person's own is under their pointer. -->
{#each pointed as pointer (pointer.key)}
	<div
		class={[
			'pointer-events-none absolute top-0 left-0 z-3 size-0 scale-(--inv)',
			pointer.name !== null &&
				'transition-[translate] duration-75 ease-linear motion-reduce:transition-none'
		]}
		style:translate="{pointer.at[0] * W}px {pointer.at[1] * H}px"
		style:--c={pointer.tint}
		data-pointer={pointer.key}
		role={pointer.name === null ? undefined : 'status'}
		aria-label={pointer.name === null ? undefined : `${pointer.name} is pointing here`}
	>
		<span
			class="absolute size-7 -translate-1/2 rounded-full bg-(--c)/35 shadow-[0_0_10px_2px_var(--c)]"
		></span>
		<span
			class="absolute size-3 -translate-1/2 rounded-full border-[1.5px] border-[#12151c] bg-(--c)"
		></span>
		{#if pointer.name !== null}
			<span
				class={[
					'absolute left-0 w-max -translate-x-1/2 truncate rounded-full bg-(--c) px-2 leading-[1.6] font-semibold text-[#12151c] shadow-[0_1px_3px_rgb(0_0_0/0.5)]',
					passive ? 'top-5 max-w-[240px] text-base' : 'top-4 max-w-[150px] text-xs'
				]}>{pointer.name}</span
			>
		{/if}
	</div>
{/each}

<!-- How long each ruler is, written at the end it is being pulled to. -->
{#each rulers as ruler (ruler.key)}
	{#if ruler.length}
		{@const [ex, ey] = ruler.points[ruler.points.length - 1]}
		<div
			class="pointer-events-none absolute top-0 left-0 z-3 size-0 origin-top-left scale-(--inv)"
			style:translate="{ex * W}px {ey * H}px"
			style:--c={ruler.tint}
		>
			<span
				class={[
					'absolute bottom-3 left-0 -translate-x-1/2 rounded-full border border-(--c) bg-night/90 px-2 py-0.5 font-semibold whitespace-nowrap',
					passive ? 'text-base' : 'text-xs'
				]}
			>
				{ruler.length}
			</span>
		</div>
	{/if}
{/each}
