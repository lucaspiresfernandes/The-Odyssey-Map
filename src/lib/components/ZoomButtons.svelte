<script lang="ts">
	// The buttons that zoom the map and fit it to the screen.

	import { KEY, ariaKey, keyLabel } from '#lib/client/keys.ts';

	interface Props {
		/** A table display has none: its keys still zoom. */
		passive: boolean;
		/** Zooms by this much: more than one is closer in. */
		onzoom: (factor: number) => void;
		onfit: () => void;
	}

	let { passive, onzoom, onfit }: Props = $props();

	const zoomButton = 'h-9 w-9.5 cursor-pointer hover:bg-panel-2 touch:size-11';
</script>

<!-- In the bottom corner, beside the tools. A narrow screen gives the
     whole bottom edge to the tools, so there it sits in a top corner:
     the left one, since tools are docked in the right. Fingers zoom by
     pinching, which leaves only Fit to offer them. A table display has
     none: its keys still zoom. -->
<div
	class={[
		'pointer-events-auto absolute right-3.5 bottom-3.5 grid overflow-hidden rounded-[10px] border bg-panel max-[720px]:top-3.5 max-[720px]:right-auto max-[720px]:bottom-auto max-[720px]:left-3.5',
		passive && 'hidden'
	]}
>
	<button
		class="{zoomButton} border-b text-[19px] touch:hidden"
		aria-label="Zoom in"
		aria-keyshortcuts={ariaKey(KEY.zoomIn)}
		title="Zoom in ({keyLabel(KEY.zoomIn)})"
		onclick={() => onzoom(1.6)}
	>
		+
	</button>
	<button
		class="{zoomButton} border-b text-[19px] touch:hidden"
		aria-label="Zoom out"
		aria-keyshortcuts={ariaKey(KEY.zoomOut)}
		title="Zoom out ({keyLabel(KEY.zoomOut)})"
		onclick={() => onzoom(1 / 1.6)}
	>
		−
	</button>
	<button
		class="{zoomButton} text-xs"
		aria-label="Fit the whole map"
		aria-keyshortcuts={ariaKey(KEY.fit)}
		title="Fit the whole map ({keyLabel(KEY.fit)})"
		onclick={onfit}>Fit</button
	>
</div>
