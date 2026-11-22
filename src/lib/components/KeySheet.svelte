<script lang="ts">
	// The sheet of keyboard shortcuts: every key the map answers to, by what
	// it is for. It is laid out from the same table the keys are listened for
	// by, in src/lib/client/keys.ts, so it can't fall behind them. A player
	// is shown the keys a player has.

	import { SHEET, keyLabel, type SheetSection } from '#lib/client/keys.ts';
	import type { MapKind } from '#lib/shared/types.ts';
	import Modal from './Modal.svelte';

	interface Props {
		gm: boolean;
		/** The kind of map it was opened on: what is about that kind comes first. */
		kind: MapKind;
		onclose: () => void;
	}

	let { gm, kind, onclose }: Props = $props();

	const sections = $derived(
		SHEET.filter((section) => gm || !section.gm)
			.map((section) => ({ ...section, rows: section.rows.filter((row) => gm || !row.gm) }))
			.filter((section) => section.rows.length)
			// What goes for any map, then for this kind of map, then what is the
			// GM's on either, then the other kind of map.
			.sort((a, b) => rank(a) - rank(b))
	);

	function rank(section: SheetSection): number {
		if (section.kind) return section.kind === kind ? 1 : 3;
		return section.gm ? 2 : 0;
	}
</script>

<Modal title="Keyboard shortcuts" wide {onclose}>
	<!-- The sheet scrolls inside the dialog, so its title and the way out of it
	     stay put. It takes the focus as it opens: the arrow keys scroll it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="-mr-2 max-h-[calc(100dvh-190px)] overflow-y-auto pr-2 focus-visible:outline-none"
		role="region"
		aria-label="Every shortcut"
		tabindex="0"
	>
		<!-- Two columns of sections where there is room for them, each kept whole. -->
		<div class="gap-x-8 sm:columns-2">
			{#each sections as section (section.title)}
				<section class="mb-5 break-inside-avoid">
					<h3 class="mb-1.5 flex items-baseline gap-2 text-[15px]">
						{section.title}
						{#if section.kind && section.kind !== kind && !section.title.includes(section.kind)}
							<span class="font-sans text-xs font-normal text-muted">
								on a {section.kind} map
							</span>
						{/if}
					</h3>
					<dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-[13px]">
						{#each section.rows as row (row.does)}
							<dt class="flex gap-1 whitespace-nowrap">
								{#each row.keys as key (key)}
									<kbd
										class="rounded border border-[#4a5670] bg-panel-2 px-1.5 py-px font-sans text-xs text-cream"
										>{keyLabel(key)}</kbd
									>
								{/each}
							</dt>
							<dd class="text-[#d3cfc4]">{row.does}</dd>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	</div>
	<div class="flex items-center justify-between gap-3">
		<span class="text-xs text-muted">
			Every button says its key in its tooltip. In a text field, a letter is a letter.
		</span>
		<button class="btn" onclick={onclose}>Close</button>
	</div>
</Modal>
