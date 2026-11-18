const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Random URL-safe id. 16 characters is roughly 95 bits. */
export function newId(length = 16): string {
	// Rejection sampling keeps the distribution uniform over 62 symbols.
	let out = '';
	while (out.length < length) {
		const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
		for (const b of bytes) {
			if (b < 248 && out.length < length) out += ALPHABET[b % 62];
		}
	}
	return out;
}

/** Long random token for things that act as credentials (sessions, invites). */
export function newToken(): string {
	return newId(40);
}
