<script lang="ts">
	// Whose turn it is on a battle map: the tokens that take turns, down the
	// side of the map in the order they take them, the one whose turn it is
	// ringed in gold. Everyone sees it. The GM runs it: moves on to the next
	// turn, reorders the tokens, takes one out, and ends the fight.
	//
	// Tokens are put in the order from the map, with the buttons under a
	// selected token. Until one is, this is not there at all.

	import { movedTurn, nextTurn } from '#lib/shared/turns.ts';
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
		/** The GM changed the order, whose turn it is, or the round. */
		onchange: (turns: Partial<Turns>) => void;
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
	/** The token of the order that is selected on the map: the GM's buttons act on it. */
	const picked = $derived(line.find((token) => token.id === selectedId) ?? null);
	const started = $derived(turns.current !== null);

	/** Moves on to the next turn. The first time, that is the first token's. */
	export function next() {
		const turn = nextTurn(turns, here);
		if (turn) onchange(turn);
	}

	function move(token: Token, by: -1 | 1) {
		onchange({ order: movedTurn(turns.order, token.id, by, here) });
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
			     with its initials. The one whose turn it is wears the gold ring. -->
			<ol class="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto px-0.5 py-1 scrollbar-none">
				{#each line as token (token.id)}
					{@const current = turns.current === token.id}
					<li class="flex">
						<button
							class={[
								'relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-(--c) leading-none font-semibold text-[#12151c] transition-[scale] duration-120',
								passive ? 'size-14 text-xl' : 'size-9 text-[13px] touch:size-11',
								passive ? 'cursor-default' : 'cursor-pointer',
								current ? 'scale-110 border-white token-selected' : 'border-[#12151c]',
								picked?.id === token.id && !current && 'border-accent',
								token.hidden && 'border-dashed opacity-60',
								token.marks.includes('down') && 'brightness-60 saturate-0'
							]}
							style:--c={token.color}
							title="{token.name}{current ? ' · their turn' : ''}{token.hidden
								? ' · hidden from players'
								: ''}"
							aria-label="{token.name}{current ? ', their turn' : ''}"
							aria-current={current ? 'step' : undefined}
							disabled={passive}
							onclick={() => onpick(token.id)}
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
				{#if picked}
					<!-- For the token of the order that is selected on the map. -->
					<div class="grid gap-1.5 border-t pt-1.5" role="group" aria-label={picked.name}>
						<ToolButton
							tip="bottom"
							icon="up"
							label="Earlier in the order"
							disabled={here[0] === picked.id}
							onclick={() => move(picked, -1)}
						/>
						<ToolButton
							tip="bottom"
							icon="down"
							label="Later in the order"
							disabled={here.at(-1) === picked.id}
							onclick={() => move(picked, 1)}
						/>
					</div>
				{/if}
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
