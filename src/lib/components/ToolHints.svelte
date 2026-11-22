<script lang="ts">
	// What the tool in hand is waiting for, said at the top of the map: one
	// line, and the keys that go with it.

	import { KEY, keyLabel } from '#lib/client/keys.ts';
	import type { TemplateKind } from '#lib/shared/types.ts';

	interface Props {
		tool: string;
		/** How many corners the region being drawn has so far. */
		corners: number;
		/** The ruler is being laid a click at a time. */
		routing: boolean;
		battle: boolean;
		/** Which shape the pen is laying down. */
		shape: TemplateKind;
		/** There is fog on the map to clear. */
		fogOn: boolean;
		/** A text is being typed onto the map. */
		writing: boolean;
	}

	let { tool, corners, routing, battle, shape, fogOn, writing }: Props = $props();

	// On a narrow screen it leaves the corner to the zoom buttons, and may wrap.
	const hint =
		'absolute top-3.5 left-1/2 w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-full border border-accent bg-night/90 px-3.5 py-2 text-center text-sm max-[720px]:max-w-[calc(100%-136px)] max-[720px]:rounded-2xl';
	/** Typed only where there are keys to type it on. */
	const keys = 'ml-1.5 text-muted touch:hidden';
</script>

{#if tool === 'draw'}
	<p class={hint}>
		{#if corners < 3}
			<span class="touch:hidden">Click to mark the corners of the region.</span>
			<span class="hidden touch:inline">Tap to mark the corners of the region.</span>
		{:else}
			<span class="touch:hidden">Click the first corner or press Enter to finish.</span>
			<span class="hidden touch:inline">Tap the first corner to finish.</span>
		{/if}
		<span class={keys}>Backspace removes a corner · Esc cancels</span>
	</p>
{:else if tool === 'place'}
	<p class={hint}>
		<span class="touch:hidden">Click the map where it belongs.</span>
		<span class="hidden touch:inline">Tap the map where it belongs.</span>
		<span class={keys}>Esc cancels</span>
	</p>
{:else if tool === 'measure'}
	<p class={hint}>
		{#if routing}
			<span class="touch:hidden">Click along the way. Double-click to end it.</span>
			<span class="hidden touch:inline">Tap along the way. Double-tap to end it.</span>
			<span class={keys}>Backspace takes a bend back · Esc puts the ruler away</span>
		{:else}
			<span class="touch:hidden">Drag to measure, or click along a road to follow it.</span>
			<span class="hidden touch:inline">Drag to measure, or tap along a road to follow it.</span>
			<span class={keys}>
				{#if battle}Alt measures off the grid ·{/if} Esc puts the ruler away
			</span>
		{/if}
	</p>
{:else if tool === 'template'}
	<p class={hint}>
		{#if shape === 'circle'}
			Drag out from the middle of the circle.
		{:else if shape === 'cone'}
			Drag from the tip of the cone the way it points.
		{:else if shape === 'ray'}
			Drag from where the line starts the way it goes.
		{:else}
			Drag from one corner of the box to the other.
		{/if}
		<span class={keys}>Alt leaves the grid · Esc puts the pen away</span>
	</p>
{:else if tool === 'select'}
	<p class={hint}>
		{battle
			? 'Drag a box around what you want to select.'
			: 'Drag a box around the markers to move, hide or delete together.'}
		<span class={keys}>Shift adds to the selection · Esc cancels</span>
	</p>
{:else if tool === 'sketch'}
	<p class={hint}>
		Drag across the map to draw.
		<span class={keys}>Esc puts the pen away</span>
	</p>
{:else if tool === 'reveal'}
	<p class={hint}>
		{#if fogOn}
			Paint over what the players may see.
			<span class={keys}>
				{keyLabel(KEY.brushSmaller)} {keyLabel(KEY.brushBigger)} size the brush ·
				{keyLabel(KEY.fogSwap)} covers instead · Esc puts it away
			</span>
		{:else}
			There is no fog on this map yet. Cover some of it first.
		{/if}
	</p>
{:else if tool === 'cover'}
	<p class={hint}>
		Paint over what the fog should cover.
		<span class={keys}>
			{keyLabel(KEY.brushSmaller)} {keyLabel(KEY.brushBigger)} size the brush ·
			{#if fogOn}{keyLabel(KEY.fogSwap)} clears instead ·{/if} Esc puts it away
		</span>
	</p>
{:else if tool === 'point'}
	<p class={hint}>
		<span class="touch:hidden">Hold the button down: the table sees where you point.</span>
		<span class="hidden touch:inline">Press and move a finger: the table sees where you point.</span>
		<span class={keys}>A click leaves a ping · Esc puts it away</span>
	</p>
{:else if tool === 'align'}
	<p class={hint}>
		Drag a box over a few squares of the map's own grid, from corner to corner.
		<span class={keys}>Esc cancels</span>
	</p>
{:else if tool === 'text' && !writing}
	<p class={hint}>
		<span class="touch:hidden">Click the map where the text goes.</span>
		<span class="hidden touch:inline">Tap the map where the text goes.</span>
		<span class={keys}>Esc cancels</span>
	</p>
{/if}
