<script lang="ts">
	// The fog's own tools, the same on either kind of map: clear some of it
	// or cover some again, with a round brush or a square one, or do the whole
	// map at once. They stand in a palette docked in the corner of the map,
	// so their tooltips come out to the left of it.

	import { KEY } from '#lib/client/keys.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		/** There is fog on this map. */
		fogOn: boolean;
		/** Which of the fog's two tools is in hand. */
		fogHand: 'reveal' | 'cover' | null;
		/** What the fog is cleared and covered with: a brush that is round, or square. */
		fogShape: 'round' | 'square';
		/** How many steps the slider of the brush has, and which of them it is on. */
		BRUSH_STEPS: number;
		brushStep: number;
		/** Sizes the brush to a step of its slider. */
		sizeBrush: (step: number) => void;
		takeFog: (tool: 'reveal' | 'cover') => void;
		/** Covers the whole map, or where there is fog, lifts all of it. */
		fogAll: () => void;
	}

	let {
		fogOn,
		fogHand,
		fogShape = $bindable(),
		BRUSH_STEPS,
		brushStep,
		sizeBrush,
		takeFog,
		fogAll
	}: Props = $props();
</script>

<ToolButton
	tip="left"
	icon="reveal"
	label="Clear the fog from an area"
	hint={fogOn ? undefined : 'There is no fog on this map yet'}
	shortcut={fogHand === 'cover' && fogOn ? KEY.fogSwap : undefined}
	disabled={!fogOn}
	active={fogHand === 'reveal'}
	onclick={() => takeFog('reveal')}
/>
<ToolButton
	tip="left"
	icon="hide"
	label="Cover an area with fog"
	shortcut={fogHand === 'reveal' ? KEY.fogSwap : undefined}
	active={fogHand === 'cover'}
	onclick={() => takeFog('cover')}
	/>
	<span class="h-px bg-line"></span>
	<ToolButton
		tip="left"
		icon="circle"
		label="Paint with a round brush"
		hint="Shift and the wheel size it, or [ and ]"
		shortcut={fogShape === 'square' ? KEY.brushShape : undefined}
		active={fogShape === 'round'}
		onclick={() => (fogShape = 'round')}
	/>
	<ToolButton
		tip="left"
		icon="box"
		label="Paint with a square brush"
		hint="Sized the same way"
		shortcut={fogShape === 'round' ? KEY.brushShape : undefined}
		active={fogShape === 'square'}
		onclick={() => (fogShape = 'square')}
	/>
	<!-- How big the brush is. It stands on end, like the tools around
	     it, with the bigger brush at the top. -->
	<input
		class="h-24 w-4 cursor-pointer justify-self-center accent-accent [direction:rtl] [writing-mode:vertical-lr]"
		type="range"
		min="0"
		max={BRUSH_STEPS}
		step="1"
		value={brushStep}
		oninput={(e) => sizeBrush(e.currentTarget.valueAsNumber)}
		aria-label="Brush size"
		title="Brush size"
	/>
	<span class="h-px bg-line"></span>
<ToolButton
	tip="left"
	icon="fog"
	label={fogOn ? 'Lift all the fog' : 'Cover the whole map'}
	hint={fogOn ? 'Ctrl+Z brings it back' : undefined}
	shortcut={KEY.fogAll}
	onclick={fogAll}
/>
