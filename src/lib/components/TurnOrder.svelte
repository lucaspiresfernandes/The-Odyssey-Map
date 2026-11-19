<script lang="ts">
	// Whose turn it is on a battle map: the tokens that take turns, down the
	// side of the map in the order they take them, the one whose turn it is
	// ringed in gold. Everyone sees it. The GM runs it: moves on to the next
	// turn, sorts the tokens by dragging them up and down the line, and ends
	// the fight.
	//
	// Tokens are put in the order from the map, with the buttons under a
	// selected token. Until one is, this is not there at all.

	import { nextTurn, reorderedTurns } from '#lib/shared/turns.ts';
	import { imageUrl, type Token, type Turns } from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		campaignId: string;
		/** The tokens on the map that this person can see. */
		tokens: Token[];
		turns: Turns;
		gm: boolean;
		/** A table display: the order is shown, and nothing about it can be touched. */
		passive?: boolean;
		collapsed: boolean;
		/** The token selected on the map, when it is the only one: it is marked here too. */
		selectedId: string | null;
		/** A token here was clicked: the map selects it. */
		onpick: (id: string) => void;
		/**
		 * The GM changed the order, whose turn it is, or the round. Resolves
		 * once the server has taken the change, or refused it.
		 */
		onchange: (turns: Partial<Turns>) => Promise<unknown>;
	}

	let {
		campaignId,
		tokens,
		turns,
		gm,
		passive = false,
		collapsed = $bindable(),
		selectedId,
		onpick,
		onchange
	}: Props = $props();

	/** The tokens that take turns, in order: the ones still on the map. */
	const line = $derived(
		turns.order.flatMap((id) => {
			const token = tokens.find((each) => each.id === id);
			return token ? [token] : [];
		})
	);
	const here = $derived(line.map((token) => token.id));
	const started = $derived(turns.current !== null);
	/** The line is the GM's to sort, by dragging a token up or down it. */
	const sortable = $derived(gm && !passive);

	/** Moves on to the next turn. The first time, that is the first token's. */
	export function next() {
		const turn = nextTurn(turns, here);
		if (turn) onchange(turn);
	}

	// ------------------------------------------------------------- sorting

	let list = $state<HTMLOListElement>();
	/** A press on a token of the line, which is a click until it has gone somewhere. */
	let press: { id: string; y: number; pointer: number; moved: boolean } | null = null;
	/** The token the GM has in hand, and the place in the line the pointer has taken it to. */
	let drag = $state.raw<{ id: string; to: number } | null>(null);
	/** The line as it was let go, kept until the server has it so, so it never jumps back. */
	let resting = $state.raw<string[] | null>(null);

	/** The line with one token put at another place in it. */
	function placed(ids: string[], id: string, to: number): string[] {
		const rest = ids.filter((each) => each !== id);
		rest.splice(to, 0, id);
		return rest;
	}

	/** The line as it is drawn: as it is being sorted, as it was let go, or as it is. */
	const shown = $derived.by(() => {
		const ids = drag ? placed(here, drag.id, drag.to) : resting;
		if (!ids) return line;
		const sorted = ids.flatMap((id) => line.find((token) => token.id === id) ?? []);
		// Anyone who joined the line meanwhile goes at the end, as they do in the order.
		return [...sorted, ...line.filter((token) => !ids.includes(token.id))];
	});

	/** Which place in the line a spot of the screen is: how many of the other tokens sit above it. */
	function placeAt(y: number, id: string): number {
		let above = 0;
		for (const item of list?.children ?? []) {
			if ((item as HTMLElement).dataset.id === id) continue;
			const box = item.getBoundingClientRect();
			if (box.top + box.height / 2 < y) above++;
		}
		return above;
	}

	// The line is redrawn as it is sorted, which moves the very element that
	// was pressed. So the rest of the drag is listened for on the window.
	function listen(on: boolean) {
		const heard = { pointermove: onpointermove, pointerup: onpointerup, pointercancel: onpointercancel };
		for (const [type, listener] of Object.entries(heard)) {
			if (on) window.addEventListener(type, listener as EventListener);
			else window.removeEventListener(type, listener as EventListener);
		}
	}

	function onpointerdown(e: PointerEvent, token: Token) {
		if (passive || press || (e.pointerType === 'mouse' && e.button !== 0)) return;
		press = { id: token.id, y: e.clientY, pointer: e.pointerId, moved: false };
		listen(true);
	}

	function onpointermove(e: PointerEvent) {
		if (!press || e.pointerId !== press.pointer || !sortable) return;
		if (!press.moved && Math.abs(e.clientY - press.y) < 6) return;
		press.moved = true;
		drag = { id: press.id, to: placeAt(e.clientY, press.id) };
	}

	function onpointerup(e: PointerEvent) {
		if (!press || e.pointerId !== press.pointer) return;
		const { id, moved } = press;
		const sorted = drag ? placed(here, drag.id, drag.to) : null;
		letGo();
		// A press that went nowhere was a click: the map selects that token.
		if (!moved) return onpick(id);
		if (!sorted || sorted.every((each, i) => each === here[i])) return;
		resting = sorted;
		onchange({ order: reorderedTurns(turns.order, sorted) }).finally(() => {
			if (resting === sorted) resting = null;
		});
	}

	function onpointercancel(e: PointerEvent) {
		if (press && e.pointerId === press.pointer) letGo();
	}

	function letGo() {
		press = null;
		drag = null;
		listen(false);
	}

	$effect(() => letGo);

	/** A token of the line with the focus: Enter selects it, Alt with an arrow moves it a place. */
	function onkeydown(e: KeyboardEvent, token: Token) {
		const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
		if (!sortable || !e.altKey || !by) return;
		e.preventDefault();
		const to = here.indexOf(token.id) + by;
		if (e.repeat || to < 0 || to >= here.length) return;
		onchange({ order: reorderedTurns(turns.order, placed(here, token.id, to)) });
	}

	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? '')
			.join('');
	}
</script>

{#if line.length}
	{#if collapsed && !passive}
		<div class="rounded-xl border bg-panel/94 p-1.5 shadow-pop">
			<ToolButton
				tip="bottom"
				icon="turns"
				label="Show the turn order"
				hint={started ? `Round ${turns.round}` : undefined}
				active={started}
				onclick={() => (collapsed = false)}
			/>
		</div>
	{:else}
		<div
			class="flex max-h-[calc(100dvh-220px)] flex-col gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop"
			role="group"
			aria-label="Turn order"
		>
			<div class="flex items-center justify-between gap-1.5">
				{#if !passive}
					<ToolButton
						tip="bottom"
						icon="up"
						label="Fold the turn order away"
						onclick={() => (collapsed = true)}
					/>
				{/if}
				<span
					class={[
						'grow px-1 text-center font-semibold whitespace-nowrap text-muted tabular-nums',
						passive ? 'text-base' : 'text-xs'
					]}
				>
					{started ? `Round ${turns.round}` : 'Turns'}
				</span>
			</div>

			<!-- Each token as a disc, like on the map: its picture, or its colour (--c)
			     with its initials. The one whose turn it is wears the gold ring. The
			     GM drags one up or down the line to sort it, and the line makes
			     room as it goes. -->
			<ol
				class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto px-1.5 py-1 scrollbar-none"
				bind:this={list}
			>
				{#each shown as token (token.id)}
					{@const current = turns.current === token.id}
					{@const held = drag?.id === token.id}
					<li class="flex" data-id={token.id}>
						<button
							class={[
								'relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-(--c) leading-none font-semibold text-[#12151c] transition-[scale] duration-120 select-none',
								passive ? 'size-14 text-xl' : 'size-9 text-[13px] touch:size-11',
								passive ? 'cursor-default' : !sortable ? 'cursor-pointer' : held ? 'cursor-grabbing' : 'cursor-grab',
								sortable && 'touch-none',
								held ? 'z-1 scale-125 token-lifted' : current && 'scale-110',
								current ? 'border-white token-selected' : 'border-[#12151c]',
								selectedId === token.id && !current && 'border-accent',
								token.hidden && 'border-dashed opacity-60',
								token.marks.includes('down') && 'brightness-60 saturate-0'
							]}
							style:--c={token.color}
							title="{token.name}{current ? ' · their turn' : ''}{token.hidden
								? ' · hidden from players'
								: ''}{sortable ? ' · drag to sort' : ''}"
							aria-label="{token.name}{current ? ', their turn' : ''}{sortable
								? '. Alt with the up and down arrow keys moves it in the order.'
								: ''}"
							aria-current={current ? 'step' : undefined}
							aria-keyshortcuts={sortable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
							disabled={passive}
							onpointerdown={(e) => onpointerdown(e, token)}
							onclick={(e) => {
								// Enter or Space. A pointer's click was already answered above.
								if (e.detail === 0) onpick(token.id);
							}}
							onkeydown={(e) => onkeydown(e, token)}
						>
							{initials(token.name)}
							{#if token.image}
								<img
									class="pointer-events-none absolute inset-0 size-full object-cover"
									src={imageUrl(campaignId, token.image)}
									alt=""
									draggable="false"
									onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
								/>
							{/if}
						</button>
					</li>
				{/each}
			</ol>

			{#if gm && !passive}
				<div class="grid gap-1.5 border-t pt-1.5">
					<ToolButton
						tip="bottom"
						icon="next"
						label={started ? 'Next turn' : 'Start the first turn'}
						shortcut="n"
						onclick={next}
					/>
					<ToolButton
						tip="bottom"
						icon="close"
						danger
						label="End the fight"
						hint="Empties the turn order. Ctrl+Z brings it back"
						onclick={() => onchange({ order: [], current: null, round: 1 })}
					/>
				</div>
			{/if}
		</div>
	{/if}
{/if}
