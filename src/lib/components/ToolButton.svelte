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
		grid: 'M3 3h18v18H3Z M3 9h18 M3 15h18 M9 3v18 M15 3v18'
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
		onclick
	}: Props = $props();
</script>

<!-- The tooltip hangs off this wrapper and not the button, because a disabled
     button is the one that most needs explaining. -->
<span class="group relative flex">
	<button
		class={['btn', !named && 'w-9 px-0 touch:w-11', danger && 'btn-danger', active && 'btn-active']}
		aria-label={named ? undefined : label}
		aria-pressed={active || undefined}
		{disabled}
		{onclick}
	>
		<svg
			width="18"
			height="18"
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
			class="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-5 grid w-max -translate-x-1/2 gap-0.5 rounded-lg border border-[#4a5670] bg-night px-2.5 py-1.5 text-center text-xs opacity-0 shadow-pop transition-opacity delay-150 duration-100 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:hidden"
			aria-hidden="true"
		>
			{#if !named}<span>{label}</span>{/if}
			{#if hint}<span class="text-muted">{hint}</span>{/if}
		</span>
	{/if}
</span>
