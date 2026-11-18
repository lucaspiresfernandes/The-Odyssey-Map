<script lang="ts">
	// The buttons that float beside whatever is selected on a battle map: one
	// token, one drawing, or a whole catch of them. Each button is there only
	// for those it would do something for.
	//
	// A token's label and its lock are the whole table's, and so is copying
	// it. Turning and resizing it are for whoever moves it, while it isn't
	// locked. Hiding it and taking it off the map are the GM's. A drawing is
	// changed and rubbed out by whoever made it, and by the GM.

	import { snapToGrid } from '#lib/shared/grid.ts';
	import { canChangeDrawing, canMoveToken, canRemoveToken } from '#lib/shared/rules.ts';
	import {
		LIMITS,
		ROTATION_STEP,
		type Command,
		type Drawing,
		type MapInfo,
		type Role,
		type Token,
		type TokenInput
	} from '#lib/shared/types.ts';
	import ToolButton from './ToolButton.svelte';

	interface Props {
		map: MapInfo;
		tokens: Token[];
		drawings: Drawing[];
		role: Role;
		userId: string;
		/** Carries the commands out. `note` is said once they are, with a way to undo them. */
		send: (commands: Command[], note?: string) => Promise<boolean>;
		/** Copies were asked for. Whoever carries these out selects what they make. */
		oncopy: (commands: Command[]) => void;
		/** The rest of what a token is: its picture, its colour, whose it is. */
		onedit: (token: Token) => void;
		/** A text is to be reworded, there on the map. */
		onwrite: (drawing: Drawing) => void;
		/** What was selected is on its way out. */
		onclear: () => void;
	}

	let { map, tokens, drawings, role, userId, send, oncopy, onedit, onwrite, onclear }: Props =
		$props();

	const gm = $derived(canRemoveToken(role));
	/** The tokens that can be turned and resized from here. */
	const loose = $derived(tokens.filter((t) => !t.locked && canMoveToken(role, userId, t)));
	const erasable = $derived(drawings.filter((d) => canChangeDrawing(role, userId, d)));
	/** The one token selected, when that is all there is. */
	const one = $derived(tokens.length === 1 && drawings.length === 0 ? tokens[0] : null);
	/** The one text selected, likewise, if it is this person's to reword. */
	const text = $derived(
		tokens.length === 0 && drawings.length === 1 && erasable[0]?.kind === 'text' ? erasable[0] : null
	);
	const allLocked = $derived(tokens.length > 0 && tokens.every((t) => t.locked));
	const allHidden = $derived(tokens.length > 0 && tokens.every((t) => t.hidden));
	const several = $derived(tokens.length > 1);
	const removable = $derived((gm ? tokens.length : 0) + erasable.length);

	let labelling = $state(false);
	let label = $state('');

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

	const update = (token: Token, changes: Partial<TokenInput>): Command => ({
		t: 'token.update',
		id: token.id,
		changes
	});

	function turn(by: number) {
		send(loose.map((t) => update(t, { rotation: (t.rotation + by + 360) % 360 })));
	}

	const fits = (size: number) => size >= 1 && size <= LIMITS.tokenSize;

	function resize(by: number) {
		send(
			loose
				.filter((t) => fits(t.size + by))
				.map((t) => {
					// An even number of cells sits where four meet, an odd one in
					// the middle of a cell: it shifts half a cell to stay square.
					const size = t.size + by;
					const [x, y] = snapToGrid(map, [t.x, t.y], size);
					return update(t, { size, x, y });
				})
		);
	}

	function lock() {
		const locked = !allLocked;
		send(tokens.filter((t) => t.locked !== locked).map((t) => update(t, { locked })));
	}

	function hide() {
		const hidden = !allHidden;
		send(tokens.filter((t) => t.hidden !== hidden).map((t) => update(t, { hidden })));
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
			...(gm ? tokens : []).map((t): Command => ({ t: 'token.delete', id: t.id })),
			...erasable.map((d): Command => ({ t: 'drawing.delete', id: d.id }))
		];
		if (commands.length === 0) return;
		let note = `Deleted ${commands.length} things.`;
		if (commands.length === 1) {
			note =
				gm && tokens.length
					? `Deleted “${tokens[0].name}”.`
					: `Rubbed out the ${erasable[0].kind === 'text' ? 'text' : 'drawing'}.`;
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
		{:else}
			{#if loose.length}
				<ToolButton
					small
					icon="turn-left"
					label="Turn left {ROTATION_STEP}°"
					onclick={() => turn(-ROTATION_STEP)}
				/>
				<ToolButton
					small
					icon="turn-right"
					label="Turn right {ROTATION_STEP}°"
					onclick={() => turn(ROTATION_STEP)}
				/>
				<ToolButton
					small
					icon="shrink"
					label="Make smaller"
					disabled={!loose.some((t) => fits(t.size - 1))}
					onclick={() => resize(-1)}
				/>
				<ToolButton
					small
					icon="grow"
					label="Make bigger"
					disabled={!loose.some((t) => fits(t.size + 1))}
					onclick={() => resize(1)}
				/>
				<span class="w-px self-stretch bg-line"></span>
			{/if}
			{#if tokens.length}
				{#if one}
					<ToolButton
						small
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
					icon={allLocked ? 'unlock' : 'lock'}
					label={allLocked ? 'Unlock' : 'Lock in place'}
					active={allLocked}
					onclick={lock}
				/>
				<ToolButton
					small
					icon="duplicate"
					label={several ? 'Duplicate them' : 'Duplicate'}
					onclick={() => oncopy(tokens.map((t) => ({ t: 'token.duplicate', id: t.id })))}
				/>
				{#if one && canMoveToken(role, userId, one)}
					<ToolButton
						small
						icon="image"
						label="Picture, colour{gm ? ' and owner' : ''}"
						onclick={() => onedit(one)}
					/>
				{/if}
			{/if}
			{#if text}
				<ToolButton small icon="rename" label="Change the text" onclick={() => onwrite(text)} />
			{/if}
			{#if gm && tokens.length}
				<span class="w-px self-stretch bg-line"></span>
				<ToolButton
					small
					icon={allHidden ? 'reveal' : 'hide'}
					label={allHidden ? 'Reveal to players' : 'Hide from players'}
					active={allHidden}
					onclick={hide}
				/>
			{/if}
			{#if removable}
				<ToolButton
					small
					danger
					icon="delete"
					label={removable > 1 ? `Delete all ${removable}` : gm && tokens.length ? 'Delete' : 'Rub out'}
					onclick={remove}
				/>
			{/if}
		{/if}
	</div>
{/if}
