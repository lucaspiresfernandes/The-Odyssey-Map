<script lang="ts">
	// The buttons that float beside whatever is selected on a battle map: one
	// token, one drawing, or a whole catch of them. Each button is there only
	// for those it would do something for.
	//
	// A token is the whole table's: its label, its lock, its marks, its look,
	// copying it, and taking it off the map. Hiding it is the GM's, and so is
	// saying whether it takes turns. Turning and resizing it are not done from
	// here: the map has handles for those on the token itself. A drawing is
	// changed and rubbed out by whoever made it, and by the GM.

	import { canChangeDrawing, canHideToken } from '#lib/shared/rules.ts';
	import { joinedTurns } from '#lib/shared/turns.ts';
	import {
		LIMITS,
		TOKEN_MARKS,
		isTemplate,
		type Command,
		type Drawing,
		type Role,
		type Token,
		type TokenInput,
		type TokenMark,
		type Turns
	} from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		tokens: Token[];
		drawings: Drawing[];
		/** Who takes turns on this map, for the button that puts a token among them. */
		turns: Turns;
		role: Role;
		userId: string;
		/** Which side the buttons' tooltips come out on: away from what is selected. */
		tip: 'top' | 'bottom';
		/** Carries the commands out. `note` is said once they are, with a way to undo them. */
		send: (commands: Command[], note?: string) => Promise<boolean>;
		/** Copies were asked for. Whoever carries these out selects what they make. */
		oncopy: (commands: Command[]) => void;
		/** The rest of what a token is: its picture, its colour, its outline. */
		onedit: (token: Token) => void;
		/** A text is to be reworded, there on the map. */
		onwrite: (drawing: Drawing) => void;
		/** What was selected is on its way out. */
		onclear: () => void;
	}

	let {
		tokens,
		drawings,
		turns,
		role,
		userId,
		tip,
		send,
		oncopy,
		onedit,
		onwrite,
		onclear
	}: Props = $props();

	const gm = $derived(canHideToken(role));
	const erasable = $derived(drawings.filter((d) => canChangeDrawing(role, userId, d)));
	/** The one token selected, when that is all there is. */
	const one = $derived(tokens.length === 1 && drawings.length === 0 ? tokens[0] : null);
	/** The one text selected, likewise, if it is this person's to reword. */
	const text = $derived(
		tokens.length === 0 && drawings.length === 1 && erasable[0]?.kind === 'text' ? erasable[0] : null
	);
	const allLocked = $derived(tokens.length > 0 && tokens.every((t) => t.locked));
	const allHidden = $derived(tokens.length > 0 && tokens.every((t) => t.hidden));
	const allTakeTurns = $derived(
		tokens.length > 0 && tokens.every((t) => turns.order.includes(t.id))
	);
	const several = $derived(tokens.length > 1);
	const removable = $derived(tokens.length + erasable.length);

	let labelling = $state(false);
	let label = $state('');
	/** The marks are out, to put on what is selected or take off it. */
	let marking = $state(false);

	/**
	 * Puts the caret in the label's box, with what is there selected to type
	 * over. The button that opened the box has the focus by then, and the
	 * browser only focuses a new field by itself when nothing else has it.
	 */
	function takeFocus(box: HTMLInputElement) {
		box.focus();
		box.select();
	}

	// A label being typed is for the token it was started on.
	$effect(() => {
		void one?.id;
		labelling = false;
	});

	// The marks are put away with the last token.
	$effect(() => {
		if (tokens.length === 0) marking = false;
	});

	const update = (token: Token, changes: Partial<TokenInput>): Command => ({
		t: 'token.update',
		id: token.id,
		changes
	});

	function lock() {
		const locked = !allLocked;
		send(tokens.filter((t) => t.locked !== locked).map((t) => update(t, { locked })));
	}

	function hide() {
		const hidden = !allHidden;
		send(tokens.filter((t) => t.hidden !== hidden).map((t) => update(t, { hidden })));
	}

	/** Whether every token selected wears this mark. */
	const marked = (mark: TokenMark) => tokens.every((t) => t.marks.includes(mark));

	/** Marks are changed one at a time, in the order they were clicked. */
	let marksTurn: Promise<unknown> = Promise.resolve();

	/**
	 * Puts a mark on every token selected, or when they all wear it, takes it
	 * off them. A token's marks are sent whole, so each change waits for the
	 * one before it: two marks clicked in a hurry would otherwise each be
	 * added to the marks as they were before either, and the second would
	 * undo the first.
	 */
	function mark(mark: TokenMark) {
		marksTurn = marksTurn.then(() => {
			const off = marked(mark);
			return send(
				tokens
					.filter((t) => t.marks.includes(mark) === off)
					.map((t) =>
						update(t, { marks: off ? t.marks.filter((m) => m !== mark) : [...t.marks, mark] })
					)
			);
		});
	}

	/** Puts the tokens selected at the end of the turn order, or when they are all in it, takes them out. */
	function takeTurns() {
		const ids = tokens.map((t) => t.id);
		const order = allTakeTurns
			? turns.order.filter((id) => !ids.includes(id))
			: joinedTurns(turns.order, ids);
		send([{ t: 'map.update', id: tokens[0].mapId, turns: { order } }]);
	}

	function saveLabel(event: SubmitEvent) {
		event.preventDefault();
		const name = label.trim();
		if (one && name && name !== one.name) send([update(one, { name })]);
		labelling = false;
	}

	/** Takes off the map everything selected that is this person's to take off. */
	export function remove() {
		const commands: Command[] = [
			...tokens.map((t): Command => ({ t: 'token.delete', id: t.id })),
			...erasable.map((d): Command => ({ t: 'drawing.delete', id: d.id }))
		];
		if (commands.length === 0) return;
		let note = `Deleted ${commands.length} things.`;
		if (commands.length === 1) {
			note =
				tokens.length
					? `Deleted “${tokens[0].name}”.`
					: `Rubbed out the ${erasable[0].kind === 'text' ? 'text' : isTemplate(erasable[0].kind) ? 'template' : 'drawing'}.`;
		}
		onclear();
		send(commands, note);
	}
</script>

{#if tokens.length > 0 || removable > 0}
	<div
		class="flex items-center gap-1 rounded-xl border border-[#55607a] bg-panel/94 p-1 shadow-pop"
		role="toolbar"
		aria-label={one ? `Token ${one.name}` : 'Selection'}
	>
		{#if labelling && one}
			<form class="flex items-center gap-1" onsubmit={saveLabel}>
				<input
					class="input min-h-7 w-44 py-0 text-[13px] touch:min-h-9 touch:text-base"
					bind:value={label}
					maxlength={LIMITS.tokenName}
					aria-label="Label"
					required
					use:takeFocus
					onkeydown={(e) => {
						if (e.key !== 'Escape') return;
						// Only the label is put away, not the selection with it.
						e.stopPropagation();
						labelling = false;
					}}
				/>
				<button class="btn btn-sm btn-primary">Save</button>
			</form>
		{:else if marking && tokens.length}
			<!-- The marks, each a disc of its own colour (--c): lit while every
			     token selected wears it. The first crosses a token out. -->
			<div class="flex items-center gap-1.5 px-1" role="group" aria-label="Marks">
				{#each TOKEN_MARKS as option (option.id)}
					{@const on = marked(option.id)}
					<button
						class={[
							'grid size-6 cursor-pointer place-items-center rounded-full border-2 bg-(--c) touch:size-8',
							on ? 'border-white token-selected' : 'border-[#55607a]'
						]}
						style:--c={option.color}
						style:font-size="24px"
						aria-pressed={on}
						aria-label={option.id === 'down' ? 'Down' : `${option.label} mark`}
						title={option.id === 'down' ? 'Down: crosses the token out' : `${option.label} mark`}
						onclick={() => mark(option.id)}
						onkeydown={(e) => {
							if (e.key !== 'Escape') return;
							// Only the marks are put away, not the selection with them.
							e.stopPropagation();
							marking = false;
						}}
					>
						{#if option.id === 'down'}
							<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
								<path
									d="M5 5 19 19M19 5 5 19"
									fill="none"
									stroke="#e5544b"
									stroke-width="4"
									stroke-linecap="round"
								/>
							</svg>
						{/if}
					</button>
				{/each}
				<button class="btn btn-sm" onclick={() => (marking = false)}>Done</button>
			</div>
		{:else}
			{#if tokens.length}
				{#if one}
					<ToolButton
						small
						{tip}
						icon="label"
						label="Label"
						onclick={() => {
							label = one.name;
							labelling = true;
						}}
					/>
				{/if}
				<ToolButton
					small
					{tip}
					icon={allLocked ? 'unlock' : 'lock'}
					label={allLocked ? 'Unlock' : 'Lock in place'}
					active={allLocked}
					onclick={lock}
				/>
				<ToolButton
					small
					{tip}
					icon="mark"
					label="Marks"
					hint="Pips on its rim, or crossed out"
					active={tokens.some((t) => t.marks.length > 0)}
					onclick={() => (marking = true)}
				/>
				<ToolButton
					small
					{tip}
					icon="duplicate"
					label={several ? 'Duplicate them' : 'Duplicate'}
					onclick={() => oncopy(tokens.map((t) => ({ t: 'token.duplicate', id: t.id })))}
				/>
				{#if one}
					<ToolButton
						small
						{tip}
						icon="image"
						label="Picture, colour and outline"
						onclick={() => onedit(one)}
					/>
				{/if}
			{/if}
			{#if text}
				<ToolButton small {tip} icon="rename" label="Change the text" onclick={() => onwrite(text)} />
			{/if}
			{#if gm && tokens.length}
				<span class="w-px self-stretch bg-line"></span>
				<ToolButton
					small
					{tip}
					icon="turns"
					label={allTakeTurns ? 'Take out of the turn order' : 'Add to the turn order'}
					active={allTakeTurns}
					onclick={takeTurns}
				/>
				<ToolButton
					small
					{tip}
					icon={allHidden ? 'reveal' : 'hide'}
					label={allHidden ? 'Reveal to players' : 'Hide from players'}
					active={allHidden}
					onclick={hide}
				/>
			{/if}
			{#if removable}
				<ToolButton
					small
					{tip}
					danger
					icon="delete"
					label={removable > 1 ? `Delete all ${removable}` : tokens.length ? 'Delete' : 'Rub out'}
					onclick={remove}
				/>
			{/if}
		{/if}
	</div>
{/if}
