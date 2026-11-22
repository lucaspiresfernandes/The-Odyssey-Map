<script lang="ts" module>
	import { KEY } from '#lib/client/keys.ts';
	import type { BattleTool, PenKind } from '#lib/client/toolbelt.svelte.ts';
	import type { ToolIcon } from './ToolButton.svelte';

	export type { BattleTool };
	/** What the pen draws: a line freehand, a shape dragged out, or text. */
	export type Pen = PenKind;

	/** Each with the key that takes it in hand: the top row of the keyboard, left to right. */
	export const BATTLE_TOOLS: { tool: BattleTool; icon: ToolIcon; label: string; key: string }[] = [
		{ tool: 'pan', icon: 'pointer', label: 'Select and move', key: KEY.hand },
		{ tool: 'select', icon: 'marquee', label: 'Select multiple', key: KEY.box },
		{ tool: 'measure', icon: 'ruler', label: 'Measure a distance', key: KEY.ruler },
		{ tool: 'sketch', icon: 'draw', label: 'Draw', key: KEY.pen },
		{ tool: 'point', icon: 'ping', label: 'Point at the map', key: KEY.point }
	];

	/**
	 * What the pen draws: a line, one of the shapes, for the area of a spell,
	 * a breath, a wall, or a line of text. With the pen in hand each has a
	 * number key, in this order: see PEN_KEYS.
	 */
	export const PENS: { pen: Pen; icon: ToolIcon; label: string; hint: string }[] = [
		{ pen: 'line', icon: 'draw', label: 'Draw a line', hint: 'Freehand' },
		{ pen: 'circle', icon: 'circle', label: 'Draw a circle', hint: 'A burst around a spot' },
		{ pen: 'cone', icon: 'cone', label: 'Draw a cone', hint: 'As wide at its end as it is long' },
		{ pen: 'rect', icon: 'box', label: 'Draw a box', hint: 'A square or a wall' },
		{ pen: 'text', icon: 'text', label: 'Draw text', hint: 'Click the map and type' }
	];

</script>

<script lang="ts">
	// The tools of a battle map, docked in the upper right corner: what is in
	// hand, and for the GM, what the map itself is. Folded away it is one
	// button, which still shows the tool in hand. What goes with the tool in
	// hand comes out beside it: the pen's shapes and inks, the fog's brushes.

	import type { Snippet } from 'svelte';
	import { PEN_KEYS, keyLabel } from '#lib/client/keys.ts';
	import { INK_COLORS, type Token } from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		battleTool: BattleTool;
		/** The GM has one of the fog's two tools in hand. */
		fogging: boolean;
		toolsFolded: boolean;
		isGm: boolean;
		/** What the pen draws. */
		pen: Pen;
		/** The colour it draws in. */
		ink: string;
		/** A click on a tool picks it up, or with that one in hand, puts it down again. */
		pick: (tool: BattleTool) => void;
		/** The tokens on this map that are this person's own, and the one whose turn it is. */
		myTokens: Token[];
		myTurn: Token | null;
		goToMine: () => void;
		/** The GM is to set up the grid. */
		onsetup: () => void;
		/** There is fog on this map. */
		fogOn: boolean;
		pickFog: () => void;
		/** The fog's own tools, for while the GM is at it. */
		fogTools: Snippet;
	}

	let {
		battleTool,
		fogging,
		toolsFolded = $bindable(),
		isGm,
		pen = $bindable(),
		ink = $bindable(),
		pick,
		myTokens,
		myTurn,
		goToMine,
		onsetup,
		fogOn,
		pickFog,
		fogTools
	}: Props = $props();

	/** A bar that floats over the map. */
	const floating = 'rounded-xl border bg-panel/94 shadow-pop';

	/** The tool in hand, for the one button the palette folds down to. */
	const inHand = $derived(
		fogging
			? { icon: 'fog' as const, label: 'Fog of war' }
			: (BATTLE_TOOLS.find((each) => each.tool === battleTool) ?? BATTLE_TOOLS[0])
	);
</script>

<div class="absolute top-3.5 right-3.5 z-1 flex items-start gap-1.5">
	{#if !toolsFolded && isGm && fogging}
		<!-- The fog's own tools, out while the GM is at it. -->
		<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Fog of war">
			{@render fogTools()}
		</div>
	{/if}
	{#if !toolsFolded && battleTool === 'sketch'}
		<!-- What the pen draws, out while it is in hand: a line, a shape, or text. -->
		<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="What to draw">
			{#each PENS as each, i (each.pen)}
				<ToolButton
					tip="left"
					icon={each.icon}
					label={each.label}
					hint={each.hint}
					shortcut={PEN_KEYS[i]}
					active={pen === each.pen}
					onclick={() => (pen = each.pen)}
				/>
			{/each}
		</div>
	{/if}
	{#if !toolsFolded && battleTool === 'sketch'}
		<!-- The inks, out with the pen. -->
		<div
			class="grid gap-1.5 p-1.5 {floating}"
			role="radiogroup"
			aria-label={pen === 'text' ? 'Colour of the text' : 'Colour of the pen'}
		>
			{#each INK_COLORS as option (option)}
				<!-- Each ink is a disc of itself, which arrives as --c. -->
				<button
					class={[
						'size-6 cursor-pointer rounded-full border-2 border-[#55607a] bg-(--c) touch:size-8',
						ink === option && 'token-selected'
					]}
					style:--c={option}
					role="radio"
					aria-checked={ink === option}
					aria-label="Colour {option}"
					title="{keyLabel(KEY.ink)} takes the next colour, {keyLabel(KEY.inkBack)} the one before"
					onclick={() => (ink = option)}
				></button>
			{/each}
		</div>
	{/if}
	<div class="grid gap-1.5 p-1.5 {floating}" role="toolbar" aria-label="Map tools">
		{#if toolsFolded}
			<ToolButton
				tip="left"
				icon={inHand.icon}
				label="Show the tools"
				hint="In hand: {inHand.label.toLowerCase()}"
				shortcut={KEY.palettes}
				active={battleTool !== 'pan'}
				onclick={() => (toolsFolded = false)}
			/>
		{:else}
			<ToolButton
				tip="left"
				icon="up"
				label="Fold the tools away"
				hint="{keyLabel(KEY.palettes)} folds the dock and the turn order too"
				onclick={() => (toolsFolded = true)}
			/>
			<span class="h-px bg-line"></span>
			{#each BATTLE_TOOLS as each (each.tool)}
				<ToolButton
					tip="left"
					icon={each.icon}
					label={each.label}
					shortcut={each.key}
					active={battleTool === each.tool}
					onclick={() => pick(each.tool)}
				/>
			{/each}
			{#if myTokens.length}
				<!-- Only for someone with a token of their own on this map: the
				     way back to it, lit while its turn is on. -->
				<ToolButton
					tip="left"
					icon="person"
					label={myTokens.length > 1 ? 'Go to my tokens' : 'Go to my token'}
					hint={myTurn ? 'It is your turn' : undefined}
					shortcut={KEY.mine}
					active={myTurn !== null}
					onclick={goToMine}
				/>
			{/if}
			{#if isGm}
				<span class="h-px bg-line"></span>
				<ToolButton
					tip="left"
					icon="grid"
					label="Set up the grid"
					shortcut={KEY.grid}
					active={battleTool === 'align'}
					onclick={onsetup}
				/>
				<ToolButton
					tip="left"
					icon="fog"
					label="Fog of war"
					hint={fogOn ? 'On: players see only what you clear' : 'Off'}
					shortcut={KEY.fog}
					active={fogging}
					expanded={fogging}
					onclick={pickFog}
				/>
			{/if}
		{/if}
	</div>
</div>
