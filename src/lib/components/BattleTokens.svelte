<script lang="ts">
	// The pieces on a battle map, each with what it wears: its ring, its
	// marks, its number, its name, and on the one that is selected, the
	// handles that turn and resize it.

	import type { Carried, Shaping, View } from '#lib/client/mapview.ts';
	import { cellsToFeet, feetCount } from '#lib/shared/grid.ts';
	import {
		MARK_LOOKS,
		imageUrl,
		type MapInfo,
		type MarkLook,
		type Point,
		type Token,
		type Units
	} from '#lib/shared/types.ts';
	import MarkIcon from './MarkIcon.svelte';

	interface Props {
		battle: boolean;
		tokens: Token[];
		/** Where a token is drawn: in a hand if it is in one, or where it stands. */
		spotOf: (token: Token) => Point;
		canGrabToken: (token: Token) => boolean;
		passive: boolean;
		/** What this person has in hand. */
		carry: Carried | null;
		/** The hand is out: what is on the map can be selected and dragged. */
		selecting: boolean;
		selectedIds: string[];
		/** How big a token is drawn, and which way round: as its handles have it, or as it is. */
		sizeOf: (token: Token) => number;
		turnOf: (token: Token) => number;
		/** The side of one grid cell, in map pixels. */
		cell: number;
		W: number;
		H: number;
		/** The tokens inside a shape that is being laid or is selected. */
		caughtIds: Set<string>;
		/** The token whose turn it is. */
		turnId: string | null;
		tool: string;
		userId: string;
		canShape: boolean;
		map: MapInfo;
		/** The token that wears handles: the only one selected, if it can be moved. */
		handled: Token | null;
		shaping: Shaping | null;
		/** How far beyond a token's rim its handles stand, on screen. */
		turnReach: number;
		sizeReach: number;
		view: View;
		units: Units;
		tokenKey: (e: KeyboardEvent, token: Token) => void;
		handleKey: (e: KeyboardEvent, token: Token, how: 'turn' | 'resize', side?: number) => void;
	}

	let {
		battle,
		tokens,
		spotOf,
		canGrabToken,
		passive,
		carry,
		selecting,
		selectedIds,
		sizeOf,
		turnOf,
		cell,
		W,
		H,
		caughtIds,
		turnId,
		tool,
		userId,
		canShape,
		map,
		handled,
		shaping,
		turnReach,
		sizeReach,
		view,
		units,
		tokenKey,
		handleKey
	}: Props = $props();

	/**
	 * The pips a token wears on its rim, one for each of its marks but
	 * `down`: where round the rim each sits, in degrees clockwise from the
	 * top, and how big it is in fractions of the token. A pip with an icon is
	 * a little bigger than a plain one, to be made out. They sit side by side
	 * from the top right, and close up once there are more than fit round.
	 */
	function pipsOf(token: Token): { look: MarkLook; angle: number; size: number }[] {
		const looks = MARK_LOOKS.filter((look) => look.id !== 'down' && token.marks.includes(look.id));
		const wide = (look: MarkLook) => (look.icon ? 36 : 28);
		const all = looks.reduce((sum, look) => sum + wide(look), 0);
		const squeeze = Math.min(1, 350 / all);
		let at = 6;
		return looks.map((look) => {
			const takes = wide(look) * squeeze;
			at += takes;
			return { look, angle: at - takes / 2, size: look.icon ? 0.31 : 0.24 };
		});
	}

	/** The first letters of a token's name, to write on it. */
	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	}

	/** What every handle on a token looks like. Each keeps its size on screen: scale-(--inv). */
	const handleLook =
		'absolute top-0 left-0 -translate-1/2 scale-(--inv) rounded-full border-[1.5px] border-accent-ink bg-white text-accent-ink shadow-[0_1px_3px_rgb(0_0_0/0.55)] [-webkit-tap-highlight-color:transparent]';
</script>

<!-- The pieces on a battle map. Each is as many cells across as it says, so
     unlike a pin it grows and shrinks with the map. It is a disc in its own
     colour (--c) with its initials on it, or its picture. Either can wear
     a ring in its outline colour (--o), to tell it from the next one. Its
     name is lettered underneath once it is big enough on screen to tell
     from its neighbours. The one whose turn it is stands in a ring of
     gold. What a token is marked with shows on its rim, a pip for each
     mark, and one that is down is crossed out. -->
{#if battle}
	{#each tokens as token (token.id)}
		{@const [x, y] = spotOf(token)}
		{@const mine = canGrabToken(token) && !passive}
		{@const inHand = !!carry?.held && token.id in carry.origins}
		{@const selected = selecting && selectedIds.includes(token.id)}
		{@const across = sizeOf(token) * cell}
		{@const turn = turnOf(token)}
		{@const down = token.marks.includes('down')}
		{@const pips = pipsOf(token)}
		<!-- Only the position glides, from one report of a drag to the next and
		     onto the grid when it is let go. Never in the hand that holds it. -->
		<div
			class={[
				'absolute top-0 left-0 size-0',
				inHand
					? 'z-2'
					: 'transition-[translate] duration-100 ease-linear motion-reduce:transition-none',
				selected && 'z-1'
			]}
			style:translate="{x * W}px {y * H}px"
		>
			{#if caughtIds.has(token.id)}
				<!-- Inside a shape that is being laid, or is selected: a pale ring
				     around what it would catch. -->
				<span
					class="pointer-events-none absolute -translate-1/2 rounded-full border-[#fff8e4] shadow-[0_0_0.45em_0.1em_#fff8e4]"
					data-caught={token.id}
					style:width="{across * 1.16}px"
					style:height="{across * 1.16}px"
					style:border-width="{across * 0.05}px"
					style:font-size="{across * 0.4}px"
					aria-hidden="true"
				></span>
			{/if}
			{#if turnId === token.id}
				<!-- Whose turn it is: a ring of gold around the token, breathing. -->
				<span
					class="pointer-events-none absolute -translate-1/2 animate-pulse rounded-full border-accent shadow-[0_0_0.5em_0.1em_var(--color-accent)] motion-reduce:animate-none"
					style:width="{across * 1.2}px"
					style:height="{across * 1.2}px"
					style:border-width="{across * 0.06}px"
					style:font-size="{across * 0.4}px"
					aria-hidden="true"
				></span>
			{/if}
			<button
				class={[
					'absolute grid -translate-1/2 place-items-center overflow-hidden rounded-full border-(--o) bg-(--c) leading-none font-semibold text-[#12151c] [-webkit-tap-highlight-color:transparent]',
					inHand ? 'cursor-grabbing' : mine ? 'cursor-grab' : 'cursor-pointer',
					selected ? 'token-selected' : inHand ? 'token-lifted' : 'token-shadow',
					// Only the GM ever has a hidden one to draw.
					token.hidden && 'border-dashed opacity-55',
					down && 'brightness-60 saturate-0',
					tool !== 'pan' && 'pointer-events-none'
				]}
				data-token-id={token.id}
				style:width="{across}px"
				style:height="{across}px"
				style:border-width="{across * (token.outline ? 0.09 : 0.06)}px"
				style:font-size="{across * 0.4}px"
				style:rotate="{turn}deg"
				style:--c={token.color}
				style:--o={token.outline ?? '#12151c'}
				title="{token.name}{token.ownerName
					? token.ownerId === userId
						? ' · yours'
						: ` · ${token.ownerName}’s`
					: ''}{token.locked ? ' · locked' : ''}"
				aria-label="Token: {token.name}{token.count != null
					? `, ${token.count}${token.countHidden ? ' (only you see the number)' : ''}`
					: ''}{caughtIds.has(token.id) ? ' (inside the shape)' : ''}{token.hidden ? (canShape ? ' (hidden from players)' : ' (a secret)') : ''}{down
					? ' (down)'
					: ''}{turnId === token.id ? ' (their turn)' : ''}{mine
					? '. Arrow keys move it.'
					: ''}"
				aria-pressed={selected}
				tabindex={tool === 'pan' && !passive ? 0 : -1}
				onkeydown={(e) => tokenKey(e, token)}
			>
				{initials(token.name)}
				{#if token.image}
					<!-- Over the initials, which show through if the picture can't be loaded. -->
					<img
						class="pointer-events-none absolute inset-0 size-full object-cover"
						src={imageUrl(map.campaignId, token.image)}
						alt=""
						draggable="false"
						onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
					/>
				{/if}
			</button>
			{#if down}
				<svg
					class="pointer-events-none absolute -translate-1/2"
					style:width="{across}px"
					style:height="{across}px"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						class="fill-none stroke-[#12151c] stroke-[5] [stroke-linecap:round]"
						d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
					/>
					<path
						class="fill-none stroke-[#e5544b] stroke-[2.5] [stroke-linecap:round]"
						d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
					/>
				</svg>
			{/if}
			{#each pips as { look, angle, size } (look.id)}
				<!-- Round its rim from the top, clockwise. A plain one is a disc of
				     its colour (--c). One with an icon is a dark disc, ringed in
				     the icon's colour, with the icon on it. -->
				{@const round = (angle * Math.PI) / 180}
				<span
					class={[
						'pointer-events-none absolute grid -translate-1/2 place-items-center rounded-full',
						look.icon ? 'border-(--c) bg-[#12151c]' : 'border-[#12151c] bg-(--c)'
					]}
					style:left="{Math.sin(round) * (across / 2)}px"
					style:top="{-Math.cos(round) * (across / 2)}px"
					style:width="{across * size}px"
					style:height="{across * size}px"
					style:border-width="{across * (look.icon ? 0.02 : 0.03)}px"
					style:--c={look.color}
					aria-hidden="true"
				>
					<MarkIcon {look} />
				</span>
			{/each}
			{#if token.count != null}
				<!-- The number it carries, on its rim at the upper left, where
				     the pips leave room: hit points, charges, rounds left. One
				     the GM keeps to themself is gold in a broken ring: nobody
				     else is sent it. -->
				<span
					class={[
						'pointer-events-none absolute grid -translate-1/2 place-items-center rounded-full bg-[#12151c] px-[0.3em] leading-none font-bold whitespace-nowrap tabular-nums',
						token.countHidden
							? 'border-dashed border-accent text-accent'
							: 'border-[#fff8e4]/85 text-[#fff8e4]'
					]}
					data-count={token.countHidden ? 'kept' : 'shown'}
					style:left="{-0.354 * across}px"
					style:top="{-0.354 * across}px"
					style:min-width="{across * 0.36}px"
					style:height="{across * 0.36}px"
					style:font-size="{across * 0.23}px"
					style:border-width="{across * 0.02}px"
					aria-hidden="true"
				>
					{token.count}
				</span>
			{/if}
			{#if across * view.k >= 26 || selected}
				<span
					class={[
						'pointer-events-none absolute left-0 w-max origin-top -translate-x-1/2 scale-(--inv) truncate pt-0.5 font-semibold text-[#fff8e4] text-shadow-map',
						passive ? 'max-w-[260px] text-lg' : 'max-w-[160px] text-xs'
					]}
					style:top="{across / 2}px"
				>
					{token.name}
				</span>
			{/if}
			{#if handled?.id === token.id}
				<!-- The handles of the one token selected. A dot on each side of it
				     is dragged out or in to resize it, half a cell at a time. The
				     one above it is dragged around it to turn it: it goes round
				     with the pointer while it is held, and the token turns as far.
				     Let go, it is back on top. -->
				{@const out = across / 2 + turnReach / view.k}
				{@const swing = shaping?.held && shaping.id === token.id ? (shaping.swing ?? 0) : 0}
				{@const round = (swing * Math.PI) / 180}
				{#each [-1, 1] as side (side)}
					<button
						class="{handleLook} size-3 cursor-ew-resize touch:size-5"
						data-handle="resize"
						style:left="{side * (across / 2 + sizeReach / view.k)}px"
						title="Drag to resize"
						aria-label="Resize {token.name}: drag, or use the left and right arrow keys"
						onkeydown={(e) => handleKey(e, token, 'resize', side)}
					></button>
				{/each}
				<button
					class="{handleLook} grid size-5.5 cursor-grab place-items-center touch:size-8"
					data-handle="turn"
					style:left="{Math.sin(round) * out}px"
					style:top="{-Math.cos(round) * out}px"
					title="Drag around the token to turn it"
					aria-label="Turn {token.name}: drag around it, or use the left and right arrow keys"
					onkeydown={(e) => handleKey(e, token, 'turn')}
				>
					<svg
						class="pointer-events-none size-[62%]"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5" />
					</svg>
				</button>
				{#if shaping?.held && shaping.id === token.id}
					<!-- How big it is being made, or how far round it is being turned,
					     written over the top of it for as long as a handle is held. -->
					<div
						class="pointer-events-none absolute left-0 size-0 scale-(--inv)"
						style:top="{-out}px"
						aria-hidden="true"
					>
						<span
							class="absolute bottom-4.5 left-0 -translate-x-1/2 rounded-full border border-accent bg-night/90 px-2 py-0.5 text-xs font-semibold whitespace-nowrap touch:bottom-6"
						>
							{shaping.size !== undefined ? `${feetCount(cellsToFeet(map, shaping.size), units)} across` : `${turn}°`}
						</span>
					</div>
				{/if}
			{/if}
		</div>
	{/each}
{/if}
