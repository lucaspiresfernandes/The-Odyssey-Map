<script lang="ts">
	// The buttons that float beside whatever is selected on a battle map: one
	// token, one drawing, or a whole catch of them. Each button is there only
	// for those it would do something for.
	//
	// A token is the whole table's: its label, its lock, its marks, the number
	// it carries, its look, copying it, and taking it off the map. Hiding it
	// is the GM's, and so are saying who it is a secret with, and whether it
	// takes turns. Turning and resizing it are not done from
	// here: the map has handles for those on the token itself. A drawing is
	// changed and rubbed out by whoever made it, and by the GM.

	import { canChangeDrawing, canHideToken } from '#lib/shared/rules.ts';
	import { countFrom, joinedTurns } from '#lib/shared/turns.ts';
	import {
		LIMITS,
		MARK_LOOKS,
		isTemplate,
		type Command,
		type Drawing,
		type Player,
		type Role,
		type Token,
		type TokenInput,
		type TokenMark,
		type Turns
	} from '#lib/shared/types.ts';
	import MarkIcon from './MarkIcon.svelte';
	import PlayerPicker from './PlayerPicker.svelte';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		tokens: Token[];
		drawings: Drawing[];
		/** Who takes turns on this map, for the button that puts a token among them. */
		turns: Turns;
		role: Role;
		userId: string;
		/** The players of the campaign, for the GM to choose who a hidden token is a secret with. */
		players: Player[];
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
		players,
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
	/** The number the tokens carry is being typed. */
	let counting = $state(false);
	let count = $state('');
	/** What was typed for it is no number. */
	let miscounted = $state(false);
	/** The GM is choosing which players see the tokens selected. */
	let sharing = $state(false);
	/** The players every token selected is a secret with. */
	const sharedWith = $derived(
		tokens.length
			? tokens[0].seenBy.filter((id) => tokens.every((t) => t.hidden && t.seenBy.includes(id)))
			: []
	);

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

	// The marks are put away with the last token, and so is the rest.
	$effect(() => {
		if (tokens.length === 0) marking = counting = sharing = false;
	});

	/**
	 * Says which players see the tokens selected, and nobody else at the
	 * table: each is hidden, and a secret with those.
	 */
	function share(seenBy: string[]) {
		send(tokens.map((t) => update(t, { hidden: true, seenBy })));
	}

	/**
	 * The number typed goes on every token selected: as it is, or with a sign
	 * in front, that much more or less than each had. Nothing typed takes it
	 * off them.
	 */
	function saveCount(event: SubmitEvent) {
		event.preventDefault();
		const limits = { min: LIMITS.countMin, max: LIMITS.countMax };
		const changes: Command[] = [];
		for (const token of tokens) {
			const to = countFrom(count, token.count, limits);
			if (to === undefined) return void (miscounted = true);
			if (to !== token.count) changes.push(update(token, { count: to }));
		}
		send(changes);
		counting = false;
	}

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
					: `Rubbed out the ${erasable[0].kind === 'text' ? 'text' : isTemplate(erasable[0].kind) ? 'shape' : 'drawing'}.`;
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
		{:else if counting && tokens.length}
			<form class="flex items-center gap-1" onsubmit={saveCount}>
				<input
					class={[
						'input min-h-7 w-28 py-0 text-[13px] touch:min-h-9 touch:text-base',
						miscounted && 'border-danger'
					]}
					bind:value={count}
					maxlength="8"
					inputmode="text"
					placeholder="12, +3, -5"
					aria-label="Number: a number, or + or - and how much to change it by. Empty takes it off."
					aria-invalid={miscounted}
					title="A number, or + or - and how much to change it by. Empty takes it off."
					use:takeFocus
					oninput={() => (miscounted = false)}
					onkeydown={(e) => {
						if (e.key !== 'Escape') return;
						// Only the number is put away, not the selection with it.
						e.stopPropagation();
						counting = false;
					}}
				/>
				<button class="btn btn-sm btn-primary">Save</button>
			</form>
		{:else if sharing && tokens.length}
			<!-- Who the tokens selected are shown to, and nobody else at the table. -->
			<div class="grid max-w-72 gap-1.5 p-1">
				<span class="text-xs text-muted">
					Only these players see {several ? 'them' : 'it'}:
				</span>
				<PlayerPicker
					{players}
					value={sharedWith}
					label="Players who see what is selected"
					onchange={share}
				/>
				<button class="btn btn-sm justify-self-end" onclick={() => (sharing = false)}>Done</button>
			</div>
		{:else if marking && tokens.length}
			<!-- The marks, seven to a row: lit while every token selected wears it.
			     The first crosses a token out. Then the plain ones, each a disc of
			     its own colour (--c), and under them the ones with an icon. -->
			<div class="grid grid-cols-7 gap-1.5 p-1" role="group" aria-label="Marks">
				{#each MARK_LOOKS as option (option.id)}
					{@const on = marked(option.id)}
					<button
						class={[
							'grid size-6 cursor-pointer place-items-center rounded-full border-2 bg-(--c) touch:size-8',
							on ? 'border-white token-selected' : 'border-[#55607a]'
						]}
						style:--c={option.icon ? '#12151c' : option.color}
						style:font-size="24px"
						aria-pressed={on}
						aria-label={option.id === 'down' ? 'Down' : `${option.label} mark`}
						title={option.id === 'down' ? 'Down: crosses the token out' : option.label}
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
						{:else}
							<MarkIcon look={option} />
						{/if}
					</button>
				{/each}
				<button class="btn btn-sm col-span-7 justify-self-end" onclick={() => (marking = false)}>
					Done
				</button>
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
					hint="Colours and icons on its rim, or crossed out"
					active={tokens.some((t) => t.marks.length > 0)}
					onclick={() => (marking = true)}
				/>
				<ToolButton
					small
					{tip}
					icon="count"
					label="Number"
					hint="Hit points, charges, rounds left: type +3 or -5 to change it"
					active={tokens.some((t) => t.count !== null)}
					onclick={() => {
						count = one?.count != null ? String(one.count) : '';
						miscounted = false;
						counting = true;
					}}
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
					label={allHidden ? 'Reveal to all players' : 'Hide from players'}
					active={allHidden}
					onclick={hide}
				/>
				<ToolButton
					small
					{tip}
					icon="people"
					label="Show to some players only"
					hint="A secret between them and you"
					active={sharedWith.length > 0}
					onclick={() => (sharing = true)}
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
