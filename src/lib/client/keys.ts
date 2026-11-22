// The keyboard: every key the map answers to, in one table. Whoever listens
// for a key reads it from here, and so do the tooltips and the sheet of
// shortcuts, so the three can't come to say different things.
//
// A key is written the way `chord` reads a press: `Ctrl+Shift+Z`, `Shift+H`,
// `H`, `#`, `ArrowUp`. Ctrl stands for the Command key of a Mac too.
//
// How they were chosen: the tools in hand keep the top row of the keyboard,
// left to right. What is done to a selection is a bare letter, most often
// the first of what it does. Shift with the same letter is its other way
// round, or its bigger brother. Shift with a letter is also what the header
// opens. Ctrl is kept for what every other program has it for.

export const KEY = {
	// Anywhere on a map.
	undo: 'Ctrl+Z',
	redo: 'Ctrl+Shift+Z',
	/** What Windows has always redone with. */
	redoToo: 'Ctrl+Y',
	find: 'Ctrl+K',
	/** The same, for one finger. */
	findToo: '/',
	help: '?',
	zoomIn: '+',
	zoomOut: '-',
	fit: '0',
	/** Back out to the map this one is drawn on, like a folder's way up. */
	out: 'Alt+ArrowUp',
	/** Out of the campaign, to the list of them. It asks first. */
	exit: 'Shift+Q',
	putAway: 'Escape',
	remove: 'Delete',
	selectAll: 'Ctrl+A',

	// The tools in hand. A battle map has all five, a world map the ones it shares.
	hand: 'Q',
	box: 'W',
	ruler: 'E',
	pen: 'R',
	point: 'T',

	// A battle map.
	mine: 'G',
	nextTurn: 'N',
	/** Its other way round: back to the turn before. */
	prevTurn: 'Shift+N',
	rolls: 'Shift+R',
	endFight: 'Shift+E',
	plainToken: 'A',
	grid: '#',
	palettes: '\\',
	/** With the pen in hand: the next ink, and the one before. 1 to 5 choose what it draws. */
	ink: 'C',
	inkBack: 'Shift+C',

	// A world map.
	note: 'N',
	filter: 'V',
	marker: 'M',
	region: 'R',

	// The GM's, on either kind of map.
	fog: 'F',
	fogAll: 'Shift+F',
	fogSwap: 'X',
	brushShape: 'S',
	brushSmaller: '[',
	brushBigger: ']',
	settings: 'Shift+S',
	gallery: 'Shift+G',
	invite: 'Shift+I',
	seats: 'Shift+P',
	display: 'Shift+D',

	// What is selected: tokens, drawings, a marker, a region.
	rename: 'L',
	/** What every file manager renames with. */
	renameToo: 'F2',
	lock: 'K',
	marks: 'M',
	count: 'C',
	duplicate: 'Ctrl+D',
	look: 'P',
	inside: 'Shift+W',
	turns: 'I',
	hide: 'H',
	share: 'Shift+H',
	move: 'G',
	enter: 'Enter'
} as const;

/** The keys that choose what the pen draws, in the order its palette has them. */
export const PEN_KEYS = ['1', '2', '3', '4', '5'];

/** What of a key press tells one from another. A KeyboardEvent is one of these. */
export interface Press {
	key: string;
	code?: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	getModifierState?: (key: string) => boolean;
}

/**
 * A key press, written the way the table above writes its keys. A letter
 * is its capital, whatever Caps Lock says. A sign that takes Shift to type
 * is that sign and no more: `?`, not `Shift+/`, so it is the same key on
 * every layout.
 */
export function chord(e: Press): string {
	let key = e.key === ' ' ? 'Space' : e.key;
	// A keyboard set to another alphabet still has its letters where they were.
	if (key.length === 1 && !/[\x20-\x7e]/.test(key) && /^Key[A-Z]$/.test(e.code ?? '')) {
		key = e.code!.slice(3);
	}
	const letter = /^[a-z]$/i.test(key);
	if (letter) key = key.toUpperCase();
	// AltGr types signs, and Windows reports it as Ctrl and Alt held together.
	const typed = !!e.getModifierState?.('AltGraph') && key.length === 1;
	return [
		(e.ctrlKey || e.metaKey) && !typed && 'Ctrl',
		e.altKey && !typed && 'Alt',
		e.shiftKey && (letter || key.length > 1) && 'Shift',
		key
	]
		.filter(Boolean)
		.join('+');
}

/** Input types that take no text: a letter pressed on one of them is still a shortcut. */
const NOT_TEXT = new Set([
	'range',
	'checkbox',
	'radio',
	'button',
	'submit',
	'reset',
	'file',
	'color',
	'image'
]);

/** Whether a key pressed here is being typed: in a text field, a letter is a letter. */
export function isTyping(target: EventTarget | null): boolean {
	if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
	const field = target.closest('input, textarea, select, [contenteditable]');
	if (!field) return false;
	return !(field instanceof HTMLInputElement && NOT_TEXT.has(field.type));
}

/** Whether the arrow keys have a job of their own here: a slider, a list, a menu. */
export function usesArrows(target: EventTarget | null): boolean {
	if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
	return !!target.closest(
		'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]'
	);
}

/** Whether Enter has a job of its own here: it presses the button, follows the link. */
export function usesEnter(target: EventTarget | null): boolean {
	if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
	return !!target.closest('button, a, input, textarea, select, summary, [contenteditable]');
}

const NAMES: Record<string, string> = {
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Escape: 'Esc',
	Delete: 'Del'
};

/** A key as it is shown to people: `Alt+↑`, `Shift+H`, `Esc`. */
export function keyLabel(key: string): string {
	// The plus sign is a key itself, and the last thing in a chord when it is one.
	const parts = key.endsWith('+') ? [...key.slice(0, -1).split('+').filter(Boolean), '+'] : key.split('+');
	return parts.map((part) => NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join('+');
}

/** The same key as `aria-keyshortcuts` wants it. */
export function ariaKey(key: string): string {
	const last = key.endsWith('+') ? 'Plus' : key.split('+').at(-1)!;
	const held = key.endsWith('+') ? key.slice(0, -1) : key.slice(0, key.length - last.length);
	return held.replace('Ctrl', 'Control') + last;
}

// ------------------------------------------------------------- the sheet

export interface SheetRow {
	/** The keys that do it, each as the table above writes it, or in words: `1 to 5`. */
	keys: string[];
	does: string;
	/** Only the GM has it. */
	gm?: boolean;
}

export interface SheetSection {
	title: string;
	/** Which kind of map it is about, when it is about one. */
	kind?: 'world' | 'battle';
	gm?: boolean;
	rows: SheetRow[];
}

/** Every shortcut, as the sheet lays them out: `?` opens it. */
export const SHEET: SheetSection[] = [
	{
		title: 'Anywhere on a map',
		rows: [
			{ keys: [KEY.help], does: 'Show this sheet' },
			{ keys: [KEY.find, KEY.findToo], does: 'Find a place or a marker' },
			{ keys: [KEY.undo], does: 'Undo' },
			{ keys: [KEY.redo, KEY.redoToo], does: 'Redo' },
			{ keys: [KEY.putAway], does: 'Put the tool away, then let go of what is selected' },
			{ keys: [KEY.remove, 'Backspace'], does: 'Delete what is selected' },
			{ keys: [KEY.selectAll], does: 'Select everything on the map' },
			{ keys: ['Arrows'], does: 'Move the map, or walk the selected tokens a cell' },
			{ keys: [KEY.zoomIn, KEY.zoomOut, KEY.fit], does: 'Zoom in, zoom out, fit the whole map' },
			{ keys: [KEY.out], does: 'Step back out to the map this one is on' },
			{ keys: [KEY.exit], does: 'Exit to your campaigns' }
		]
	},
	{
		title: 'Tools on a battle map',
		kind: 'battle',
		rows: [
			{ keys: [KEY.hand], does: 'Select and move' },
			{ keys: [KEY.box], does: 'Select multiple' },
			{ keys: [KEY.ruler], does: 'Measure a distance' },
			{ keys: [KEY.pen], does: 'Draw' },
			{ keys: [KEY.point], does: 'Point at the map' },
			{ keys: ['1 to 5'], does: 'With the pen: a line, a circle, a cone, a box, text' },
			{ keys: [KEY.ink, KEY.inkBack], does: 'With the pen: the next colour, the one before' },
			{ keys: [KEY.plainToken], does: 'Put down a plain token' },
			{ keys: [KEY.mine], does: 'Go to my token' },
			{ keys: [KEY.palettes], does: 'Fold every palette away, or bring them back' },
			{ keys: [KEY.grid], does: 'Set up the grid', gm: true }
		]
	},
	{
		title: 'Turn order',
		kind: 'battle',
		rows: [
			{ keys: [KEY.nextTurn], does: 'End the turn and go on to the next' },
			{ keys: [KEY.prevTurn], does: 'Go back to the turn before', gm: true },
			{ keys: [KEY.turns], does: 'Put the selected tokens in the order, or take them out', gm: true },
			{ keys: [KEY.rolls], does: 'Sort by what they rolled', gm: true },
			{ keys: [KEY.endFight], does: 'End the fight', gm: true },
			{ keys: ['Alt+ArrowUp', 'Alt+ArrowDown'], does: 'Move the token in focus up or down the order', gm: true }
		]
	},
	{
		title: 'Selected tokens and drawings',
		kind: 'battle',
		rows: [
			{ keys: [KEY.rename, KEY.renameToo], does: 'Label the token, or reword the text' },
			{ keys: [KEY.count], does: 'Number: type 12, +3 or -5' },
			{ keys: [KEY.marks], does: 'Marks' },
			{ keys: [KEY.lock], does: 'Lock in place, or unlock' },
			{ keys: [KEY.duplicate], does: 'Duplicate' },
			{ keys: [KEY.look], does: 'Picture, colour and outline' },
			{ keys: [KEY.inside], does: 'Select the tokens inside the shape' },
			{ keys: [KEY.hide], does: 'Hide from players, or reveal', gm: true },
			{ keys: [KEY.share], does: 'Visibility: who sees it', gm: true }
		]
	},
	{
		title: 'Tools on a world map',
		kind: 'world',
		rows: [
			{ keys: [KEY.hand], does: 'Back to the hand' },
			{ keys: [KEY.box], does: 'Select multiple markers' },
			{ keys: [KEY.ruler], does: 'Measure a distance' },
			{ keys: [KEY.point], does: 'Point at the map' },
			{ keys: [KEY.note], does: 'Add a note' },
			{ keys: [KEY.filter], does: 'Filter markers and regions' },
			{ keys: [KEY.marker], does: 'Add a world marker', gm: true },
			{ keys: [KEY.region], does: 'Draw a region', gm: true }
		]
	},
	{
		title: 'A selected marker or region',
		kind: 'world',
		rows: [
			{ keys: [KEY.rename, KEY.renameToo], does: 'Edit the marker, or rename the region' },
			{ keys: [KEY.move], does: 'Move the marker' },
			{ keys: [KEY.enter], does: 'Enter the region', gm: true },
			{ keys: [KEY.lock], does: 'Close the region to players, or open it', gm: true },
			{ keys: [KEY.hide], does: 'Hide from players, or reveal', gm: true },
			{ keys: [KEY.share], does: 'Visibility: who sees it', gm: true }
		]
	},
	{
		title: 'Fog',
		gm: true,
		rows: [
			{ keys: [KEY.fog], does: 'Take up the fog' },
			{ keys: [KEY.fogSwap], does: 'Swap between clearing and covering' },
			{ keys: [KEY.brushShape], does: 'Swap the round brush and the square one' },
			{ keys: [KEY.brushSmaller, KEY.brushBigger], does: 'A smaller brush, a bigger one' },
			{ keys: [KEY.fogAll], does: 'Cover the whole map, or lift all the fog' }
		]
	},
	{
		title: 'The table',
		gm: true,
		rows: [
			{ keys: [KEY.settings], does: 'Map settings' },
			{ keys: [KEY.gallery], does: 'Gallery' },
			{ keys: [KEY.invite], does: 'Invite' },
			{ keys: [KEY.seats], does: 'Seats: the players of the campaign' },
			{ keys: [KEY.display], does: 'Open the table display' }
		]
	}
];
