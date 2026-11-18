// Accounts and login sessions. Used by the SvelteKit hooks and by the
// WebSocket server, so both recognise the same session cookie.

import type { Db } from './db';
import { newId, newToken } from './ids';

export const SESSION_COOKIE = 'odyssey_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // seconds

export interface User {
	id: string;
	name: string;
	/** Guests joined through an invite link and have no password. */
	isGuest: boolean;
}

export class AuthError extends Error {}

const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;

function cleanName(raw: unknown): string {
	const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
	if (name.length < 1 || name.length > 40) {
		throw new AuthError('Pick a name between 1 and 40 characters.');
	}
	return name;
}

export async function registerUser(db: Db, rawUsername: unknown, rawPassword: unknown): Promise<User> {
	const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
	const password = typeof rawPassword === 'string' ? rawPassword : '';
	if (!USERNAME.test(username)) {
		throw new AuthError('Usernames are 3 to 32 letters, digits, dots, dashes or underscores.');
	}
	if (password.length < 8 || password.length > 200) {
		throw new AuthError('Passwords need at least 8 characters.');
	}

	const hash = await Bun.password.hash(password);
	const id = newId();
	try {
		db.query(
			'INSERT INTO users (id, name, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, username, username.toLowerCase(), hash, Date.now());
	} catch (err) {
		if (String(err).includes('UNIQUE')) throw new AuthError('That username is taken.');
		throw err;
	}
	return { id, name: username, isGuest: false };
}

export async function verifyLogin(db: Db, rawUsername: unknown, rawPassword: unknown): Promise<User> {
	const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';
	const password = typeof rawPassword === 'string' ? rawPassword : '';
	const row = db
		.query('SELECT id, name, password_hash FROM users WHERE username = ?')
		.get(username) as { id: string; name: string; password_hash: string | null } | null;

	const ok = row?.password_hash ? await Bun.password.verify(password, row.password_hash) : false;
	if (!row || !ok) throw new AuthError('Wrong username or password.');
	return { id: row.id, name: row.name, isGuest: false };
}

/** A player who arrived by invite link: a name, and nothing to log in with. */
export function createGuest(db: Db, rawName: unknown): User {
	const name = cleanName(rawName);
	const id = newId();
	db.query('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(id, name, Date.now());
	return { id, name, isGuest: true };
}

// Only a hash of the session token is stored, so a copy of the database
// can't be replayed as anyone's login.
function hashToken(token: string): string {
	return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

/** Returns the token to put in the session cookie. */
export function createSession(db: Db, userId: string): string {
	const token = newToken();
	db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
		hashToken(token),
		userId,
		Date.now() + SESSION_MAX_AGE * 1000
	);
	return token;
}

export function getSessionUser(db: Db, token: string | undefined | null): User | null {
	if (!token) return null;
	const row = db
		.query(
			`SELECT u.id, u.name, u.password_hash IS NULL AS is_guest
			 FROM sessions s JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash = ? AND s.expires_at > ?`
		)
		.get(hashToken(token), Date.now()) as { id: string; name: string; is_guest: number } | null;
	return row ? { id: row.id, name: row.name, isGuest: row.is_guest === 1 } : null;
}

export function deleteSession(db: Db, token: string | undefined | null) {
	if (token) db.query('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Reads one cookie out of a raw `Cookie` header. */
export function readCookie(header: string | null, name: string): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq !== -1 && part.slice(0, eq).trim() === name) {
			return decodeURIComponent(part.slice(eq + 1).trim());
		}
	}
	return undefined;
}
