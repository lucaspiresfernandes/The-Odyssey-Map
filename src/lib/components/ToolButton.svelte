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
		'turn-left': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
		'turn-right': 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5',
		grow: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
		shrink: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
		label:
			'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z M7.5 7.5h.01',
		lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 10 0v4',
		unlock:
			'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M7 11V7a5 5 0 0 1 9.9-1',
		duplicate:
			'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2',
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
		/** Writes the label on the button instead, for a tool that stands alone. */
		named?: boolean;
		disabled?: boolean;
		danger?: boolean;
		/** A tool that is switched on. */
		active?: boolean;
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
		named = false,
		disabled = false,
		danger = false,
		active = false,
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
	{#if !named || hint}
		<span
			class="pointer-events-none absolute z-5 grid w-max gap-0.5 rounded-lg border border-[#4a5670] bg-night px-2.5 py-1.5 text-center text-xs opacity-0 shadow-pop transition-opacity delay-150 duration-100 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:hidden {TIP[
				tip
			]}"
			aria-hidden="true"
		>
			{#if !named}<span>{label}</span>{/if}
			{#if hint}<span class="text-muted">{hint}</span>{/if}
		</span>
	{/if}
</span>
