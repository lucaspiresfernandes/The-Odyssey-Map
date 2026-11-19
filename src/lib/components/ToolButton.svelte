<script lang="ts" module>
	// Line icons on a 24 x 24 grid, like the marker glyphs.
	const ICONS = {
		note: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z M12 7v6 M9 10h6',
		marker: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M12 7v6 M9 10h6',
		// An outline with a dot on each corner.
		region:
			'M5 6 18 5l1 11-10 3Z M4 6a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M17 5a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M18 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M8 19a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
		image:
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M7.5 9a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M21 15l-3.6-3.6a2 2 0 0 0-2.8 0L5 21',
		rename: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
		// Arrows out to all four sides: pick it up and put it elsewhere.
		move: 'M12 2v20 M2 12h20 M9 5l3-3 3 3 M9 19l3 3 3-3 M5 9l-3 3 3 3 M19 9l3 3-3 3',
		enter: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
		reveal: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
		hide: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M4 3l16 18',
		delete:
			'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6',
		// A playing piece: a head on a foot.
		token: 'M9.4 10.4a4 4 0 1 1 5.2 0 M9.4 10.4 7.5 18h9l-1.9-7.6 M5.5 21h13 M7.5 18l-2 3 M16.5 18l2 3',
		ruler: 'M16 3l5 5L8 21l-5-5Z M7 12l2 2 M10 9l2 2 M13 6l2 2',
		grid: 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
		// The tools of a battle map: a pointer, a box to catch several things
		// in, a line drawn freehand, a letter.
		pointer: 'M4 4l7.07 17 2.51-7.39L21 11.07Z',
		marquee:
			'M5 3a2 2 0 0 0-2 2 M19 3a2 2 0 0 1 2 2 M21 19a2 2 0 0 1-2 2 M5 21a2 2 0 0 1-2-2 M9 3h1 M14 3h1 M9 21h1 M14 21h1 M3 9v1 M3 14v1 M21 9v1 M21 14v1',
		draw: 'M3 16c2.5-8 5-8 7-1.5s4.5 4.5 6-2 2.5-5.5 5-3.5',
		text: 'M4 7V4h16v3 M9 20h6 M12 4v16',
		// What is done to a token.
		label:
			'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z M7.5 7.5h.01',
		lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 10 0v4',
		unlock:
			'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 9.9-1',
		duplicate:
			'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
		filter: 'M22 3H2l8 9.46V19l4 2v-8.54Z',
		// A banner on a pole: where the party is.
		party: 'M5 21V4 M5 4h14l-3.5 4.5L19 13H5',
		// A cloud: the fog of war.
		fog: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z',
		// Four ways in to one spot: everyone is brought here.
		gather:
			'M12 2v5 M12 17v5 M2 12h5 M17 12h5 M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M10 5l2 2 2-2 M10 19l2-2 2 2 M5 10l2 2-2 2 M19 10l-2 2 2 2',
		// The shapes the pen draws besides a line.
		circle: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M11.5 12a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0',
		cone: 'M3 12 20 4.5v15Z',
		box: 'M4 4h16v16H4Z',
		// An hourglass: whose turn it is. And the way on to the next one.
		turns: 'M6 2h12 M6 22h12 M7 2v4l5 6-5 6v4 M17 2v4l-5 6 5 6v4',
		next: 'M5 4l10 8-10 8Z M19 5v14',
		// A token with a pip on its rim.
		mark: 'M4 13a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0-15 0 M15 6.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
		// Rings spreading from a spot: pointing it out to the table.
		ping: 'M11.5 12a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
		// A number sign: what a token counts.
		count: 'M4 9h16 M4 15h16 M10 3 8 21 M16 3l-2 18',
		// Two heads: the players something is a secret with.
		people:
			'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M16 3.13a4 4 0 0 1 0 7.75 M22 21v-1a6 6 0 0 0-4-5.66',
		// A die: what each token rolled for its place in the turn order.
		dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8.5 8.5h.01 M15.5 8.5h.01 M12 12h.01 M8.5 15.5h.01 M15.5 15.5h.01',
		search: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-4.3-4.3',
		// A screen on a stand: something held up for the whole table.
		show: 'M3 4h18v12H3Z M8 20h8 M12 16v4',
		close: 'M6 6l12 12 M18 6 6 18',
		plus: 'M12 5v14 M5 12h14',
		up: 'M6 15l6-6 6 6',
		down: 'M6 9l6 6 6-6',
		right: 'M9 6l6 6-6 6'
	};

	export type ToolIcon = keyof typeof ICONS;
</script>

<script lang="ts">
	// One tool in the bar under the map: an icon, and a tooltip that says what
	// it does. The bar stays small that way, however many tools it holds.

	interface Props {
		icon: ToolIcon;
		/** What the tool does. The tooltip, and the button's name for screen readers. */
		label: string;
		/** A second, quieter line in the tooltip: why the tool is off, for one. */
		hint?: string;
		/** The key that does the same, shown beside the label. Whoever owns the tool listens for it. */
		shortcut?: string;
		/** Writes the label on the button instead, for a tool that stands alone. */
		named?: boolean;
		disabled?: boolean;
		danger?: boolean;
		/** A tool that is switched on. */
		active?: boolean;
		/**
		 * For a tool that opens something beside it: whether that is open. While
		 * it is, the tooltip keeps out of its way.
		 */
		expanded?: boolean;
		/** A smaller button, for the ones that float over the map beside what they act on. */
		small?: boolean;
		/** Which side the tooltip comes out on. Above, unless the button is docked where that has no room. */
		tip?: 'top' | 'bottom' | 'left';
		onclick: () => void;
	}

	let {
		icon,
		label,
		hint,
		shortcut,
		named = false,
		disabled = false,
		danger = false,
		active = false,
		expanded,
		small = false,
		tip = 'top',
		onclick
	}: Props = $props();

	const TIP = {
		top: 'bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2',
		bottom: 'top-[calc(100%+10px)] left-1/2 -translate-x-1/2',
		left: 'top-1/2 right-[calc(100%+10px)] -translate-y-1/2'
	};
</script>

<!-- The tooltip hangs off this wrapper and not the button, because a disabled
     button is the one that most needs explaining. -->
<span class="group relative flex">
	<button
		class={[
			'btn',
			small && 'btn-sm',
			!named && (small ? 'w-7 px-0 touch:w-9' : 'w-9 px-0 touch:w-11'),
			danger && 'btn-danger',
			active && 'btn-active'
		]}
		aria-label={named ? undefined : label}
		aria-pressed={active || undefined}
		aria-expanded={expanded}
		aria-keyshortcuts={shortcut?.toUpperCase()}
		{disabled}
		{onclick}
	>
		<svg
			width={small ? 15 : 18}
			height={small ? 15 : 18}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={ICONS[icon]} />
		</svg>
		{#if named}{label}{/if}
	</button>
	{#if (!named || hint) && !expanded}
		<span
			class="pointer-events-none absolute z-5 grid w-max gap-0.5 rounded-lg border border-[#4a5670] bg-night px-2.5 py-1.5 text-center text-xs opacity-0 shadow-pop transition-opacity delay-150 duration-100 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:hidden {TIP[
				tip
			]}"
			aria-hidden="true"
		>
			{#if !named}
				<span>
					{label}
					{#if shortcut}
						<kbd
							class="ml-1 rounded border border-[#4a5670] bg-panel-2 px-1 font-sans text-[11px] text-muted"
							>{shortcut.toUpperCase()}</kbd
						>
					{/if}
				</span>
			{/if}
			{#if hint}<span class="text-muted">{hint}</span>{/if}
		</span>
	{/if}
</span>
