// The colour each person at the table is shown in: their pings, where they
// point, their ruler. Each keeps one colour for as long as this page is
// open. The GM's is the gold of everything else that is the GM's.

import type { Role } from '#lib/shared/types.ts';

const TINTS = [
	'#ff7a90',
	'#5cc8ff',
	'#7be495',
	'#c79bff',
	'#4fe0d0',
	'#ff8ad8',
	'#c3e24f',
	'#8fa2ff'
];
const tints = new Map<string, string>();

export function tintOf(other: { role: Role; userId: string }): string {
	if (other.role === 'gm') return 'var(--color-accent)';
	let tint = tints.get(other.userId);
	if (!tint) tints.set(other.userId, (tint = TINTS[tints.size % TINTS.length]));
	return tint;
}

/**
 * The cursor of the pointing tool: a dot in a ring, so the spot it is on
 * shows through. While the button is down, the dot the table sees is
 * drawn there in its place.
 */
export const POINT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
		'<circle cx="12" cy="12" r="8" fill="none" stroke="#12151c" stroke-width="3.5"/>' +
		'<circle cx="12" cy="12" r="8" fill="none" stroke="#fff8e4" stroke-width="1.5"/>' +
		'<circle cx="12" cy="12" r="3" fill="#fff8e4" stroke="#12151c" stroke-width="1.5"/>' +
		'</svg>'
)}") 12 12, crosshair`;
