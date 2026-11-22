<script lang="ts">
	// The dock in the upper left corner of a battle map: what the table is
	// told. It is one box with two tabs, a button each at its top. Click one
	// and what it holds opens under it. Click it again and it is put away,
	// and the box is its two buttons.
	//
	// The first tab is whose turn it is, and is the one that is open: the
	// tokens that take turns, in the order they take them, the one whose turn
	// it is ringed in gold. Everyone sees it. The GM runs it: starts the
	// fight, sorts the tokens by dragging them up and down the line, or by
	// typing in what each rolled, goes back a turn when one was ended by
	// mistake, and ends the fight. Ending a turn is the
	// table's: a token that is some player's has its turn ended by them, and
	// one that is nobody's by any player who can see it.
	//
	// Who takes turns is said here too, and nowhere else: the GM selects
	// tokens on the map, and the plus beside the round puts them in the
	// order, or takes them out.
	//
	// The second tab is who is at the table now, each by name.
	//
	// A table display has no tabs: it shows the turn order, once there is one.

	import { KEY } from '#lib/client/keys.ts';
	import { canEndTurn } from '#lib/shared/rules.ts';
	import { joinedTurns, reorderedTurns, sortedByRolls } from '#lib/shared/turns.ts';
	import { LIMITS, imageUrl, type Presence, type Token, type Turns } from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		campaignId: string;
		/** The tokens on the map that this person can see. */
		tokens: Token[];
		turns: Turns;
		/** Who is at the table now. */
		online: Presence[];
		gm: boolean;
		/** Who is looking: a token that is theirs has its turn ended by them. */
		userId: string;
		/** A table display: the order is shown, and nothing about it can be touched. */
		passive?: boolean;
		/** Neither tab is open: the dock is its buttons and nothing more. */
		collapsed: boolean;
		/**
		 * What is selected on the map. The tokens among it are marked here too,
		 * and are the ones the GM puts in the order or takes out of it.
		 */
		selectedIds: string[];
		/** A token here was clicked: the map selects it. */
		onpick: (id: string) => void;
		/**
		 * The GM changed the order, whose turn it is, or the round. Resolves
		 * once the server has taken the change, or refused it.
		 */
		onchange: (turns: Partial<Turns>) => Promise<unknown>;
		/** The turn is over: on to the next. The first time, for the GM, that is the first token's. */
		onnext: () => void;
		/** The GM takes the turn back: the one before it is on again. */
		onback: () => void;
	}

	let {
		campaignId,
		tokens,
		turns,
		online,
		gm,
		userId,
		passive = false,
		collapsed = $bindable(),
		selectedIds,
		onpick,
		onchange,
		onnext,
		onback
	}: Props = $props();

	/** The tab that is open, or while the dock is collapsed, the one that was open last. */
	let tab = $state<'turns' | 'table'>('turns');
	const open = $derived(collapsed ? null : tab);

	/** A button of the dock: it opens its tab, or puts it away when it is the one open. */
	function toggle(which: 'turns' | 'table') {
		if (open === which) {
			collapsed = true;
			return;
		}
		tab = which;
		collapsed = false;
	}

	/** The tokens that take turns, in order: the ones still on the map. */
	const line = $derived(
		turns.order.flatMap((id) => {
			const token = tokens.find((each) => each.id === id);
			return token ? [token] : [];
		})
	);
	const here = $derived(line.map((token) => token.id));
	const started = $derived(turns.current !== null);
	/**
	 * The GM is typing in what each token rolled: what has been typed so far,
	 * by token id. Null while the rolls are put away.
	 */
	let rolling = $state<Record<string, number | null> | null>(null);
	/** The line is the GM's to sort, by dragging a token up or down it. Not while the rolls are out. */
	const sortable = $derived(gm && !passive && !rolling);

	/** The token whose turn it is, if it is one this person can see. */
	const acting = $derived(line.find((token) => token.id === turns.current) ?? null);
	/** It is the turn of a token that is this person's own. */
	const mine = $derived(!passive && acting?.ownerId === userId);
	/**
	 * Whether this person can end the turn. The GM always can, and starts the
	 * fight. A player ends the turn of their own token, and of one that is
	 * nobody's, if they can see it: one they can't see is the GM's to move on
	 * from, and another player's is that player's.
	 */
	const canPass = $derived(
		!passive && (gm || (acting !== null && canEndTurn('player', userId, acting)))
	);

	// ------------------------------------------------------ who takes turns

	/** The order is this person's to run: the GM, anywhere but on a table display. */
	const runs = $derived(gm && !passive);
	/** The tokens selected on the map. */
	const picked = $derived(tokens.filter((token) => selectedIds.includes(token.id)));
	/** Every token selected takes turns already: the button takes them out. */
	const allIn = $derived(picked.length > 0 && picked.every((t) => turns.order.includes(t.id)));
	const those = $derived(picked.length === 1 ? 'the selected token' : `the ${picked.length} selected tokens`);
	/** What the button that does it says, as things stand. */
	const joining = $derived(
		picked.length === 0
			? {
					label: line.length ? 'Add tokens to the turn order' : 'Start a turn order',
					hint: 'Select the tokens that take turns on the map first'
				}
			: allIn
				? { label: `Take ${those} out`, hint: undefined }
				: line.length
					? { label: `Add ${those}`, hint: 'At the end of the turn order' }
					: { label: `Start a turn order with ${those}`, hint: undefined }
	);
	/** How the fight stands, in a word or two. */
	const status = $derived(
		started ? `Round ${turns.round}` : line.length ? 'Not started' : 'No turns yet'
	);

	/**
	 * Puts the tokens selected on the map at the end of the order, or when
	 * they are all in it, takes them out. The GM's, and undone with Ctrl+Z.
	 */
	export function join() {
		if (!runs || rolling || picked.length === 0) return;
		// What the key did shows in the turn order, so that is the tab to have.
		tab = 'turns';
		const ids = picked.map((token) => token.id);
		if (!allIn) return void onchange({ order: joinedTurns(turns.order, ids) });
		const order = turns.order.filter((id) => !ids.includes(id));
		// With the last one out, the fight is over.
		onchange(order.length ? { order } : { order, current: null, round: 1 });
	}

	/** Moves on to the next turn, if that is this person's to do. */
	export function next() {
		if (canPass) onnext();
	}

	/**
	 * Goes back to the turn before: the GM's, for a turn ended by mistake,
	 * a second press of the button most of all. Back from the first turn of
	 * all is the fight not yet started.
	 */
	export function back() {
		if (runs && started) onback();
	}

	// ----------------------------------------------------------- initiative

	function startRolling() {
		const typed: Record<string, number | null> = {};
		for (const id of here) typed[id] = turns.rolls?.[id] ?? null;
		rolling = typed;
	}

	/** The GM's key for the rolls: the boxes come out, opening the turn order if it was put away. */
	export function roll() {
		if (!gm || passive || line.length === 0 || rolling) return;
		tab = 'turns';
		collapsed = false;
		startRolling();
	}

	/** Ends the fight: nobody takes turns any more. The GM's, and undone with Ctrl+Z. */
	export function end() {
		if (!gm || passive || line.length === 0) return;
		rolling = null;
		onchange({ order: [], current: null, round: 1 });
	}

	/**
	 * The rolls are done: they are kept, and the line is sorted by them, the
	 * highest first. A token with nothing typed keeps its place after the
	 * ones that rolled.
	 */
	function keepRolls() {
		const typed = rolling;
		rolling = null;
		if (!typed) return;
		const rolls: Record<string, number> = { ...turns.rolls };
		for (const [id, roll] of Object.entries(typed)) {
			// An emptied number field reads as null: that token has no roll.
			if (typeof roll !== 'number' || !Number.isFinite(roll)) delete rolls[id];
			else rolls[id] = Math.min(LIMITS.rollMax, Math.max(LIMITS.rollMin, Math.round(roll)));
		}
		onchange({ rolls, order: sortedByRolls(turns.order, rolls) });
	}

	/** Puts the caret in the first roll, the moment the boxes are on the page. */
	function takeFocus(box: HTMLInputElement, first: boolean) {
		if (first) box.focus();
	}

	/** Enter in a roll goes on to the next one down the line, and after the last, sorts. */
	function nextRoll(box: HTMLInputElement) {
		const boxes = [...(list?.querySelectorAll('input') ?? [])];
		const next = boxes[boxes.indexOf(box) + 1];
		if (!next) return keepRolls();
		next.focus();
		next.select();
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

<!-- The turn order itself. Each token is a row: a disc like the one on the
     map, with its picture, or its colour (--c) and its initials, and its name
     beside it. The one whose turn it is wears the gold ring. The whole row is
     the button: the GM drags it up or down the line to sort it, and the line
     makes room as it goes. A table display has the same rows, drawn large. -->
{#snippet order()}
	<ol
		class="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1.5 py-1 scrollbar-none"
		bind:this={list}
	>
		{#each shown as token, i (token.id)}
			{@const current = turns.current === token.id}
			{@const held = drag?.id === token.id}
			{@const down = token.marks.includes('down')}
			<li class="flex min-w-0 items-center gap-1.5" data-id={token.id}>
				<button
					class={[
						'flex min-w-0 grow items-center rounded-full text-left select-none',
						passive ? 'gap-3' : 'gap-2',
						passive ? 'cursor-default' : !sortable ? 'cursor-pointer' : held ? 'cursor-grabbing' : 'cursor-grab',
						sortable && 'touch-none',
						token.hidden && 'opacity-60'
					]}
					title="{token.name}{token.ownerName
						? token.ownerId === userId
							? ' · yours'
							: ` · ${token.ownerName}’s`
						: ''}{current ? ' · their turn' : ''}{token.hidden
						? ' · hidden from players'
						: ''}{sortable ? ' · drag to sort' : ''}"
					aria-label="{token.name}{current ? ', their turn' : ''}{sortable
						? '. Alt with the up and down arrow keys moves it in the order.'
						: ''}"
					aria-current={current ? 'step' : undefined}
					aria-keyshortcuts={sortable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
					tabindex={rolling ? -1 : undefined}
					disabled={passive}
					data-turn={token.id}
					onpointerdown={(e) => onpointerdown(e, token)}
					onclick={(e) => {
						// Enter or Space. A pointer's click was already answered above.
						if (e.detail === 0) onpick(token.id);
					}}
					onkeydown={(e) => onkeydown(e, token)}
				>
					<span
						class={[
							'relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-(--c) leading-none font-semibold text-[#12151c] transition-[scale] duration-120',
							passive ? 'size-14 text-xl' : 'size-9 text-[13px] touch:size-11',
							held ? 'z-1 scale-125 token-lifted' : current && 'scale-110',
							current ? 'border-white token-selected' : 'border-[#12151c]',
							selectedIds.includes(token.id) && !current && 'border-accent',
							token.hidden && 'border-dashed',
							down && 'brightness-60 saturate-0'
						]}
						style:--c={token.color}
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
					</span>
					<span
						class={[
							'min-w-0 truncate',
							passive ? 'max-w-56 pr-2 text-lg' : 'text-[13px]',
							current ? 'font-semibold' : 'text-muted',
							down && 'line-through'
						]}
					>
						{token.name}
					</span>
				</button>
				{#if rolling}
					<!-- What it rolled, beside it, while the GM has the rolls out. -->
					<input
						class="input min-h-7 w-12 shrink-0 px-1.5 py-0 text-center text-[13px] tabular-nums touch:min-h-9 touch:text-base"
						type="number"
						min={LIMITS.rollMin}
						max={LIMITS.rollMax}
						step="1"
						inputmode="numeric"
						bind:value={rolling[token.id]}
						aria-label="What {token.name} rolled"
						use:takeFocus={i === 0}
						onkeydown={(e) => {
							if (e.key === 'Enter') nextRoll(e.currentTarget);
							if (e.key !== 'Escape') return;
							// Only the rolls are put away, with nothing kept.
							e.stopPropagation();
							rolling = null;
						}}
					/>
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

{#if passive}
	{#if line.length}
		<!-- A table display: the turn order and nothing else, drawn large. The
		     box is as wide as its longest name, up to where a name is cut. -->
		<div
			class="flex max-h-[calc(100dvh-220px)] min-h-0 flex-col gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop"
			role="group"
			aria-label="Turn order"
		>
			<span class="px-1 text-center text-base font-semibold whitespace-nowrap text-muted tabular-nums">
				{started ? `Round ${turns.round}` : 'Turns'}
			</span>
			{@render order()}
		</div>
	{/if}
{:else}
	<!-- With a tab open the box has one width, whichever tab it is, so it
	     never jumps as they are switched: room for a token's name beside its
	     disc, and for what it rolled beside that. -->
	<div
		class={[
			'flex max-h-[calc(100dvh-220px)] min-h-0 flex-col gap-1.5 rounded-xl border bg-panel/94 p-1.5 shadow-pop',
			open && 'w-48 touch:w-52'
		]}
		data-table-dock={open ?? 'closed'}
	>
		<!-- The tabs. Each opens what it holds underneath, and the one that is
		     lit puts it away again. -->
		<div class="flex shrink-0 gap-1.5" role="toolbar" aria-label="What the table is told">
			<ToolButton
				tip="bottom-start"
				icon="turns"
				label="Turn order"
				hint={mine ? 'Your turn' : status}
				fill
				active={open === 'turns'}
				expanded={open === 'turns'}
				onclick={() => toggle('turns')}
			/>
			<ToolButton
				tip="bottom-start"
				icon="people"
				label="At the table"
				hint={online.length === 1 ? '1 person here now' : `${online.length} people here now`}
				fill
				active={open === 'table'}
				expanded={open === 'table'}
				onclick={() => toggle('table')}
			/>
		</div>

		{#if open === 'turns'}
			<div class="flex min-h-0 flex-col gap-1.5 border-t pt-1.5" role="group" aria-label="Turn order">
				<!-- How the fight stands, and for the GM, the way into the order
				     and out of it for the tokens selected on the map. -->
				<div class="flex min-h-9 shrink-0 items-center gap-1.5 touch:min-h-11">
					<span
						class={[
							'grow px-1 text-xs font-semibold tabular-nums',
							mine ? 'text-accent' : 'text-muted'
						]}
						role={mine ? 'status' : undefined}
					>
						{mine ? 'Your turn' : status}
					</span>
					{#if runs}
						<ToolButton
							tip="bottom-start"
							icon={allIn ? 'minus' : 'plus'}
							label={joining.label}
							hint={joining.hint}
							shortcut={KEY.turns}
							disabled={picked.length === 0 || rolling !== null}
							onclick={join}
						/>
					{/if}
				</div>

				{#if line.length}
					{@render order()}

					{#if runs}
						<div class="flex gap-1.5 border-t pt-1.5">
							{#if rolling}
								<button class="btn btn-sm btn-primary grow" onclick={keepRolls}>Sort</button>
								<button class="btn btn-sm btn-ghost" onclick={() => (rolling = null)}>Cancel</button>
							{:else}
								<ToolButton
									tip="bottom-start"
									icon="previous"
									label="Back a turn"
									hint="For a turn ended by mistake"
									shortcut={KEY.prevTurn}
									fill
									disabled={!started}
									onclick={back}
								/>
								<ToolButton
									tip="bottom-start"
									icon="next"
									label={started ? 'Next turn' : 'Start the first turn'}
									shortcut={KEY.nextTurn}
									fill
									onclick={next}
								/>
								<ToolButton
									tip="bottom"
									icon="dice"
									label="Sort by what they rolled"
									hint="Type each token's roll: the highest goes first"
									shortcut={KEY.rolls}
									fill
									onclick={startRolling}
								/>
								<ToolButton
									tip="bottom"
									icon="close"
									danger
									label="End the fight"
									hint="Empties the turn order. Ctrl+Z brings it back"
									shortcut={KEY.endFight}
									fill
									onclick={end}
								/>
							{/if}
						</div>
					{:else if canPass}
						<!-- A player ends the turn of a token they can see: their own, most of all. -->
						<div class="flex shrink-0 border-t pt-1.5">
							<ToolButton
								tip="bottom"
								icon="next"
								label={mine ? 'End your turn' : 'End this turn'}
								shortcut={KEY.nextTurn}
								fill
								onclick={next}
							/>
						</div>
					{/if}
				{/if}
			</div>
		{:else if open === 'table'}
			<!-- Who is at the table now: the GM in gold, and a word beside whoever
			     is looking. -->
			<ul
				class="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-t px-1 pt-2 pb-0.5 scrollbar-none"
				aria-label="At the table now"
			>
				{#each online as person (person.id)}
					<li class="flex items-center gap-2">
						<span
							class={[
								'grid size-6.5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
								person.role === 'gm' ? 'bg-accent text-accent-ink' : 'bg-[#3a465c]'
							]}
							aria-hidden="true"
						>
							{initials(person.name)}
						</span>
						<span class="min-w-0 grow truncate text-[13px]" title={person.name}>{person.name}</span>
						{#if person.role === 'gm'}
							<span class="text-[11px] font-semibold text-accent">GM</span>
						{:else if person.id === userId}
							<span class="text-[11px] text-muted">you</span>
						{/if}
					</li>
				{:else}
					<li class="text-xs text-muted">Nobody yet.</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
