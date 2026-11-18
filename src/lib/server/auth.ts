// Accounts and login sessions. The WebSocket server has no copy of this: it
// passes a browser's cookies to the app, which looks the session up here.

import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db';
import { newId, newToken } from './ids';
import { sessions, users } from './schema';

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
		db.insert(users)
			.values({
				id,
				name: username,
				username: username.toLowerCase(),
				passwordHash: hash,
				createdAt: Date.now()
			})
			.run();
	} catch (err) {
		// Drizzle wraps the database's own error, which names the constraint.
		const reason = err instanceof Error && err.cause ? err.cause : err;
		if (String(reason).includes('UNIQUE')) throw new AuthError('That username is taken.');
		throw err;
	}
	return { id, name: username, isGuest: false };
}

export async function verifyLogin(db: Db, rawUsername: unknown, rawPassword: unknown): Promise<User> {
	const username = typeof rawUsername === 'string' ? rawUsername.trim().toLowerCase() : '';
	const password = typeof rawPassword === 'string' ? rawPassword : '';
	const row = db
		.select({ id: users.id, name: users.name, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.username, username))
		.get();

	const ok = row?.passwordHash ? await Bun.password.verify(password, row.passwordHash) : false;
	if (!row || !ok) throw new AuthError('Wrong username or password.');
	return { id: row.id, name: row.name, isGuest: false };
}

/** A player who arrived by invite link: a name, and nothing to log in with. */
export function createGuest(db: Db, rawName: unknown): User {
	const name = cleanName(rawName);
	const id = newId();
	db.insert(users).values({ id, name, createdAt: Date.now() }).run();
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
	db.insert(sessions)
		.values({
			tokenHash: hashToken(token),
			userId,
			expiresAt: Date.now() + SESSION_MAX_AGE * 1000
		})
		.run();
	return token;
}

export function getSessionUser(db: Db, token: string | undefined | null): User | null {
	if (!token) return null;
	const row = db
		.select({
			id: users.id,
			name: users.name,
			isGuest: sql<boolean>`${users.passwordHash} IS NULL`.mapWith(Boolean)
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, Date.now())))
		.get();
	return row ?? null;
}

export function deleteSession(db: Db, token: string | undefined | null) {
	if (token) db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}
